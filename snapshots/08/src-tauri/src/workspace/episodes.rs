//! Episodes (회차): `episodes/<number:06>-<id8>/{episode.json, manuscript.md}`.
//!
//! - A new episode is published as one folder (both files appear together or not at all).
//! - The next number is max(existing) + 1, chosen under the work's write lock, so two
//!   independent requests always get different numbers; gaps are kept, never refilled.
//! - `episode.json` records the creating `requestId`; a retried request (even after a restart)
//!   returns the episode it already made instead of making another.
//! - The folder name is fixed at creation. Renaming the title only rewrites `episode.json`,
//!   so the episode ID and every path that points at it stay valid.

use super::error::WsError;
use super::manifest::{TMP_DIR, now_rfc3339, strip_bom};
use super::{Expect, WorkspaceSession, atomic, display_path};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use uuid::Uuid;

pub const EPISODES_DIR: &str = "episodes";
pub const EPISODE_FILE: &str = "episode.json";
pub const MANUSCRIPT_FILE: &str = "manuscript.md";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EpisodeRecord {
    pub episode_id: String,
    pub number: u32,
    #[serde(default)]
    pub title: String,
    pub created_at: String,
    /// The request that created this episode (retry de-duplication across restarts).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EpisodeInfo {
    pub episode_id: String,
    pub number: u32,
    pub title: String,
    pub created_at: String,
    /// Work-relative folder, e.g. `episodes/000003-1a2b3c4d`.
    pub folder: String,
    /// Work-relative manuscript path (what records store).
    pub manuscript_rel: String,
    /// Absolute manuscript path for display / external editors.
    pub manuscript_path: String,
}

/// A folder under `episodes/` that could not be read as an episode. It is shown, never touched.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EpisodeProblem {
    pub folder: String,
    pub detail: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct EpisodeList {
    pub episodes: Vec<EpisodeInfo>,
    pub problems: Vec<EpisodeProblem>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreatedEpisode {
    pub episode: EpisodeInfo,
    /// false when the same request had already created this episode.
    pub created: bool,
}

fn info(s: &WorkspaceSession, folder_name: &str, r: &EpisodeRecord) -> EpisodeInfo {
    let folder = format!("{EPISODES_DIR}/{folder_name}");
    let manuscript_rel = format!("{folder}/{MANUSCRIPT_FILE}");
    EpisodeInfo {
        episode_id: r.episode_id.clone(),
        number: r.number,
        title: r.title.clone(),
        created_at: r.created_at.clone(),
        manuscript_path: display_path(
            &s.root
                .join(EPISODES_DIR)
                .join(folder_name)
                .join(MANUSCRIPT_FILE),
        ),
        folder,
        manuscript_rel,
    }
}

struct Scanned {
    list: EpisodeList,
    records: Vec<(String, EpisodeRecord)>,
}

fn scan(s: &WorkspaceSession) -> Result<Scanned, WsError> {
    let dir = s.root.join(EPISODES_DIR);
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            return Ok(Scanned {
                list: EpisodeList::default(),
                records: Vec::new(),
            });
        }
        Err(e) => return Err(e.into()),
    };
    let mut records: Vec<(String, EpisodeRecord)> = Vec::new();
    let mut problems = Vec::new();
    for entry in entries {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let folder = format!("{EPISODES_DIR}/{name}");
        match fs::read(entry.path().join(EPISODE_FILE)) {
            Ok(bytes) => match serde_json::from_slice::<EpisodeRecord>(strip_bom(&bytes)) {
                Ok(r) if r.number > 0 && !r.episode_id.trim().is_empty() => records.push((name, r)),
                Ok(_) => problems.push(EpisodeProblem {
                    folder,
                    detail: "number must be > 0 and episodeId non-empty".into(),
                }),
                Err(e) => problems.push(EpisodeProblem {
                    folder,
                    detail: e.to_string(),
                }),
            },
            Err(e) => problems.push(EpisodeProblem {
                folder,
                detail: format!("{EPISODE_FILE}: {e}"),
            }),
        }
    }
    // Stable order: number, then creation time, then folder name.
    records.sort_by(|a, b| {
        (a.1.number, &a.1.created_at, &a.0).cmp(&(b.1.number, &b.1.created_at, &b.0))
    });
    // A number or ID used twice (e.g. a hand-copied folder) is reported, not guessed at.
    let mut seen_numbers = std::collections::HashSet::new();
    let mut seen_ids = std::collections::HashSet::new();
    let mut kept = Vec::new();
    for (name, r) in records {
        if !seen_numbers.insert(r.number) || !seen_ids.insert(r.episode_id.clone()) {
            problems.push(EpisodeProblem {
                folder: format!("{EPISODES_DIR}/{name}"),
                detail: format!("duplicate number {} or episodeId", r.number),
            });
            continue;
        }
        kept.push((name, r));
    }
    problems.sort_by(|a, b| a.folder.cmp(&b.folder));
    let episodes = kept.iter().map(|(n, r)| info(s, n, r)).collect();
    Ok(Scanned {
        list: EpisodeList { episodes, problems },
        records: kept,
    })
}

pub fn list(s: &WorkspaceSession) -> Result<EpisodeList, WsError> {
    Ok(scan(s)?.list)
}

/// Highest number in use, including folders reported as duplicates, so a new episode never
/// reuses a number that already appears on disk.
fn max_number_on_disk(s: &WorkspaceSession) -> u32 {
    let Ok(entries) = fs::read_dir(s.root.join(EPISODES_DIR)) else {
        return 0;
    };
    entries
        .flatten()
        .filter_map(|e| fs::read(e.path().join(EPISODE_FILE)).ok())
        .filter_map(|b| serde_json::from_slice::<EpisodeRecord>(strip_bom(&b)).ok())
        .map(|r| r.number)
        .max()
        .unwrap_or(0)
}

/// Creates the next episode, or returns the one this `request_id` already created.
pub fn create_next(s: &WorkspaceSession, request_id: &str) -> Result<CreatedEpisode, WsError> {
    s.ensure_writable()?;
    if request_id.trim().is_empty() {
        return Err(WsError::InvalidRelativePath {
            rel: "requestId".into(),
        });
    }
    let _guard = s.writer_guard()?;
    let scanned = scan(s)?;
    if let Some((name, r)) = scanned
        .records
        .iter()
        .find(|(_, r)| r.request_id.as_deref() == Some(request_id))
    {
        return Ok(CreatedEpisode {
            episode: info(s, name, r),
            created: false,
        });
    }
    let number = max_number_on_disk(s)
        .checked_add(1)
        .ok_or_else(|| WsError::Io {
            kind: "Overflow".into(),
            detail: "episode number overflow".into(),
        })?;
    let id = Uuid::new_v4();
    let record = EpisodeRecord {
        episode_id: id.to_string(),
        number,
        title: String::new(),
        created_at: now_rfc3339(),
        request_id: Some(request_id.to_string()),
        extra: Default::default(),
    };
    let name = format!("{number:06}-{}", &id.simple().to_string()[..8]);
    let body = serde_json::to_vec_pretty(&record).map_err(io::Error::other)?;
    fs::create_dir_all(s.root.join(EPISODES_DIR))?;
    atomic::publish_new_dir(
        &s.root.join(TMP_DIR),
        &s.root.join(EPISODES_DIR).join(&name),
        &[(EPISODE_FILE, &body), (MANUSCRIPT_FILE, b"")],
    )?;
    Ok(CreatedEpisode {
        episode: info(s, &name, &record),
        created: true,
    })
}

pub fn find(s: &WorkspaceSession, episode_id: &str) -> Result<EpisodeInfo, WsError> {
    list(s)?
        .episodes
        .into_iter()
        .find(|e| e.episode_id == episode_id)
        .ok_or_else(|| WsError::NotFound {
            path: format!("episode {episode_id}"),
        })
}

/// Changes only the title in `episode.json`. Folder, ID and manuscript path are unchanged.
pub fn rename(
    s: &WorkspaceSession,
    request_id: &str,
    episode_id: &str,
    title: &str,
) -> Result<EpisodeInfo, WsError> {
    s.ensure_writable()?;
    let ep = find(s, episode_id)?;
    let rel = format!("{}/{EPISODE_FILE}", ep.folder);
    let (bytes, hash) = s.read_file(&rel)?;
    let mut record: EpisodeRecord =
        serde_json::from_slice(strip_bom(&bytes)).map_err(|e| WsError::InvalidManifest {
            detail: format!("{rel}: {e}"),
        })?;
    record.title = title.trim().to_string();
    let body = serde_json::to_vec_pretty(&record).map_err(io::Error::other)?;
    s.write_file(request_id, &rel, &body, Expect::Hash(hash))?;
    find(s, episode_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::{CreateOptions, CreateOutcome, create, open};
    use std::path::{Path, PathBuf};
    use std::sync::Arc;

    fn new_work(base: &Path) -> PathBuf {
        let dir = base.join("잿빛 항구 (테스트) #1 & 'x' 100%");
        fs::create_dir_all(&dir).unwrap();
        let opts = CreateOptions {
            title: "잿빛 항구".into(),
            request_id: "w".into(),
            track_label: "본편".into(),
            confirm_non_empty: false,
        };
        assert!(matches!(
            create(&dir, &opts, None).unwrap(),
            CreateOutcome::Created(_)
        ));
        dir
    }

    // S03.A
    #[test]
    fn s03a_episodes_1_2_3_survive_reopen_in_order_with_absolute_paths() {
        let base = tempfile::tempdir().unwrap();
        let dir = new_work(base.path());
        let s = open(&dir).unwrap();
        assert!(list(&s).unwrap().episodes.is_empty());
        for (i, req) in ["r1", "r2", "r3"].iter().enumerate() {
            let c = create_next(&s, req).unwrap();
            assert!(c.created);
            assert_eq!(c.episode.number, i as u32 + 1);
            assert_eq!(fs::read(&c.episode.manuscript_path).unwrap(), b"");
        }
        drop(s);
        let s = open(&dir).unwrap();
        let eps = list(&s).unwrap();
        assert!(eps.problems.is_empty());
        assert_eq!(
            eps.episodes.iter().map(|e| e.number).collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
        for e in &eps.episodes {
            let p = Path::new(&e.manuscript_path);
            assert!(p.is_absolute(), "{}", e.manuscript_path);
            assert!(p.starts_with(dunce::simplified(&s.root)));
            assert!(p.exists());
            assert!(e.manuscript_rel.starts_with("episodes/"));
            assert!(e.folder.starts_with(&format!("episodes/{:06}-", e.number)));
        }
    }

    // S03.B
    #[test]
    fn s03b_same_request_retry_makes_one_episode_even_after_reopen() {
        let base = tempfile::tempdir().unwrap();
        let dir = new_work(base.path());
        let s = open(&dir).unwrap();
        let a = create_next(&s, "req-same").unwrap();
        let b = create_next(&s, "req-same").unwrap();
        assert!(a.created && !b.created);
        assert_eq!(a.episode, b.episode);
        drop(s);
        let s = open(&dir).unwrap();
        let c = create_next(&s, "req-same").unwrap();
        assert!(!c.created);
        assert_eq!(c.episode.episode_id, a.episode.episode_id);
        assert_eq!(list(&s).unwrap().episodes.len(), 1);
    }

    #[test]
    fn s03b_concurrent_independent_requests_get_distinct_consecutive_numbers() {
        let base = tempfile::tempdir().unwrap();
        let dir = new_work(base.path());
        let s = Arc::new(open(&dir).unwrap());
        let handles: Vec<_> = (0..8)
            .map(|i| {
                let s = Arc::clone(&s);
                std::thread::spawn(move || create_next(&s, &format!("req-{i}")).unwrap())
            })
            .collect();
        let mut nums: Vec<u32> = handles
            .into_iter()
            .map(|h| h.join().unwrap().episode.number)
            .collect();
        nums.sort();
        assert_eq!(nums, (1..=8).collect::<Vec<_>>());

        // Same request from several threads at once: still exactly one new episode.
        let handles: Vec<_> = (0..6)
            .map(|_| {
                let s = Arc::clone(&s);
                std::thread::spawn(move || create_next(&s, "double-click").unwrap())
            })
            .collect();
        let made: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
        assert_eq!(made.iter().filter(|m| m.created).count(), 1);
        assert!(made.iter().all(|m| m.episode.number == 9));
        assert_eq!(list(&s).unwrap().episodes.len(), 9);
    }

    #[test]
    fn gaps_are_kept_and_next_follows_the_maximum() {
        let base = tempfile::tempdir().unwrap();
        let dir = new_work(base.path());
        let s = open(&dir).unwrap();
        for r in ["a", "b", "c"] {
            create_next(&s, r).unwrap();
        }
        // The writer deletes episode 2 by hand: 3 is still the max, next is 4.
        let two = list(&s).unwrap().episodes[1].folder.clone();
        fs::remove_dir_all(s.root.join(&two)).unwrap();
        assert_eq!(create_next(&s, "d").unwrap().episode.number, 4);
        assert_eq!(
            list(&s)
                .unwrap()
                .episodes
                .iter()
                .map(|e| e.number)
                .collect::<Vec<_>>(),
            vec![1, 3, 4]
        );
    }

    #[test]
    fn broken_and_duplicate_folders_are_reported_not_touched() {
        let base = tempfile::tempdir().unwrap();
        let dir = new_work(base.path());
        let s = open(&dir).unwrap();
        let one = create_next(&s, "a").unwrap().episode;
        // Hand-copied folder: same number and id.
        let copy = s.root.join("episodes/000001-copy");
        fs::create_dir_all(&copy).unwrap();
        fs::copy(
            s.root.join(&one.folder).join(EPISODE_FILE),
            copy.join(EPISODE_FILE),
        )
        .unwrap();
        fs::create_dir_all(s.root.join("episodes/메모")).unwrap();
        fs::write(s.root.join("episodes/메모/note.txt"), "작가 메모").unwrap();
        let l = list(&s).unwrap();
        assert_eq!(l.episodes.len(), 1);
        assert_eq!(l.problems.len(), 2);
        assert_eq!(create_next(&s, "b").unwrap().episode.number, 2);
        assert_eq!(
            fs::read_to_string(s.root.join("episodes/메모/note.txt")).unwrap(),
            "작가 메모"
        );
    }

    #[test]
    fn rename_keeps_id_folder_and_manuscript() {
        let base = tempfile::tempdir().unwrap();
        let dir = new_work(base.path());
        let s = open(&dir).unwrap();
        let e = create_next(&s, "a").unwrap().episode;
        fs::write(&e.manuscript_path, "서린은 손끝에 불을 피웠다.").unwrap();
        let r = rename(&s, "t1", &e.episode_id, "  각성  ").unwrap();
        assert_eq!(r.title, "각성");
        assert_eq!(r.episode_id, e.episode_id);
        assert_eq!(r.folder, e.folder);
        assert_eq!(
            fs::read_to_string(&r.manuscript_path).unwrap(),
            "서린은 손끝에 불을 피웠다."
        );
    }

    #[test]
    fn read_only_work_cannot_create() {
        let base = tempfile::tempdir().unwrap();
        let dir = new_work(base.path());
        let _owner = open(&dir).unwrap();
        let second = open(&dir).unwrap();
        assert!(matches!(
            create_next(&second, "x"),
            Err(WsError::ReadOnly { .. })
        ));
    }
}
