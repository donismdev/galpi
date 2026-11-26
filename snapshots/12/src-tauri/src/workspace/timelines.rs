//! Timelines, events and story tracks (session 09).
//!
//! Layout (WORKSPACE_FORMAT):
//! - `timelines/collections/<collectionId>.json` — a named timeline and its default view mode
//! - `timelines/events/<eventId>.json`           — one event; `collectionIds` lists every timeline
//!   it is shown in, so editing it once updates all of them (S09.C)
//! - `workspace.json` `storyTracks`               — in-story time tracks (‘본편’, ‘회귀 전’, …)
//!
//! An event needs at least one coordinate: an episode (`episodeId` + `episodeOrder`) and/or an
//! in-story position. The in-story position has a certainty (CH2): `confirmed` / `estimated`
//! carry `storyTrackId` + `storyOrder` (+ optional `storyLabel`); `unknown` carries none.
//! Files written before the certainty field existed are read as `confirmed` when they have a
//! valid track + order, otherwise `unknown` (no schemaVersion change; reading rule only).
//!
//! Events tied to an episode keep their own `reviewedRevisionId` (CH1): the state is computed
//! against the episode's newest commit exactly like summaries (07), and the two records never
//! touch each other.

use super::error::WsError;
use super::manifest::{MANIFEST_FILE, Manifest, StoryTrack, now_rfc3339, strip_bom};
use super::{Expect, WorkspaceSession, episodes, history};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io;
use uuid::Uuid;

pub const COLLECTIONS_DIR: &str = "timelines/collections";
pub const EVENTS_DIR: &str = "timelines/events";
pub const TIMELINE_SCHEMA_VERSION: u32 = 1;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ViewMode {
    Episode,
    Story,
    Both,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    #[serde(default = "one")]
    pub schema_version: u32,
    pub collection_id: String,
    pub name: String,
    pub default_mode: ViewMode,
    #[serde(default)]
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

fn one() -> u32 {
    1
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum Certainty {
    Confirmed,
    Estimated,
    #[default]
    Unknown,
}

/// One state change carried by an event (10): ‘서린 / 화염 능력 / 불씨 감지’. `entity_id` is
/// normally a world card ID (08). An event keeps its changes in a fixed order.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct StateChange {
    pub entity_id: String,
    pub property_key: String,
    #[serde(default)]
    pub value: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct EventRecord {
    #[serde(default = "one")]
    pub schema_version: u32,
    pub event_id: String,
    #[serde(default)]
    pub collection_ids: Vec<String>,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub detail: String,
    #[serde(default)]
    pub tag_ids: Vec<String>,
    #[serde(default)]
    pub related_card_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub changes: Vec<StateChange>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub episode_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub episode_order: Option<f64>,
    /// Missing in files written before 09 → derived on read (see module docs).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub story_certainty: Option<Certainty>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub story_track_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub story_order: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub story_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reviewed_revision_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reviewed_at: Option<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

impl EventRecord {
    /// The certainty to show: the stored one, or the pre-09 default.
    pub fn certainty(&self) -> Certainty {
        match self.story_certainty {
            Some(c) => c,
            None if self.story_track_id.is_some()
                && self.story_order.is_some_and(f64::is_finite) =>
            {
                Certainty::Confirmed
            }
            None => Certainty::Unknown,
        }
    }
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EventReview {
    /// Not tied to an episode: nothing to check against.
    NoEpisode,
    NoRevision,
    Unreviewed,
    Reviewed,
    Recheck,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EventInfo {
    #[serde(flatten)]
    pub record: EventRecord,
    /// Effective certainty (stored or derived for older files).
    pub certainty: Certainty,
    pub episode_number: Option<u32>,
    pub review: EventReview,
    pub reviewed_ordinal: Option<u32>,
    pub latest_revision_id: Option<String>,
    pub latest_ordinal: Option<u32>,
    pub hash: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CollectionInfo {
    #[serde(flatten)]
    pub collection: Collection,
    pub event_count: usize,
    pub hash: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TimelineProblem {
    pub path: String,
    pub detail: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimelineData {
    pub collections: Vec<CollectionInfo>,
    pub events: Vec<EventInfo>,
    pub tracks: Vec<StoryTrack>,
    pub tracks_hash: String,
    /// Saved views / links (10), see `views.rs`.
    pub views: Vec<super::views::ViewInfo>,
    pub problems: Vec<TimelineProblem>,
}

pub(crate) fn invalid(reason: &str) -> WsError {
    WsError::InvalidEvent {
        reason: reason.into(),
    }
}

pub(crate) fn check_id(id: &str) -> Result<(), WsError> {
    if !id.is_empty() && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        Ok(())
    } else {
        Err(WsError::InvalidRelativePath { rel: id.into() })
    }
}

pub(crate) fn collection_rel(id: &str) -> String {
    format!("{COLLECTIONS_DIR}/{id}.json")
}

fn event_rel(id: &str) -> String {
    format!("{EVENTS_DIR}/{id}.json")
}

/// Reads every `*.json` in `dir` as `T`; unreadable files are reported, not fatal.
pub(crate) fn read_dir_json<T: for<'de> Deserialize<'de>>(
    s: &WorkspaceSession,
    dir: &str,
    problems: &mut Vec<TimelineProblem>,
) -> Result<Vec<(T, String)>, WsError> {
    let entries = match fs::read_dir(s.root.join(dir)) {
        Ok(e) => e,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    let mut names: Vec<String> = entries
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    let mut out = Vec::new();
    for n in names {
        let rel = format!("{dir}/{n}");
        match s.read_file(&rel) {
            Ok((b, h)) => match serde_json::from_slice::<T>(strip_bom(&b)) {
                Ok(v) => out.push((v, h)),
                Err(e) => problems.push(TimelineProblem {
                    path: rel,
                    detail: e.to_string(),
                }),
            },
            Err(e) => problems.push(TimelineProblem {
                path: rel,
                detail: format!("{e}"),
            }),
        }
    }
    Ok(out)
}

fn read_manifest_with_hash(s: &WorkspaceSession) -> Result<(Manifest, String), WsError> {
    let (b, h) = s.read_file(MANIFEST_FILE)?;
    let m = serde_json::from_slice(strip_bom(&b)).map_err(|e| WsError::InvalidManifest {
        detail: e.to_string(),
    })?;
    Ok((m, h))
}

/// Everything the timeline screens need in one read.
pub fn load(s: &WorkspaceSession) -> Result<TimelineData, WsError> {
    let mut problems = Vec::new();
    let collections: Vec<(Collection, String)> = read_dir_json(s, COLLECTIONS_DIR, &mut problems)?;
    let events: Vec<(EventRecord, String)> = read_dir_json(s, EVENTS_DIR, &mut problems)?;
    let views = super::views::read_all(s, &mut problems)?;
    let (manifest, tracks_hash) = read_manifest_with_hash(s)?;
    let eps = episodes::list(s)?.episodes;
    let mut hist_cache: HashMap<String, Vec<history::RevisionInfo>> = HashMap::new();
    let mut infos = Vec::new();
    for (rec, hash) in events {
        if rec.event_id.is_empty() {
            continue;
        }
        infos.push(info_of(s, rec, hash, &eps, &mut hist_cache)?);
    }
    let collections = collections
        .into_iter()
        .map(|(c, hash)| CollectionInfo {
            event_count: infos
                .iter()
                .filter(|e| e.record.collection_ids.contains(&c.collection_id))
                .count(),
            collection: c,
            hash,
        })
        .collect();
    Ok(TimelineData {
        collections,
        events: infos,
        tracks: manifest.story_tracks,
        tracks_hash,
        views,
        problems,
    })
}

fn info_of(
    s: &WorkspaceSession,
    record: EventRecord,
    hash: String,
    eps: &[episodes::EpisodeInfo],
    cache: &mut HashMap<String, Vec<history::RevisionInfo>>,
) -> Result<EventInfo, WsError> {
    let ep = record
        .episode_id
        .as_deref()
        .and_then(|id| eps.iter().find(|e| e.episode_id == id));
    let (review, reviewed_ordinal, latest_revision_id, latest_ordinal) = match ep {
        None => (EventReview::NoEpisode, None, None, None),
        Some(ep) => {
            if !cache.contains_key(&ep.episode_id) {
                cache.insert(
                    ep.episode_id.clone(),
                    history::list_in(s, ep, true)?.revisions,
                );
            }
            let revs = &cache[&ep.episode_id];
            let latest = revs.last();
            let state = match (latest, record.reviewed_revision_id.as_deref()) {
                (None, _) => EventReview::NoRevision,
                (Some(_), None) => EventReview::Unreviewed,
                (Some(l), Some(r)) if l.revision_id == r => EventReview::Reviewed,
                (Some(_), Some(_)) => EventReview::Recheck,
            };
            let reviewed = record
                .reviewed_revision_id
                .as_deref()
                .and_then(|r| revs.iter().find(|x| x.revision_id == r).map(|x| x.ordinal));
            (
                state,
                reviewed,
                latest.map(|l| l.revision_id.clone()),
                latest.map(|l| l.ordinal),
            )
        }
    };
    Ok(EventInfo {
        certainty: record.certainty(),
        episode_number: ep.map(|e| e.number),
        record,
        review,
        reviewed_ordinal,
        latest_revision_id,
        latest_ordinal,
        hash,
    })
}

pub fn read_event(s: &WorkspaceSession, event_id: &str) -> Result<EventInfo, WsError> {
    check_id(event_id)?;
    let (b, hash) = s.read_file(&event_rel(event_id))?;
    let rec: EventRecord =
        serde_json::from_slice(strip_bom(&b)).map_err(|e| WsError::InvalidManifest {
            detail: format!("{}: {e}", event_rel(event_id)),
        })?;
    let eps = episodes::list(s)?.episodes;
    info_of(s, rec, hash, &eps, &mut HashMap::new())
}

// ---------------------------------------------------------------- collections

pub fn create_collection(
    s: &WorkspaceSession,
    request_id: &str,
    name: &str,
    default_mode: ViewMode,
) -> Result<CollectionInfo, WsError> {
    s.ensure_writable()?;
    let name = name.trim();
    if name.is_empty() {
        return Err(invalid("nameEmpty"));
    }
    let mut problems = Vec::new();
    if let Some((c, hash)) = read_dir_json::<Collection>(s, COLLECTIONS_DIR, &mut problems)?
        .into_iter()
        .find(|(c, _)| c.request_id.as_deref() == Some(request_id))
    {
        return Ok(CollectionInfo {
            collection: c,
            event_count: 0,
            hash,
        });
    }
    let c = Collection {
        schema_version: TIMELINE_SCHEMA_VERSION,
        collection_id: Uuid::new_v4().to_string(),
        name: name.into(),
        default_mode,
        created_at: now_rfc3339(),
        request_id: Some(request_id.into()),
        extra: Default::default(),
    };
    let body = serde_json::to_vec_pretty(&c).map_err(io::Error::other)?;
    let hash = s.write_file(
        request_id,
        &collection_rel(&c.collection_id),
        &body,
        Expect::Absent,
    )?;
    Ok(CollectionInfo {
        collection: c,
        event_count: 0,
        hash,
    })
}

pub fn update_collection(
    s: &WorkspaceSession,
    request_id: &str,
    collection_id: &str,
    name: &str,
    default_mode: ViewMode,
    expected_hash: &str,
) -> Result<(), WsError> {
    s.ensure_writable()?;
    check_id(collection_id)?;
    let name = name.trim();
    if name.is_empty() {
        return Err(invalid("nameEmpty"));
    }
    let rel = collection_rel(collection_id);
    let (b, _) = s.read_file(&rel)?;
    let mut c: Collection =
        serde_json::from_slice(strip_bom(&b)).map_err(|e| WsError::InvalidManifest {
            detail: format!("{rel}: {e}"),
        })?;
    c.name = name.into();
    c.default_mode = default_mode;
    let body = serde_json::to_vec_pretty(&c).map_err(io::Error::other)?;
    s.write_file(request_id, &rel, &body, Expect::Hash(expected_hash.into()))?;
    Ok(())
}

// ---------------------------------------------------------------- events

/// What the editor sends. Validation lives here (the UI mirrors it to keep typed values).
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct EventDraft {
    pub collection_ids: Vec<String>,
    pub title: String,
    #[serde(default)]
    pub detail: String,
    #[serde(default)]
    pub tag_ids: Vec<String>,
    #[serde(default)]
    pub related_card_ids: Vec<String>,
    #[serde(default)]
    pub changes: Vec<StateChange>,
    pub episode_id: Option<String>,
    pub episode_order: Option<f64>,
    pub story_certainty: Certainty,
    pub story_track_id: Option<String>,
    pub story_order: Option<f64>,
    pub story_label: Option<String>,
}

fn dedupe(v: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for x in v {
        let x = x.trim();
        if !x.is_empty() && !out.iter().any(|y| y == x) {
            out.push(x.to_string());
        }
    }
    out
}

/// S09.B: episode only / story only / both are valid; neither is refused (`noCoordinate`).
/// Confirmed or estimated story time needs a known track and a number (`storyIncomplete`).
fn validate(
    s: &WorkspaceSession,
    d: &EventDraft,
    own_id: Option<&str>,
    existing: &[EventRecord],
) -> Result<EventRecord, WsError> {
    let title = d.title.trim();
    if title.is_empty() {
        return Err(invalid("titleEmpty"));
    }
    let collection_ids = dedupe(&d.collection_ids);
    if collection_ids.is_empty() {
        return Err(invalid("noTimeline"));
    }
    for c in &collection_ids {
        check_id(c)?;
        if !s.root.join(collection_rel(c)).is_file() {
            return Err(WsError::NotFound {
                path: collection_rel(c),
            });
        }
    }
    let episode_id = d
        .episode_id
        .as_deref()
        .map(str::trim)
        .filter(|x| !x.is_empty());
    if let Some(e) = episode_id {
        episodes::find(s, e)?;
    }
    let (track, order, label) = match d.story_certainty {
        Certainty::Unknown => (None, None, None),
        Certainty::Confirmed | Certainty::Estimated => {
            let track = d
                .story_track_id
                .as_deref()
                .map(str::trim)
                .filter(|x| !x.is_empty());
            let order = d.story_order.filter(|o| o.is_finite());
            let (Some(track), Some(order)) = (track, order) else {
                return Err(invalid("storyIncomplete"));
            };
            let (m, _) = read_manifest_with_hash(s)?;
            if !m.story_tracks.iter().any(|t| t.track_id == track) {
                return Err(invalid("unknownTrack"));
            }
            let label = d
                .story_label
                .as_deref()
                .map(str::trim)
                .filter(|x| !x.is_empty())
                .map(str::to_string);
            (Some(track.to_string()), Some(order), label)
        }
    };
    if episode_id.is_none() && track.is_none() {
        return Err(invalid("noCoordinate"));
    }
    if d.episode_order.is_some_and(|o| !o.is_finite()) {
        return Err(invalid("episodeOrder"));
    }
    // A new place in an episode without an explicit order goes after the others.
    let episode_order = episode_id.map(|e| {
        d.episode_order.unwrap_or_else(|| {
            existing
                .iter()
                .filter(|x| {
                    x.episode_id.as_deref() == Some(e) && Some(x.event_id.as_str()) != own_id
                })
                .filter_map(|x| x.episode_order)
                .fold(0.0, f64::max)
                + 1.0
        })
    });
    let mut changes = Vec::new();
    for c in &d.changes {
        let (e, k) = (c.entity_id.trim(), c.property_key.trim());
        if e.is_empty() && k.is_empty() && c.value.trim().is_empty() {
            continue; // an empty row in the editor
        }
        if e.is_empty() || k.is_empty() {
            return Err(invalid("changeIncomplete"));
        }
        changes.push(StateChange {
            entity_id: e.into(),
            property_key: k.into(),
            value: c.value.trim().into(),
        });
    }
    Ok(EventRecord {
        schema_version: TIMELINE_SCHEMA_VERSION,
        changes,
        collection_ids,
        title: title.to_string(),
        detail: d.detail.replace("\r\n", "\n"),
        tag_ids: dedupe(&d.tag_ids),
        related_card_ids: dedupe(&d.related_card_ids),
        episode_id: episode_id.map(str::to_string),
        episode_order,
        story_certainty: Some(d.story_certainty),
        story_track_id: track,
        story_order: order,
        story_label: label,
        ..Default::default()
    })
}

/// Creates (`event_id` None) or replaces an event. Replacing needs the hash that was read.
pub fn save_event(
    s: &WorkspaceSession,
    request_id: &str,
    event_id: Option<&str>,
    expected_hash: Option<&str>,
    draft: &EventDraft,
) -> Result<EventInfo, WsError> {
    s.ensure_writable()?;
    let mut problems = Vec::new();
    let existing: Vec<EventRecord> = read_dir_json::<EventRecord>(s, EVENTS_DIR, &mut problems)?
        .into_iter()
        .map(|(e, _)| e)
        .collect();
    match event_id {
        None => {
            if let Some(e) = existing
                .iter()
                .find(|e| e.request_id.as_deref() == Some(request_id))
            {
                return read_event(s, &e.event_id);
            }
            let mut rec = validate(s, draft, None, &existing)?;
            rec.event_id = Uuid::new_v4().to_string();
            rec.created_at = now_rfc3339();
            rec.request_id = Some(request_id.into());
            let body = serde_json::to_vec_pretty(&rec).map_err(io::Error::other)?;
            s.write_file(request_id, &event_rel(&rec.event_id), &body, Expect::Absent)?;
            read_event(s, &rec.event_id)
        }
        Some(id) => {
            check_id(id)?;
            let rel = event_rel(id);
            let (b, hash) = s.read_file(&rel)?;
            let expected = expected_hash.unwrap_or_default();
            if hash != expected {
                return Err(WsError::WriteConflict {
                    expected: Some(expected.into()),
                    actual: Some(hash),
                });
            }
            let old: EventRecord =
                serde_json::from_slice(strip_bom(&b)).map_err(|e| WsError::InvalidManifest {
                    detail: format!("{rel}: {e}"),
                })?;
            let mut rec = validate(s, draft, Some(id), &existing)?;
            rec.event_id = id.into();
            rec.created_at = old.created_at.clone();
            rec.request_id = old.request_id.clone();
            rec.extra = old.extra.clone();
            // The review belongs to the episode it was made against.
            if old.episode_id == rec.episode_id {
                rec.reviewed_revision_id = old.reviewed_revision_id.clone();
                rec.reviewed_at = old.reviewed_at.clone();
            }
            let body = serde_json::to_vec_pretty(&rec).map_err(io::Error::other)?;
            s.write_file(request_id, &rel, &body, Expect::Hash(hash))?;
            read_event(s, id)
        }
    }
}

/// Records that the writer checked this event against `revision_id`, which must still be the
/// episode's newest commit. Only this event's file changes (summaries are separate, CH1).
pub fn confirm_event(
    s: &WorkspaceSession,
    request_id: &str,
    event_id: &str,
    revision_id: &str,
) -> Result<EventInfo, WsError> {
    s.ensure_writable()?;
    check_id(event_id)?;
    let rel = event_rel(event_id);
    let (b, hash) = s.read_file(&rel)?;
    let mut rec: EventRecord =
        serde_json::from_slice(strip_bom(&b)).map_err(|e| WsError::InvalidManifest {
            detail: format!("{rel}: {e}"),
        })?;
    let episode_id = rec.episode_id.clone().ok_or_else(|| invalid("noEpisode"))?;
    let latest = history::latest(s, &episode_id)?.ok_or_else(|| WsError::NotFound {
        path: format!("episode {episode_id} has no commit"),
    })?;
    if latest.revision_id != revision_id {
        return Err(WsError::WriteConflict {
            expected: Some(revision_id.into()),
            actual: Some(latest.revision_id),
        });
    }
    rec.reviewed_revision_id = Some(revision_id.into());
    rec.reviewed_at = Some(now_rfc3339());
    let body = serde_json::to_vec_pretty(&rec).map_err(io::Error::other)?;
    s.write_file(request_id, &rel, &body, Expect::Hash(hash))?;
    read_event(s, event_id)
}

/// Explicit event deletion (10). Different from clearing a filter (view only) or unticking a
/// timeline (membership only): the file goes away for every timeline it was in. The UI shows
/// `collectionIds.len()` first and asks.
pub fn delete_event(
    s: &WorkspaceSession,
    event_id: &str,
    expected_hash: &str,
) -> Result<(), WsError> {
    s.ensure_writable()?;
    check_id(event_id)?;
    let rel = event_rel(event_id);
    let _guard = s.writer_guard()?;
    let (_, hash) = s.read_file(&rel)?;
    if hash != expected_hash {
        return Err(WsError::WriteConflict {
            expected: Some(expected_hash.into()),
            actual: Some(hash),
        });
    }
    fs::remove_file(s.root.join(&rel))?;
    Ok(())
}

// ---------------------------------------------------------------- story tracks (CH2)

fn write_manifest(
    s: &WorkspaceSession,
    request_id: &str,
    m: &Manifest,
    hash: &str,
) -> Result<(), WsError> {
    let body = serde_json::to_vec_pretty(m).map_err(io::Error::other)?;
    s.write_file(request_id, MANIFEST_FILE, &body, Expect::Hash(hash.into()))?;
    Ok(())
}

pub fn add_track(
    s: &WorkspaceSession,
    request_id: &str,
    label: &str,
    expected_hash: &str,
) -> Result<Vec<StoryTrack>, WsError> {
    s.ensure_writable()?;
    let label = label.trim();
    if label.is_empty() {
        return Err(invalid("nameEmpty"));
    }
    let (mut m, hash) = read_manifest_with_hash(s)?;
    if hash != expected_hash {
        return Err(WsError::WriteConflict {
            expected: Some(expected_hash.into()),
            actual: Some(hash),
        });
    }
    m.story_tracks.push(StoryTrack {
        track_id: Uuid::new_v4().to_string(),
        label: label.into(),
        extra: Default::default(),
    });
    write_manifest(s, request_id, &m, &hash)?;
    Ok(m.story_tracks)
}

/// Names an existing track (‘회귀 전’, ‘1차 회귀’). The track ID and every event on it stay.
pub fn rename_track(
    s: &WorkspaceSession,
    request_id: &str,
    track_id: &str,
    label: &str,
    expected_hash: &str,
) -> Result<Vec<StoryTrack>, WsError> {
    s.ensure_writable()?;
    let label = label.trim();
    if label.is_empty() {
        return Err(invalid("nameEmpty"));
    }
    let (mut m, hash) = read_manifest_with_hash(s)?;
    if hash != expected_hash {
        return Err(WsError::WriteConflict {
            expected: Some(expected_hash.into()),
            actual: Some(hash),
        });
    }
    let t = m
        .story_tracks
        .iter_mut()
        .find(|t| t.track_id == track_id)
        .ok_or_else(|| WsError::NotFound {
            path: format!("track {track_id}"),
        })?;
    t.label = label.into();
    write_manifest(s, request_id, &m, &hash)?;
    Ok(m.story_tracks)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::content_hash;
    use crate::workspace::manuscript::{self, LineEnding, save as save_ms};
    use crate::workspace::open;
    use crate::workspace::sample::make_sample;
    use crate::workspace::summaries::{self, TextKind};

    struct W {
        _base: tempfile::TempDir,
        dir: std::path::PathBuf,
        s: WorkspaceSession,
        eps: Vec<String>,
    }

    fn work(n: u32) -> W {
        let base = tempfile::tempdir().unwrap();
        let dir = base.path().join("타임라인 시험 (09)");
        let made = make_sample(&dir, "잿빛 항구", n).unwrap();
        let eps = made.episodes.iter().map(|e| e.episode_id.clone()).collect();
        let s = open(&dir).unwrap();
        W {
            _base: base,
            dir,
            s,
            eps,
        }
    }

    fn rid() -> String {
        Uuid::new_v4().to_string()
    }

    fn timeline(s: &WorkspaceSession, name: &str, mode: ViewMode) -> String {
        create_collection(s, &rid(), name, mode)
            .unwrap()
            .collection
            .collection_id
    }

    fn track0(s: &WorkspaceSession) -> String {
        load(s).unwrap().tracks[0].track_id.clone()
    }

    fn draft(cols: &[&str], title: &str, ep: Option<&str>) -> EventDraft {
        EventDraft {
            collection_ids: cols.iter().map(|c| c.to_string()).collect(),
            title: title.into(),
            episode_id: ep.map(str::to_string),
            story_certainty: Certainty::Unknown,
            ..Default::default()
        }
    }

    fn write_ms(s: &WorkspaceSession, id: &str, text: &str) {
        let p = manuscript::file_path(s, id).unwrap();
        let h = fs::read(&p).ok().map(|b| content_hash(&b));
        save_ms(s, &rid(), id, text, h.as_deref(), false, LineEnding::Lf).unwrap();
    }

    fn commit(s: &WorkspaceSession, id: &str) -> String {
        history::commit(s, &rid(), id, "", None)
            .unwrap()
            .revision
            .revision_id
    }

    // S09.A — events sit on the right episodes; adding story time keeps the same ID everywhere.
    #[test]
    fn s09a_episode_rows_and_story_time_keep_the_same_id() {
        let w = work(3);
        let s = &w.s;
        let k = timeline(s, "주인공의 능력", ViewMode::Episode);
        let awaken = save_event(
            s,
            &rid(),
            None,
            None,
            &draft(&[&k], "각성", Some(&w.eps[0])),
        )
        .unwrap();
        let fire = save_event(
            s,
            &rid(),
            None,
            None,
            &draft(&[&k], "불을 다룸", Some(&w.eps[2])),
        )
        .unwrap();
        let d = load(s).unwrap();
        let on = |n: u32| -> Vec<String> {
            d.events
                .iter()
                .filter(|e| e.episode_number == Some(n))
                .map(|e| e.record.title.clone())
                .collect()
        };
        assert_eq!(on(1), vec!["각성"]);
        assert!(on(2).is_empty());
        assert_eq!(on(3), vec!["불을 다룸"]);
        assert_eq!(fire.record.episode_order, Some(1.0));
        assert_eq!(fire.certainty, Certainty::Unknown);

        let mut dd = draft(&[&k], "불을 다룸", Some(&w.eps[2]));
        dd.story_certainty = Certainty::Confirmed;
        dd.story_track_id = Some(track0(s));
        dd.story_order = Some(10.0);
        dd.story_label = Some("10일차".into());
        let fire2 = save_event(
            s,
            &rid(),
            Some(&fire.record.event_id),
            Some(&fire.hash),
            &dd,
        )
        .unwrap();
        assert_eq!(fire2.record.event_id, fire.record.event_id);
        assert_eq!(fire2.record.story_order, Some(10.0));
        assert_eq!(load(s).unwrap().events.len(), 2);
        assert_ne!(awaken.record.event_id, fire.record.event_id);
        // a second event in 1화 goes after the first
        let second = save_event(
            s,
            &rid(),
            None,
            None,
            &draft(&[&k], "첫 불씨", Some(&w.eps[0])),
        )
        .unwrap();
        assert_eq!(second.record.episode_order, Some(2.0));
    }

    // S09.B — coordinate combinations.
    #[test]
    fn s09b_coordinate_validation() {
        let w = work(1);
        let s = &w.s;
        let k = timeline(s, "왕국 연표", ViewMode::Story);
        let t = track0(s);
        // episode only
        assert!(
            save_event(
                s,
                &rid(),
                None,
                None,
                &draft(&[&k], "회차만", Some(&w.eps[0]))
            )
            .is_ok()
        );
        // story only
        let mut st = draft(&[&k], "시간만", None);
        st.story_certainty = Certainty::Estimated;
        st.story_track_id = Some(t.clone());
        st.story_order = Some(2.0);
        let e = save_event(s, &rid(), None, None, &st).unwrap();
        assert_eq!(
            (e.certainty, e.review),
            (Certainty::Estimated, EventReview::NoEpisode)
        );
        // both
        let mut both = st.clone();
        both.title = "둘 다".into();
        both.episode_id = Some(w.eps[0].clone());
        assert!(save_event(s, &rid(), None, None, &both).is_ok());
        // neither
        let err = save_event(s, &rid(), None, None, &draft(&[&k], "모두 비움", None)).unwrap_err();
        assert_eq!(err, invalid("noCoordinate"));
        // confirmed without a number
        let mut half = draft(&[&k], "반쪽", None);
        half.story_certainty = Certainty::Confirmed;
        half.story_track_id = Some(t);
        assert_eq!(
            save_event(s, &rid(), None, None, &half).unwrap_err(),
            invalid("storyIncomplete")
        );
        assert_eq!(
            save_event(s, &rid(), None, None, &draft(&[], "x", Some(&w.eps[0]))).unwrap_err(),
            invalid("noTimeline")
        );
        assert_eq!(
            save_event(s, &rid(), None, None, &draft(&[&k], "  ", Some(&w.eps[0]))).unwrap_err(),
            invalid("titleEmpty")
        );
        assert_eq!(load(s).unwrap().events.len(), 3);
        // unknown certainty clears story fields
        let mut unk = st.clone();
        unk.title = "미상".into();
        unk.episode_id = Some(w.eps[0].clone());
        unk.story_certainty = Certainty::Unknown;
        let u = save_event(s, &rid(), None, None, &unk).unwrap();
        assert_eq!(
            (u.record.story_track_id.as_deref(), u.record.story_order),
            (None, None)
        );
    }

    // S09.C — one event in two timelines: one edit, both show it.
    #[test]
    fn s09c_shared_event_updates_both_timelines() {
        let w = work(3);
        let s = &w.s;
        let a = timeline(s, "주인공의 능력", ViewMode::Episode);
        let b = timeline(s, "왕국 연표", ViewMode::Both);
        let e = save_event(
            s,
            &rid(),
            None,
            None,
            &draft(&[&a, &b], "불을 다룸", Some(&w.eps[2])),
        )
        .unwrap();
        let mut d = draft(&[&a, &b], "남은 불씨를 감지", Some(&w.eps[2]));
        d.detail = "퇴고 반영".into();
        save_event(s, &rid(), Some(&e.record.event_id), Some(&e.hash), &d).unwrap();
        let data = load(s).unwrap();
        for k in [&a, &b] {
            let shown: Vec<_> = data
                .events
                .iter()
                .filter(|x| x.record.collection_ids.contains(k))
                .collect();
            assert_eq!(shown.len(), 1);
            assert_eq!(shown[0].record.title, "남은 불씨를 감지");
        }
        assert!(data.collections.iter().all(|c| c.event_count == 1));
        // stale hash refused
        let again = save_event(s, &rid(), Some(&e.record.event_id), Some(&e.hash), &d);
        assert!(matches!(again, Err(WsError::WriteConflict { .. })));
        // create retried with the same request id → one event
        let r = rid();
        save_event(s, &r, None, None, &draft(&[&a], "한 번", Some(&w.eps[0]))).unwrap();
        save_event(s, &r, None, None, &draft(&[&a], "한 번", Some(&w.eps[0]))).unwrap();
        assert_eq!(load(s).unwrap().events.len(), 2);
    }

    // S09.D — CH1 pass example end to end.
    #[test]
    fn s09d_ch1_summary_and_event_reviews_are_independent() {
        let w = work(3);
        let s = &w.s;
        let e3 = &w.eps[2];
        let k = timeline(s, "주인공의 능력", ViewMode::Episode);
        write_ms(s, e3, "서린은 손끝에 불을 피웠다.\n");
        let r1 = commit(s, e3);
        let ev = save_event(s, &rid(), None, None, &draft(&[&k], "불을 다룸", Some(e3))).unwrap();
        assert_eq!(ev.review, EventReview::Unreviewed);
        let cur = summaries::read(s, e3).unwrap();
        summaries::save_text(
            s,
            &rid(),
            e3,
            TextKind::Summary,
            "3화: 불을 피운다.",
            cur.summary.hash.as_deref(),
        )
        .unwrap();
        summaries::confirm(s, &rid(), e3, &r1).unwrap();
        let ev = confirm_event(s, &rid(), &ev.record.event_id, &r1).unwrap();
        assert_eq!(ev.review, EventReview::Reviewed);

        // external open/close (no change) and a merged save: still r1, both reviewed
        let p = manuscript::file_path(s, e3).unwrap();
        let bytes = fs::read(&p).unwrap();
        fs::write(&p, &bytes).unwrap();
        fs::write(&p, "서린은 손끝에 불을 피웠다.\n외부에서 합친 줄\n").unwrap();
        write_ms(
            s,
            e3,
            "서린은 손끝에 불을 피웠다.\n외부에서 합친 줄\n앱 초안 줄\n",
        );
        assert_eq!(history::list(s, e3).unwrap().revisions.len(), 1);
        assert_eq!(
            read_event(s, &ev.record.event_id).unwrap().review,
            EventReview::Reviewed
        );
        assert_eq!(
            summaries::read(s, e3).unwrap().status.state,
            summaries::ReviewState::Reviewed
        );

        // r2 → both recheck
        write_ms(s, e3, "서린은 남은 불씨를 감지했다.\n");
        let r2 = commit(s, e3);
        assert_eq!(
            read_event(s, &ev.record.event_id).unwrap().review,
            EventReview::Recheck
        );
        assert_eq!(
            summaries::read(s, e3).unwrap().status.state,
            summaries::ReviewState::Recheck
        );
        // confirm the summary only → the event still says recheck
        summaries::confirm(s, &rid(), e3, &r2).unwrap();
        assert_eq!(
            summaries::read(s, e3).unwrap().status.state,
            summaries::ReviewState::Reviewed
        );
        let still = read_event(s, &ev.record.event_id).unwrap();
        assert_eq!(
            (still.review, still.reviewed_ordinal, still.latest_ordinal),
            (EventReview::Recheck, Some(1), Some(2))
        );
        // stale revision refused, newest accepted
        assert!(matches!(
            confirm_event(s, &rid(), &ev.record.event_id, &r1),
            Err(WsError::WriteConflict { .. })
        ));
        assert_eq!(
            confirm_event(s, &rid(), &ev.record.event_id, &r2)
                .unwrap()
                .review,
            EventReview::Reviewed
        );
        // moving the event to another episode drops the old review
        let moved = save_event(
            s,
            &rid(),
            Some(&ev.record.event_id),
            Some(&read_event(s, &ev.record.event_id).unwrap().hash),
            &draft(&[&k], "불을 다룸", Some(&w.eps[0])),
        )
        .unwrap();
        assert_eq!(moved.review, EventReview::NoRevision);
        assert!(moved.record.reviewed_revision_id.is_none());
    }

    // S09.E — certainty and track names persist; older files read as confirmed / unknown.
    #[test]
    fn s09e_certainty_tracks_and_legacy_files() {
        let w = work(1);
        let s = &w.s;
        let k = timeline(s, "회귀 연표", ViewMode::Story);
        let (_, h) = read_manifest_with_hash(s).unwrap();
        let t0 = track0(s);
        let tracks = rename_track(s, &rid(), &t0, "회귀 전", &h).unwrap();
        assert_eq!(tracks[0].label, "회귀 전");
        let (_, h) = read_manifest_with_hash(s).unwrap();
        let tracks = add_track(s, &rid(), "1차 회귀", &h).unwrap();
        let t1 = tracks[1].track_id.clone();
        assert!(matches!(
            rename_track(s, &rid(), &t0, "x", &h),
            Err(WsError::WriteConflict { .. })
        ));
        let mut est = draft(&[&k], "불씨 감지", None);
        est.story_certainty = Certainty::Estimated;
        est.story_track_id = Some(t1.clone());
        est.story_order = Some(2.0);
        est.story_label = Some("2일차?".into());
        let e = save_event(s, &rid(), None, None, &est).unwrap();

        // legacy files: no storyCertainty
        let legacy_with = format!(
            r#"{{"eventId":"00000000-0000-4000-8000-0000000000a1","collectionIds":["{k}"],"title":"예전 확정","storyTrackId":"{t0}","storyOrder":2,"storyLabel":"2일차"}}"#
        );
        let legacy_without = format!(
            r#"{{"eventId":"00000000-0000-4000-8000-0000000000a2","collectionIds":["{k}"],"title":"예전 미상","episodeId":"{}"}}"#,
            w.eps[0]
        );
        fs::write(
            s.root
                .join(event_rel("00000000-0000-4000-8000-0000000000a1")),
            legacy_with,
        )
        .unwrap();
        fs::write(
            s.root
                .join(event_rel("00000000-0000-4000-8000-0000000000a2")),
            legacy_without,
        )
        .unwrap();

        drop(w.s);
        let s = open(&w.dir).unwrap();
        let d = load(&s).unwrap();
        assert_eq!(
            d.tracks
                .iter()
                .map(|t| t.label.as_str())
                .collect::<Vec<_>>(),
            vec!["회귀 전", "1차 회귀"]
        );
        let by = |id: &str| d.events.iter().find(|x| x.record.event_id == id).unwrap();
        assert_eq!(by(&e.record.event_id).certainty, Certainty::Estimated);
        assert_eq!(
            by(&e.record.event_id).record.story_label.as_deref(),
            Some("2일차?")
        );
        assert_eq!(
            by("00000000-0000-4000-8000-0000000000a1").certainty,
            Certainty::Confirmed
        );
        assert_eq!(
            by("00000000-0000-4000-8000-0000000000a2").certainty,
            Certainty::Unknown
        );
        // the legacy file is not rewritten by reading
        assert!(
            !fs::read_to_string(
                s.root
                    .join(event_rel("00000000-0000-4000-8000-0000000000a1"))
            )
            .unwrap()
            .contains("storyCertainty")
        );
        assert!(d.problems.is_empty());
    }

    #[test]
    fn timelines_rename_and_bad_files_are_reported() {
        let w = work(0);
        let s = &w.s;
        let c = create_collection(s, "same", "능력", ViewMode::Both).unwrap();
        assert_eq!(
            create_collection(s, "same", "능력", ViewMode::Both)
                .unwrap()
                .collection
                .collection_id,
            c.collection.collection_id
        );
        update_collection(
            s,
            &rid(),
            &c.collection.collection_id,
            "주인공의 능력",
            ViewMode::Episode,
            &c.hash,
        )
        .unwrap();
        fs::write(s.root.join(format!("{EVENTS_DIR}/broken.json")), "{").unwrap();
        let d = load(s).unwrap();
        assert_eq!(d.collections.len(), 1);
        assert_eq!(d.collections[0].collection.name, "주인공의 능력");
        assert_eq!(d.collections[0].collection.default_mode, ViewMode::Episode);
        assert_eq!(d.problems.len(), 1);
        assert!(create_collection(s, &rid(), " ", ViewMode::Story).is_err());
    }
}
