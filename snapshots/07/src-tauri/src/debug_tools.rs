//! Debug-tab tools (debug builds only). They exist to run each session's manual checklist from
//! inside the app. Anything that rewrites, locks or changes attributes of a manuscript only works on
//! synthetic works (`workspace.json` has `"galpiSample": true`, see workspace::sample).
//!
//! Session 04: manuscript forms (BOM/CRLF/emoji, CP949, empty, long, mixed line endings),
//! holding a file locked like another program would, and the read-only attribute.

use crate::workspace::error::WsError;
use crate::workspace::manuscript;
use crate::workspace::sample::is_sample;
use crate::workspace::{WorkspaceSession, content_hash};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::sync::Mutex;

fn refuse(detail: &str) -> WsError {
    WsError::Io {
        kind: "Unsupported".into(),
        detail: detail.into(),
    }
}

pub fn ensure_allowed(s: &WorkspaceSession) -> Result<(), WsError> {
    if !cfg!(debug_assertions) {
        return Err(refuse("debug builds only"));
    }
    if !is_sample(s) {
        return Err(refuse(
            "only synthetic works (made with 합성 작품 만들기) can be changed by debug tools",
        ));
    }
    Ok(())
}

#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Fixture {
    /// UTF-8 BOM + CRLF + emoji + quotes (what Windows Notepad "UTF-8 with BOM" writes).
    BomCrlfEmoji,
    /// "서린은 불씨를 감지했다." encoded as CP949/EUC-KR (Notepad "ANSI" on Korean Windows).
    Cp949,
    Empty,
    /// ~120,000 characters of Korean text, LF.
    Long,
    /// CRLF, LF and lone CR mixed.
    Mixed,
}

pub fn fixture_bytes(f: Fixture) -> Vec<u8> {
    match f {
        Fixture::BomCrlfEmoji => [
            &b"\xEF\xBB\xBF"[..],
            "# 1화\r\n\r\n서린은 손끝에 불을 피웠다. 🔥\r\n\"린, 괜찮아?\"\r\n".as_bytes(),
        ]
        .concat(),
        Fixture::Cp949 => vec![
            0xBC, 0xAD, 0xB8, 0xB0, 0xC0, 0xBA, 0x20, 0xBA, 0xD2, 0xBE, 0xBE, 0xB8, 0xA6, 0x20,
            0xB0, 0xA8, 0xC1, 0xF6, 0xC7, 0xDF, 0xB4, 0xD9, 0x2E,
        ],
        Fixture::Empty => Vec::new(),
        Fixture::Long => "서린은 남은 불씨를 감지했다. 회귀 전의 기억이 손끝에서 떨렸다.\n"
            .repeat(3000)
            .into_bytes(),
        Fixture::Mixed => "첫 줄\r\n둘째 줄\n셋째 줄\r넷째 줄\r\n".as_bytes().to_vec(),
    }
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub path: String,
    pub exists: bool,
    pub size: u64,
    pub hash: String,
    pub bom: bool,
    pub crlf: usize,
    pub lone_lf: usize,
    pub lone_cr: usize,
    pub utf8: bool,
    pub readonly: bool,
    pub locked_by_debug: bool,
    pub head_hex: String,
    pub is_sample: bool,
}

/// Files the debug tab keeps open with no sharing (simulates another program's lock).
#[derive(Default)]
pub struct DebugLocks(pub Mutex<HashMap<String, fs::File>>);

pub fn file_info(
    s: &WorkspaceSession,
    episode_id: &str,
    locks: &DebugLocks,
) -> Result<FileInfo, WsError> {
    let p = manuscript::file_path(s, episode_id)?;
    let key = p.display().to_string();
    let locked = locks
        .0
        .lock()
        .map(|m| m.contains_key(&key))
        .unwrap_or(false);
    let meta = fs::metadata(&p).ok();
    // While we hold the lock ourselves the file cannot be read; report what we can.
    let bytes = if locked { None } else { fs::read(&p).ok() };
    let b = bytes.as_deref().unwrap_or(&[]);
    let crlf = b.windows(2).filter(|w| w == b"\r\n").count();
    Ok(FileInfo {
        path: crate::workspace::display_path(&p),
        exists: meta.is_some(),
        size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
        hash: bytes
            .as_deref()
            .map(content_hash)
            .unwrap_or_else(|| "(locked)".into()),
        bom: b.starts_with(b"\xEF\xBB\xBF"),
        crlf,
        lone_lf: b.iter().filter(|&&c| c == b'\n').count() - crlf,
        lone_cr: b.iter().filter(|&&c| c == b'\r').count() - crlf,
        utf8: std::str::from_utf8(b).is_ok(),
        readonly: meta.map(|m| m.permissions().readonly()).unwrap_or(false),
        locked_by_debug: locked,
        head_hex: b
            .iter()
            .take(24)
            .map(|x| format!("{x:02X}"))
            .collect::<Vec<_>>()
            .join(" "),
        is_sample: is_sample(s),
    })
}

/// Overwrites the manuscript with a test form, bypassing the editor (like an external program).
pub fn write_fixture(s: &WorkspaceSession, episode_id: &str, f: Fixture) -> Result<(), WsError> {
    ensure_allowed(s)?;
    let p = manuscript::file_path(s, episode_id)?;
    fs::write(&p, fixture_bytes(f))?;
    Ok(())
}

pub fn set_lock(
    s: &WorkspaceSession,
    episode_id: &str,
    on: bool,
    locks: &DebugLocks,
) -> Result<(), WsError> {
    ensure_allowed(s)?;
    let p = manuscript::file_path(s, episode_id)?;
    let key = p.display().to_string();
    let mut map = locks.0.lock().map_err(|_| refuse("lock table poisoned"))?;
    if on {
        if let std::collections::hash_map::Entry::Vacant(slot) = map.entry(key) {
            #[cfg(windows)]
            let f = {
                use std::os::windows::fs::OpenOptionsExt;
                fs::OpenOptions::new().read(true).share_mode(0).open(&p)?
            };
            #[cfg(not(windows))]
            let f = fs::OpenOptions::new().read(true).open(&p)?;
            slot.insert(f);
        }
    } else {
        map.remove(&key);
    }
    Ok(())
}

pub fn set_readonly(s: &WorkspaceSession, episode_id: &str, on: bool) -> Result<(), WsError> {
    ensure_allowed(s)?;
    let p = manuscript::file_path(s, episode_id)?;
    let mut perm = fs::metadata(&p)?.permissions();
    #[allow(clippy::permissions_set_readonly_false)]
    perm.set_readonly(on);
    fs::set_permissions(&p, perm)?;
    Ok(())
}

/// Session 05: what an external editor does to a manuscript, for conflict testing.
#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExternalAction {
    /// Append a line in place (like Notepad saving).
    AppendLine,
    /// Write a temp file next to it and rename over the manuscript (VS Code / many editors).
    ReplaceViaTemp,
    /// Delete the manuscript.
    Delete,
    /// Change only the modified time; content stays the same (opening/closing a program, S05.D).
    TouchOnly,
    /// Rewrite the same text as CP949 (an editor saving in ANSI).
    SaveAsCp949,
}

pub fn external_edit(
    s: &WorkspaceSession,
    episode_id: &str,
    a: ExternalAction,
) -> Result<(), WsError> {
    ensure_allowed(s)?;
    let p = manuscript::file_path(s, episode_id)?;
    let stamp = time_stamp();
    match a {
        ExternalAction::AppendLine => {
            let mut b = fs::read(&p).unwrap_or_default();
            if !b.is_empty() && !b.ends_with(b"\n") {
                b.extend_from_slice(b"\n");
            }
            b.extend_from_slice(format!("[외부 편집 {stamp}] 린은 창밖을 보았다.\n").as_bytes());
            fs::write(&p, b)?;
        }
        ExternalAction::ReplaceViaTemp => {
            let mut b = fs::read(&p).unwrap_or_default();
            b.extend_from_slice(format!("[교체 저장 {stamp}] 서린은 문을 닫았다.\n").as_bytes());
            let tmp = p.with_file_name(".manuscript.md.galpi-debug~");
            fs::write(&tmp, b)?;
            fs::rename(&tmp, &p)?;
        }
        ExternalAction::Delete => fs::remove_file(&p)?,
        ExternalAction::TouchOnly => {
            let f = fs::OpenOptions::new().write(true).open(&p)?;
            f.set_modified(std::time::SystemTime::now())?;
        }
        ExternalAction::SaveAsCp949 => fs::write(&p, fixture_bytes(Fixture::Cp949))?,
    }
    Ok(())
}

fn time_stamp() -> String {
    let t = crate::workspace::manifest::now_rfc3339();
    t.get(11..19).unwrap_or(&t).to_string()
}

/// Session 06: history situations for the commit/compare/restore checklist.
#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum HistoryAction {
    /// Write three versions through the normal save path and commit each (r1 초고 → r2 → r3).
    ThreeRevisions,
    /// Leave a staged revision in .galpi/tmp as if the app died just before publishing.
    LeftoverStaging,
    /// Change the newest revision's stored text so its hash no longer matches.
    DamageLatest,
}

pub const R1: &str = "# 1화

서린은 손끝에 불을 피웠다.
린은 말이 없었다.

항구에는 잿빛 안개가 내려앉았다.
";
pub const R2: &str = "# 1화

서린은 남은 불씨를 감지했다.
린은 말이 없었다.

항구에는 잿빛 안개가 내려앉았다.
";
pub const R3: &str = "# 1화 · 각성

서린은 남은 불씨를 감지했다. 손끝이 아니라 가슴 안쪽에서, 아주 작게.
\"린, 괜찮아?\" 린은 대답 대신 창밖을 보았다.

항구에는 잿빛 안개가 내려앉았고, 서린은 그 안개 너머에서 누군가 자신을 부르는 소리를 들은 것 같았다. 회귀 전의 기억이 손끝에서 떨렸다.
";

pub fn history_fixture(
    s: &WorkspaceSession,
    episode_id: &str,
    a: HistoryAction,
) -> Result<String, WsError> {
    use crate::workspace::history;
    ensure_allowed(s)?;
    match a {
        HistoryAction::ThreeRevisions => {
            let mut made = Vec::new();
            for (text, msg) in [(R1, "초고"), (R2, "퇴고 1"), (R3, "퇴고 2")] {
                let p = manuscript::file_path(s, episode_id)?;
                let base = fs::read(&p).ok().map(|b| content_hash(&b));
                manuscript::save(
                    s,
                    &uuid::Uuid::new_v4().to_string(),
                    episode_id,
                    text,
                    base.as_deref(),
                    false,
                    manuscript::LineEnding::Lf,
                )?;
                let r =
                    history::commit(s, &uuid::Uuid::new_v4().to_string(), episode_id, msg, None)?;
                made.push(format!("r{}", r.revision.ordinal));
            }
            Ok(made.join(", "))
        }
        HistoryAction::LeftoverStaging => {
            let stage = s
                .root
                .join(crate::workspace::manifest::TMP_DIR)
                .join(format!(
                    "{}{}",
                    uuid::Uuid::new_v4().simple(),
                    crate::workspace::atomic::TMP_DIR_SUFFIX
                ));
            fs::create_dir_all(&stage)?;
            fs::write(stage.join("revision.json"), b"{\"ordinal\": 999}")?;
            fs::write(stage.join("manuscript.md"), "게시 직전에 멈춘 판")?;
            Ok(crate::workspace::display_path(&stage))
        }
        HistoryAction::DamageLatest => {
            let latest =
                history::latest(s, episode_id)?.ok_or_else(|| refuse("no revision yet"))?;
            let p = s.root.join(&latest.folder).join("manuscript.md");
            fs::write(&p, "몰래 바뀐 과거판")?;
            Ok(format!("r{}", latest.ordinal))
        }
    }
}

/// Session 07: summary / next-note situations.
#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SummaryAction {
    /// Write a summary and a next-episode note for the episode (through the normal save path).
    WriteSummaryAndNote,
    /// Change summary.md outside the app (like another editor).
    ExternalSummaryEdit,
}

pub fn summary_fixture(
    s: &WorkspaceSession,
    episode_id: &str,
    a: SummaryAction,
) -> Result<String, WsError> {
    use crate::workspace::summaries::{self, TextKind};
    ensure_allowed(s)?;
    let ep = crate::workspace::episodes::find(s, episode_id)?;
    match a {
        SummaryAction::WriteSummaryAndNote => {
            let d = summaries::read(s, episode_id)?;
            summaries::save_text(
                s,
                &uuid::Uuid::new_v4().to_string(),
                episode_id,
                TextKind::Summary,
                &format!(
                    "{}화 요약: 서린이 남은 불씨를 감지한다.
린은 끝까지 말이 없다.
",
                    ep.number
                ),
                d.summary.hash.as_deref(),
            )?;
            let d = summaries::read(s, episode_id)?;
            summaries::save_text(
                s,
                &uuid::Uuid::new_v4().to_string(),
                episode_id,
                TextKind::Note,
                &format!(
                    "{}화에서 쓸 것: 검은 편지를 서랍에서 꺼내기.
린이 처음으로 웃는 장면.
",
                    ep.number + 1
                ),
                d.note.hash.as_deref(),
            )?;
            Ok(format!("{}화 요약·다음 화 메모", ep.number))
        }
        SummaryAction::ExternalSummaryEdit => {
            let p = s.root.join(format!("summaries/{episode_id}/summary.md"));
            let mut b = fs::read(&p).unwrap_or_default();
            b.extend_from_slice(
                format!(
                    "[외부에서 덧붙임 {}]
",
                    time_stamp()
                )
                .as_bytes(),
            );
            if let Some(dir) = p.parent() {
                fs::create_dir_all(dir)?;
            }
            fs::write(&p, b)?;
            Ok(crate::workspace::display_path(&p))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::manuscript::{ManuscriptRead, read};
    use crate::workspace::sample::make_sample;
    use crate::workspace::{CreateOptions, create, open};

    #[test]
    fn tools_work_on_sample_works_only() {
        let base = tempfile::tempdir().unwrap();
        let dir = base.path().join("합성");
        let made = make_sample(&dir, "합성", 1).unwrap();
        let id = made.episodes[0].episode_id.clone();
        let s = open(&dir).unwrap();
        let locks = DebugLocks::default();

        write_fixture(&s, &id, Fixture::Cp949).unwrap();
        assert!(matches!(
            read(&s, &id).unwrap(),
            ManuscriptRead::Undecodable { .. }
        ));
        write_fixture(&s, &id, Fixture::BomCrlfEmoji).unwrap();
        let info = file_info(&s, &id, &locks).unwrap();
        assert!(info.bom && info.crlf == 4 && info.utf8 && info.is_sample);

        set_lock(&s, &id, true, &locks).unwrap();
        assert!(matches!(
            read(&s, &id).unwrap(),
            ManuscriptRead::Locked { .. }
        ));
        assert!(file_info(&s, &id, &locks).unwrap().locked_by_debug);
        set_lock(&s, &id, false, &locks).unwrap();
        assert!(matches!(read(&s, &id).unwrap(), ManuscriptRead::Ok { .. }));

        set_readonly(&s, &id, true).unwrap();
        assert!(file_info(&s, &id, &locks).unwrap().readonly);
        set_readonly(&s, &id, false).unwrap();

        // A real (non-sample) work is refused and left untouched.
        let real = base.path().join("진짜 작품");
        std::fs::create_dir_all(&real).unwrap();
        let o = CreateOptions {
            title: "진짜".into(),
            request_id: "r".into(),
            track_label: "본편".into(),
            confirm_non_empty: false,
        };
        create(&real, &o, None).unwrap();
        let rs = open(&real).unwrap();
        let ep = crate::workspace::episodes::create_next(&rs, "e")
            .unwrap()
            .episode;
        std::fs::write(&ep.manuscript_path, "작가의 진짜 원고").unwrap();
        assert!(write_fixture(&rs, &ep.episode_id, Fixture::Empty).is_err());
        assert!(set_lock(&rs, &ep.episode_id, true, &locks).is_err());
        assert!(set_readonly(&rs, &ep.episode_id, true).is_err());
        assert_eq!(
            std::fs::read_to_string(&ep.manuscript_path).unwrap(),
            "작가의 진짜 원고"
        );
    }

    #[test]
    fn fixtures_have_the_forms_they_claim() {
        assert!(fixture_bytes(Fixture::BomCrlfEmoji).starts_with(b"\xEF\xBB\xBF"));
        assert!(std::str::from_utf8(&fixture_bytes(Fixture::Cp949)).is_err());
        assert!(fixture_bytes(Fixture::Empty).is_empty());
        assert!(fixture_bytes(Fixture::Long).len() > 200_000);
        let mixed = fixture_bytes(Fixture::Mixed);
        assert!(mixed.windows(2).any(|w| w == b"\r\n"));
    }
}

#[cfg(test)]
mod tests05 {
    use super::*;
    use crate::workspace::open;
    use crate::workspace::sample::make_sample;
    use crate::workspace::watch::probe;

    #[test]
    fn external_actions_change_what_they_say() {
        let base = tempfile::tempdir().unwrap();
        let dir = base.path().join("외부 편집 시험");
        let made = make_sample(&dir, "외부", 1).unwrap();
        let id = made.episodes[0].episode_id.clone();
        let s = open(&dir).unwrap();
        let p = manuscript::file_path(&s, &id).unwrap();
        std::fs::write(&p, "원래 문장\n").unwrap();
        let h0 = probe(&p).1;
        external_edit(&s, &id, ExternalAction::TouchOnly).unwrap();
        assert_eq!(probe(&p).1, h0, "touch must not change content");
        external_edit(&s, &id, ExternalAction::AppendLine).unwrap();
        assert!(std::fs::read_to_string(&p).unwrap().contains("외부 편집"));
        external_edit(&s, &id, ExternalAction::ReplaceViaTemp).unwrap();
        assert!(std::fs::read_to_string(&p).unwrap().contains("교체 저장"));
        assert!(!p.with_file_name(".manuscript.md.galpi-debug~").exists());
        external_edit(&s, &id, ExternalAction::SaveAsCp949).unwrap();
        assert!(std::str::from_utf8(&std::fs::read(&p).unwrap()).is_err());
        external_edit(&s, &id, ExternalAction::Delete).unwrap();
        assert!(!p.exists());
    }
}

#[cfg(test)]
mod tests06 {
    use super::*;
    use crate::workspace::history;
    use crate::workspace::open;
    use crate::workspace::sample::make_sample;

    #[test]
    fn history_fixtures() {
        let base = tempfile::tempdir().unwrap();
        let dir = base.path().join("이력 도구 시험");
        let made = make_sample(&dir, "이력", 1).unwrap();
        let id = made.episodes[0].episode_id.clone();
        let s = open(&dir).unwrap();
        assert_eq!(
            history_fixture(&s, &id, HistoryAction::ThreeRevisions).unwrap(),
            "r1, r2, r3"
        );
        assert_eq!(history::list(&s, &id).unwrap().revisions.len(), 3);
        history_fixture(&s, &id, HistoryAction::LeftoverStaging).unwrap();
        drop(s);
        let s = open(&dir).unwrap();
        assert!(s.recovery.tmp_files_removed >= 1);
        assert_eq!(history::list(&s, &id).unwrap().revisions.len(), 3);
        assert_eq!(
            history_fixture(&s, &id, HistoryAction::DamageLatest).unwrap(),
            "r3"
        );
        let h = history::list(&s, &id).unwrap();
        assert_eq!((h.revisions.len(), h.problems.len()), (2, 1));
    }
}

#[cfg(test)]
mod tests07 {
    use super::*;
    use crate::workspace::open;
    use crate::workspace::sample::make_sample;
    use crate::workspace::summaries;

    #[test]
    fn summary_fixtures() {
        let base = tempfile::tempdir().unwrap();
        let dir = base.path().join("요약 도구 시험");
        let made = make_sample(&dir, "요약", 2).unwrap();
        let id = made.episodes[0].episode_id.clone();
        let s = open(&dir).unwrap();
        summary_fixture(&s, &id, SummaryAction::WriteSummaryAndNote).unwrap();
        let d = summaries::read(&s, &id).unwrap();
        assert!(d.summary.text.starts_with("1화 요약"));
        assert!(d.note.text.starts_with("2화에서 쓸 것"));
        summary_fixture(&s, &id, SummaryAction::ExternalSummaryEdit).unwrap();
        assert!(
            summaries::read(&s, &id)
                .unwrap()
                .summary
                .text
                .contains("외부에서 덧붙임")
        );
    }
}
