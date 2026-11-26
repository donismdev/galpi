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

use crate::workspace::WorkspaceSession;
use crate::workspace::error::WsError;
use crate::workspace::search::{self, SyncError, SyncStats};
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
}

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
        let path = search::cache_path(cache_dir, &s.workspace_id, &s.root);
        let mut open = self.open.lock().map_err(|_| poisoned())?;
        if open.path.as_deref() != Some(path.as_path()) || open.conn.is_none() {
            open.conn = None;
            let (c, _) = search::open_index(&path, &s.workspace_id, &s.root)?;
            open.conn = Some(c);
            open.path = Some(path.clone());
        }
        let conn = open.conn.as_mut().expect("opened above");
        let stats = search::sync(conn, s, &AtomicBool::new(false)).map_err(sync_err)?;
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
            st.last = Some(stats);
            st.error = None;
        });
        f(conn)
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
