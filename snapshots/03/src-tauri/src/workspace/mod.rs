//! Work-folder core: inspect a folder, create a work, open/close it, and the single write path
//! (validated relative path + expected version + atomic publish) every later feature uses.

pub mod atomic;
pub mod episodes;
pub mod error;
pub mod manifest;
pub mod paths;

use error::{ReadOnlyReason, WsError};
use manifest::{
    APP_DIR, INIT_MARKER, InitMarker, LAYOUT_DIRS, LOCK_FILE, MANIFEST_FILE, Manifest,
    ManifestRead, RESERVED_TOP, SCHEMA_VERSION, StoryTrack, TMP_DIR,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use uuid::Uuid;

pub fn display_path(p: &Path) -> String {
    dunce::simplified(p).display().to_string()
}

pub fn content_hash(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

// ---------------------------------------------------------------- inspect

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FolderKind {
    /// No entries: a new work can be created.
    Empty,
    /// Has unrelated entries. Creating needs confirmation, and is refused if `conflicts` is non-empty.
    NonEmpty,
    /// A previous create stopped before workspace.json was published; it can be resumed.
    IncompleteInit,
    Workspace,
    /// Created by a newer galpi; opens read-only and is never modified.
    NewerWorkspace,
    /// workspace.json exists but cannot be read; nothing is touched.
    InvalidWorkspace,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Inspection {
    pub path: String,
    pub kind: FolderKind,
    pub title: Option<String>,
    pub workspace_id: Option<String>,
    pub schema_version: Option<u64>,
    pub entry_count: usize,
    pub conflicts: Vec<String>,
    pub suggestion: Option<String>,
    pub detail: Option<String>,
}

fn require_dir(path: &Path) -> Result<(), WsError> {
    match fs::metadata(path) {
        Ok(m) if m.is_dir() => Ok(()),
        Ok(_) => Err(WsError::NotADirectory {
            path: display_path(path),
        }),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Err(WsError::NotFound {
            path: display_path(path),
        }),
        Err(e) => Err(e.into()),
    }
}

/// A sibling-free subfolder name inside `path` that does not exist yet.
fn suggest_subfolder(path: &Path, base: &str) -> Option<String> {
    let base = if paths::validate_relative(base).is_ok() && !base.contains(['/', '\\']) {
        base.to_string()
    } else {
        "galpi".to_string()
    };
    (1..100).find_map(|n| {
        let name = if n == 1 {
            base.clone()
        } else {
            format!("{base} ({n})")
        };
        let p = path.join(&name);
        (!p.exists()).then(|| display_path(&p))
    })
}

pub fn inspect(path: &Path, suggest_name: &str) -> Result<Inspection, WsError> {
    require_dir(path)?;
    let mut names = Vec::new();
    for entry in fs::read_dir(path)? {
        names.push(entry?.file_name().to_string_lossy().into_owned());
    }
    names.sort();
    let mut out = Inspection {
        path: display_path(path),
        kind: FolderKind::Empty,
        title: None,
        workspace_id: None,
        schema_version: None,
        entry_count: names.len(),
        conflicts: Vec::new(),
        suggestion: None,
        detail: None,
    };
    match manifest::read_manifest(path)? {
        ManifestRead::Ok(m) => {
            out.kind = FolderKind::Workspace;
            out.title = Some(m.title);
            out.workspace_id = Some(m.workspace_id);
            out.schema_version = Some(u64::from(m.schema_version));
            return Ok(out);
        }
        ManifestRead::Newer { found, title } => {
            out.kind = FolderKind::NewerWorkspace;
            out.title = title;
            out.schema_version = Some(found);
            return Ok(out);
        }
        ManifestRead::Invalid(detail) => {
            out.kind = FolderKind::InvalidWorkspace;
            out.detail = Some(detail);
            return Ok(out);
        }
        ManifestRead::Missing => {}
    }
    if let Some(marker) = manifest::read_init_marker(path)? {
        out.kind = FolderKind::IncompleteInit;
        out.title = Some(marker.title);
        out.workspace_id = Some(marker.workspace_id);
        return Ok(out);
    }
    if names.is_empty() {
        return Ok(out);
    }
    out.kind = FolderKind::NonEmpty;
    // Windows file names are case-insensitive: `Episodes` collides with `episodes`.
    out.conflicts = names
        .iter()
        .filter(|n| RESERVED_TOP.iter().any(|r| r.eq_ignore_ascii_case(n)))
        .cloned()
        .collect();
    if !out.conflicts.is_empty() {
        out.suggestion = suggest_subfolder(path, suggest_name);
    }
    Ok(out)
}

// ---------------------------------------------------------------- create

/// Creates `path` as a new folder if it does not exist. Only the last component is created:
/// the parent must already be an existing folder. An existing folder is accepted as is.
pub fn ensure_leaf_folder(path: &Path) -> Result<(), WsError> {
    if path.is_dir() {
        return Ok(());
    }
    let parent = path.parent().ok_or_else(|| WsError::NotFound {
        path: display_path(path),
    })?;
    require_dir(parent)?;
    match fs::create_dir(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists && path.is_dir() => Ok(()),
        Err(e) => Err(e.into()),
    }
}

#[derive(Clone, Debug)]
pub struct CreateOptions {
    pub title: String,
    pub request_id: String,
    pub track_label: String,
    pub confirm_non_empty: bool,
}

/// Points where a create can be stopped in tests (and, in debug builds, via `GALPI_FAILPOINT`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InitStep {
    AfterMarker,
    AfterDirs,
    AfterManifest,
}

impl InitStep {
    fn name(self) -> &'static str {
        match self {
            InitStep::AfterMarker => "init-after-marker",
            InitStep::AfterDirs => "init-after-dirs",
            InitStep::AfterManifest => "init-after-manifest",
        }
    }
}

/// Simulated crash: returned instead of finishing, leaving the folder exactly as a real crash would.
#[derive(Debug)]
pub struct Interrupted(pub InitStep);

fn check_failpoint(step: InitStep, stop_at: Option<InitStep>) -> Result<(), Interrupted> {
    #[cfg(debug_assertions)]
    if std::env::var("GALPI_FAILPOINT").is_ok_and(|v| v == step.name()) {
        eprintln!("GALPI_FAILPOINT={} - aborting process", step.name());
        std::process::abort();
    }
    let _ = step.name();
    if stop_at == Some(step) {
        Err(Interrupted(step))
    } else {
        Ok(())
    }
}

pub enum CreateOutcome {
    Created(Manifest),
    Interrupted(InitStep),
}

/// Creates (or resumes creating) a work in `path`. Never overwrites or deletes an existing entry.
pub fn create(
    path: &Path,
    opts: &CreateOptions,
    stop_at: Option<InitStep>,
) -> Result<CreateOutcome, WsError> {
    let info = inspect(path, &opts.title)?;
    match info.kind {
        FolderKind::Workspace => {
            return Err(WsError::AlreadyWorkspace {
                workspace_id: info.workspace_id.unwrap_or_default(),
            });
        }
        FolderKind::NewerWorkspace => {
            return Err(WsError::NewerSchema {
                found: info.schema_version.unwrap_or_default(),
                supported: SCHEMA_VERSION,
            });
        }
        FolderKind::InvalidWorkspace => {
            return Err(WsError::InvalidManifest {
                detail: info.detail.unwrap_or_default(),
            });
        }
        FolderKind::NonEmpty if !info.conflicts.is_empty() => {
            return Err(WsError::NameConflicts {
                conflicts: info.conflicts,
                suggestion: info.suggestion,
            });
        }
        FolderKind::NonEmpty if !opts.confirm_non_empty => {
            return Err(WsError::NeedsConfirmation {
                entry_count: info.entry_count,
            });
        }
        FolderKind::Empty | FolderKind::NonEmpty | FolderKind::IncompleteInit => {}
    }

    let tmp_dir = path.join(TMP_DIR);
    // 1. Marker first: if we stop anywhere after this, the next attempt resumes with the same ID.
    let marker = match manifest::read_init_marker(path)? {
        Some(m) => m,
        None => {
            let m = InitMarker {
                workspace_id: Uuid::new_v4().to_string(),
                title: opts.title.trim().to_string(),
                track_id: Uuid::new_v4().to_string(),
                track_label: opts.track_label.trim().to_string(),
                request_id: opts.request_id.clone(),
                started_at: manifest::now_rfc3339(),
            };
            fs::create_dir_all(path.join(APP_DIR))?;
            let body = serde_json::to_vec_pretty(&m).map_err(io::Error::other)?;
            atomic::publish_new(&tmp_dir, &path.join(INIT_MARKER), &body)?;
            m
        }
    };
    if let Err(Interrupted(s)) = check_failpoint(InitStep::AfterMarker, stop_at) {
        return Ok(CreateOutcome::Interrupted(s));
    }

    // 2. Layout. create_dir_all succeeds on our own existing dirs and fails on a same-named file.
    for d in LAYOUT_DIRS {
        fs::create_dir_all(path.join(d))?;
    }
    if let Err(Interrupted(s)) = check_failpoint(InitStep::AfterDirs, stop_at) {
        return Ok(CreateOutcome::Interrupted(s));
    }

    // 3. Publish workspace.json — the commit point. Never replaces an existing file.
    let m = Manifest {
        schema_version: SCHEMA_VERSION,
        workspace_id: marker.workspace_id.clone(),
        title: marker.title.clone(),
        story_tracks: vec![StoryTrack {
            track_id: marker.track_id.clone(),
            label: marker.track_label.clone(),
            extra: Default::default(),
        }],
        created_at: marker.started_at.clone(),
        extra: Default::default(),
    };
    let body = serde_json::to_vec_pretty(&m).map_err(io::Error::other)?;
    atomic::publish_new(&tmp_dir, &path.join(MANIFEST_FILE), &body)?;
    if let Err(Interrupted(s)) = check_failpoint(InitStep::AfterManifest, stop_at) {
        return Ok(CreateOutcome::Interrupted(s));
    }

    // 4. Done: drop the marker.
    fs::remove_file(path.join(INIT_MARKER))?;
    Ok(CreateOutcome::Created(m))
}

// ---------------------------------------------------------------- open / session

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OpenMode {
    ReadWrite,
    ReadOnly,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Recovery {
    /// Leftover temp files from an interrupted write, removed on open.
    pub tmp_files_removed: usize,
    /// workspace.json was published but the init marker was still there; the marker was removed.
    pub init_marker_cleared: bool,
}

/// What a write must find on disk before it may publish.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Expect {
    /// The file must not exist yet.
    Absent,
    /// The file's current bytes must hash to this value (from `read_file`).
    Hash(String),
}

pub struct WorkspaceSession {
    pub session_id: String,
    pub root: PathBuf,
    pub workspace_id: String,
    pub title: String,
    pub schema_version: u64,
    pub mode: OpenMode,
    pub read_only_reason: Option<ReadOnlyReason>,
    pub recovery: Recovery,
    /// Holds the OS lock on `.galpi/lock` for the session's lifetime (released on drop/crash).
    _lock: Option<fs::File>,
    /// Serialises writes in this work folder; also remembers finished request IDs.
    writer: Mutex<HashMap<String, String>>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenedWorkspace {
    pub session_id: String,
    pub root: String,
    pub workspace_id: String,
    pub title: String,
    pub schema_version: u64,
    pub mode: OpenMode,
    pub read_only_reason: Option<ReadOnlyReason>,
    pub recovery: Recovery,
}

fn is_permission(e: &io::Error) -> bool {
    matches!(
        e.kind(),
        io::ErrorKind::PermissionDenied | io::ErrorKind::ReadOnlyFilesystem
    )
}

/// Tries to take the write lock and prove the folder is writable. Returns `Err(reason)` for read-only.
fn acquire_write(root: &Path) -> Result<fs::File, ReadOnlyReason> {
    let readonly_manifest = fs::metadata(root.join(MANIFEST_FILE))
        .map(|m| m.permissions().readonly())
        .unwrap_or(false);
    if readonly_manifest {
        return Err(ReadOnlyReason::NoWritePermission);
    }
    if fs::create_dir_all(root.join(APP_DIR)).is_err() {
        return Err(ReadOnlyReason::NoWritePermission);
    }
    let lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(root.join(LOCK_FILE))
        .map_err(|e| {
            if is_permission(&e) {
                ReadOnlyReason::NoWritePermission
            } else {
                ReadOnlyReason::LockedByOther
            }
        })?;
    match lock.try_lock() {
        Ok(()) => {}
        Err(fs::TryLockError::WouldBlock) => return Err(ReadOnlyReason::LockedByOther),
        Err(fs::TryLockError::Error(_)) => return Err(ReadOnlyReason::NoWritePermission),
    }
    // Probe: a real temp write + remove in our own folder.
    let tmp = root.join(TMP_DIR);
    let probe = (|| {
        fs::create_dir_all(&tmp)?;
        let p = tmp.join(format!(
            "probe-{}{}",
            Uuid::new_v4().simple(),
            atomic::TMP_SUFFIX
        ));
        fs::write(&p, b"probe")?;
        fs::remove_file(&p)
    })();
    match probe {
        Ok(()) => Ok(lock),
        Err(_) => Err(ReadOnlyReason::NoWritePermission),
    }
}

pub fn open(path: &Path) -> Result<WorkspaceSession, WsError> {
    require_dir(path)?;
    let root = dunce::canonicalize(path)?;
    let session_id = Uuid::new_v4().to_string();
    let manifest = match manifest::read_manifest(&root)? {
        ManifestRead::Ok(m) => m,
        ManifestRead::Newer { found, title } => {
            // Never write anything into a folder from a newer build: no lock, no cleanup.
            return Ok(WorkspaceSession {
                session_id,
                workspace_id: String::new(),
                title: title.unwrap_or_default(),
                schema_version: found,
                mode: OpenMode::ReadOnly,
                read_only_reason: Some(ReadOnlyReason::NewerSchema),
                recovery: Recovery::default(),
                root,
                _lock: None,
                writer: Mutex::new(HashMap::new()),
            });
        }
        ManifestRead::Invalid(detail) => return Err(WsError::InvalidManifest { detail }),
        ManifestRead::Missing => {
            return Err(WsError::NotAWorkspace {
                path: display_path(&root),
            });
        }
    };

    let (lock, reason) = match acquire_write(&root) {
        Ok(l) => (Some(l), None),
        Err(r) => (None, Some(r)),
    };
    let mut recovery = Recovery::default();
    if lock.is_some() {
        recovery.tmp_files_removed = atomic::cleanup_tmp(&root.join(TMP_DIR))?;
        let marker = root.join(INIT_MARKER);
        if marker.exists() {
            fs::remove_file(marker)?;
            recovery.init_marker_cleared = true;
        }
    }
    Ok(WorkspaceSession {
        session_id,
        workspace_id: manifest.workspace_id,
        title: manifest.title,
        schema_version: u64::from(manifest.schema_version),
        mode: if lock.is_some() {
            OpenMode::ReadWrite
        } else {
            OpenMode::ReadOnly
        },
        read_only_reason: reason,
        recovery,
        root,
        _lock: lock,
        writer: Mutex::new(HashMap::new()),
    })
}

impl WorkspaceSession {
    pub fn summary(&self) -> OpenedWorkspace {
        OpenedWorkspace {
            session_id: self.session_id.clone(),
            root: display_path(&self.root),
            workspace_id: self.workspace_id.clone(),
            title: self.title.clone(),
            schema_version: self.schema_version,
            mode: self.mode,
            read_only_reason: self.read_only_reason,
            recovery: self.recovery.clone(),
        }
    }

    /// Refuses in read-only mode.
    pub fn ensure_writable(&self) -> Result<(), WsError> {
        match self.read_only_reason {
            Some(reason) => Err(WsError::ReadOnly { reason }),
            None => Ok(()),
        }
    }

    /// Holds the per-work write lock. Multi-step operations (e.g. "next number + publish")
    /// run entirely under it so two requests can never pick the same number.
    pub(crate) fn writer_guard(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, HashMap<String, String>>, WsError> {
        self.writer.lock().map_err(|_| WsError::Io {
            kind: "Poisoned".into(),
            detail: "writer lock poisoned".into(),
        })
    }

    /// Reads a file inside the work folder and returns its bytes and version hash.
    pub fn read_file(&self, rel: &str) -> Result<(Vec<u8>, String), WsError> {
        let p = paths::resolve_in_root(&self.root, rel)?;
        let bytes = fs::read(p)?;
        let h = content_hash(&bytes);
        Ok((bytes, h))
    }

    /// The only write path into a work folder.
    /// - refuses in read-only mode and for paths that leave the root;
    /// - writes only if the disk still matches `expect` (otherwise `WriteConflict`, nothing written);
    /// - a repeated `request_id` returns the first result without writing again.
    pub fn write_file(
        &self,
        request_id: &str,
        rel: &str,
        bytes: &[u8],
        expect: Expect,
    ) -> Result<String, WsError> {
        if let Some(reason) = self.read_only_reason {
            return Err(WsError::ReadOnly { reason });
        }
        let target = paths::resolve_in_root(&self.root, rel)?;
        if rel
            .split(['/', '\\'])
            .next()
            .is_some_and(|top| top.eq_ignore_ascii_case(APP_DIR))
        {
            return Err(WsError::InvalidRelativePath { rel: rel.into() });
        }
        let mut done = self.writer.lock().map_err(|_| WsError::Io {
            kind: "Poisoned".into(),
            detail: "writer lock poisoned".into(),
        })?;
        let key = format!("{request_id}\u{0}{rel}");
        if let Some(h) = done.get(&key) {
            return Ok(h.clone());
        }
        let actual = match fs::read(&target) {
            Ok(b) => Some(content_hash(&b)),
            Err(e) if e.kind() == io::ErrorKind::NotFound => None,
            Err(e) => return Err(e.into()),
        };
        let expected = match &expect {
            Expect::Absent => None,
            Expect::Hash(h) => Some(h.clone()),
        };
        if actual != expected {
            return Err(WsError::WriteConflict { expected, actual });
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        let tmp = self.root.join(TMP_DIR);
        match expect {
            Expect::Absent => atomic::publish_new(&tmp, &target, bytes)?,
            Expect::Hash(_) => atomic::replace_atomic(&tmp, &target, bytes)?,
        }
        let h = content_hash(bytes);
        done.insert(key, h.clone());
        Ok(h)
    }
}

#[cfg(test)]
mod tests;
