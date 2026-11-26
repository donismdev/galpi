//! Disk-change hints for manuscripts (session 05).
//!
//! The OS watcher (ReadDirectoryChangesW on Windows) only tells us *that something happened* to a
//! path. We never trust the event kind: after a short quiet period (`DEBOUNCE`) every touched
//! `episodes/*/manuscript.md` is re-read and identified by its content hash. So
//! - an editor's "write temp file + rename over" save, or a burst of events, becomes one change;
//! - opening/closing a program or changing only the timestamp produces no change (same hash);
//! - our own saves are recognised by hash (`WorkspaceSession::was_own_write`) and not reported.
//!
//! Every report carries the session and work IDs so a late report for a work that was already
//! closed or replaced can be ignored (S05.C).

use super::WorkspaceSession;
use super::content_hash;
use super::episodes::{EPISODE_FILE, EPISODES_DIR, MANUSCRIPT_FILE};
use super::manifest::strip_bom;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{RecvTimeoutError, channel};
use std::sync::{Arc, Weak};
use std::time::Duration;

pub const DEBOUNCE: Duration = Duration::from_millis(200);

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiskChange {
    pub session_id: String,
    pub workspace_id: String,
    pub episode_id: String,
    pub exists: bool,
    /// Content hash, or None if the file is missing or could not be read (e.g. locked).
    pub hash: Option<String>,
}

/// Keeps the OS watcher alive; dropping it stops watching and ends the debounce thread.
pub struct WatchHandle {
    _watcher: RecommendedWatcher,
}

/// Current state of one manuscript on disk (also used on window focus / manual refresh).
pub fn probe(path: &Path) -> (bool, Option<String>) {
    match std::fs::read(path) {
        Ok(b) => (true, Some(content_hash(&b))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (false, None),
        Err(_) => (path.exists(), None),
    }
}

fn episode_id_of(manuscript: &Path) -> Option<String> {
    let folder = manuscript.parent()?;
    let bytes = std::fs::read(folder.join(EPISODE_FILE)).ok()?;
    let v: serde_json::Value = serde_json::from_slice(strip_bom(&bytes)).ok()?;
    v.get("episodeId")?.as_str().map(str::to_string)
}

/// `<root>/episodes/<folder>/manuscript.md` → that path; anything else → None.
fn manuscript_of(root: &Path, p: &Path) -> Option<PathBuf> {
    let rel = p.strip_prefix(root).ok()?;
    let parts: Vec<_> = rel.components().collect();
    if parts.len() == 3
        && parts[0].as_os_str().eq_ignore_ascii_case(EPISODES_DIR)
        && parts[2].as_os_str().eq_ignore_ascii_case(MANUSCRIPT_FILE)
    {
        Some(
            root.join(EPISODES_DIR)
                .join(parts[1].as_os_str())
                .join(MANUSCRIPT_FILE),
        )
    } else {
        None
    }
}

pub fn start(
    session: &Arc<WorkspaceSession>,
    emit: impl Fn(DiskChange) + Send + 'static,
) -> notify::Result<WatchHandle> {
    let root = session.root.clone();
    // Never create anything here: watching is read-only. Works always have episodes/ (02 layout).
    let episodes_dir = root.join(EPISODES_DIR);
    let (tx, rx) = channel::<PathBuf>();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            for p in ev.paths {
                let _ = tx.send(p);
            }
        }
    })?;
    watcher.watch(&episodes_dir, RecursiveMode::Recursive)?;

    let weak: Weak<WorkspaceSession> = Arc::downgrade(session);
    let session_id = session.session_id.clone();
    let workspace_id = session.workspace_id.clone();
    std::thread::Builder::new()
        .name("galpi-watch".into())
        .spawn(move || {
            let mut pending: HashSet<PathBuf> = HashSet::new();
            loop {
                match rx.recv_timeout(DEBOUNCE) {
                    Ok(p) => {
                        if let Some(m) = manuscript_of(&root, &p) {
                            pending.insert(m);
                        }
                    }
                    Err(RecvTimeoutError::Timeout) => {
                        if pending.is_empty() {
                            continue;
                        }
                        let Some(s) = weak.upgrade() else { return };
                        for m in pending.drain() {
                            let (exists, hash) = probe(&m);
                            if let Some(h) = &hash
                                && s.was_own_write(&m, h)
                            {
                                continue; // our own save
                            }
                            let Some(episode_id) = episode_id_of(&m) else {
                                continue;
                            };
                            emit(DiskChange {
                                session_id: session_id.clone(),
                                workspace_id: workspace_id.clone(),
                                episode_id,
                                exists,
                                hash,
                            });
                        }
                    }
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
        })
        .map_err(|e| notify::Error::generic(&e.to_string()))?;
    Ok(WatchHandle { _watcher: watcher })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::sample::make_sample;
    use crate::workspace::{Expect, open};
    use std::sync::mpsc::Receiver;
    use std::time::Instant;

    fn setup() -> (tempfile::TempDir, Arc<WorkspaceSession>, String, PathBuf) {
        let base = tempfile::tempdir().unwrap();
        let dir = base.path().join("감시 시험 (05)");
        let s = make_sample(&dir, "감시", 2).unwrap();
        let ep = s.episodes[0].clone();
        let session = Arc::new(open(&dir).unwrap());
        (
            base,
            session,
            ep.episode_id,
            PathBuf::from(ep.manuscript_path),
        )
    }

    fn collect(rx: &Receiver<DiskChange>, wait: Duration) -> Vec<DiskChange> {
        let end = Instant::now() + wait;
        let mut out = Vec::new();
        while let Some(left) = end.checked_duration_since(Instant::now()) {
            match rx.recv_timeout(left) {
                Ok(c) => out.push(c),
                Err(_) => break,
            }
        }
        out
    }

    fn watched(s: &Arc<WorkspaceSession>) -> (WatchHandle, Receiver<DiskChange>) {
        let (tx, rx) = channel();
        let h = start(s, move |c| {
            let _ = tx.send(c);
        })
        .unwrap();
        std::thread::sleep(Duration::from_millis(150)); // let the OS watch settle
        (h, rx)
    }

    // S05.A external edit / replace-save / delete; S05.D touch is silent; own writes are silent.
    #[test]
    fn s05a_reports_content_changes_once_with_hash_and_ignores_own_writes() {
        let (_b, s, id, m) = setup();
        let (_h, rx) = watched(&s);

        std::fs::write(&m, "VS Code에서 쓴 문장").unwrap();
        let got = collect(&rx, Duration::from_millis(1200));
        assert_eq!(got.len(), 1, "{got:?}");
        assert_eq!(got[0].episode_id, id);
        assert_eq!(got[0].session_id, s.session_id);
        assert_eq!(
            got[0].hash.as_deref(),
            Some(content_hash("VS Code에서 쓴 문장".as_bytes()).as_str())
        );

        // Editor-style save: write a temp file next to it, then rename over (several raw events).
        let tmp = m.with_file_name("manuscript.md.tmp~");
        std::fs::write(&tmp, "교체 저장한 문장").unwrap();
        std::fs::rename(&tmp, &m).unwrap();
        let got = collect(&rx, Duration::from_millis(1200));
        assert_eq!(got.len(), 1, "{got:?}");
        assert_eq!(
            got[0].hash.as_deref(),
            Some(content_hash("교체 저장한 문장".as_bytes()).as_str())
        );

        // Our own save through the write path: no report.
        let (_, h) = s
            .read_file(&format!(
                "episodes/{}/manuscript.md",
                m.parent().unwrap().file_name().unwrap().to_string_lossy()
            ))
            .unwrap();
        let rel = format!(
            "episodes/{}/manuscript.md",
            m.parent().unwrap().file_name().unwrap().to_string_lossy()
        );
        s.write_file("own", &rel, "앱이 저장한 문장".as_bytes(), Expect::Hash(h))
            .unwrap();
        let got = collect(&rx, Duration::from_millis(1000));
        assert!(got.is_empty(), "own write reported: {got:?}");

        // Delete.
        std::fs::remove_file(&m).unwrap();
        let got = collect(&rx, Duration::from_millis(1200));
        assert_eq!(got.len(), 1, "{got:?}");
        assert!(!got[0].exists && got[0].hash.is_none());
    }

    #[test]
    fn s05d_timestamp_only_change_is_reported_with_the_same_hash() {
        // The watcher may see a metadata event; the hash is unchanged, so the UI ignores it.
        let (_b, s, _id, m) = setup();
        std::fs::write(&m, "그대로인 문장").unwrap();
        let expected = content_hash("그대로인 문장".as_bytes());
        let (_h, rx) = watched(&s);
        let f = std::fs::OpenOptions::new().write(true).open(&m).unwrap();
        f.set_modified(std::time::SystemTime::now() + Duration::from_secs(60))
            .unwrap();
        drop(f);
        for c in collect(&rx, Duration::from_millis(1000)) {
            assert_eq!(c.hash.as_deref(), Some(expected.as_str()));
        }
    }

    #[test]
    fn s05c_reports_carry_their_session_and_stop_after_drop() {
        let (_b, s, _id, m) = setup();
        let (h, rx) = watched(&s);
        drop(h);
        std::thread::sleep(Duration::from_millis(300));
        std::fs::write(&m, "닫은 뒤의 변경").unwrap();
        let got = collect(&rx, Duration::from_millis(800));
        assert!(got.is_empty(), "{got:?}");
    }

    #[test]
    fn only_manuscripts_are_mapped() {
        let root = Path::new(r"C:\w");
        assert!(manuscript_of(root, Path::new(r"C:\w\episodes\000001-a\manuscript.md")).is_some());
        assert!(manuscript_of(root, Path::new(r"C:\w\episodes\000001-a\episode.json")).is_none());
        assert!(
            manuscript_of(
                root,
                Path::new(r"C:\w\episodes\000001-a\manuscript.md.tmp~")
            )
            .is_none()
        );
        assert!(manuscript_of(root, Path::new(r"C:\w\lore\x\manuscript.md")).is_none());
    }
}
