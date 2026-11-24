//! Reading and saving an episode's `manuscript.md` for the built-in editor (session 04).
//!
//! - The editor works on LF text. The file's own form (UTF-8 BOM yes/no, CRLF or LF) is
//!   remembered at read time and re-applied on save, so a file written by Notepad/VS Code keeps
//!   its bytes unless the writer actually changed text. Opening never writes.
//! - Every save carries the hash of the bytes it was based on; if the disk changed meanwhile the
//!   save is refused (`writeConflict`) and nothing is written (session 05 resolves it).
//! - A file another program holds exclusively → `locked` (offer "read again").
//!   A file that is not UTF-8 (e.g. CP949) → `undecodable`: no text is produced, nothing is
//!   written, autosave stays off until the writer converts it outside and reads again (CH1).
//! - Unsaved text that could not be saved is kept as a draft in `.galpi/drafts/<episodeId>.json`
//!   (app-internal, never mixed with the manuscript) until it is saved or discarded.

use super::episodes;
use super::error::WsError;
use super::manifest::{APP_DIR, TMP_DIR, now_rfc3339, strip_bom};
use super::{Expect, WorkspaceSession, atomic, content_hash, display_path, paths};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LineEnding {
    Lf,
    Crlf,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ManuscriptRead {
    Ok {
        episode_id: String,
        /// Text with LF line breaks (what the editor shows).
        text: String,
        /// Hash of the exact bytes on disk; the base for the next save.
        hash: String,
        bom: bool,
        line_ending: LineEnding,
        /// The file mixed CRLF/LF/CR. Saving writes one style (`line_ending`) throughout.
        mixed_line_endings: bool,
        path: String,
    },
    /// Not valid UTF-8. Nothing was changed; the editor must not autosave.
    Undecodable {
        episode_id: String,
        hash: String,
        size: u64,
        /// Byte offset where UTF-8 decoding failed.
        valid_up_to: usize,
        path: String,
    },
    /// Another program holds the file so it cannot be read right now.
    Locked {
        episode_id: String,
        path: String,
        detail: String,
    },
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SavedManuscript {
    pub hash: String,
    pub saved_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub episode_id: String,
    /// Disk hash the draft was edited from (None if the file could not be read).
    pub base_hash: Option<String>,
    pub text: String,
    pub saved_at: String,
}

fn is_sharing_violation(e: &io::Error) -> bool {
    // ERROR_SHARING_VIOLATION (32) / ERROR_LOCK_VIOLATION (33)
    matches!(e.raw_os_error(), Some(32) | Some(33))
}

/// Splits bytes into (bom, LF text, dominant ending, mixed?). `Err(valid_up_to)` if not UTF-8.
pub fn decode(bytes: &[u8]) -> Result<(bool, String, LineEnding, bool), usize> {
    let bom = bytes.starts_with(b"\xEF\xBB\xBF");
    let body = strip_bom(bytes);
    let s = std::str::from_utf8(body).map_err(|e| e.valid_up_to() + if bom { 3 } else { 0 })?;
    let crlf = s.matches("\r\n").count();
    let lf = s.matches('\n').count() - crlf;
    let cr = s.matches('\r').count() - crlf;
    let ending = if crlf > lf {
        LineEnding::Crlf
    } else {
        LineEnding::Lf
    };
    let mixed = cr > 0 || (crlf > 0 && lf > 0);
    let text = s.replace("\r\n", "\n").replace('\r', "\n");
    Ok((bom, text, ending, mixed))
}

/// The exact bytes to write for LF `text` in the file's form.
pub fn encode(text: &str, bom: bool, ending: LineEnding) -> Vec<u8> {
    let body = match ending {
        LineEnding::Lf => text.replace("\r\n", "\n"),
        LineEnding::Crlf => text.replace("\r\n", "\n").replace('\n', "\r\n"),
    };
    let mut out = Vec::with_capacity(body.len() + 3);
    if bom {
        out.extend_from_slice(b"\xEF\xBB\xBF");
    }
    out.extend_from_slice(body.as_bytes());
    out
}

fn manuscript_path(s: &WorkspaceSession, episode_id: &str) -> Result<(String, PathBuf), WsError> {
    let ep = episodes::find(s, episode_id)?;
    let p = paths::resolve_in_root(&s.root, &ep.manuscript_rel)?;
    Ok((ep.manuscript_rel, p))
}

pub fn read(s: &WorkspaceSession, episode_id: &str) -> Result<ManuscriptRead, WsError> {
    let (_, p) = manuscript_path(s, episode_id)?;
    let path = display_path(&p);
    let bytes = match fs::read(&p) {
        Ok(b) => b,
        Err(e) if is_sharing_violation(&e) => {
            return Ok(ManuscriptRead::Locked {
                episode_id: episode_id.into(),
                path,
                detail: e.to_string(),
            });
        }
        Err(e) => return Err(e.into()),
    };
    let hash = content_hash(&bytes);
    Ok(match decode(&bytes) {
        Ok((bom, text, line_ending, mixed_line_endings)) => ManuscriptRead::Ok {
            episode_id: episode_id.into(),
            text,
            hash,
            bom,
            line_ending,
            mixed_line_endings,
            path,
        },
        Err(valid_up_to) => ManuscriptRead::Undecodable {
            episode_id: episode_id.into(),
            hash,
            size: bytes.len() as u64,
            valid_up_to,
            path,
        },
    })
}

/// Saves LF `text` in the given form, only if the disk still has `base_hash`.
pub fn save(
    s: &WorkspaceSession,
    request_id: &str,
    episode_id: &str,
    text: &str,
    base_hash: &str,
    bom: bool,
    ending: LineEnding,
) -> Result<SavedManuscript, WsError> {
    let (rel, _) = manuscript_path(s, episode_id)?;
    let bytes = encode(text, bom, ending);
    let hash = s.write_file(
        request_id,
        &rel,
        &bytes,
        Expect::Hash(base_hash.to_string()),
    )?;
    Ok(SavedManuscript {
        hash,
        saved_at: now_rfc3339(),
    })
}

fn draft_path(s: &WorkspaceSession, episode_id: &str) -> Result<PathBuf, WsError> {
    // Episode IDs are UUIDs; refuse anything else so the name cannot escape drafts/.
    if episode_id.is_empty()
        || !episode_id
            .chars()
            .all(|c| c.is_ascii_hexdigit() || c == '-')
    {
        return Err(WsError::InvalidRelativePath {
            rel: format!("drafts/{episode_id}"),
        });
    }
    Ok(s.root
        .join(APP_DIR)
        .join("drafts")
        .join(format!("{episode_id}.json")))
}

pub fn save_draft(
    s: &WorkspaceSession,
    episode_id: &str,
    base_hash: Option<&str>,
    text: &str,
) -> Result<Draft, WsError> {
    s.ensure_writable()?;
    episodes::find(s, episode_id)?;
    let p = draft_path(s, episode_id)?;
    let d = Draft {
        episode_id: episode_id.into(),
        base_hash: base_hash.map(str::to_string),
        text: text.into(),
        saved_at: now_rfc3339(),
    };
    let _guard = s.writer_guard()?;
    fs::create_dir_all(p.parent().expect("drafts dir"))?;
    let body = serde_json::to_vec_pretty(&d).map_err(io::Error::other)?;
    atomic::replace_atomic(&s.root.join(TMP_DIR), &p, &body)?;
    Ok(d)
}

pub fn load_draft(s: &WorkspaceSession, episode_id: &str) -> Result<Option<Draft>, WsError> {
    let p = draft_path(s, episode_id)?;
    match fs::read(&p) {
        Ok(b) => Ok(serde_json::from_slice(strip_bom(&b)).ok()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn discard_draft(s: &WorkspaceSession, episode_id: &str) -> Result<(), WsError> {
    s.ensure_writable()?;
    let p = draft_path(s, episode_id)?;
    let _guard = s.writer_guard()?;
    match fs::remove_file(&p) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

/// Absolute manuscript path (for "open the file's location").
pub fn file_path(s: &WorkspaceSession, episode_id: &str) -> Result<PathBuf, WsError> {
    Ok(manuscript_path(s, episode_id)?.1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::sample::make_sample;
    use crate::workspace::{open, write_lock_for_tests};

    fn work() -> (tempfile::TempDir, WorkspaceSession, String) {
        let base = tempfile::tempdir().unwrap();
        let dir = base.path().join("잿빛 항구 (원고 시험)");
        let s = make_sample(&dir, "잿빛 항구", 1).unwrap();
        let id = s.episodes[0].episode_id.clone();
        let session = open(&dir).unwrap();
        (base, session, id)
    }

    fn write_raw(s: &WorkspaceSession, id: &str, bytes: &[u8]) {
        fs::write(file_path(s, id).unwrap(), bytes).unwrap();
    }

    // S04.C — opening never changes bytes; saving unchanged text reproduces them exactly.
    #[test]
    fn s04c_round_trip_keeps_bytes_for_every_form() {
        let long = "서린은 남은 불씨를 감지했다. ".repeat(4000);
        let cases: Vec<(&str, Vec<u8>)> = vec![
            ("empty", Vec::new()),
            ("bom only", b"\xEF\xBB\xBF".to_vec()),
            ("lf", "첫 줄\n둘째 줄\n".as_bytes().to_vec()),
            ("lf no trailing", "첫 줄\n둘째 줄".as_bytes().to_vec()),
            ("crlf", "첫 줄\r\n둘째 줄\r\n".as_bytes().to_vec()),
            (
                "bom crlf emoji",
                [
                    &b"\xEF\xBB\xBF"[..],
                    "서린 🔥 \"린\"\r\n\r\n– 끝 –\r\n".as_bytes(),
                ]
                .concat(),
            ),
            ("long", long.as_bytes().to_vec()),
            (
                "markdown",
                "# 1화\n\n> 인용\n\n- 목록\n  *강조* `코드`\n"
                    .as_bytes()
                    .to_vec(),
            ),
        ];
        let (_b, s, id) = work();
        for (name, original) in cases {
            write_raw(&s, &id, &original);
            let r = read(&s, &id).unwrap();
            assert_eq!(
                fs::read(file_path(&s, &id).unwrap()).unwrap(),
                original,
                "{name}: read changed bytes"
            );
            let ManuscriptRead::Ok {
                text,
                hash,
                bom,
                line_ending,
                ..
            } = r
            else {
                panic!("{name}: not ok");
            };
            assert!(!text.contains('\r'), "{name}");
            assert_eq!(encode(&text, bom, line_ending), original, "{name}: encode");
            save(
                &s,
                &format!("r-{name}"),
                &id,
                &text,
                &hash,
                bom,
                line_ending,
            )
            .unwrap();
            assert_eq!(
                fs::read(file_path(&s, &id).unwrap()).unwrap(),
                original,
                "{name}: save changed bytes"
            );
        }
    }

    #[test]
    fn edits_keep_bom_and_crlf() {
        let (_b, s, id) = work();
        write_raw(&s, &id, "\u{feff}서린은 손끝에 불을 피웠다.\r\n".as_bytes());
        let ManuscriptRead::Ok {
            text,
            hash,
            bom,
            line_ending,
            ..
        } = read(&s, &id).unwrap()
        else {
            panic!()
        };
        assert!(bom);
        assert_eq!(line_ending, LineEnding::Crlf);
        let edited = text.replace("손끝에 불을 피웠다", "남은 불씨를 감지했다") + "새 줄\n";
        save(&s, "e", &id, &edited, &hash, bom, line_ending).unwrap();
        assert_eq!(
            fs::read(file_path(&s, &id).unwrap()).unwrap(),
            "\u{feff}서린은 남은 불씨를 감지했다.\r\n새 줄\r\n".as_bytes()
        );
    }

    #[test]
    fn mixed_endings_are_reported_and_saved_in_the_dominant_style() {
        let (_b, s, id) = work();
        write_raw(&s, &id, b"a\r\nb\r\nc\nd\r");
        let ManuscriptRead::Ok {
            text,
            line_ending,
            mixed_line_endings,
            ..
        } = read(&s, &id).unwrap()
        else {
            panic!()
        };
        assert!(mixed_line_endings);
        assert_eq!(line_ending, LineEnding::Crlf);
        assert_eq!(text, "a\nb\nc\nd\n");
    }

    #[test]
    fn save_is_refused_when_disk_changed_and_nothing_is_written() {
        let (_b, s, id) = work();
        let ManuscriptRead::Ok { hash, .. } = read(&s, &id).unwrap() else {
            panic!()
        };
        write_raw(&s, &id, "VS Code에서 쓴 문장".as_bytes());
        let r = save(&s, "x", &id, "앱에서 쓴 문장", &hash, false, LineEnding::Lf);
        assert!(matches!(r, Err(WsError::WriteConflict { .. })));
        assert_eq!(
            fs::read_to_string(file_path(&s, &id).unwrap()).unwrap(),
            "VS Code에서 쓴 문장"
        );
    }

    // S04.D — CP949 file: undecodable, bytes untouched, existing draft untouched.
    #[test]
    fn s04d_cp949_is_undecodable_and_untouched() {
        let (_b, s, id) = work();
        // "서린은 불씨를 감지했다." in CP949 (EUC-KR) bytes.
        let cp949: &[u8] = &[
            0xBC, 0xAD, 0xB8, 0xB0, 0xC0, 0xBA, 0x20, 0xBA, 0xD2, 0xBE, 0xBE, 0xB8, 0xA6, 0x20,
            0xB0, 0xA8, 0xC1, 0xF6, 0xC7, 0xDF, 0xB4, 0xD9, 0x2E,
        ];
        write_raw(&s, &id, cp949);
        save_draft(&s, &id, None, "앱에 남아 있던 초안").unwrap();
        match read(&s, &id).unwrap() {
            ManuscriptRead::Undecodable {
                size, valid_up_to, ..
            } => {
                assert_eq!(size, cp949.len() as u64);
                assert_eq!(valid_up_to, 0);
            }
            other => panic!("{other:?}"),
        }
        assert_eq!(fs::read(file_path(&s, &id).unwrap()).unwrap(), cp949);
        assert_eq!(
            load_draft(&s, &id).unwrap().unwrap().text,
            "앱에 남아 있던 초안"
        );
        // After the writer re-saves it as UTF-8 outside, "read again" works.
        write_raw(&s, &id, "서린은 불씨를 감지했다.".as_bytes());
        assert!(matches!(read(&s, &id).unwrap(), ManuscriptRead::Ok { .. }));
    }

    // S04.D — a file held exclusively by another program reads as `locked`, then recovers.
    #[cfg(windows)]
    #[test]
    fn s04d_locked_file_then_read_again() {
        let (_b, s, id) = work();
        write_raw(&s, &id, "잠긴 원고".as_bytes());
        let holder = write_lock_for_tests(&file_path(&s, &id).unwrap());
        assert!(matches!(
            read(&s, &id).unwrap(),
            ManuscriptRead::Locked { .. }
        ));
        drop(holder);
        assert!(matches!(read(&s, &id).unwrap(), ManuscriptRead::Ok { .. }));
    }

    #[test]
    fn drafts_round_trip_and_stay_out_of_the_manuscript() {
        let (_b, s, id) = work();
        assert!(load_draft(&s, &id).unwrap().is_none());
        save_draft(&s, &id, Some("sha256:x"), "저장 못 한 문장").unwrap();
        let d = load_draft(&s, &id).unwrap().unwrap();
        assert_eq!(d.text, "저장 못 한 문장");
        assert_eq!(d.base_hash.as_deref(), Some("sha256:x"));
        assert_eq!(fs::read(file_path(&s, &id).unwrap()).unwrap(), b"");
        discard_draft(&s, &id).unwrap();
        assert!(load_draft(&s, &id).unwrap().is_none());
        assert!(save_draft(&s, "../../evil", None, "x").is_err());
    }
}
