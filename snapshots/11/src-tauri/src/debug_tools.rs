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

/// Session 08: world card situations (sample works only).
#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LoreAction {
    /// Two cards named 서린 in characters/주연 and characters/조연, tag "A" on both, alias 린 on one.
    SameNameCards,
    /// Appends a line to every card.md named 서린 outside the app (like another editor).
    ExternalCardEdit,
}

pub fn lore_fixture(s: &WorkspaceSession, a: LoreAction) -> Result<String, WsError> {
    use crate::workspace::lore::{self, MetaPatch, TemplateId};
    ensure_allowed(s)?;
    match a {
        LoreAction::SameNameCards => {
            let tag = match lore::list_tags(s)?.into_iter().find(|t| t.label == "A") {
                Some(t) => t,
                None => lore::create_tag(s, &uuid::Uuid::new_v4().to_string(), "A")?,
            };
            let mut made = Vec::new();
            for (folder, body, alias) in [
                (
                    "characters/주연",
                    "# 서린\n\n## 욕구\n- 잃어버린 불을 되찾기\n",
                    true,
                ),
                (
                    "characters/조연",
                    "# 서린 (동명이인)\n\n## 메모\n- 시장 골목의 약초상\n",
                    false,
                ),
            ] {
                lore::create_folder(s, folder)?;
                let c = lore::create(
                    s,
                    &uuid::Uuid::new_v4().to_string(),
                    TemplateId::Character,
                    "서린",
                    Some(folder),
                    body,
                )?;
                let d = lore::read(s, &c.card_id)?;
                lore::update_meta(
                    s,
                    &uuid::Uuid::new_v4().to_string(),
                    &c.card_id,
                    &MetaPatch {
                        aliases: alias.then(|| vec!["린".to_string()]),
                        tag_ids: Some(vec![tag.tag_id.clone()]),
                        ..Default::default()
                    },
                    &d.meta_hash,
                )?;
                made.push(folder);
            }
            Ok(format!("서린 ×2 ({}) · 태그 A", made.join(", ")))
        }
        LoreAction::ExternalCardEdit => {
            let mut n = 0;
            for c in lore::list(s)?
                .cards
                .into_iter()
                .filter(|c| c.name == "서린")
            {
                let p = s.root.join(&c.dir).join(lore::CARD_MD);
                let mut b = fs::read(&p).unwrap_or_default();
                b.extend_from_slice(format!("[외부에서 덧붙임 {}]\n", time_stamp()).as_bytes());
                fs::write(&p, b)?;
                n += 1;
            }
            if n == 0 {
                return Err(refuse("no card named 서린"));
            }
            Ok(format!("card.md {n}개"))
        }
    }
}

/// Session 09: timeline situations (sample works only). The standard sample uses fixed event IDs
/// so later sessions and the docs can name them.
#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TimelineAction {
    /// ‘주인공의 능력’(회차) + ‘왕국 연표’(함께 보기); 1화 ‘각성’, 3화 ‘불을 다룸’(두 타임라인 공유).
    StandardSample,
    /// Two event files in the pre-09 shape (no storyCertainty): one with story time, one without.
    LegacyEvents,
    /// Session 10: 351 episodes + the regression fixture (fixed IDs …1001~…1012).
    RegressionSample,
    /// Session 11: search texts in 1~3화, card 서린 (alias 린), an event in 3화 tied to 서린.
    SearchSample,
}

pub const SAMPLE_EVENT_AWAKEN: &str = "00000000-0000-4000-8000-000000000901";
pub const SAMPLE_EVENT_FIRE: &str = "00000000-0000-4000-8000-000000000903";
pub const SAMPLE_EVENT_LEGACY_TIMED: &str = "00000000-0000-4000-8000-000000000a01";
pub const SAMPLE_EVENT_LEGACY_UNTIMED: &str = "00000000-0000-4000-8000-000000000a02";

pub fn timeline_fixture(s: &WorkspaceSession, a: TimelineAction) -> Result<String, WsError> {
    use crate::workspace::timelines::{self, Certainty, EventRecord, ViewMode};
    use crate::workspace::{Expect, episodes};
    ensure_allowed(s)?;
    let find_or_make = |name: &str, mode: ViewMode| -> Result<String, WsError> {
        let d = timelines::load(s)?;
        if let Some(c) = d.collections.iter().find(|c| c.collection.name == name) {
            return Ok(c.collection.collection_id.clone());
        }
        Ok(
            timelines::create_collection(s, &uuid::Uuid::new_v4().to_string(), name, mode)?
                .collection
                .collection_id,
        )
    };
    let put = |rec: &EventRecord| -> Result<bool, WsError> {
        let rel = format!("{}/{}.json", timelines::EVENTS_DIR, rec.event_id);
        if s.root.join(&rel).exists() {
            return Ok(false);
        }
        let body = serde_json::to_vec_pretty(rec).map_err(std::io::Error::other)?;
        s.write_file(
            &uuid::Uuid::new_v4().to_string(),
            &rel,
            &body,
            Expect::Absent,
        )?;
        Ok(true)
    };
    match a {
        TimelineAction::StandardSample => {
            let eps = episodes::list(s)?.episodes;
            if eps.len() < 3 {
                return Err(refuse("needs at least 3 episodes"));
            }
            let power = find_or_make("주인공의 능력", ViewMode::Episode)?;
            let kingdom = find_or_make("왕국 연표", ViewMode::Both)?;
            let mut made = 0;
            for (id, title, ep, cols) in [
                (SAMPLE_EVENT_AWAKEN, "각성", &eps[0], vec![power.clone()]),
                (
                    SAMPLE_EVENT_FIRE,
                    "불을 다룸",
                    &eps[2],
                    vec![power.clone(), kingdom.clone()],
                ),
            ] {
                let rec = EventRecord {
                    schema_version: 1,
                    event_id: id.into(),
                    collection_ids: cols,
                    title: title.into(),
                    episode_id: Some(ep.episode_id.clone()),
                    episode_order: Some(1.0),
                    story_certainty: Some(Certainty::Unknown),
                    created_at: crate::workspace::manifest::now_rfc3339(),
                    ..Default::default()
                };
                made += usize::from(put(&rec)?);
            }
            Ok(format!(
                "타임라인 2개, 사건 {made}개 새로 씀 (각성 …0901 / 불을 다룸 …0903)"
            ))
        }
        TimelineAction::RegressionSample => regression_sample(s),
        TimelineAction::SearchSample => search_sample(s),
        TimelineAction::LegacyEvents => {
            let k = find_or_make("주인공의 능력", ViewMode::Episode)?;
            let d = timelines::load(s)?;
            let track = d
                .tracks
                .first()
                .ok_or_else(|| refuse("no story track"))?
                .track_id
                .clone();
            let ep = episodes::list(s)?
                .episodes
                .first()
                .map(|e| e.episode_id.clone());
            let timed = serde_json::json!({
                "eventId": SAMPLE_EVENT_LEGACY_TIMED, "collectionIds": [k], "title": "예전 사건 (좌표 있음)",
                "storyTrackId": track, "storyOrder": 2, "storyLabel": "2일차"
            });
            let mut untimed = serde_json::json!({
                "eventId": SAMPLE_EVENT_LEGACY_UNTIMED, "collectionIds": [k], "title": "예전 사건 (좌표 없음)"
            });
            if let Some(ep) = ep {
                untimed["episodeId"] = serde_json::Value::String(ep);
            }
            let mut n = 0;
            for (id, v) in [
                (SAMPLE_EVENT_LEGACY_TIMED, timed),
                (SAMPLE_EVENT_LEGACY_UNTIMED, untimed),
            ] {
                let p = s.root.join(format!("{}/{id}.json", timelines::EVENTS_DIR));
                if !p.exists() {
                    fs::write(
                        &p,
                        serde_json::to_vec_pretty(&v).map_err(std::io::Error::other)?,
                    )?;
                    n += 1;
                }
            }
            Ok(format!(
                "예전 형식 사건 파일 {n}개 (…0a01 좌표 있음 / …0a02 좌표 없음)"
            ))
        }
    }
}

/// Fixed IDs of the session-10 regression sample (`TimelineAction::RegressionSample`).
pub const REGRESSION_EVENTS: [(&str, &str); 12] = [
    ("00000000-0000-4000-8000-000000001001", "각성"),
    ("00000000-0000-4000-8000-000000001002", "능력 강화"),
    ("00000000-0000-4000-8000-000000001003", "동료 도윤"),
    ("00000000-0000-4000-8000-000000001004", "동료 린"),
    ("00000000-0000-4000-8000-000000001005", "299화 사건"),
    ("00000000-0000-4000-8000-000000001006", "화염 사용"),
    ("00000000-0000-4000-8000-000000001007", "능력 없음"),
    ("00000000-0000-4000-8000-000000001008", "불씨 감지"),
    ("00000000-0000-4000-8000-000000001009", "327화 과거 공개"),
    ("00000000-0000-4000-8000-000000001010", "350화 사건"),
    ("00000000-0000-4000-8000-000000001011", "351화 귀환"),
    ("00000000-0000-4000-8000-000000001012", "회차 미정 사건"),
];

type Spec<'a> = (
    usize,
    Option<u32>,
    f64,
    Option<(&'a String, f64, crate::workspace::timelines::Certainty)>,
    Vec<&'a String>,
    Option<(&'static str, &'static str)>,
);

/// Session 10: 351 episodes, tracks 본편 / 회귀 전 / 1차 회귀, card 서린, tags 회귀·비밀·곁가지,
/// timeline ‘회귀 연표’ with the same events as `views::fixture` (fixed IDs above).
fn regression_sample(s: &WorkspaceSession) -> Result<String, WsError> {
    use crate::workspace::lore::{self, TemplateId};
    use crate::workspace::timelines::{self, Certainty, EventRecord, StateChange, ViewMode};
    use crate::workspace::{Expect, episodes};
    let new_id = || uuid::Uuid::new_v4().to_string();
    let mut eps = episodes::list(s)?.episodes;
    while eps.len() < 351 {
        episodes::create_next(s, &new_id())?;
        eps = episodes::list(s)?.episodes;
    }
    let ep_id = |n: u32| {
        eps.iter()
            .find(|e| e.number == n)
            .map(|e| e.episode_id.clone())
    };
    let mut d = timelines::load(s)?;
    for label in ["회귀 전", "1차 회귀"] {
        if !d.tracks.iter().any(|t| t.label == label) {
            timelines::add_track(s, &new_id(), label, &d.tracks_hash)?;
            d = timelines::load(s)?;
        }
    }
    let track = |label: &str| {
        d.tracks
            .iter()
            .find(|t| t.label == label)
            .map(|t| t.track_id.clone())
            .ok_or_else(|| refuse("track"))
    };
    let main = d.tracks[0].track_id.clone();
    let before = track("회귀 전")?;
    let loop1 = track("1차 회귀")?;
    let serin = match lore::list(s)?.cards.into_iter().find(|c| c.name == "서린") {
        Some(c) => c.card_id,
        None => {
            lore::create(
                s,
                &new_id(),
                TemplateId::Character,
                "서린",
                None,
                "# 서린\n",
            )?
            .card_id
        }
    };
    let tag = |label: &str| -> Result<String, WsError> {
        Ok(
            match lore::list_tags(s)?.into_iter().find(|t| t.label == label) {
                Some(t) => t.tag_id,
                None => lore::create_tag(s, &new_id(), label)?.tag_id,
            },
        )
    };
    let (t_reg, t_sec, t_side) = (tag("회귀")?, tag("비밀")?, tag("곁가지")?);
    let k = match d
        .collections
        .iter()
        .find(|c| c.collection.name == "회귀 연표")
    {
        Some(c) => c.collection.collection_id.clone(),
        None => {
            timelines::create_collection(s, &new_id(), "회귀 연표", ViewMode::Both)?
                .collection
                .collection_id
        }
    };
    use Certainty::{Confirmed as C, Estimated as E};
    let spec: [Spec; 12] = [
        (
            0,
            Some(1),
            1.0,
            Some((&main, 1.0, C)),
            vec![],
            Some(("능력", "불꽃 각성")),
        ),
        (
            1,
            Some(20),
            1.0,
            Some((&main, 6.0, C)),
            vec![],
            Some(("능력", "화염 조종")),
        ),
        (
            2,
            Some(25),
            1.0,
            Some((&main, 4.0, C)),
            vec![&t_side],
            Some(("동료", "도윤")),
        ),
        (
            3,
            Some(25),
            1.0,
            Some((&main, 4.0, C)),
            vec![&t_side],
            Some(("동료", "린")),
        ),
        (4, Some(299), 1.0, Some((&main, 9.0, C)), vec![], None),
        (
            5,
            Some(300),
            1.0,
            Some((&before, 2.0, C)),
            vec![&t_reg],
            Some(("능력", "화염 사용")),
        ),
        (
            6,
            Some(305),
            1.0,
            Some((&loop1, 1.0, C)),
            vec![&t_reg],
            Some(("능력", "능력 없음")),
        ),
        (
            7,
            Some(310),
            1.0,
            Some((&loop1, 2.0, E)),
            vec![&t_reg],
            Some(("능력", "불씨 감지")),
        ),
        (
            8,
            Some(327),
            1.0,
            Some((&main, 2.0, C)),
            vec![&t_reg, &t_sec],
            Some(("과거", "회귀자")),
        ),
        (9, Some(350), 2.0, None, vec![&t_reg], None),
        (10, Some(351), 1.0, Some((&main, 10.0, C)), vec![], None),
        (11, None, 0.0, Some((&main, 5.0, C)), vec![], None),
    ];
    let mut written = 0;
    for (i, ep, order, story, tags, change) in spec {
        let (id, title) = REGRESSION_EVENTS[i];
        let rel = format!("{}/{id}.json", timelines::EVENTS_DIR);
        if s.root.join(&rel).exists() {
            continue;
        }
        let (track_id, story_order, cert) = match story {
            Some((t, o, c)) => (Some(t.clone()), Some(o), c),
            None => (None, None, Certainty::Unknown),
        };
        let rec = EventRecord {
            schema_version: 1,
            event_id: id.into(),
            collection_ids: vec![k.clone()],
            title: title.into(),
            tag_ids: tags.into_iter().cloned().collect(),
            changes: change
                .map(|(p, v)| StateChange {
                    entity_id: serin.clone(),
                    property_key: p.into(),
                    value: v.into(),
                })
                .into_iter()
                .collect(),
            related_card_ids: if change.is_some() {
                vec![serin.clone()]
            } else {
                Vec::new()
            },
            episode_id: ep.and_then(ep_id),
            episode_order: ep.map(|_| order),
            story_certainty: Some(cert),
            story_track_id: track_id,
            story_order,
            story_label: story_order.map(|o| format!("{o}일차")),
            created_at: crate::workspace::manifest::now_rfc3339(),
            ..Default::default()
        };
        let body = serde_json::to_vec_pretty(&rec).map_err(std::io::Error::other)?;
        s.write_file(&new_id(), &rel, &body, Expect::Absent)?;
        written += 1;
    }
    Ok(format!(
        "회차 {}개, 트랙 3개, 사건 {written}개 새로 씀 (…1001~…1012), 카드 서린",
        eps.len()
    ))
}

/// The S11 texts (same as `workspace::search::fixture`).
pub const SEARCH_TEXTS: [&str; 3] = [
    "서린은 손끝에 불을 피웠다.\n\n\"불씨\"라는 말이 50% 확률로 돌았다. snake_case 표기와 Hello World.",
    "편지에는 린이라고만 적혀 있었다.",
    "그 아이는 남은 불씨를 감지했다.\n\n서린이 웃었다.",
];

fn search_sample(s: &WorkspaceSession) -> Result<String, WsError> {
    use crate::workspace::lore::{self, MetaPatch, TemplateId};
    use crate::workspace::manuscript::{LineEnding, save};
    use crate::workspace::timelines::{self, EventDraft, ViewMode};
    use crate::workspace::{content_hash, episodes};
    let new_id = || uuid::Uuid::new_v4().to_string();
    let eps = episodes::list(s)?.episodes;
    if eps.len() < 3 {
        return Err(refuse("needs at least 3 episodes"));
    }
    for (ep, text) in eps.iter().zip(SEARCH_TEXTS) {
        let p = manuscript::file_path(s, &ep.episode_id)?;
        let h = fs::read(&p).ok().map(|b| content_hash(&b));
        save(
            s,
            &new_id(),
            &ep.episode_id,
            text,
            h.as_deref(),
            false,
            LineEnding::Lf,
        )?;
    }
    let card = match lore::list(s)?.cards.into_iter().find(|c| c.name == "서린") {
        Some(c) => c,
        None => lore::create(
            s,
            &new_id(),
            TemplateId::Character,
            "서린",
            None,
            "# 서린\n\n미래 메모: 327화에서 회귀자임이 밝혀짐\n",
        )?,
    };
    let doc = lore::read(s, &card.card_id)?;
    lore::update_meta(
        s,
        &new_id(),
        &card.card_id,
        &MetaPatch {
            aliases: Some(vec!["린".into()]),
            ..Default::default()
        },
        &doc.meta_hash,
    )?;
    let d = timelines::load(s)?;
    if !d.events.iter().any(|e| e.record.title == "그 아이의 정체") {
        let k = match d
            .collections
            .iter()
            .find(|c| c.collection.name == "주인공의 능력")
        {
            Some(c) => c.collection.collection_id.clone(),
            None => {
                timelines::create_collection(s, &new_id(), "주인공의 능력", ViewMode::Episode)?
                    .collection
                    .collection_id
            }
        };
        timelines::save_event(
            s,
            &new_id(),
            None,
            None,
            &EventDraft {
                collection_ids: vec![k],
                title: "그 아이의 정체".into(),
                detail: "서린과 연결".into(),
                related_card_ids: vec![card.card_id.clone()],
                episode_id: Some(eps[2].episode_id.clone()),
                ..Default::default()
            },
        )?;
    }
    Ok("1~3화 원고, 카드 서린(별칭 린), 3화 사건 ‘그 아이의 정체’".into())
}

#[cfg(test)]
mod tests11 {
    use super::*;
    use crate::workspace::open;
    use crate::workspace::sample::make_sample;
    use crate::workspace::search;
    use std::sync::atomic::AtomicBool;

    #[test]
    fn search_sample_gives_the_s11_answers() {
        let base = tempfile::tempdir().unwrap();
        let dir = base.path().join("검색 표본");
        make_sample(&dir, "검색", 3).unwrap();
        let s = open(&dir).unwrap();
        timeline_fixture(&s, TimelineAction::SearchSample).unwrap();
        timeline_fixture(&s, TimelineAction::SearchSample).unwrap(); // idempotent
        let path = search::cache_path(&base.path().join("cache"), &s.workspace_id, &s.root);
        let (mut c, _) = search::open_index(&path, &s.workspace_id, &s.root).unwrap();
        search::sync(&mut c, &s, &AtomicBool::new(false)).unwrap();
        let eps = |q: &str| {
            let mut v: Vec<u32> = search::search(&c, q, &Default::default())
                .unwrap()
                .hits
                .iter()
                .filter(|h| h.kind == "manuscript")
                .filter_map(|h| h.episode_number)
                .collect();
            v.dedup();
            v
        };
        assert_eq!(eps("린"), vec![1, 2, 3]);
        assert_eq!(eps("감지했다"), vec![3]);
        assert_eq!(eps("%"), vec![1]);
        assert_eq!(
            crate::workspace::timelines::load(&s).unwrap().events.len(),
            1
        );
    }
}

#[cfg(test)]
mod tests10 {
    use super::*;
    use crate::workspace::open;
    use crate::workspace::sample::make_sample;
    use crate::workspace::timelines;
    use crate::workspace::views::{self, Basis, Range, StateQuery, ViewFilter};

    #[test]
    fn regression_sample_matches_the_fixture() {
        let base = tempfile::tempdir().unwrap();
        let dir = base.path().join("회귀 표본");
        make_sample(&dir, "회귀", 3).unwrap();
        let s = open(&dir).unwrap();
        timeline_fixture(&s, TimelineAction::RegressionSample).unwrap();
        timeline_fixture(&s, TimelineAction::RegressionSample).unwrap(); // idempotent
        let d = timelines::load(&s).unwrap();
        assert_eq!(
            crate::workspace::episodes::list(&s).unwrap().episodes.len(),
            351
        );
        assert_eq!(d.events.len(), 12);
        assert_eq!(d.tracks.len(), 3);
        let id = |n: usize| REGRESSION_EVENTS[n].0.to_string();
        let f = ViewFilter {
            episode_range: Some(Range {
                from: Some(300.0),
                to: Some(350.0),
            }),
            ..Default::default()
        };
        let mut got = views::filter_events(&d.events, &f);
        got.sort();
        assert_eq!(got, (5..=9).map(id).collect::<Vec<_>>());
        let serin = d
            .events
            .iter()
            .find_map(|e| e.record.changes.first())
            .unwrap()
            .entity_id
            .clone();
        let reader = StateQuery {
            entity_id: serin.clone(),
            basis: Basis::Reader,
            episode_max: Some(25),
            ..Default::default()
        };
        assert!(
            !views::compute_state(&d.events, &reader)
                .unwrap()
                .considered
                .contains(&id(8))
        );
        let loop1 = d
            .tracks
            .iter()
            .find(|t| t.label == "1차 회귀")
            .unwrap()
            .track_id
            .clone();
        let story = StateQuery {
            entity_id: serin,
            basis: Basis::Story,
            track_id: Some(loop1),
            story_max: Some(2.0),
            ..Default::default()
        };
        let r = views::compute_state(&d.events, &story).unwrap();
        assert_eq!(
            r.values
                .iter()
                .find(|v| v.property_key == "능력")
                .unwrap()
                .value
                .as_deref(),
            Some("능력 없음")
        );
        assert_eq!(r.estimated_skipped, vec![id(7)]);
    }
}

#[cfg(test)]
mod tests09 {
    use super::*;
    use crate::workspace::open;
    use crate::workspace::sample::make_sample;
    use crate::workspace::timelines::{self, Certainty};

    #[test]
    fn timeline_fixtures() {
        let base = tempfile::tempdir().unwrap();
        let dir = base.path().join("타임라인 도구 시험");
        make_sample(&dir, "잿빛 항구", 3).unwrap();
        let s = open(&dir).unwrap();
        timeline_fixture(&s, TimelineAction::StandardSample).unwrap();
        timeline_fixture(&s, TimelineAction::StandardSample).unwrap(); // idempotent
        timeline_fixture(&s, TimelineAction::LegacyEvents).unwrap();
        let d = timelines::load(&s).unwrap();
        assert_eq!(d.collections.len(), 2);
        assert_eq!(d.events.len(), 4);
        let by = |id: &str| d.events.iter().find(|e| e.record.event_id == id).unwrap();
        assert_eq!(by(SAMPLE_EVENT_AWAKEN).episode_number, Some(1));
        assert_eq!(by(SAMPLE_EVENT_FIRE).episode_number, Some(3));
        assert_eq!(by(SAMPLE_EVENT_FIRE).record.collection_ids.len(), 2);
        assert_eq!(
            by(SAMPLE_EVENT_LEGACY_TIMED).certainty,
            Certainty::Confirmed
        );
        assert_eq!(
            by(SAMPLE_EVENT_LEGACY_UNTIMED).certainty,
            Certainty::Unknown
        );
    }

    #[test]
    fn timeline_fixture_needs_three_episodes() {
        let base = tempfile::tempdir().unwrap();
        let dir = base.path().join("한 화");
        make_sample(&dir, "x", 1).unwrap();
        let s = open(&dir).unwrap();
        assert!(timeline_fixture(&s, TimelineAction::StandardSample).is_err());
    }
}

#[cfg(test)]
mod tests08 {
    use super::*;
    use crate::workspace::lore;
    use crate::workspace::open;
    use crate::workspace::sample::make_sample;

    #[test]
    fn lore_fixtures() {
        let base = tempfile::tempdir().unwrap();
        let dir = base.path().join("세계관 도구 시험");
        make_sample(&dir, "세계관", 0).unwrap();
        let s = open(&dir).unwrap();
        lore_fixture(&s, LoreAction::SameNameCards).unwrap();
        let l = lore::list(&s).unwrap();
        assert_eq!(l.cards.iter().filter(|c| c.name == "서린").count(), 2);
        assert_eq!(lore::list_tags(&s).unwrap()[0].card_count, 2);
        assert_eq!(
            l.cards
                .iter()
                .filter(|c| c.aliases == vec!["린".to_string()])
                .count(),
            1
        );
        lore_fixture(&s, LoreAction::ExternalCardEdit).unwrap();
        let id = &l.cards[0].card_id;
        assert!(lore::read(&s, id).unwrap().body.contains("외부에서 덧붙임"));
    }

    #[test]
    fn lore_fixture_refuses_real_works() {
        let base = tempfile::tempdir().unwrap();
        let dir = base.path().join("진짜 작품");
        crate::workspace::ensure_leaf_folder(&dir).unwrap();
        let opts = crate::workspace::CreateOptions {
            title: "진짜".into(),
            request_id: "r".into(),
            track_label: "본편".into(),
            confirm_non_empty: false,
        };
        crate::workspace::create(&dir, &opts, None).unwrap();
        let s = open(&dir).unwrap();
        assert!(lore_fixture(&s, LoreAction::SameNameCards).is_err());
        assert!(lore::list(&s).unwrap().cards.is_empty());
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
