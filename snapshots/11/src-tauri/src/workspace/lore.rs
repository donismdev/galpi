//! World cards (세계관 카드), folders and user tags (session 08).
//!
//! Layout (WORKSPACE_FORMAT):
//! - `lore/<folder>/<cardId>/card.md`   — the card body, free Markdown (the writer's text)
//! - `lore/<folder>/<cardId>/card.json` — cardId, templateId, name, aliases, tagIds, folder, …
//! - `tags/<tagId>.json`                — tagId, label
//!
//! `<folder>` is one of the four top folders (characters / places / groups / notes) optionally
//! followed by the writer's subfolders (e.g. `characters/주연`). A card's folder is where its
//! directory actually is; `card.json.folder` mirrors it and is repaired on the next metadata
//! write if a move was interrupted between the rename and the metadata update.
//!
//! IDs are UUIDs and never change: renaming a card or a tag, or moving a card, keeps its ID, so
//! anything linking to it (events in 09, links in 13) keeps working. Names may repeat; the list
//! shows each card's folder path to tell them apart.

use super::error::WsError;
use super::manifest::{TMP_DIR, now_rfc3339, strip_bom};
use super::{Expect, WorkspaceSession, atomic, paths};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub const LORE_DIR: &str = "lore";
pub const TAGS_DIR: &str = "tags";
pub const CARD_JSON: &str = "card.json";
pub const CARD_MD: &str = "card.md";
pub const TOP_FOLDERS: [&str; 4] = ["characters", "places", "groups", "notes"];
const MAX_DEPTH: usize = 8;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TemplateId {
    Character,
    Personality,
    Place,
    Group,
    Rule,
    Note,
}

impl TemplateId {
    /// Where a new card of this template goes unless the writer picks another folder.
    pub fn default_folder(self) -> &'static str {
        match self {
            TemplateId::Character | TemplateId::Personality => "characters",
            TemplateId::Place => "places",
            TemplateId::Group => "groups",
            TemplateId::Rule | TemplateId::Note => "notes",
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CardMeta {
    pub card_id: String,
    pub template_id: TemplateId,
    pub name: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub tag_ids: Vec<String>,
    #[serde(default)]
    pub folder: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CardInfo {
    pub card_id: String,
    pub template_id: TemplateId,
    pub name: String,
    pub aliases: Vec<String>,
    pub tag_ids: Vec<String>,
    /// Actual folder (where the card directory is), e.g. `characters/주연`.
    pub folder: String,
    pub created_at: String,
    /// Work-relative card directory, e.g. `lore/characters/<id>`.
    pub dir: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FolderInfo {
    pub path: String,
    /// Cards directly in this folder.
    pub count: usize,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LoreProblem {
    pub dir: String,
    pub detail: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CardList {
    pub cards: Vec<CardInfo>,
    pub folders: Vec<FolderInfo>,
    pub problems: Vec<LoreProblem>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CardDoc {
    pub card: CardInfo,
    pub body: String,
    pub body_hash: Option<String>,
    pub meta_hash: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub tag_id: String,
    pub label: String,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TagInfo {
    pub tag_id: String,
    pub label: String,
    /// Cards that carry this tag.
    pub card_count: usize,
}

fn bad(what: &str) -> WsError {
    WsError::InvalidRelativePath { rel: what.into() }
}

fn check_id(id: &str) -> Result<(), WsError> {
    if !id.is_empty() && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        Ok(())
    } else {
        Err(bad(id))
    }
}

/// `characters`, `characters/주연`, … — a top folder plus safe subfolder names.
pub fn validate_folder(folder: &str) -> Result<String, WsError> {
    let norm = folder.trim().trim_matches(['/', '\\']).replace('\\', "/");
    let top = norm.split('/').next().unwrap_or("");
    if !TOP_FOLDERS.contains(&top) || norm.split('/').count() > MAX_DEPTH {
        return Err(bad(folder));
    }
    paths::validate_relative(&norm)?;
    Ok(norm)
}

fn read_meta_at(dir: &Path) -> Result<CardMeta, String> {
    let b = fs::read(dir.join(CARD_JSON)).map_err(|e| format!("{CARD_JSON}: {e}"))?;
    serde_json::from_slice(strip_bom(&b)).map_err(|e| format!("{CARD_JSON}: {e}"))
}

fn walk(root: &Path, rel: &str, depth: usize, out: &mut CardList) -> io::Result<()> {
    let abs = root.join(rel);
    let mut count = 0;
    let mut entries: Vec<_> = fs::read_dir(&abs)?.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        if !e.file_type()?.is_dir() {
            continue;
        }
        let name = e.file_name().to_string_lossy().into_owned();
        let child_rel = format!("{rel}/{name}");
        if e.path().join(CARD_JSON).exists() {
            match read_meta_at(&e.path()) {
                Ok(m) if m.card_id == name => {
                    count += 1;
                    out.cards.push(CardInfo {
                        card_id: m.card_id,
                        template_id: m.template_id,
                        name: m.name,
                        aliases: m.aliases,
                        tag_ids: m.tag_ids,
                        folder: rel.trim_start_matches(&format!("{LORE_DIR}/")).to_string(),
                        created_at: m.created_at,
                        dir: child_rel,
                    });
                }
                Ok(m) => out.problems.push(LoreProblem {
                    dir: child_rel,
                    detail: format!("folder name differs from cardId {}", m.card_id),
                }),
                Err(detail) => out.problems.push(LoreProblem {
                    dir: child_rel,
                    detail,
                }),
            }
        } else if depth < MAX_DEPTH {
            walk(root, &child_rel, depth + 1, out)?;
        }
    }
    out.folders.push(FolderInfo {
        path: rel.trim_start_matches(&format!("{LORE_DIR}/")).to_string(),
        count,
    });
    Ok(())
}

pub fn list(s: &WorkspaceSession) -> Result<CardList, WsError> {
    let mut out = CardList::default();
    for top in TOP_FOLDERS {
        let rel = format!("{LORE_DIR}/{top}");
        if s.root.join(&rel).is_dir() {
            walk(&s.root, &rel, 1, &mut out)?;
        } else {
            out.folders.push(FolderInfo {
                path: top.to_string(),
                count: 0,
            });
        }
    }
    out.folders.sort_by(|a, b| a.path.cmp(&b.path));
    out.cards
        .sort_by(|a, b| (&a.folder, &a.name, &a.card_id).cmp(&(&b.folder, &b.name, &b.card_id)));
    Ok(out)
}

/// Common card lookup by ID (09: events link cards by ID).
pub fn find(s: &WorkspaceSession, card_id: &str) -> Result<CardInfo, WsError> {
    check_id(card_id)?;
    list(s)?
        .cards
        .into_iter()
        .find(|c| c.card_id == card_id)
        .ok_or_else(|| WsError::NotFound {
            path: format!("card {card_id}"),
        })
}

pub fn read(s: &WorkspaceSession, card_id: &str) -> Result<CardDoc, WsError> {
    let card = find(s, card_id)?;
    let (meta_bytes, meta_hash) = s.read_file(&format!("{}/{CARD_JSON}", card.dir))?;
    let _ = meta_bytes;
    let (body, body_hash) = match s.read_file(&format!("{}/{CARD_MD}", card.dir)) {
        Ok((b, h)) => (
            String::from_utf8_lossy(strip_bom(&b)).replace("\r\n", "\n"),
            Some(h),
        ),
        Err(WsError::Io { kind, .. }) if kind == "NotFound" => (String::new(), None),
        Err(e) => return Err(e),
    };
    Ok(CardDoc {
        card,
        body,
        body_hash,
        meta_hash,
    })
}

fn clean_aliases(aliases: &[String], name: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for a in aliases {
        let a = a.trim();
        if !a.is_empty() && a != name.trim() && !out.iter().any(|x| x == a) {
            out.push(a.to_string());
        }
    }
    out
}

/// Creates a card from a template. `body` is the template text the UI copied from its language
/// resources at this moment; it is stored as the writer's own text from then on.
pub fn create(
    s: &WorkspaceSession,
    request_id: &str,
    template: TemplateId,
    name: &str,
    folder: Option<&str>,
    body: &str,
) -> Result<CardInfo, WsError> {
    s.ensure_writable()?;
    let folder = validate_folder(folder.unwrap_or(template.default_folder()))?;
    let _guard = s.writer_guard()?;
    // Same request again → the card it made (double click, retry).
    if let Some(c) = list(s)?.cards.into_iter().find(|c| {
        read_meta_at(&s.root.join(&c.dir))
            .ok()
            .and_then(|m| m.request_id)
            .is_some_and(|r| r == request_id)
    }) {
        return Ok(c);
    }
    let id = Uuid::new_v4().to_string();
    let meta = CardMeta {
        card_id: id.clone(),
        template_id: template,
        name: name.trim().to_string(),
        aliases: Vec::new(),
        tag_ids: Vec::new(),
        folder: folder.clone(),
        created_at: now_rfc3339(),
        request_id: Some(request_id.to_string()),
        extra: Default::default(),
    };
    let rel_dir = format!("{LORE_DIR}/{folder}/{id}");
    let target = paths::resolve_in_root(&s.root, &rel_dir)?;
    fs::create_dir_all(target.parent().expect("parent"))?;
    let json = serde_json::to_vec_pretty(&meta).map_err(io::Error::other)?;
    atomic::publish_new_dir(
        &s.root.join(TMP_DIR),
        &target,
        &[
            (CARD_JSON, &json),
            (CARD_MD, body.replace("\r\n", "\n").as_bytes()),
        ],
    )?;
    find(s, &id)
}

pub fn save_body(
    s: &WorkspaceSession,
    request_id: &str,
    card_id: &str,
    text: &str,
    expected_hash: Option<&str>,
) -> Result<CardDoc, WsError> {
    s.ensure_writable()?;
    let card = find(s, card_id)?;
    let expect = match expected_hash {
        Some(h) => Expect::Hash(h.into()),
        None => Expect::Absent,
    };
    s.write_file(
        request_id,
        &format!("{}/{CARD_MD}", card.dir),
        text.replace("\r\n", "\n").as_bytes(),
        expect,
    )?;
    read(s, card_id)
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct MetaPatch {
    pub name: Option<String>,
    pub aliases: Option<Vec<String>>,
    pub tag_ids: Option<Vec<String>>,
}

/// Rename, aliases, tags. The card ID and folder never change here.
pub fn update_meta(
    s: &WorkspaceSession,
    request_id: &str,
    card_id: &str,
    patch: &MetaPatch,
    expected_meta_hash: &str,
) -> Result<CardDoc, WsError> {
    s.ensure_writable()?;
    let card = find(s, card_id)?;
    let rel = format!("{}/{CARD_JSON}", card.dir);
    let (bytes, hash) = s.read_file(&rel)?;
    if hash != expected_meta_hash {
        return Err(WsError::WriteConflict {
            expected: Some(expected_meta_hash.into()),
            actual: Some(hash),
        });
    }
    let mut meta: CardMeta =
        serde_json::from_slice(strip_bom(&bytes)).map_err(|e| WsError::InvalidManifest {
            detail: format!("{rel}: {e}"),
        })?;
    if let Some(n) = &patch.name {
        if n.trim().is_empty() {
            return Err(bad("name"));
        }
        meta.name = n.trim().to_string();
    }
    if let Some(a) = &patch.aliases {
        meta.aliases = a.clone();
    }
    meta.aliases = clean_aliases(&meta.aliases, &meta.name);
    if let Some(t) = &patch.tag_ids {
        let known: Vec<String> = list_tags(s)?.into_iter().map(|t| t.tag_id).collect();
        let mut ids: Vec<String> = Vec::new();
        for id in t {
            if !known.contains(id) {
                return Err(WsError::NotFound {
                    path: format!("tag {id}"),
                });
            }
            if !ids.contains(id) {
                ids.push(id.clone());
            }
        }
        meta.tag_ids = ids;
    }
    meta.folder = card.folder.clone(); // repair after an interrupted move
    let body = serde_json::to_vec_pretty(&meta).map_err(io::Error::other)?;
    s.write_file(request_id, &rel, &body, Expect::Hash(hash))?;
    read(s, card_id)
}

/// Moves the card directory to another folder (one rename), then records the folder.
pub fn move_card(
    s: &WorkspaceSession,
    request_id: &str,
    card_id: &str,
    to_folder: &str,
) -> Result<CardDoc, WsError> {
    s.ensure_writable()?;
    let to = validate_folder(to_folder)?;
    let card = find(s, card_id)?;
    if card.folder != to {
        let _guard = s.writer_guard()?;
        let from = paths::resolve_in_root(&s.root, &card.dir)?;
        let target_rel = format!("{LORE_DIR}/{to}/{card_id}");
        let target = paths::resolve_in_root(&s.root, &target_rel)?;
        if target.exists() {
            return Err(WsError::NameConflicts {
                conflicts: vec![target_rel],
                suggestion: None,
            });
        }
        fs::create_dir_all(target.parent().expect("parent"))?;
        fs::rename(&from, &target)?;
    }
    // Record the new folder (also repairs a previous interrupted move).
    let doc = read(s, card_id)?;
    update_meta(
        s,
        request_id,
        card_id,
        &MetaPatch::default(),
        &doc.meta_hash,
    )
}

pub fn create_folder(s: &WorkspaceSession, folder: &str) -> Result<String, WsError> {
    s.ensure_writable()?;
    let f = validate_folder(folder)?;
    let p = paths::resolve_in_root(&s.root, &format!("{LORE_DIR}/{f}"))?;
    if p.join(CARD_JSON).exists() {
        return Err(bad(folder));
    }
    fs::create_dir_all(p)?;
    Ok(f)
}

// ---------------------------------------------------------------- tags

fn tag_rel(id: &str) -> String {
    format!("{TAGS_DIR}/{id}.json")
}

fn read_tags(s: &WorkspaceSession) -> Result<Vec<Tag>, WsError> {
    let dir = s.root.join(TAGS_DIR);
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    let mut tags = Vec::new();
    for e in entries.flatten() {
        if e.path().extension().is_some_and(|x| x == "json")
            && let Ok(b) = fs::read(e.path())
            && let Ok(t) = serde_json::from_slice::<Tag>(strip_bom(&b))
        {
            tags.push(t);
        }
    }
    tags.sort_by(|a, b| (&a.label, &a.tag_id).cmp(&(&b.label, &b.tag_id)));
    Ok(tags)
}

pub fn list_tags(s: &WorkspaceSession) -> Result<Vec<TagInfo>, WsError> {
    let cards = list(s)?.cards;
    Ok(read_tags(s)?
        .into_iter()
        .map(|t| TagInfo {
            card_count: cards
                .iter()
                .filter(|c| c.tag_ids.contains(&t.tag_id))
                .count(),
            tag_id: t.tag_id,
            label: t.label,
        })
        .collect())
}

pub fn create_tag(s: &WorkspaceSession, request_id: &str, label: &str) -> Result<TagInfo, WsError> {
    s.ensure_writable()?;
    let label = label.trim();
    if label.is_empty() {
        return Err(bad("label"));
    }
    let id = Uuid::new_v4().to_string();
    let t = Tag {
        tag_id: id.clone(),
        label: label.into(),
        extra: Default::default(),
    };
    let body = serde_json::to_vec_pretty(&t).map_err(io::Error::other)?;
    s.write_file(request_id, &tag_rel(&id), &body, Expect::Absent)?;
    Ok(TagInfo {
        tag_id: id,
        label: label.into(),
        card_count: 0,
    })
}

/// Changes only the label; the tag ID (and every card that carries it) stays.
pub fn rename_tag(
    s: &WorkspaceSession,
    request_id: &str,
    tag_id: &str,
    label: &str,
) -> Result<TagInfo, WsError> {
    s.ensure_writable()?;
    check_id(tag_id)?;
    let label = label.trim();
    if label.is_empty() {
        return Err(bad("label"));
    }
    let rel = tag_rel(tag_id);
    let (bytes, hash) = s.read_file(&rel)?;
    let mut t: Tag =
        serde_json::from_slice(strip_bom(&bytes)).map_err(|e| WsError::InvalidManifest {
            detail: format!("{rel}: {e}"),
        })?;
    t.label = label.into();
    let body = serde_json::to_vec_pretty(&t).map_err(io::Error::other)?;
    s.write_file(request_id, &rel, &body, Expect::Hash(hash))?;
    list_tags(s)?
        .into_iter()
        .find(|x| x.tag_id == tag_id)
        .ok_or(WsError::NotFound { path: rel })
}

/// "태그 전역 정리": removes the tag from every card, then deletes the tag. Returns the number of
/// cards changed. The UI shows `TagInfo.card_count` first and asks before calling this.
pub fn delete_tag_everywhere(
    s: &WorkspaceSession,
    request_id: &str,
    tag_id: &str,
) -> Result<usize, WsError> {
    s.ensure_writable()?;
    check_id(tag_id)?;
    let mut changed = 0;
    for c in list(s)?
        .cards
        .into_iter()
        .filter(|c| c.tag_ids.iter().any(|t| t == tag_id))
    {
        let doc = read(s, &c.card_id)?;
        let tags: Vec<String> = c.tag_ids.iter().filter(|t| *t != tag_id).cloned().collect();
        update_meta(
            s,
            &format!("{request_id}:{}", c.card_id),
            &c.card_id,
            &MetaPatch {
                tag_ids: Some(tags),
                ..Default::default()
            },
            &doc.meta_hash,
        )?;
        changed += 1;
    }
    let p: PathBuf = paths::resolve_in_root(&s.root, &tag_rel(tag_id))?;
    match fs::remove_file(p) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::open;
    use crate::workspace::sample::make_sample;

    fn work() -> (tempfile::TempDir, PathBuf, WorkspaceSession) {
        let base = tempfile::tempdir().unwrap();
        let dir = base.path().join("세계관 시험 (08)");
        make_sample(&dir, "세계관", 0).unwrap();
        let s = open(&dir).unwrap();
        (base, dir, s)
    }

    fn meta_hash(s: &WorkspaceSession, id: &str) -> String {
        read(s, id).unwrap().meta_hash
    }

    // S08.A — same name in two folders; rename + move keep ID, tags and body.
    #[test]
    fn s08a_same_name_two_folders_rename_and_move_keep_id_tags_body() {
        let (_b, _d, s) = work();
        create_folder(&s, "characters/주연").unwrap();
        create_folder(&s, "characters/조연").unwrap();
        let a = create(
            &s,
            "a",
            TemplateId::Character,
            "서린",
            Some("characters/주연"),
            "# 서린\n\n## 욕구\n- 불을 되찾기\n",
        )
        .unwrap();
        let b = create(
            &s,
            "b",
            TemplateId::Character,
            "서린",
            Some("characters/조연"),
            "# 동명이인\n",
        )
        .unwrap();
        assert_ne!(a.card_id, b.card_id);
        let tag = create_tag(&s, "t", "주인공").unwrap();
        update_meta(
            &s,
            "m1",
            &a.card_id,
            &MetaPatch {
                tag_ids: Some(vec![tag.tag_id.clone()]),
                ..Default::default()
            },
            &meta_hash(&s, &a.card_id),
        )
        .unwrap();
        let l = list(&s).unwrap();
        let named: Vec<_> = l
            .cards
            .iter()
            .filter(|c| c.name == "서린")
            .map(|c| c.folder.clone())
            .collect();
        assert_eq!(
            named,
            vec!["characters/조연".to_string(), "characters/주연".to_string()]
        );

        update_meta(
            &s,
            "m2",
            &a.card_id,
            &MetaPatch {
                name: Some("한서린".into()),
                ..Default::default()
            },
            &meta_hash(&s, &a.card_id),
        )
        .unwrap();
        let moved = move_card(&s, "mv", &a.card_id, "characters").unwrap();
        assert_eq!(moved.card.card_id, a.card_id);
        assert_eq!(moved.card.name, "한서린");
        assert_eq!(moved.card.folder, "characters");
        assert_eq!(moved.card.tag_ids, vec![tag.tag_id.clone()]);
        assert_eq!(moved.body, "# 서린\n\n## 욕구\n- 불을 되찾기\n");
        assert!(
            !s.root
                .join(format!("lore/characters/주연/{}", a.card_id))
                .exists()
        );
        let raw: CardMeta = serde_json::from_slice(
            &fs::read(
                s.root
                    .join(format!("lore/characters/{}/card.json", a.card_id)),
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(raw.folder, "characters");
        // The other card is untouched.
        assert_eq!(read(&s, &b.card_id).unwrap().body, "# 동명이인\n");
    }

    // S08.B — alias survives reopen; tag counts never change by viewing.
    #[test]
    fn s08b_alias_survives_reopen_and_tag_rename_keeps_id() {
        let (_b, dir, s) = work();
        let c = create(&s, "c", TemplateId::Character, "서린", None, "").unwrap();
        let tag = create_tag(&s, "t", "A").unwrap();
        update_meta(
            &s,
            "m",
            &c.card_id,
            &MetaPatch {
                aliases: Some(vec!["린".into(), " 린 ".into(), "서린".into(), "".into()]),
                tag_ids: Some(vec![tag.tag_id.clone()]),
                ..Default::default()
            },
            &meta_hash(&s, &c.card_id),
        )
        .unwrap();
        drop(s);
        let s = open(&dir).unwrap();
        let again = find(&s, &c.card_id).unwrap();
        assert_eq!(again.aliases, vec!["린".to_string()]);
        let renamed = rename_tag(&s, "r", &tag.tag_id, "주요 인물").unwrap();
        assert_eq!(renamed.tag_id, tag.tag_id);
        assert_eq!(renamed.card_count, 1);
        assert_eq!(find(&s, &c.card_id).unwrap().tag_ids, vec![tag.tag_id]);
    }

    #[test]
    fn remove_from_card_vs_global_cleanup() {
        let (_b, _d, s) = work();
        let t = create_tag(&s, "t", "B").unwrap();
        let ids: Vec<String> = (0..3)
            .map(|i| {
                let c = create(
                    &s,
                    &format!("c{i}"),
                    TemplateId::Place,
                    &format!("장소{i}"),
                    None,
                    "",
                )
                .unwrap();
                update_meta(
                    &s,
                    &format!("m{i}"),
                    &c.card_id,
                    &MetaPatch {
                        tag_ids: Some(vec![t.tag_id.clone()]),
                        ..Default::default()
                    },
                    &meta_hash(&s, &c.card_id),
                )
                .unwrap();
                c.card_id
            })
            .collect();
        // Remove from one card only.
        update_meta(
            &s,
            "rm",
            &ids[0],
            &MetaPatch {
                tag_ids: Some(vec![]),
                ..Default::default()
            },
            &meta_hash(&s, &ids[0]),
        )
        .unwrap();
        assert_eq!(list_tags(&s).unwrap()[0].card_count, 2);
        // Global cleanup: impact 2, tag gone, cards kept.
        assert_eq!(delete_tag_everywhere(&s, "g", &t.tag_id).unwrap(), 2);
        assert!(list_tags(&s).unwrap().is_empty());
        assert_eq!(list(&s).unwrap().cards.len(), 3);
        assert!(list(&s).unwrap().cards.iter().all(|c| c.tag_ids.is_empty()));
    }

    #[test]
    fn create_is_atomic_and_idempotent_and_templates_go_to_their_folders() {
        let (_b, _d, s) = work();
        let first = create(&s, "same", TemplateId::Rule, "불의 규칙", None, "## 조건\n").unwrap();
        let again = create(&s, "same", TemplateId::Rule, "불의 규칙", None, "## 조건\n").unwrap();
        assert_eq!(first, again);
        assert_eq!(first.folder, "notes");
        for (t, f) in [
            (TemplateId::Personality, "characters"),
            (TemplateId::Place, "places"),
            (TemplateId::Group, "groups"),
            (TemplateId::Note, "notes"),
        ] {
            assert_eq!(
                create(&s, &format!("{t:?}"), t, "x", None, "")
                    .unwrap()
                    .folder,
                f
            );
        }
        assert_eq!(list(&s).unwrap().cards.len(), 5);
        assert!(fs::read_dir(s.root.join(TMP_DIR)).unwrap().next().is_none());
    }

    #[test]
    fn interrupted_move_is_repaired_and_folders_are_validated() {
        let (_b, _d, s) = work();
        let c = create(&s, "c", TemplateId::Group, "흑월단", None, "본문").unwrap();
        // Simulate a crash after the rename but before card.json was updated.
        create_folder(&s, "groups/적대").unwrap();
        fs::rename(
            s.root.join(&c.dir),
            s.root.join(format!("lore/groups/적대/{}", c.card_id)),
        )
        .unwrap();
        let found = find(&s, &c.card_id).unwrap();
        assert_eq!(found.folder, "groups/적대");
        update_meta(
            &s,
            "fix",
            &c.card_id,
            &MetaPatch::default(),
            &meta_hash(&s, &c.card_id),
        )
        .unwrap();
        let raw: CardMeta = serde_json::from_slice(
            &fs::read(
                s.root
                    .join(format!("lore/groups/적대/{}/card.json", c.card_id)),
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(raw.folder, "groups/적대");
        for badf in [
            "",
            "secret",
            "../characters",
            "characters/../../x",
            "characters/a:b",
        ] {
            assert!(validate_folder(badf).is_err(), "{badf}");
        }
        assert!(move_card(&s, "x", &c.card_id, "../outside").is_err());
    }

    #[test]
    fn stale_body_save_is_refused() {
        let (_b, _d, s) = work();
        let c = create(&s, "c", TemplateId::Note, "메모", None, "처음").unwrap();
        let d = read(&s, &c.card_id).unwrap();
        fs::write(s.root.join(format!("{}/card.md", c.dir)), "밖에서").unwrap();
        assert!(matches!(
            save_body(&s, "x", &c.card_id, "앱", d.body_hash.as_deref()),
            Err(WsError::WriteConflict { .. })
        ));
        assert_eq!(read(&s, &c.card_id).unwrap().body, "밖에서");
    }
}
