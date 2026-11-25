//! Episode commits (회차 커밋, session 06).
//!
//! `episodes/<folder>/history/r<ordinal:03>/{revision.json, manuscript.md}` — the manuscript is a
//! byte-for-byte copy of the working file at commit time. A revision folder is staged in
//! `.galpi/tmp/` and published with one rename, so after a crash there is either no new revision
//! or a complete one; leftover staging folders are removed on the next open. Revisions are never
//! modified or deleted by the app. A folder whose files do not match its recorded hash is reported
//! as a problem and left out of the history list (never "repaired").
//!
//! Rules
//! - Same `requestId` again (double click, retry, even after a restart) → the revision it made.
//! - Working file identical to the latest revision → `noChange`, nothing is written.
//! - `expectedHash` (what the editor last read/saved) must match the file on disk; otherwise
//!   `writeConflict` — the UI re-reads (or resolves a conflict) before committing.
//! - Restoring an old revision only rewrites the working file (normal save); the next commit adds
//!   a new revision after the existing ones.

use super::episodes;
use super::error::WsError;
use super::manifest::{APP_DIR, TMP_DIR, now_rfc3339, strip_bom};
use super::manuscript::{self, LineEnding, decode};
use super::{WorkspaceSession, atomic, content_hash, display_path};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub const HISTORY_DIR: &str = "history";
pub const REVISION_FILE: &str = "revision.json";
const SNAPSHOT_FILE: &str = "manuscript.md";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RevisionRecord {
    pub revision_id: String,
    pub episode_id: String,
    pub parent_revision_id: Option<String>,
    pub ordinal: u32,
    pub created_at: String,
    #[serde(default)]
    pub message: String,
    /// sha256 of the stored manuscript bytes (not of normalized text).
    pub content_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RevisionInfo {
    pub revision_id: String,
    pub episode_id: String,
    pub parent_revision_id: Option<String>,
    pub ordinal: u32,
    pub created_at: String,
    pub message: String,
    pub content_hash: String,
    pub size: u64,
    /// Work-relative folder, e.g. `episodes/000001-ab/history/r002`.
    pub folder: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryProblem {
    pub folder: String,
    pub detail: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct History {
    /// Oldest first.
    pub revisions: Vec<RevisionInfo>,
    pub problems: Vec<HistoryProblem>,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CommitOutcome {
    Created,
    /// The same request already made this revision.
    SameRequest,
    /// The working file equals the latest revision; nothing was written.
    NoChange,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitResult {
    pub outcome: CommitOutcome,
    /// The new revision (Created), the earlier one (SameRequest) or the latest (NoChange).
    pub revision: RevisionInfo,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RevisionText {
    pub revision_id: String,
    pub ordinal: u32,
    /// LF text (comparison and restore work on this).
    pub text: String,
    pub bom: bool,
    pub line_ending: LineEnding,
    pub content_hash: String,
}

/// Where a commit can be stopped in tests (and, in debug builds, via `GALPI_FAILPOINT`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CommitStep {
    /// Snapshot staged in .galpi/tmp, not yet published.
    BeforePublish,
    /// Revision folder published.
    AfterPublish,
}

impl CommitStep {
    fn name(self) -> &'static str {
        match self {
            CommitStep::BeforePublish => "commit-before-publish",
            CommitStep::AfterPublish => "commit-after-publish",
        }
    }
}

#[derive(Debug)]
pub struct CommitInterrupted(pub CommitStep);

fn failpoint(step: CommitStep, stop_at: Option<CommitStep>) -> Result<(), CommitInterrupted> {
    #[cfg(debug_assertions)]
    if std::env::var("GALPI_FAILPOINT").is_ok_and(|v| v == step.name()) {
        eprintln!("GALPI_FAILPOINT={} - aborting process", step.name());
        std::process::abort();
    }
    let _ = step.name();
    if stop_at == Some(step) {
        Err(CommitInterrupted(step))
    } else {
        Ok(())
    }
}

fn history_dir(s: &WorkspaceSession, episode_id: &str) -> Result<(String, PathBuf), WsError> {
    let ep = episodes::find(s, episode_id)?;
    let dir = s.root.join(&ep.folder).join(HISTORY_DIR);
    Ok((format!("{}/{HISTORY_DIR}", ep.folder), dir))
}

fn read_revision_folder(dir: &Path) -> Result<(RevisionRecord, u64), String> {
    let rec: RevisionRecord = serde_json::from_slice(strip_bom(
        &fs::read(dir.join(REVISION_FILE)).map_err(|e| format!("{REVISION_FILE}: {e}"))?,
    ))
    .map_err(|e| format!("{REVISION_FILE}: {e}"))?;
    let bytes = fs::read(dir.join(SNAPSHOT_FILE)).map_err(|e| format!("{SNAPSHOT_FILE}: {e}"))?;
    let h = content_hash(&bytes);
    if h != rec.content_hash {
        return Err(format!(
            "content hash mismatch (recorded {}, actual {h})",
            rec.content_hash
        ));
    }
    Ok((rec, bytes.len() as u64))
}

pub fn list(s: &WorkspaceSession, episode_id: &str) -> Result<History, WsError> {
    let (rel, dir) = history_dir(s, episode_id)?;
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(History::default()),
        Err(e) => return Err(e.into()),
    };
    let mut revisions = Vec::new();
    let mut problems = Vec::new();
    for entry in entries {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let folder = format!("{rel}/{name}");
        match read_revision_folder(&entry.path()) {
            Ok((r, size)) if r.episode_id == episode_id => revisions.push(RevisionInfo {
                revision_id: r.revision_id,
                episode_id: r.episode_id,
                parent_revision_id: r.parent_revision_id,
                ordinal: r.ordinal,
                created_at: r.created_at,
                message: r.message,
                content_hash: r.content_hash,
                size,
                folder,
            }),
            Ok((r, _)) => problems.push(HistoryProblem {
                folder,
                detail: format!("belongs to another episode ({})", r.episode_id),
            }),
            Err(detail) => problems.push(HistoryProblem { folder, detail }),
        }
    }
    revisions.sort_by(|a, b| (a.ordinal, &a.created_at).cmp(&(b.ordinal, &b.created_at)));
    problems.sort_by(|a, b| a.folder.cmp(&b.folder));
    Ok(History {
        revisions,
        problems,
    })
}

/// The newest revision of an episode, if any (07: "reviewed against which revision").
pub fn latest(s: &WorkspaceSession, episode_id: &str) -> Result<Option<RevisionInfo>, WsError> {
    Ok(list(s, episode_id)?.revisions.pop())
}

pub fn read(
    s: &WorkspaceSession,
    episode_id: &str,
    revision_id: &str,
) -> Result<RevisionText, WsError> {
    let h = list(s, episode_id)?;
    let info = h
        .revisions
        .into_iter()
        .find(|r| r.revision_id == revision_id)
        .ok_or_else(|| WsError::NotFound {
            path: format!("revision {revision_id}"),
        })?;
    let bytes = fs::read(s.root.join(&info.folder).join(SNAPSHOT_FILE))?;
    let (bom, text, line_ending, _) = decode(&bytes).map_err(|at| WsError::InvalidManifest {
        detail: format!("revision {} is not UTF-8 (byte {at})", info.ordinal),
    })?;
    Ok(RevisionText {
        revision_id: info.revision_id,
        ordinal: info.ordinal,
        text,
        bom,
        line_ending,
        content_hash: info.content_hash,
    })
}

/// Highest ordinal on disk, counting folders reported as problems too (never reuse a number).
fn max_ordinal_on_disk(dir: &Path) -> u32 {
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .filter_map(|e| {
            let n = e.file_name().to_string_lossy().into_owned();
            let from_name = n.strip_prefix('r').and_then(|d| d.parse::<u32>().ok());
            let from_json = fs::read(e.path().join(REVISION_FILE))
                .ok()
                .and_then(|b| serde_json::from_slice::<RevisionRecord>(strip_bom(&b)).ok())
                .map(|r| r.ordinal);
            from_name.max(from_json)
        })
        .max()
        .unwrap_or(0)
}

pub enum CommitRun {
    Done(CommitResult),
    Interrupted(CommitStep),
}

pub fn commit(
    s: &WorkspaceSession,
    request_id: &str,
    episode_id: &str,
    message: &str,
    expected_hash: Option<&str>,
) -> Result<CommitResult, WsError> {
    match commit_with(s, request_id, episode_id, message, expected_hash, None)? {
        CommitRun::Done(r) => Ok(r),
        CommitRun::Interrupted(step) => Err(WsError::Io {
            kind: "Interrupted".into(),
            detail: format!("{step:?}"),
        }),
    }
}

pub fn commit_with(
    s: &WorkspaceSession,
    request_id: &str,
    episode_id: &str,
    message: &str,
    expected_hash: Option<&str>,
    stop_at: Option<CommitStep>,
) -> Result<CommitRun, WsError> {
    s.ensure_writable()?;
    if request_id.trim().is_empty() {
        return Err(WsError::InvalidRelativePath {
            rel: "requestId".into(),
        });
    }
    // An unresolved conflict / recovery copy must be settled first (05).
    if manuscript::load_draft(s, episode_id)?.is_some() {
        return Err(WsError::WriteConflict {
            expected: expected_hash.map(str::to_string),
            actual: None,
        });
    }
    let (rel, dir) = history_dir(s, episode_id)?;
    let _guard = s.writer_guard()?;

    // Same request again → what it made the first time.
    let existing = list(s, episode_id)?;
    for r in &existing.revisions {
        let rec_path = s.root.join(&r.folder).join(REVISION_FILE);
        let same = fs::read(&rec_path)
            .ok()
            .and_then(|b| serde_json::from_slice::<RevisionRecord>(strip_bom(&b)).ok())
            .and_then(|rec| rec.request_id)
            .is_some_and(|id| id == request_id);
        if same {
            return Ok(CommitRun::Done(CommitResult {
                outcome: CommitOutcome::SameRequest,
                revision: r.clone(),
            }));
        }
    }

    let manuscript = manuscript::file_path(s, episode_id)?;
    let bytes = fs::read(&manuscript)?;
    let hash = content_hash(&bytes);
    if let Some(exp) = expected_hash
        && exp != hash
    {
        return Err(WsError::WriteConflict {
            expected: Some(exp.to_string()),
            actual: Some(hash),
        });
    }
    let latest = existing.revisions.last().cloned();
    if let Some(l) = &latest
        && l.content_hash == hash
    {
        return Ok(CommitRun::Done(CommitResult {
            outcome: CommitOutcome::NoChange,
            revision: l.clone(),
        }));
    }

    let ordinal = max_ordinal_on_disk(&dir) + 1;
    let record = RevisionRecord {
        revision_id: Uuid::new_v4().to_string(),
        episode_id: episode_id.to_string(),
        parent_revision_id: latest.as_ref().map(|l| l.revision_id.clone()),
        ordinal,
        created_at: now_rfc3339(),
        message: message.trim().to_string(),
        content_hash: hash,
        request_id: Some(request_id.to_string()),
        extra: Default::default(),
    };
    let name = format!("r{ordinal:03}");
    let body = serde_json::to_vec_pretty(&record).map_err(io::Error::other)?;
    fs::create_dir_all(&dir)?;

    if stop_at == Some(CommitStep::BeforePublish)
        || std::env::var("GALPI_FAILPOINT").is_ok_and(|v| v == CommitStep::BeforePublish.name())
    {
        // Stage exactly as publish would, then stop before the rename.
        let stage = s.root.join(TMP_DIR).join(format!(
            "{}{}",
            Uuid::new_v4().simple(),
            atomic::TMP_DIR_SUFFIX
        ));
        fs::create_dir_all(&stage)?;
        fs::write(stage.join(REVISION_FILE), &body)?;
        fs::write(stage.join(SNAPSHOT_FILE), &bytes)?;
        if let Err(CommitInterrupted(step)) = failpoint(CommitStep::BeforePublish, stop_at) {
            return Ok(CommitRun::Interrupted(step));
        }
    }
    atomic::publish_new_dir(
        &s.root.join(TMP_DIR),
        &dir.join(&name),
        &[(REVISION_FILE, &body), (SNAPSHOT_FILE, &bytes)],
    )?;
    if let Err(CommitInterrupted(step)) = failpoint(CommitStep::AfterPublish, stop_at) {
        return Ok(CommitRun::Interrupted(step));
    }
    let info = RevisionInfo {
        revision_id: record.revision_id,
        episode_id: record.episode_id,
        parent_revision_id: record.parent_revision_id,
        ordinal,
        created_at: record.created_at,
        message: record.message,
        content_hash: record.content_hash,
        size: bytes.len() as u64,
        folder: format!("{rel}/{name}"),
    };
    Ok(CommitRun::Done(CommitResult {
        outcome: CommitOutcome::Created,
        revision: info,
    }))
}

/// Keeps a copy of the current working file before a restore replaces it
/// (`.galpi/backups/<episodeId>/<time>.md`). Returns the absolute path.
pub fn backup_working_copy(s: &WorkspaceSession, episode_id: &str) -> Result<String, WsError> {
    s.ensure_writable()?;
    let src = manuscript::file_path(s, episode_id)?;
    let bytes = fs::read(&src)?;
    let dir = s.root.join(APP_DIR).join("backups").join(episode_id);
    fs::create_dir_all(&dir)?;
    let stamp = now_rfc3339().replace([':', '.'], "-");
    let target = dir.join(format!(
        "{stamp}-{}.md",
        &Uuid::new_v4().simple().to_string()[..6]
    ));
    atomic::publish_new(&s.root.join(TMP_DIR), &target, &bytes)?;
    Ok(display_path(&target))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::manuscript::{ManuscriptRead, read as read_ms, save};
    use crate::workspace::open;
    use crate::workspace::sample::make_sample;

    fn work(n: u32) -> (tempfile::TempDir, PathBuf, WorkspaceSession, Vec<String>) {
        let base = tempfile::tempdir().unwrap();
        let dir = base.path().join("이력 시험 (06)");
        let made = make_sample(&dir, "이력", n).unwrap();
        let ids = made.episodes.iter().map(|e| e.episode_id.clone()).collect();
        let s = open(&dir).unwrap();
        (base, dir, s, ids)
    }

    fn write_text(s: &WorkspaceSession, id: &str, text: &str) -> String {
        let h = match read_ms(s, id).unwrap() {
            ManuscriptRead::Ok { hash, .. } => hash,
            other => panic!("{other:?}"),
        };
        save(
            s,
            &Uuid::new_v4().to_string(),
            id,
            text,
            Some(&h),
            false,
            LineEnding::Lf,
        )
        .unwrap()
        .hash
    }

    fn c(s: &WorkspaceSession, req: &str, id: &str, msg: &str) -> CommitResult {
        commit(s, req, id, msg, None).unwrap()
    }

    // S06.A — r1, r2, r3; same content; same request; external save right before commit.
    #[test]
    fn s06a_three_revisions_same_content_same_request_and_external_save() {
        let (_b, _d, s, ids) = work(1);
        let id = &ids[0];
        write_text(&s, id, "서린은 손끝에 불을 피웠다.");
        let r1 = c(&s, "a", id, "초고");
        assert_eq!(
            (r1.outcome, r1.revision.ordinal),
            (CommitOutcome::Created, 1)
        );
        assert_eq!(r1.revision.parent_revision_id, None);
        // Same content, new request → no change.
        let same = c(&s, "b", id, "다시");
        assert_eq!(same.outcome, CommitOutcome::NoChange);
        assert_eq!(same.revision.revision_id, r1.revision.revision_id);
        write_text(&s, id, "서린은 남은 불씨를 감지했다.");
        let r2 = c(&s, "c", id, "퇴고");
        // Same request again (double click / retry) → same revision, nothing new.
        let again = c(&s, "c", id, "퇴고");
        assert_eq!(again.outcome, CommitOutcome::SameRequest);
        assert_eq!(again.revision, r2.revision);
        // External save just before commit: the editor's expected hash is stale → refused.
        let h_editor = write_text(&s, id, "앱에서 저장한 문장");
        fs::write(
            manuscript::file_path(&s, id).unwrap(),
            "VS Code가 방금 저장한 문장",
        )
        .unwrap();
        assert!(matches!(
            commit(&s, "d", id, "3차", Some(&h_editor)),
            Err(WsError::WriteConflict { .. })
        ));
        // After re-reading, the commit stores exactly the disk bytes.
        let disk_h = content_hash("VS Code가 방금 저장한 문장".as_bytes());
        let r3 = commit(&s, "e", id, "3차", Some(&disk_h)).unwrap();
        assert_eq!(r3.revision.ordinal, 3);
        assert_eq!(
            r3.revision.parent_revision_id.as_deref(),
            Some(r2.revision.revision_id.as_str())
        );
        let h = list(&s, id).unwrap();
        assert_eq!(
            h.revisions.iter().map(|r| r.ordinal).collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
        assert_eq!(
            read(&s, id, &r1.revision.revision_id).unwrap().text,
            "서린은 손끝에 불을 피웠다."
        );
        assert_eq!(
            read(&s, id, &r3.revision.revision_id).unwrap().text,
            "VS Code가 방금 저장한 문장"
        );
        assert_eq!(
            latest(&s, id).unwrap().unwrap().revision_id,
            r3.revision.revision_id
        );
    }

    #[test]
    fn concurrent_commits_with_one_request_make_one_revision() {
        let (_b, _d, s, ids) = work(1);
        let s = std::sync::Arc::new(s);
        write_text(&s, &ids[0], "동시 클릭");
        let id = ids[0].clone();
        let hs: Vec<_> = (0..6)
            .map(|_| {
                let s = s.clone();
                let id = id.clone();
                std::thread::spawn(move || commit(&s, "click", &id, "", None).unwrap().outcome)
            })
            .collect();
        let outs: Vec<_> = hs.into_iter().map(|h| h.join().unwrap()).collect();
        assert_eq!(
            outs.iter()
                .filter(|o| **o == CommitOutcome::Created)
                .count(),
            1
        );
        assert_eq!(list(&s, &id).unwrap().revisions.len(), 1);
    }

    // S06.B — stop just before and just after publishing; reopen shows old or complete new only.
    #[test]
    fn s06b_interrupted_commit_before_and_after_publish() {
        let (_b, dir, s, ids) = work(1);
        let id = &ids[0];
        write_text(&s, id, "r1");
        c(&s, "a", id, "");
        write_text(&s, id, "r2 직전 중단");
        let run = commit_with(&s, "b", id, "", None, Some(CommitStep::BeforePublish)).unwrap();
        assert!(matches!(
            run,
            CommitRun::Interrupted(CommitStep::BeforePublish)
        ));
        drop(s);
        let s = open(&dir).unwrap(); // restart: staging leftovers removed
        assert!(s.recovery.tmp_files_removed >= 1);
        assert_eq!(
            list(&s, id).unwrap().revisions.len(),
            1,
            "half commit must not appear"
        );
        // Same request after restart publishes normally.
        let r2 = c(&s, "b", id, "");
        assert_eq!(
            (r2.outcome, r2.revision.ordinal),
            (CommitOutcome::Created, 2)
        );

        write_text(&s, id, "r3 직후 중단");
        let run = commit_with(&s, "c", id, "", None, Some(CommitStep::AfterPublish)).unwrap();
        assert!(matches!(
            run,
            CommitRun::Interrupted(CommitStep::AfterPublish)
        ));
        drop(s);
        let s = open(&dir).unwrap();
        let h = list(&s, id).unwrap();
        assert_eq!(
            h.revisions.iter().map(|r| r.ordinal).collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
        assert!(h.problems.is_empty());
        // Retry of the interrupted request finds the complete revision.
        assert_eq!(c(&s, "c", id, "").outcome, CommitOutcome::SameRequest);
    }

    // S06.C — two episodes do not mix; restore + r4 keeps r2/r3 bytes and hashes.
    #[test]
    fn s06c_histories_are_separate_and_old_revisions_survive_restore() {
        let (_b, _d, s, ids) = work(2);
        let (a, b) = (&ids[0], &ids[1]);
        write_text(&s, a, "A1");
        c(&s, "a1", a, "");
        write_text(&s, b, "B1");
        c(&s, "b1", b, "");
        write_text(&s, a, "A2");
        let r2 = c(&s, "a2", a, "").revision;
        write_text(&s, a, "A3");
        let r3 = c(&s, "a3", a, "").revision;
        assert_eq!(list(&s, a).unwrap().revisions.len(), 3);
        assert_eq!(list(&s, b).unwrap().revisions.len(), 1);
        let snap = |r: &RevisionInfo| fs::read(s.root.join(&r.folder).join(SNAPSHOT_FILE)).unwrap();
        let (b2, b3) = (snap(&r2), snap(&r3));
        // Restore r2 into the working copy (with a backup), then commit → r4.
        let backup = backup_working_copy(&s, a).unwrap();
        assert_eq!(fs::read_to_string(&backup).unwrap(), "A3");
        write_text(&s, a, &read(&s, a, &r2.revision_id).unwrap().text);
        let r4 = c(&s, "a4", a, "r2로 복원").revision;
        assert_eq!(r4.ordinal, 4);
        assert_eq!(r4.content_hash, r2.content_hash);
        assert_eq!(snap(&r2), b2);
        assert_eq!(snap(&r3), b3);
        assert_eq!(
            list(&s, a).unwrap().revisions[1].content_hash,
            content_hash(&b2)
        );
    }

    #[test]
    fn damaged_revision_is_reported_and_its_number_never_reused() {
        let (_b, _d, s, ids) = work(1);
        let id = &ids[0];
        write_text(&s, id, "하나");
        let r1 = c(&s, "a", id, "").revision;
        fs::write(s.root.join(&r1.folder).join(SNAPSHOT_FILE), "몰래 바뀜").unwrap();
        let h = list(&s, id).unwrap();
        assert!(h.revisions.is_empty());
        assert_eq!(h.problems.len(), 1);
        write_text(&s, id, "둘");
        assert_eq!(c(&s, "b", id, "").revision.ordinal, 2);
    }

    #[test]
    fn commit_waits_for_an_unresolved_conflict_and_keeps_bytes_exact() {
        let (_b, _d, s, ids) = work(1);
        let id = &ids[0];
        let bom_crlf = "\u{feff}첫 줄\r\n둘째 줄\r\n";
        fs::write(manuscript::file_path(&s, id).unwrap(), bom_crlf).unwrap();
        manuscript::save_draft(&s, id, Some("sha256:x"), Some(""), "충돌 중").unwrap();
        assert!(matches!(
            commit(&s, "a", id, "", None),
            Err(WsError::WriteConflict { .. })
        ));
        manuscript::discard_draft(&s, id).unwrap();
        let r = c(&s, "a", id, "").revision;
        assert_eq!(
            fs::read(s.root.join(&r.folder).join(SNAPSHOT_FILE)).unwrap(),
            bom_crlf.as_bytes()
        );
        let t = read(&s, id, &r.revision_id).unwrap();
        assert!(t.bom && t.line_ending == LineEnding::Crlf);
        assert_eq!(t.text, "첫 줄\n둘째 줄\n");
    }
}
