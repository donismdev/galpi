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
    let mut made = Vec::new();
    for i in 0..count.min(1000) {
        made.push(episodes::create_next(&session, &format!("sample-{i}"))?.episode);
    }
    Ok(SampleWork {
        workspace_id,
        episodes: made,
    })
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
        assert_eq!(episodes::list(&again).unwrap().episodes.len(), 3);
    }
}
