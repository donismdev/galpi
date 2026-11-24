use serde::Serialize;
use std::io;

/// Why a work folder is open read-only. Shown to the writer; nothing is written in this mode.
#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ReadOnlyReason {
    /// workspace.json has a schemaVersion this build does not know. The folder is never modified.
    NewerSchema,
    /// Another galpi process (or another open in this one) owns the write lock.
    LockedByOther,
    /// The OS refused a write (permissions, read-only attribute, read-only media).
    NoWritePermission,
}

/// Failure codes crossing the Rust ↔ UI boundary. `code` is stable; the UI maps it to text.
#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(
    tag = "code",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum WsError {
    NotFound {
        path: String,
    },
    NotADirectory {
        path: String,
    },
    /// The folder already holds entries whose names galpi would create. Nothing was written.
    NameConflicts {
        conflicts: Vec<String>,
        suggestion: Option<String>,
    },
    /// The folder has unrelated files; the writer must confirm adding work files next to them.
    NeedsConfirmation {
        entry_count: usize,
    },
    /// The folder is already a work folder (e.g. a retried create). Open it instead.
    AlreadyWorkspace {
        workspace_id: String,
    },
    NotAWorkspace {
        path: String,
    },
    InvalidManifest {
        detail: String,
    },
    NewerSchema {
        found: u64,
        supported: u32,
    },
    InvalidRelativePath {
        rel: String,
    },
    PathOutsideWorkspace {
        rel: String,
    },
    /// A request carried a session id that is no longer the open work folder.
    StaleSession,
    NoWorkspaceOpen,
    ReadOnly {
        reason: ReadOnlyReason,
    },
    /// The file on disk is not the version the caller read. Nothing was written.
    WriteConflict {
        expected: Option<String>,
        actual: Option<String>,
    },
    Io {
        kind: String,
        detail: String,
    },
}

impl From<io::Error> for WsError {
    fn from(e: io::Error) -> Self {
        WsError::Io {
            kind: format!("{:?}", e.kind()),
            detail: e.to_string(),
        }
    }
}

impl std::fmt::Display for WsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}

impl std::error::Error for WsError {}
