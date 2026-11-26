//! `workspace.json` and the fixed folder layout (docs/development/WORKSPACE_FORMAT.md).

use super::error::WsError;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::Path;

pub const SCHEMA_VERSION: u32 = 1;
pub const MANIFEST_FILE: &str = "workspace.json";
/// App-internal folder inside a work folder: temp files, write lock, init marker.
pub const APP_DIR: &str = ".galpi";
pub const TMP_DIR: &str = ".galpi/tmp";
pub const LOCK_FILE: &str = ".galpi/lock";
pub const INIT_MARKER: &str = ".galpi/init.json";

/// Top-level names galpi creates. A pre-existing entry with one of these names is a conflict.
pub const RESERVED_TOP: [&str; 10] = [
    MANIFEST_FILE,
    APP_DIR,
    "episodes",
    "summaries",
    "notes",
    "lore",
    "tags",
    "timelines",
    "links",
    "threads",
];

pub const LAYOUT_DIRS: [&str; 13] = [
    "episodes",
    "summaries",
    "notes/next",
    "lore/characters",
    "lore/places",
    "lore/groups",
    "lore/notes",
    "tags",
    "timelines/collections",
    "timelines/events",
    "timelines/views",
    "links",
    "threads",
];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoryTrack {
    pub track_id: String,
    pub label: String,
    /// Unknown fields written by a newer build of the same schema version are kept on rewrite.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub schema_version: u32,
    pub workspace_id: String,
    pub title: String,
    pub story_tracks: Vec<StoryTrack>,
    pub created_at: String,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// Marker written before any layout is created, removed after workspace.json is published.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InitMarker {
    pub workspace_id: String,
    pub title: String,
    pub track_id: String,
    pub track_label: String,
    pub request_id: String,
    pub started_at: String,
}

pub enum ManifestRead {
    Missing,
    Ok(Manifest),
    Newer { found: u64, title: Option<String> },
    Invalid(String),
}

pub fn strip_bom(bytes: &[u8]) -> &[u8] {
    bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes)
}

pub fn read_manifest(root: &Path) -> io::Result<ManifestRead> {
    let bytes = match fs::read(root.join(MANIFEST_FILE)) {
        Ok(b) => b,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(ManifestRead::Missing),
        Err(e) => return Err(e),
    };
    let value: serde_json::Value = match serde_json::from_slice(strip_bom(&bytes)) {
        Ok(v) => v,
        Err(e) => return Ok(ManifestRead::Invalid(e.to_string())),
    };
    let Some(version) = value.get("schemaVersion").and_then(|v| v.as_u64()) else {
        return Ok(ManifestRead::Invalid("schemaVersion missing".into()));
    };
    if version > u64::from(SCHEMA_VERSION) {
        let title = value
            .get("title")
            .and_then(|t| t.as_str())
            .map(str::to_string);
        return Ok(ManifestRead::Newer {
            found: version,
            title,
        });
    }
    match serde_json::from_value::<Manifest>(value) {
        Ok(m) if m.workspace_id.trim().is_empty() => {
            Ok(ManifestRead::Invalid("workspaceId empty".into()))
        }
        Ok(m) => Ok(ManifestRead::Ok(m)),
        Err(e) => Ok(ManifestRead::Invalid(e.to_string())),
    }
}

pub fn read_init_marker(root: &Path) -> Result<Option<InitMarker>, WsError> {
    match fs::read(root.join(INIT_MARKER)) {
        Ok(b) => serde_json::from_slice(strip_bom(&b))
            .map(Some)
            .map_err(|e| WsError::InvalidManifest {
                detail: format!("{INIT_MARKER}: {e}"),
            }),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(root: &Path, s: &str) {
        fs::write(root.join(MANIFEST_FILE), s).unwrap();
    }

    #[test]
    fn classifies_manifest_versions() {
        let d = tempfile::tempdir().unwrap();
        assert!(matches!(
            read_manifest(d.path()).unwrap(),
            ManifestRead::Missing
        ));
        write(d.path(), "{ broken");
        assert!(matches!(
            read_manifest(d.path()).unwrap(),
            ManifestRead::Invalid(_)
        ));
        write(d.path(), r#"{"schemaVersion": 99, "title": "미래 작품"}"#);
        assert!(matches!(
            read_manifest(d.path()).unwrap(),
            ManifestRead::Newer { found: 99, title: Some(t) } if t == "미래 작품"
        ));
        write(
            d.path(),
            "\u{feff}{\"schemaVersion\":1,\"workspaceId\":\"w1\",\"title\":\"잿빛 항구\",\"storyTracks\":[],\"createdAt\":\"x\",\"futureField\":true}",
        );
        match read_manifest(d.path()).unwrap() {
            ManifestRead::Ok(m) => {
                assert_eq!(m.workspace_id, "w1");
                assert_eq!(
                    m.extra.get("futureField"),
                    Some(&serde_json::Value::Bool(true))
                );
            }
            _ => panic!("expected Ok"),
        }
    }
}
