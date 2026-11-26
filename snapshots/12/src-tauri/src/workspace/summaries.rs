//! Episode summaries, next-episode notes and summary review (session 07).
//!
//! Files (all in the work folder, written only through `WorkspaceSession::write_file`):
//! - `summaries/<episodeId>/summary.md`  — the summary text (free Markdown, the writer's own words)
//! - `summaries/<episodeId>/summary.json` — review record: which committed revision the writer
//!   confirmed the summary against (`reviewedRevisionId`), when, and the summary hash at that time
//! - `notes/next/<episodeId>.md`          — "what to write next", left in episode N for episode N+1
//!
//! Review state is derived, never stored:
//! - `unwritten`  — summary missing or blank
//! - `noRevision` — summary written, but the episode has no commit yet (nothing to confirm against)
//! - `unreviewed` — commits exist, never confirmed
//! - `reviewed`   — confirmed against the newest commit
//! - `recheck`    — confirmed against an older commit; a newer commit exists
//!
//! Only a new commit can turn `reviewed` into `recheck` (CH1). Saving the working manuscript,
//! an external editor opening/closing, or a conflict-resolve save create no commit and so change
//! nothing here; they show up only as the separate `uncommittedEdits` flag. Editing the summary
//! file (in the app or outside) never confirms anything by itself; it only sets
//! `summaryEditedSinceReview`.

use super::episodes;
use super::error::WsError;
use super::history;
use super::manifest::{now_rfc3339, strip_bom};
use super::{Expect, WorkspaceSession, content_hash, manuscript};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;

pub const SUMMARIES_DIR: &str = "summaries";
pub const NOTES_DIR: &str = "notes/next";
pub const SUMMARY_SCHEMA_VERSION: u32 = 1;

fn summary_rel(episode_id: &str) -> String {
    format!("{SUMMARIES_DIR}/{episode_id}/summary.md")
}
fn meta_rel(episode_id: &str) -> String {
    format!("{SUMMARIES_DIR}/{episode_id}/summary.json")
}
fn note_rel(episode_id: &str) -> String {
    format!("{NOTES_DIR}/{episode_id}.md")
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SummaryMeta {
    #[serde(default = "schema_v1")]
    pub schema_version: u32,
    #[serde(default)]
    pub episode_id: String,
    #[serde(default)]
    pub reviewed_revision_id: Option<String>,
    #[serde(default)]
    pub reviewed_at: Option<String>,
    /// Summary text hash when it was confirmed (to tell "edited since review").
    #[serde(default)]
    pub reviewed_summary_hash: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

fn schema_v1() -> u32 {
    SUMMARY_SCHEMA_VERSION
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ReviewState {
    Unwritten,
    NoRevision,
    Unreviewed,
    Reviewed,
    Recheck,
}

/// A text file inside the work folder with the hash it was read at (None = file missing).
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TextFile {
    pub text: String,
    pub hash: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SummaryStatus {
    pub episode_id: String,
    pub number: u32,
    pub title: String,
    /// First non-blank line of the summary ("" if none).
    pub first_line: String,
    pub state: ReviewState,
    pub reviewed_revision_id: Option<String>,
    /// Ordinal of the reviewed revision, if it still exists in the history.
    pub reviewed_ordinal: Option<u32>,
    pub reviewed_at: Option<String>,
    pub latest_revision_id: Option<String>,
    pub latest_ordinal: Option<u32>,
    /// Working manuscript differs from the newest commit (does not change `state`).
    pub uncommitted_edits: bool,
    /// Summary text changed after it was confirmed (does not change `state`).
    pub summary_edited_since_review: bool,
    pub has_note: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SummaryDoc {
    pub summary: TextFile,
    pub note: TextFile,
    /// Hash of summary.json as read (None if absent) — base for the next review write.
    pub meta_hash: Option<String>,
    pub status: SummaryStatus,
}

fn read_text(s: &WorkspaceSession, rel: &str) -> Result<TextFile, WsError> {
    match s.read_file(rel) {
        Ok((bytes, hash)) => Ok(TextFile {
            text: String::from_utf8_lossy(strip_bom(&bytes)).replace("\r\n", "\n"),
            hash: Some(hash),
        }),
        Err(WsError::Io { kind, .. }) if kind == "NotFound" => Ok(TextFile {
            text: String::new(),
            hash: None,
        }),
        Err(e) => Err(e),
    }
}

fn read_meta(
    s: &WorkspaceSession,
    episode_id: &str,
) -> Result<(SummaryMeta, Option<String>), WsError> {
    match s.read_file(&meta_rel(episode_id)) {
        Ok((bytes, hash)) => {
            let m = serde_json::from_slice(strip_bom(&bytes)).map_err(|e| {
                WsError::InvalidManifest {
                    detail: format!("{}: {e}", meta_rel(episode_id)),
                }
            })?;
            Ok((m, Some(hash)))
        }
        Err(WsError::Io { kind, .. }) if kind == "NotFound" => Ok((SummaryMeta::default(), None)),
        Err(e) => Err(e),
    }
}

fn status_of(
    s: &WorkspaceSession,
    ep: &episodes::EpisodeInfo,
    summary: &TextFile,
    note: &TextFile,
    meta: &SummaryMeta,
) -> Result<SummaryStatus, WsError> {
    let hist = history::list_in(s, ep, true)?;
    let latest = hist.revisions.last();
    let first_line = summary
        .text
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("")
        .to_string();
    let state = if summary.text.trim().is_empty() {
        ReviewState::Unwritten
    } else {
        match (latest, meta.reviewed_revision_id.as_deref()) {
            (None, _) => ReviewState::NoRevision,
            (Some(_), None) => ReviewState::Unreviewed,
            (Some(l), Some(r)) if l.revision_id == r => ReviewState::Reviewed,
            (Some(_), Some(_)) => ReviewState::Recheck,
        }
    };
    let manuscript_hash = fs::read(manuscript::file_path(s, &ep.episode_id)?)
        .ok()
        .map(|b| content_hash(&b));
    Ok(SummaryStatus {
        episode_id: ep.episode_id.clone(),
        number: ep.number,
        title: ep.title.clone(),
        first_line,
        state,
        reviewed_revision_id: meta.reviewed_revision_id.clone(),
        reviewed_ordinal: meta.reviewed_revision_id.as_deref().and_then(|r| {
            hist.revisions
                .iter()
                .find(|x| x.revision_id == r)
                .map(|x| x.ordinal)
        }),
        reviewed_at: meta.reviewed_at.clone(),
        latest_revision_id: latest.map(|l| l.revision_id.clone()),
        latest_ordinal: latest.map(|l| l.ordinal),
        uncommitted_edits: latest
            .is_some_and(|l| manuscript_hash.as_deref() != Some(l.content_hash.as_str())),
        summary_edited_since_review: meta.reviewed_summary_hash.is_some()
            && meta.reviewed_summary_hash != summary.hash,
        has_note: !note.text.trim().is_empty(),
    })
}

pub fn read(s: &WorkspaceSession, episode_id: &str) -> Result<SummaryDoc, WsError> {
    let ep = episodes::find(s, episode_id)?;
    let summary = read_text(s, &summary_rel(episode_id))?;
    let note = read_text(s, &note_rel(episode_id))?;
    let (meta, meta_hash) = read_meta(s, episode_id)?;
    let status = status_of(s, &ep, &summary, &note, &meta)?;
    Ok(SummaryDoc {
        summary,
        note,
        meta_hash,
        status,
    })
}

/// Every episode, in number order — episodes without a summary are listed too (S07.A).
pub fn list(s: &WorkspaceSession) -> Result<Vec<SummaryStatus>, WsError> {
    let mut out = Vec::new();
    for ep in episodes::list(s)?.episodes {
        let summary = read_text(s, &summary_rel(&ep.episode_id))?;
        let note = read_text(s, &note_rel(&ep.episode_id))?;
        let (meta, _) = read_meta(s, &ep.episode_id).unwrap_or_default();
        out.push(status_of(s, &ep, &summary, &note, &meta)?);
    }
    Ok(out)
}

fn expect_of(hash: Option<&str>) -> Expect {
    match hash {
        Some(h) => Expect::Hash(h.to_string()),
        None => Expect::Absent,
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TextKind {
    Summary,
    Note,
}

/// Saves the summary or the next-episode note (LF, UTF-8, no BOM). `expected_hash` is what was
/// read (None = file did not exist); a different file on disk → `writeConflict`, nothing written.
pub fn save_text(
    s: &WorkspaceSession,
    request_id: &str,
    episode_id: &str,
    kind: TextKind,
    text: &str,
    expected_hash: Option<&str>,
) -> Result<SummaryDoc, WsError> {
    s.ensure_writable()?;
    episodes::find(s, episode_id)?;
    let rel = match kind {
        TextKind::Summary => summary_rel(episode_id),
        TextKind::Note => note_rel(episode_id),
    };
    s.write_file(
        request_id,
        &rel,
        text.replace("\r\n", "\n").as_bytes(),
        expect_of(expected_hash),
    )?;
    read(s, episode_id)
}

/// Records that the writer checked the summary against `revision_id`, which must still be the
/// newest commit (otherwise `writeConflict`: a newer commit arrived — look at it first).
pub fn confirm(
    s: &WorkspaceSession,
    request_id: &str,
    episode_id: &str,
    revision_id: &str,
) -> Result<SummaryDoc, WsError> {
    s.ensure_writable()?;
    let latest = history::latest(s, episode_id)?.ok_or_else(|| WsError::NotFound {
        path: format!("episode {episode_id} has no commit"),
    })?;
    if latest.revision_id != revision_id {
        return Err(WsError::WriteConflict {
            expected: Some(revision_id.to_string()),
            actual: Some(latest.revision_id),
        });
    }
    let summary = read_text(s, &summary_rel(episode_id))?;
    let (mut meta, meta_hash) = read_meta(s, episode_id)?;
    meta.schema_version = SUMMARY_SCHEMA_VERSION;
    meta.episode_id = episode_id.to_string();
    meta.reviewed_revision_id = Some(revision_id.to_string());
    meta.reviewed_at = Some(now_rfc3339());
    meta.reviewed_summary_hash = summary.hash.clone();
    let body = serde_json::to_vec_pretty(&meta).map_err(io::Error::other)?;
    s.write_file(
        request_id,
        &meta_rel(episode_id),
        &body,
        expect_of(meta_hash.as_deref()),
    )?;
    read(s, episode_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::manuscript::{LineEnding, save as save_ms};
    use crate::workspace::open;
    use crate::workspace::sample::make_sample;
    use uuid::Uuid;

    fn work(
        n: u32,
    ) -> (
        tempfile::TempDir,
        std::path::PathBuf,
        WorkspaceSession,
        Vec<String>,
    ) {
        let base = tempfile::tempdir().unwrap();
        let dir = base.path().join("요약 시험 (07)");
        let made = make_sample(&dir, "요약", n).unwrap();
        let ids = made.episodes.iter().map(|e| e.episode_id.clone()).collect();
        let s = open(&dir).unwrap();
        (base, dir, s, ids)
    }

    fn write_ms(s: &WorkspaceSession, id: &str, text: &str) {
        let p = manuscript::file_path(s, id).unwrap();
        let h = fs::read(&p).ok().map(|b| content_hash(&b));
        save_ms(
            s,
            &Uuid::new_v4().to_string(),
            id,
            text,
            h.as_deref(),
            false,
            LineEnding::Lf,
        )
        .unwrap();
    }

    fn commit(s: &WorkspaceSession, id: &str) -> String {
        history::commit(s, &Uuid::new_v4().to_string(), id, "", None)
            .unwrap()
            .revision
            .revision_id
    }

    fn put(s: &WorkspaceSession, id: &str, kind: TextKind, text: &str) -> SummaryDoc {
        let cur = read(s, id).unwrap();
        let h = match kind {
            TextKind::Summary => cur.summary.hash,
            TextKind::Note => cur.note.hash,
        };
        save_text(s, &Uuid::new_v4().to_string(), id, kind, text, h.as_deref()).unwrap()
    }

    // S07.A — every episode is listed, summary text and state survive a reopen.
    #[test]
    fn s07a_all_episodes_listed_and_summary_survives_reopen() {
        let (_b, dir, s, ids) = work(3);
        put(&s, &ids[0], TextKind::Summary, "1화: 서린 각성.\n둘째 줄");
        put(
            &s,
            &ids[2],
            TextKind::Summary,
            "\n\n3화: 불씨 감지.\n린의 침묵",
        );
        let l = list(&s).unwrap();
        assert_eq!(
            l.iter().map(|x| x.number).collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
        assert_eq!(l[1].state, ReviewState::Unwritten);
        assert_eq!(l[0].first_line, "1화: 서린 각성.");
        assert_eq!(l[2].first_line, "3화: 불씨 감지.");
        assert_eq!(l[2].state, ReviewState::NoRevision);
        drop(s);
        let s = open(&dir).unwrap();
        let d = read(&s, &ids[2]).unwrap();
        assert_eq!(d.summary.text, "\n\n3화: 불씨 감지.\n린의 침묵");
        assert_eq!(d.status.state, ReviewState::NoRevision);
        assert!(
            s.root
                .join(format!("summaries/{}/summary.md", ids[2]))
                .is_file()
        );
    }

    // S07.B + S07.D (CH1) — only a new commit makes "recheck"; other episodes untouched.
    #[test]
    fn s07b_review_cycle_and_only_commits_cause_recheck() {
        let (_b, _d, s, ids) = work(3);
        let (e1, e3) = (&ids[0], &ids[2]);
        for id in &ids {
            write_ms(&s, id, "초고");
            commit(&s, id);
        }
        put(&s, e1, TextKind::Summary, "1화 요약");
        put(&s, e3, TextKind::Summary, "3화 요약");
        assert_eq!(read(&s, e3).unwrap().status.state, ReviewState::Unreviewed);
        let r1 = history::latest(&s, e3).unwrap().unwrap().revision_id;
        let d = confirm(&s, "c1", e3, &r1).unwrap();
        assert_eq!(d.status.state, ReviewState::Reviewed);
        assert_eq!(d.status.reviewed_ordinal, Some(1));

        // Working save only (and an external editor saving): still reviewed, flag set.
        write_ms(&s, e3, "초고 + 작업본만 저장");
        fs::write(
            manuscript::file_path(&s, e3).unwrap(),
            "외부 편집기에서 합쳐 저장",
        )
        .unwrap();
        let st = read(&s, e3).unwrap().status;
        assert_eq!(st.state, ReviewState::Reviewed);
        assert!(st.uncommitted_edits);

        // New commit r2 → recheck.
        let r2 = commit(&s, e3);
        let st = read(&s, e3).unwrap().status;
        assert_eq!(st.state, ReviewState::Recheck);
        assert_eq!((st.reviewed_ordinal, st.latest_ordinal), (Some(1), Some(2)));
        assert!(!st.uncommitted_edits);

        // "이대로 확인" → reviewed at r2.
        let d = confirm(&s, "c2", e3, &r2).unwrap();
        assert_eq!(d.status.state, ReviewState::Reviewed);
        assert_eq!(d.status.reviewed_ordinal, Some(2));

        // Episodes 1 and 2 never changed.
        let l = list(&s).unwrap();
        assert_eq!(l[0].state, ReviewState::Unreviewed);
        assert_eq!(l[1].state, ReviewState::Unwritten);
    }

    #[test]
    fn confirming_against_a_stale_revision_is_refused() {
        let (_b, _d, s, ids) = work(1);
        let id = &ids[0];
        write_ms(&s, id, "a");
        let r1 = commit(&s, id);
        put(&s, id, TextKind::Summary, "요약");
        write_ms(&s, id, "b");
        commit(&s, id);
        assert!(matches!(
            confirm(&s, "x", id, &r1),
            Err(WsError::WriteConflict { .. })
        ));
        assert_eq!(read(&s, id).unwrap().status.state, ReviewState::Unreviewed);
    }

    #[test]
    fn external_summary_edit_never_confirms_and_is_flagged() {
        let (_b, _d, s, ids) = work(1);
        let id = &ids[0];
        write_ms(&s, id, "a");
        let r1 = commit(&s, id);
        put(&s, id, TextKind::Summary, "요약");
        confirm(&s, "c", id, &r1).unwrap();
        write_ms(&s, id, "b");
        commit(&s, id); // recheck
        fs::write(s.root.join(summary_rel(id)), "밖에서 고친 요약").unwrap();
        let st = read(&s, id).unwrap().status;
        assert_eq!(
            st.state,
            ReviewState::Recheck,
            "editing the summary must not confirm it"
        );
        assert!(st.summary_edited_since_review);
    }

    #[test]
    fn stale_summary_save_is_refused_and_note_is_separate() {
        let (_b, _d, s, ids) = work(2);
        let id = &ids[0];
        let d = put(&s, id, TextKind::Summary, "첫 요약");
        fs::write(s.root.join(summary_rel(id)), "밖에서 바뀜").unwrap();
        assert!(matches!(
            save_text(
                &s,
                "x",
                id,
                TextKind::Summary,
                "앱",
                d.summary.hash.as_deref()
            ),
            Err(WsError::WriteConflict { .. })
        ));
        assert_eq!(
            fs::read_to_string(s.root.join(summary_rel(id))).unwrap(),
            "밖에서 바뀜"
        );
        let n = put(&s, id, TextKind::Note, "다음 화: 린의 편지");
        assert!(n.status.has_note);
        assert_eq!(read(&s, &ids[1]).unwrap().note.text, "");
        assert!(s.root.join(format!("notes/next/{id}.md")).is_file());
    }
}
