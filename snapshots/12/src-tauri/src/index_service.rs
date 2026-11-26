//! Background owner of the search index (session 11).
//!
//! - One connection to the current work's cache file (`workspace::search::cache_path`).
//! - `sync_and` runs an incremental sync before every search, so edits made in the app, made
//!   outside while it ran, or made while it was closed are all picked up.
//! - `start_rebuild` builds a fresh index on a worker thread into `<cache>.building`; searches
//!   keep using the current file meanwhile. Each rebuild gets a generation number; a newer
//!   rebuild or `cancel` makes the older one stop and discard its file. When a build finishes it
//!   is swapped in under the lock and followed by one incremental sync, so a file edited while
//!   the build was reading is not missed.
//! - 12: `search` numbers each request. A newer request stops the older one (its sync and its
//!   scan check a cancel flag) and the screen drops any answer that is not the latest. The sync
//!   before a search has a time budget (`SEARCH_SYNC_BUDGET`); when it runs out the search uses
//!   what is indexed so far and says how many documents are still waiting (`pending`), and the
//!   screen asks again. When the cache had to be replaced on open (damaged / other version) the
//!   next result carries `reopened` once.

use crate::workspace::WorkspaceSession;
use crate::workspace::error::WsError;
use crate::workspace::search::{self, OpenHow, SearchResult, SyncError, SyncLimit, SyncStats};
use rusqlite::Connection;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatus {
    /// idle | ready | rebuilding | error
    pub state: String,
    pub generation: u64,
    pub docs: i64,
    pub fts5: bool,
    pub path: String,
    pub last: Option<SyncStats>,
    pub last_rebuild: Option<SyncStats>,
    pub error: Option<String>,
    /// How the cache file was obtained the last time it was opened (12).
    pub opened: Option<OpenHow>,
}

/// Indexing time the sync before a search may take before searching what is indexed so far
/// (12). Counted after the source list is read; every pass indexes at least one document.
pub const SEARCH_SYNC_BUDGET: std::time::Duration = std::time::Duration::from_millis(1500);

#[derive(Default)]
struct Open {
    path: Option<PathBuf>,
    conn: Option<Connection>,
}

#[derive(Default)]
pub struct IndexService {
    open: Mutex<Open>,
    status: Mutex<IndexStatus>,
    generation: AtomicU64,
    cancel: Mutex<Arc<AtomicBool>>,
    /// The newest search request number and its cancel flag (12).
    search_seq: AtomicU64,
    search_cancel: Mutex<Arc<AtomicBool>>,
    /// Debug tool: re-index at most this many documents per search sync (partial results).
    pub max_changed: Mutex<Option<usize>>,
    /// Set when the cache was replaced on open; reported once with the next search result.
    unreported_open: Mutex<Option<OpenHow>>,
}

fn poisoned() -> WsError {
    WsError::Io {
        kind: "Poisoned".into(),
        detail: "index lock poisoned".into(),
    }
}

fn sync_err(e: SyncError) -> WsError {
    match e {
        SyncError::Cancelled => WsError::Io {
            kind: "Cancelled".into(),
            detail: "index sync cancelled".into(),
        },
        SyncError::Failed(e) => e,
    }
}

impl IndexService {
    fn set_status(&self, f: impl FnOnce(&mut IndexStatus)) {
        if let Ok(mut st) = self.status.lock() {
            f(&mut st);
        }
    }

    pub fn status(&self) -> IndexStatus {
        let mut st = self.status.lock().map(|s| s.clone()).unwrap_or_default();
        st.fts5 = search::fts5_trigram_available();
        if st.state.is_empty() {
            st.state = "idle".into();
        }
        st
    }

    /// Opens the cache for `s` (switching works closes the old one), syncs it, then runs `f`.
    pub fn sync_and<T>(
        &self,
        cache_dir: &Path,
        s: &WorkspaceSession,
        f: impl FnOnce(&Connection) -> Result<T, WsError>,
    ) -> Result<T, WsError> {
        self.sync_limited_and(
            cache_dir,
            s,
            &AtomicBool::new(false),
            SyncLimit::default(),
            |c, _| f(c),
        )
    }

    fn sync_limited_and<T>(
        &self,
        cache_dir: &Path,
        s: &WorkspaceSession,
        cancel: &AtomicBool,
        limit: SyncLimit,
        f: impl FnOnce(&Connection, &SyncStats) -> Result<T, WsError>,
    ) -> Result<T, WsError> {
        let path = search::cache_path(cache_dir, &s.workspace_id, &s.root);
        let mut open = self.open.lock().map_err(|_| poisoned())?;
        if open.path.as_deref() != Some(path.as_path()) || open.conn.is_none() {
            open.conn = None;
            let (c, how) = search::open_index_ex(&path, &s.workspace_id, &s.root)?;
            open.conn = Some(c);
            open.path = Some(path.clone());
            self.set_status(|st| st.opened = Some(how));
            if matches!(how, OpenHow::ReplacedDamaged | OpenHow::ReplacedVersion)
                && let Ok(mut u) = self.unreported_open.lock()
            {
                *u = Some(how);
            }
        }
        let conn = open.conn.as_mut().expect("opened above");
        let stats = search::sync_limited(conn, s, cancel, limit).map_err(sync_err)?;
        let docs = search::doc_count(conn)?;
        let rebuilding = self
            .status
            .lock()
            .map(|st| st.state == "rebuilding")
            .unwrap_or(false);
        self.set_status(|st| {
            if !rebuilding {
                st.state = "ready".into();
            }
            st.docs = docs;
            st.path = path.display().to_string();
            st.last = Some(stats.clone());
            st.error = None;
        });
        f(conn, &stats)
    }

    /// One search request (12). `request` must grow; a newer request cancels this one.
    pub fn search(
        &self,
        cache_dir: &Path,
        s: &WorkspaceSession,
        request: u64,
        query: &str,
        options: &search::SearchOptions,
    ) -> Result<SearchResult, WsError> {
        let cancel = Arc::new(AtomicBool::new(false));
        if let Ok(mut c) = self.search_cancel.lock() {
            if self.search_seq.fetch_max(request, Ordering::SeqCst) > request {
                return Err(search::cancelled()); // a newer request is already here
            }
            c.store(true, Ordering::SeqCst);
            *c = cancel.clone();
        }
        let limit = SyncLimit {
            budget: Some(SEARCH_SYNC_BUDGET),
            max_changed: self.max_changed.lock().ok().and_then(|m| *m),
        };
        let stop = || cancel.load(Ordering::SeqCst);
        let mut r = self
            .sync_limited_and(cache_dir, s, &cancel, limit, |c, stats| {
                let mut r = search::search_with(c, query, options, &stop)?;
                r.pending = stats.pending;
                Ok(r)
            })
            .map_err(|e| match e {
                WsError::Io { ref kind, .. } if kind == "Cancelled" => search::cancelled(),
                e => e,
            })?;
        r.request = request;
        r.rebuilding = self.status().state == "rebuilding";
        r.reopened = self.unreported_open.lock().ok().and_then(|mut u| u.take());
        Ok(r)
    }

    /// Stops the running search, if any (12 ‘검색 취소’).
    pub fn cancel_search(&self) {
        if let Ok(c) = self.search_cancel.lock() {
            c.store(true, Ordering::SeqCst);
        }
    }

    /// Debug tool (12): closes the cache and overwrites its file with junk (damaged cache).
    pub fn damage_cache(&self, cache_dir: &Path, s: &WorkspaceSession) -> Result<String, WsError> {
        let path = search::cache_path(cache_dir, &s.workspace_id, &s.root);
        let mut open = self.open.lock().map_err(|_| poisoned())?;
        open.conn = None;
        open.path = None;
        search::remove_db_files(&path);
        if let Some(d) = path.parent() {
            std::fs::create_dir_all(d)?;
        }
        std::fs::write(&path, b"not a database: damaged by the 12 debug tool")?;
        Ok(path.display().to_string())
    }

    /// Starts a rebuild on a worker thread and returns its generation.
    pub fn start_rebuild(self: &Arc<Self>, cache_dir: PathBuf, s: Arc<WorkspaceSession>) -> u64 {
        let my_gen = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let cancel = Arc::new(AtomicBool::new(false));
        if let Ok(mut c) = self.cancel.lock() {
            c.store(true, Ordering::SeqCst); // the previous rebuild, if any, stops
            *c = cancel.clone();
        }
        self.set_status(|st| {
            st.state = "rebuilding".into();
            st.generation = my_gen;
            st.error = None;
        });
        let me = self.clone();
        std::thread::spawn(move || {
            let path = search::cache_path(&cache_dir, &s.workspace_id, &s.root);
            let result = search::build_fresh(&path, &s, &cancel);
            let current = me.generation.load(Ordering::SeqCst) == my_gen;
            match result {
                Ok((building, stats)) if current && !cancel.load(Ordering::SeqCst) => {
                    let swapped = (|| -> Result<(), WsError> {
                        let mut open = me.open.lock().map_err(|_| poisoned())?;
                        open.conn = None; // close before replacing the file
                        search::swap_in(&building, &path).map_err(sync_err)?;
                        open.path = None;
                        Ok(())
                    })();
                    me.set_status(|st| {
                        st.last_rebuild = Some(stats);
                        match swapped {
                            Ok(()) => st.state = "ready".into(),
                            Err(e) => {
                                st.state = "error".into();
                                st.error = Some(format!("{e:?}"));
                            }
                        }
                    });
                    // catch anything edited while the build was reading
                    let _ = me.sync_and(&cache_dir, &s, |_| Ok(()));
                }
                // superseded or cancelled after finishing: drop only the new file
                Ok((building, _)) => search::remove_db_files(&building),
                Err(SyncError::Cancelled) => {
                    if current {
                        me.set_status(|st| st.state = "ready".into());
                    }
                }
                Err(SyncError::Failed(e)) => {
                    if current {
                        me.set_status(|st| {
                            st.state = "error".into();
                            st.error = Some(format!("{e:?}"));
                        });
                    }
                }
            }
        });
        my_gen
    }

    pub fn cancel(&self) {
        if let Ok(c) = self.cancel.lock() {
            c.store(true, Ordering::SeqCst);
        }
    }

    /// Closes the connection and deletes the cache files of `s` (debug tool; the work is not touched).
    pub fn delete_cache(&self, cache_dir: &Path, s: &WorkspaceSession) -> Result<String, WsError> {
        let path = search::cache_path(cache_dir, &s.workspace_id, &s.root);
        let mut open = self.open.lock().map_err(|_| poisoned())?;
        open.conn = None;
        open.path = None;
        search::delete_cache(&path);
        self.set_status(|st| {
            st.state = "idle".into();
            st.docs = 0;
        });
        Ok(path.display().to_string())
    }

    /// Forget the connection when the work closes.
    pub fn close(&self) {
        if let Ok(mut open) = self.open.lock() {
            open.conn = None;
            open.path = None;
        }
        self.cancel();
        self.set_status(|st| *st = IndexStatus::default());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::open;
    use crate::workspace::sample::make_sample;
    use crate::workspace::search::SearchOptions;

    fn setup() -> (tempfile::TempDir, PathBuf, WorkspaceSession) {
        let b = tempfile::tempdir().unwrap();
        let dir = b.path().join("작품");
        make_sample(&dir, "검색", 3).unwrap();
        let s = open(&dir).unwrap();
        let cache = b.path().join("appdata");
        (b, cache, s)
    }

    // S12.C (backend half): an answer for an older request never comes back after a newer one.
    #[test]
    fn older_request_after_newer_is_cancelled() {
        let (_b, cache, s) = setup();
        let svc = IndexService::default();
        let o = SearchOptions::default();
        let r = svc.search(&cache, &s, 5, "화", &o).unwrap();
        assert_eq!(r.request, 5);
        let e = svc.search(&cache, &s, 4, "불", &o).unwrap_err();
        assert_eq!(e, search::cancelled());
        assert_eq!(svc.search(&cache, &s, 6, "불씨", &o).unwrap().request, 6);
    }

    #[test]
    fn damaged_cache_is_reported_once_then_partial_results_complete() {
        let (_b, cache, s) = setup();
        let svc = IndexService::default();
        let o = SearchOptions::default();
        svc.search(&cache, &s, 1, "화", &o).unwrap();
        svc.damage_cache(&cache, &s).unwrap();
        if let Ok(mut m) = svc.max_changed.lock() {
            *m = Some(1);
        }
        let r = svc.search(&cache, &s, 2, "화", &o).unwrap();
        assert_eq!(r.reopened, Some(OpenHow::ReplacedDamaged));
        assert!(r.pending > 0, "partial while indexing");
        let mut n = 3;
        loop {
            let r = svc.search(&cache, &s, n, "화", &o).unwrap();
            assert_eq!(r.reopened, None, "reported once");
            if r.pending == 0 {
                break;
            }
            n += 1;
            assert!(n < 60);
        }
        assert_eq!(svc.status().opened, Some(OpenHow::ReplacedDamaged));
    }
}
