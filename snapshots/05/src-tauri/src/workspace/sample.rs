//! Synthetic test works for development (debug tab, `examples/make_sample_work.rs`).
//! Uses the real create/episode code paths. Only creates into a new or empty folder.

use super::episodes::{self, EpisodeInfo};
use super::error::WsError;
use super::{CreateOptions, CreateOutcome, create, ensure_leaf_folder, open};
use std::path::Path;

pub struct SampleWork {
    pub workspace_id: String,
    pub episodes: Vec<EpisodeInfo>,
}

/// Creates `dir` (last component only) if needed, makes a work titled `title` with `count`
/// empty episodes, and closes it again so the caller can open it normally.
pub fn make_sample(dir: &Path, title: &str, count: u32) -> Result<SampleWork, WsError> {
    ensure_leaf_folder(dir)?;
    let opts = CreateOptions {
        title: title.to_string(),
        request_id: "sample".into(),
        track_label: "본편".into(),
        confirm_non_empty: false,
    };
    let workspace_id = match create(dir, &opts, None)? {
        CreateOutcome::Created(m) => m.workspace_id,
        CreateOutcome::Interrupted(s) => {
            return Err(WsError::Io {
                kind: "Interrupted".into(),
                detail: format!("{s:?}"),
            });
        }
    };
    let session = open(dir)?;
    mark_as_sample(&session)?;
    let mut made = Vec::new();
    for i in 0..count.min(1000) {
        made.push(episodes::create_next(&session, &format!("sample-{i}"))?.episode);
    }
    Ok(SampleWork {
        workspace_id,
        episodes: made,
    })
}

/// Field added to workspace.json of synthetic works. Debug tools that rewrite or lock files
/// refuse to run on any work without it, so a real manuscript folder can never be touched by them.
pub const SAMPLE_FLAG: &str = "galpiSample";

fn mark_as_sample(session: &super::WorkspaceSession) -> Result<(), WsError> {
    let (bytes, hash) = session.read_file(super::manifest::MANIFEST_FILE)?;
    let mut value: serde_json::Value = serde_json::from_slice(super::manifest::strip_bom(&bytes))
        .map_err(|e| WsError::InvalidManifest {
        detail: e.to_string(),
    })?;
    value[SAMPLE_FLAG] = serde_json::Value::Bool(true);
    let body = serde_json::to_vec_pretty(&value).map_err(std::io::Error::other)?;
    session.write_file(
        "sample-mark",
        super::manifest::MANIFEST_FILE,
        &body,
        super::Expect::Hash(hash),
    )?;
    Ok(())
}

/// True only for works made by `make_sample` (workspace.json has `"galpiSample": true`).
pub fn is_sample(session: &super::WorkspaceSession) -> bool {
    session
        .read_file(super::manifest::MANIFEST_FILE)
        .ok()
        .and_then(|(b, _)| {
            serde_json::from_slice::<serde_json::Value>(super::manifest::strip_bom(&b)).ok()
        })
        .and_then(|v| v.get(SAMPLE_FLAG).and_then(|f| f.as_bool()))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sample_work_has_numbered_episodes_and_refuses_non_empty_folders() {
        let base = tempfile::tempdir().unwrap();
        let dir = base.path().join("합성 작품");
        let s = make_sample(&dir, "잿빛 항구", 3).unwrap();
        assert_eq!(
            s.episodes.iter().map(|e| e.number).collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
        // A second run into the same (now non-empty) folder must not touch it.
        assert!(make_sample(&dir, "x", 1).is_err());
        let again = open(&dir).unwrap();
        assert_eq!(again.workspace_id, s.workspace_id);
        assert!(is_sample(&again));
        // A normal work is never a sample.
        let real = base.path().join("진짜 작품");
        std::fs::create_dir_all(&real).unwrap();
        let opts = CreateOptions {
            title: "진짜".into(),
            request_id: "r".into(),
            track_label: "본편".into(),
            confirm_non_empty: false,
        };
        create(&real, &opts, None).unwrap();
        assert!(!is_sample(&open(&real).unwrap()));
        assert_eq!(episodes::list(&again).unwrap().episodes.len(), 3);
    }
}
