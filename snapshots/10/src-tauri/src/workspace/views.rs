//! Saved views (links) and state queries (session 10).
//!
//! A saved view is `timelines/views/<viewId>.json`: only conditions are stored, never event
//! lists, so a link made for 300~350화 picks up an event added to 327화 later (S10.B). A view can
//! be attached to a parent timeline (`parentCollectionId`) and shown there as a link. Views
//! never reference other views, so following a link loads exactly one level and a cycle is
//! impossible by construction.
//!
//! Filter rules (inclusive ranges, see WORKSPACE_FORMAT):
//! - `collectionIds` empty = every timeline, otherwise an event in any of them;
//! - `episodeRange` = displayed episode numbers; events without an episode are outside;
//! - `storyRange` = one track + sort numbers; events with a confirmed or estimated position on
//!   that track (estimated is shown as such); unknown story time is outside;
//! - `includeTagIds` = any of them (OR); `hideTagIds` wins over include.
//!
//! State queries (`compute_state`) take the last value per property of one entity:
//! - reader: events published up to episode N, in (episode, order, eventId) order;
//! - story: events with a **confirmed** position on one track up to a sort number, in
//!   (storyOrder, episode, order, eventId) order — estimated and unknown never count (CH2);
//! - both: the intersection, ordered by the chosen primary axis, then the other, then eventId.

use super::error::WsError;
use super::manifest::{now_rfc3339, strip_bom};
use super::timelines::{
    self, Certainty, EventInfo, TimelineProblem, ViewMode, check_id, collection_rel, invalid,
};
use super::{Expect, WorkspaceSession};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::io;
use uuid::Uuid;

pub const VIEWS_DIR: &str = "timelines/views";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Range {
    pub from: Option<f64>,
    pub to: Option<f64>,
}

impl Range {
    fn contains(&self, x: f64) -> bool {
        self.from.is_none_or(|f| x >= f) && self.to.is_none_or(|t| x <= t)
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct StoryRange {
    pub track_id: String,
    pub from: Option<f64>,
    pub to: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ViewFilter {
    #[serde(default)]
    pub collection_ids: Vec<String>,
    #[serde(default)]
    pub episode_range: Option<Range>,
    #[serde(default)]
    pub story_range: Option<StoryRange>,
    #[serde(default)]
    pub include_tag_ids: Vec<String>,
    #[serde(default)]
    pub hide_tag_ids: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum Basis {
    #[default]
    Reader,
    Story,
    Both,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum Axis {
    #[default]
    Reader,
    Story,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct StateQuery {
    pub entity_id: String,
    pub basis: Basis,
    /// Reader basis: published up to and including this episode number (None = every episode).
    #[serde(default)]
    pub episode_max: Option<u32>,
    /// Story basis: the track and the last sort number included (None = whole track).
    #[serde(default)]
    pub track_id: Option<String>,
    #[serde(default)]
    pub story_max: Option<f64>,
    /// Both: which axis orders the intersection first.
    #[serde(default)]
    pub primary: Axis,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SavedView {
    #[serde(default = "one")]
    pub schema_version: u32,
    pub view_id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_collection_id: Option<String>,
    pub mode: ViewMode,
    #[serde(default)]
    pub collection_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub episode_range: Option<Range>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub story_range: Option<StoryRange>,
    #[serde(default)]
    pub include_tag_ids: Vec<String>,
    #[serde(default)]
    pub hide_tag_ids: Vec<String>,
    /// A pinned ‘그 시점의 상태’ view (e.g. ‘25화 기준’).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state_query: Option<StateQuery>,
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

impl SavedView {
    pub fn filter(&self) -> ViewFilter {
        ViewFilter {
            collection_ids: self.collection_ids.clone(),
            episode_range: self.episode_range.clone(),
            story_range: self.story_range.clone(),
            include_tag_ids: self.include_tag_ids.clone(),
            hide_tag_ids: self.hide_tag_ids.clone(),
        }
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ViewInfo {
    #[serde(flatten)]
    pub view: SavedView,
    pub hash: String,
}

/// What the UI sends to create or change a view.
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ViewInput {
    pub label: String,
    pub parent_collection_id: Option<String>,
    pub mode: Option<ViewMode>,
    #[serde(default)]
    pub filter: ViewFilter,
    pub state_query: Option<StateQuery>,
}

fn view_rel(id: &str) -> String {
    format!("{VIEWS_DIR}/{id}.json")
}

pub(crate) fn read_all(
    s: &WorkspaceSession,
    problems: &mut Vec<TimelineProblem>,
) -> Result<Vec<ViewInfo>, WsError> {
    Ok(
        timelines::read_dir_json::<SavedView>(s, VIEWS_DIR, problems)?
            .into_iter()
            .filter(|(v, _)| !v.view_id.is_empty())
            .map(|(view, hash)| ViewInfo { view, hash })
            .collect(),
    )
}

fn clean(input: &ViewInput, s: &WorkspaceSession) -> Result<ViewInput, WsError> {
    let label = input.label.trim();
    if label.is_empty() {
        return Err(invalid("nameEmpty"));
    }
    let mut f = input.filter.clone();
    for c in f
        .collection_ids
        .iter()
        .chain(input.parent_collection_id.iter())
    {
        check_id(c)?;
        if !s.root.join(collection_rel(c)).is_file() {
            return Err(WsError::NotFound {
                path: collection_rel(c),
            });
        }
    }
    let ok = |r: &Range| r.from.is_none_or(f64::is_finite) && r.to.is_none_or(f64::is_finite);
    if f.episode_range.as_ref().is_some_and(|r| !ok(r)) {
        return Err(invalid("rangeInvalid"));
    }
    if let Some(r) = &f.story_range
        && (r.track_id.trim().is_empty()
            || !ok(&Range {
                from: r.from,
                to: r.to,
            }))
    {
        return Err(invalid("rangeInvalid"));
    }
    // An empty range is the same as no range.
    if f.episode_range
        .as_ref()
        .is_some_and(|r| r.from.is_none() && r.to.is_none())
    {
        f.episode_range = None;
    }
    if let Some(q) = &input.state_query {
        if q.entity_id.trim().is_empty() {
            return Err(invalid("stateEntity"));
        }
        if q.basis != Basis::Reader && q.track_id.as_deref().is_none_or(|t| t.trim().is_empty()) {
            return Err(invalid("stateTrack"));
        }
    }
    Ok(ViewInput {
        label: label.into(),
        parent_collection_id: input.parent_collection_id.clone(),
        mode: input.mode,
        filter: f,
        state_query: input.state_query.clone(),
    })
}

fn apply_input(v: &mut SavedView, i: ViewInput) {
    v.label = i.label;
    v.parent_collection_id = i.parent_collection_id;
    if let Some(m) = i.mode {
        v.mode = m;
    }
    v.collection_ids = i.filter.collection_ids;
    v.episode_range = i.filter.episode_range;
    v.story_range = i.filter.story_range;
    v.include_tag_ids = i.filter.include_tag_ids;
    v.hide_tag_ids = i.filter.hide_tag_ids;
    v.state_query = i.state_query;
}

pub fn create_view(
    s: &WorkspaceSession,
    request_id: &str,
    input: &ViewInput,
) -> Result<ViewInfo, WsError> {
    s.ensure_writable()?;
    let mut problems = Vec::new();
    if let Some(v) = read_all(s, &mut problems)?
        .into_iter()
        .find(|v| v.view.request_id.as_deref() == Some(request_id))
    {
        return Ok(v);
    }
    let input = clean(input, s)?;
    let mut v = SavedView {
        schema_version: 1,
        view_id: Uuid::new_v4().to_string(),
        label: String::new(),
        parent_collection_id: None,
        mode: ViewMode::Both,
        collection_ids: Vec::new(),
        episode_range: None,
        story_range: None,
        include_tag_ids: Vec::new(),
        hide_tag_ids: Vec::new(),
        state_query: None,
        created_at: now_rfc3339(),
        request_id: Some(request_id.into()),
        extra: Default::default(),
    };
    apply_input(&mut v, input);
    let body = serde_json::to_vec_pretty(&v).map_err(io::Error::other)?;
    let hash = s.write_file(request_id, &view_rel(&v.view_id), &body, Expect::Absent)?;
    Ok(ViewInfo { view: v, hash })
}

pub fn update_view(
    s: &WorkspaceSession,
    request_id: &str,
    view_id: &str,
    input: &ViewInput,
    expected_hash: &str,
) -> Result<ViewInfo, WsError> {
    s.ensure_writable()?;
    check_id(view_id)?;
    let rel = view_rel(view_id);
    let (b, _) = s.read_file(&rel)?;
    let mut v: SavedView =
        serde_json::from_slice(strip_bom(&b)).map_err(|e| WsError::InvalidManifest {
            detail: format!("{rel}: {e}"),
        })?;
    apply_input(&mut v, clean(input, s)?);
    let body = serde_json::to_vec_pretty(&v).map_err(io::Error::other)?;
    let hash = s.write_file(request_id, &rel, &body, Expect::Hash(expected_hash.into()))?;
    Ok(ViewInfo { view: v, hash })
}

pub fn delete_view(
    s: &WorkspaceSession,
    view_id: &str,
    expected_hash: &str,
) -> Result<(), WsError> {
    s.ensure_writable()?;
    check_id(view_id)?;
    let rel = view_rel(view_id);
    let _guard = s.writer_guard()?;
    let (_, hash) = s.read_file(&rel)?;
    if hash != expected_hash {
        return Err(WsError::WriteConflict {
            expected: Some(expected_hash.into()),
            actual: Some(hash),
        });
    }
    std::fs::remove_file(s.root.join(rel))?;
    Ok(())
}

// ---------------------------------------------------------------- pure queries

fn story_pos(e: &EventInfo) -> Option<(&str, f64)> {
    if e.certainty == Certainty::Unknown {
        return None;
    }
    match (e.record.story_track_id.as_deref(), e.record.story_order) {
        (Some(t), Some(o)) if o.is_finite() => Some((t, o)),
        _ => None,
    }
}

/// IDs of the events a filter keeps, in input order.
pub fn filter_events(events: &[EventInfo], f: &ViewFilter) -> Vec<String> {
    events
        .iter()
        .filter(|e| {
            f.collection_ids.is_empty()
                || e.record
                    .collection_ids
                    .iter()
                    .any(|c| f.collection_ids.contains(c))
        })
        .filter(|e| match &f.episode_range {
            None => true,
            Some(r) => e.episode_number.is_some_and(|n| r.contains(f64::from(n))),
        })
        .filter(|e| match &f.story_range {
            None => true,
            Some(r) => story_pos(e).is_some_and(|(t, o)| {
                t == r.track_id
                    && Range {
                        from: r.from,
                        to: r.to,
                    }
                    .contains(o)
            }),
        })
        .filter(|e| {
            f.include_tag_ids.is_empty()
                || e.record
                    .tag_ids
                    .iter()
                    .any(|t| f.include_tag_ids.contains(t))
        })
        .filter(|e| !e.record.tag_ids.iter().any(|t| f.hide_tag_ids.contains(t)))
        .map(|e| e.record.event_id.clone())
        .collect()
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StateValue {
    pub property_key: String,
    /// None = ‘미기록’: nothing visible under this basis sets the property yet.
    pub value: Option<String>,
    pub event_id: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StateResult {
    pub entity_id: String,
    pub values: Vec<StateValue>,
    /// Events that counted, in the order they were applied.
    pub considered: Vec<String>,
    /// Estimated events inside the story range: shown on the track, never counted (CH2).
    pub estimated_skipped: Vec<String>,
}

fn inf(x: Option<f64>) -> f64 {
    x.unwrap_or(f64::INFINITY)
}

fn reader_key(e: &EventInfo) -> (f64, f64) {
    (
        e.episode_number.map_or(f64::INFINITY, f64::from),
        inf(e.record.episode_order),
    )
}

fn story_key(e: &EventInfo) -> f64 {
    story_pos(e).map_or(f64::INFINITY, |(_, o)| o)
}

fn cmp_f(a: f64, b: f64) -> Ordering {
    a.partial_cmp(&b).unwrap_or(Ordering::Equal)
}

fn order_reader(a: &EventInfo, b: &EventInfo) -> Ordering {
    let (ra, rb) = (reader_key(a), reader_key(b));
    cmp_f(ra.0, rb.0).then(cmp_f(ra.1, rb.1))
}

fn order_story(a: &EventInfo, b: &EventInfo) -> Ordering {
    cmp_f(story_key(a), story_key(b))
}

pub fn compute_state(events: &[EventInfo], q: &StateQuery) -> Result<StateResult, WsError> {
    let track = q
        .track_id
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty());
    if q.basis != Basis::Reader && track.is_none() {
        return Err(invalid("stateTrack"));
    }
    let reader_ok = |e: &EventInfo| {
        e.episode_number
            .is_some_and(|n| q.episode_max.is_none_or(|m| n <= m))
    };
    let in_story_range = |e: &EventInfo| {
        story_pos(e).is_some_and(|(t, o)| Some(t) == track && q.story_max.is_none_or(|m| o <= m))
    };
    let story_ok = |e: &EventInfo| e.certainty == Certainty::Confirmed && in_story_range(e);
    let mut seen: Vec<&EventInfo> = events
        .iter()
        .filter(|e| match q.basis {
            Basis::Reader => reader_ok(e),
            Basis::Story => story_ok(e),
            Basis::Both => reader_ok(e) && story_ok(e),
        })
        .collect();
    let primary_story =
        q.basis == Basis::Story || (q.basis == Basis::Both && q.primary == Axis::Story);
    seen.sort_by(|a, b| {
        let first = if primary_story {
            order_story(a, b).then(order_reader(a, b))
        } else {
            order_reader(a, b).then(order_story(a, b))
        };
        first.then_with(|| a.record.event_id.cmp(&b.record.event_id))
    });
    let mut keys: Vec<String> = events
        .iter()
        .flat_map(|e| e.record.changes.iter())
        .filter(|c| c.entity_id == q.entity_id)
        .map(|c| c.property_key.clone())
        .collect();
    keys.sort();
    keys.dedup();
    let mut values: Vec<StateValue> = keys
        .into_iter()
        .map(|k| StateValue {
            property_key: k,
            value: None,
            event_id: None,
        })
        .collect();
    for e in &seen {
        for c in e
            .record
            .changes
            .iter()
            .filter(|c| c.entity_id == q.entity_id)
        {
            if let Some(v) = values.iter_mut().find(|v| v.property_key == c.property_key) {
                v.value = Some(c.value.clone());
                v.event_id = Some(e.record.event_id.clone());
            }
        }
    }
    let estimated_skipped = if q.basis == Basis::Reader {
        Vec::new()
    } else {
        events
            .iter()
            .filter(|e| e.certainty == Certainty::Estimated && in_story_range(e))
            .map(|e| e.record.event_id.clone())
            .collect()
    };
    Ok(StateResult {
        entity_id: q.entity_id.clone(),
        values,
        considered: seen.iter().map(|e| e.record.event_id.clone()).collect(),
        estimated_skipped,
    })
}

pub fn query_view(s: &WorkspaceSession, f: &ViewFilter) -> Result<Vec<String>, WsError> {
    Ok(filter_events(&timelines::load(s)?.events, f))
}

pub fn query_state(s: &WorkspaceSession, q: &StateQuery) -> Result<StateResult, WsError> {
    compute_state(&timelines::load(s)?.events, q)
}

#[cfg(test)]
pub(crate) mod fixture {
    //! The S10 fixture: boundary episodes, an unset coordinate, two events on the same position
    //! on both axes, three tracks, a late-revealed past event and the CH2 trio.
    use super::*;
    use crate::workspace::timelines::{EventRecord, EventReview, StateChange};

    pub const MAIN: &str = "track-main";
    pub const BEFORE: &str = "track-before";
    pub const LOOP1: &str = "track-loop1";
    pub const SERIN: &str = "card-serin";

    pub struct Ev {
        pub id: &'static str,
        pub ep: Option<u32>,
        pub order: f64,
        pub story: Option<(&'static str, f64, Certainty)>,
        pub tags: &'static [&'static str],
        pub change: Option<(&'static str, &'static str)>,
    }

    pub fn info(e: &Ev) -> EventInfo {
        let (track, sorder, cert) = match e.story {
            Some((t, o, c)) => (Some(t.to_string()), Some(o), c),
            None => (None, None, Certainty::Unknown),
        };
        EventInfo {
            record: EventRecord {
                schema_version: 1,
                event_id: e.id.into(),
                collection_ids: vec!["k-regress".into()],
                title: e.id.into(),
                tag_ids: e.tags.iter().map(|t| t.to_string()).collect(),
                changes: e
                    .change
                    .iter()
                    .map(|(k, v)| StateChange {
                        entity_id: SERIN.into(),
                        property_key: (*k).into(),
                        value: (*v).into(),
                    })
                    .collect(),
                episode_id: e.ep.map(|n| format!("ep{n}")),
                episode_order: e.ep.map(|_| e.order),
                story_certainty: Some(cert),
                story_track_id: track,
                story_order: sorder,
                ..Default::default()
            },
            certainty: cert,
            episode_number: e.ep,
            review: EventReview::NoRevision,
            reviewed_ordinal: None,
            latest_revision_id: None,
            latest_ordinal: None,
            hash: String::new(),
        }
    }

    use Certainty::{Confirmed as C, Estimated as E};
    pub const EVENTS: &[Ev] = &[
        Ev {
            id: "e-awaken",
            ep: Some(1),
            order: 1.0,
            story: Some((MAIN, 1.0, C)),
            tags: &[],
            change: Some(("능력", "불꽃 각성")),
        },
        Ev {
            id: "e-power",
            ep: Some(20),
            order: 1.0,
            story: Some((MAIN, 6.0, C)),
            tags: &[],
            change: Some(("능력", "화염 조종")),
        },
        Ev {
            id: "e-tie-a",
            ep: Some(25),
            order: 1.0,
            story: Some((MAIN, 4.0, C)),
            tags: &["t-side"],
            change: Some(("동료", "도윤")),
        },
        Ev {
            id: "e-tie-b",
            ep: Some(25),
            order: 1.0,
            story: Some((MAIN, 4.0, C)),
            tags: &["t-side"],
            change: Some(("동료", "린")),
        },
        Ev {
            id: "e-299",
            ep: Some(299),
            order: 1.0,
            story: Some((MAIN, 9.0, C)),
            tags: &[],
            change: None,
        },
        Ev {
            id: "e-fire",
            ep: Some(300),
            order: 1.0,
            story: Some((BEFORE, 2.0, C)),
            tags: &["t-regress"],
            change: Some(("능력", "화염 사용")),
        },
        Ev {
            id: "e-none",
            ep: Some(305),
            order: 1.0,
            story: Some((LOOP1, 1.0, C)),
            tags: &["t-regress"],
            change: Some(("능력", "능력 없음")),
        },
        Ev {
            id: "e-spark",
            ep: Some(310),
            order: 1.0,
            story: Some((LOOP1, 2.0, E)),
            tags: &["t-regress"],
            change: Some(("능력", "불씨 감지")),
        },
        Ev {
            id: "e-327",
            ep: Some(327),
            order: 1.0,
            story: Some((MAIN, 2.0, C)),
            tags: &["t-regress", "t-secret"],
            change: Some(("과거", "회귀자")),
        },
        Ev {
            id: "e-350",
            ep: Some(350),
            order: 2.0,
            story: None,
            tags: &["t-regress"],
            change: None,
        },
        Ev {
            id: "e-351",
            ep: Some(351),
            order: 1.0,
            story: Some((MAIN, 10.0, C)),
            tags: &[],
            change: None,
        },
        Ev {
            id: "e-unset",
            ep: None,
            order: 0.0,
            story: Some((MAIN, 5.0, C)),
            tags: &[],
            change: None,
        },
    ];

    pub fn all() -> Vec<EventInfo> {
        EVENTS.iter().map(info).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::fixture::*;
    use super::*;

    fn q(basis: Basis) -> StateQuery {
        StateQuery {
            entity_id: SERIN.into(),
            basis,
            ..Default::default()
        }
    }

    fn val(r: &StateResult, k: &str) -> Option<String> {
        r.values
            .iter()
            .find(|v| v.property_key == k)
            .and_then(|v| v.value.clone())
    }

    fn ids(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    // S10.A — boundaries, unset coordinate, same position on both axes, other tracks.
    #[test]
    fn s10a_ranges_and_ties() {
        let ev = all();
        let range = |from, to| ViewFilter {
            episode_range: Some(Range {
                from: Some(from),
                to: Some(to),
            }),
            ..Default::default()
        };
        assert_eq!(
            filter_events(&ev, &range(300.0, 350.0)),
            ids(&["e-fire", "e-none", "e-spark", "e-327", "e-350"])
        );
        assert!(!filter_events(&ev, &range(300.0, 350.0)).contains(&"e-unset".to_string()));
        // story range on the main track: unknown (e-350) and other tracks are outside
        let story = ViewFilter {
            story_range: Some(StoryRange {
                track_id: MAIN.into(),
                from: Some(2.0),
                to: Some(5.0),
            }),
            ..Default::default()
        };
        assert_eq!(
            filter_events(&ev, &story),
            ids(&["e-tie-a", "e-tie-b", "e-327", "e-unset"])
        );
        // estimated stays visible on its own track
        let loop1 = ViewFilter {
            story_range: Some(StoryRange {
                track_id: LOOP1.into(),
                from: None,
                to: None,
            }),
            ..Default::default()
        };
        assert_eq!(filter_events(&ev, &loop1), ids(&["e-none", "e-spark"]));
        // tie on both axes: event ID decides, in every basis
        let mut r = q(Basis::Reader);
        r.episode_max = Some(25);
        let res = compute_state(&ev, &r).unwrap();
        assert_eq!(val(&res, "동료").as_deref(), Some("린")); // e-tie-b after e-tie-a
        assert_eq!(
            res.considered,
            ids(&["e-awaken", "e-power", "e-tie-a", "e-tie-b"])
        );
        let mut st = q(Basis::Story);
        st.track_id = Some(MAIN.into());
        st.story_max = Some(4.0);
        assert_eq!(
            compute_state(&ev, &st).unwrap().considered,
            ids(&["e-awaken", "e-327", "e-tie-a", "e-tie-b"])
        );
        // unset episode never counts for readers
        assert!(
            !compute_state(&ev, &q(Basis::Reader))
                .unwrap()
                .considered
                .contains(&"e-unset".to_string())
        );
    }

    #[test]
    fn s10b_tag_include_or_hide_wins_and_restores() {
        let ev = all();
        let base = ViewFilter {
            episode_range: Some(Range {
                from: Some(300.0),
                to: Some(350.0),
            }),
            ..Default::default()
        };
        let before = filter_events(&ev, &base).len();
        let hidden = ViewFilter {
            hide_tag_ids: ids(&["t-secret"]),
            ..base.clone()
        };
        assert_eq!(filter_events(&ev, &hidden).len(), before - 1);
        assert_eq!(filter_events(&ev, &base).len(), before); // un-hiding restores
        let inc = ViewFilter {
            include_tag_ids: ids(&["t-secret", "t-side"]),
            ..Default::default()
        };
        assert_eq!(
            filter_events(&ev, &inc),
            ids(&["e-tie-a", "e-tie-b", "e-327"])
        );
        let both = ViewFilter {
            include_tag_ids: ids(&["t-regress"]),
            hide_tag_ids: ids(&["t-secret"]),
            ..Default::default()
        };
        assert!(!filter_events(&ev, &both).contains(&"e-327".to_string()));
    }

    // S10.C — the late-revealed day-2 past event.
    #[test]
    fn s10c_reader_story_and_intersection() {
        let ev = all();
        let mut reader = q(Basis::Reader);
        reader.episode_max = Some(25);
        let r = compute_state(&ev, &reader).unwrap();
        assert!(!r.considered.contains(&"e-327".to_string()));
        assert_eq!(val(&r, "능력").as_deref(), Some("화염 조종"));
        assert_eq!(val(&r, "과거"), None); // ‘미기록’
        assert!(
            r.values
                .iter()
                .any(|v| v.property_key == "과거" && v.value.is_none())
        );

        let mut story = q(Basis::Story);
        story.track_id = Some(MAIN.into());
        story.story_max = Some(2.0);
        let s = compute_state(&ev, &story).unwrap();
        assert_eq!(s.considered, ids(&["e-awaken", "e-327"]));
        assert_eq!(val(&s, "과거").as_deref(), Some("회귀자"));
        assert_eq!(val(&s, "능력").as_deref(), Some("불꽃 각성"));

        let mut both = story.clone();
        both.basis = Basis::Both;
        both.episode_max = Some(25);
        let b = compute_state(&ev, &both).unwrap();
        assert_eq!(b.considered, ids(&["e-awaken"]));
        assert_eq!(val(&b, "과거"), None);
        // primary axis changes the order inside the intersection, not its members
        both.story_max = Some(6.0);
        both.primary = Axis::Story;
        let by_story = compute_state(&ev, &both).unwrap().considered;
        both.primary = Axis::Reader;
        let by_reader = compute_state(&ev, &both).unwrap().considered;
        assert_eq!(
            by_story,
            ids(&["e-awaken", "e-tie-a", "e-tie-b", "e-power"])
        );
        assert_eq!(
            by_reader,
            ids(&["e-awaken", "e-power", "e-tie-a", "e-tie-b"])
        );
    }

    // S10.D — CH2: only confirmed positions count.
    #[test]
    fn s10d_estimated_does_not_change_confirmed_state() {
        let mut ev = all();
        let mut loop2 = q(Basis::Story);
        loop2.track_id = Some(LOOP1.into());
        loop2.story_max = Some(2.0);
        let r = compute_state(&ev, &loop2).unwrap();
        assert_eq!(val(&r, "능력").as_deref(), Some("능력 없음"));
        assert_eq!(r.estimated_skipped, ids(&["e-spark"]));
        let mut before = q(Basis::Story);
        before.track_id = Some(BEFORE.into());
        before.story_max = Some(2.0);
        let before_val = val(&compute_state(&ev, &before).unwrap(), "능력");
        let reader_all = compute_state(&ev, &q(Basis::Reader)).unwrap().considered;

        // the writer confirms the estimated day
        let spark = ev
            .iter_mut()
            .find(|e| e.record.event_id == "e-spark")
            .unwrap();
        spark.certainty = Certainty::Confirmed;
        spark.record.story_certainty = Some(Certainty::Confirmed);
        let r = compute_state(&ev, &loop2).unwrap();
        assert_eq!(val(&r, "능력").as_deref(), Some("불씨 감지"));
        assert!(r.estimated_skipped.is_empty());
        assert_eq!(
            val(&compute_state(&ev, &before).unwrap(), "능력"),
            before_val
        );
        assert_eq!(
            compute_state(&ev, &q(Basis::Reader)).unwrap().considered,
            reader_all
        );
    }

    #[test]
    fn story_basis_needs_a_track() {
        assert_eq!(
            compute_state(&all(), &q(Basis::Story)).unwrap_err(),
            invalid("stateTrack")
        );
    }
}

#[cfg(test)]
mod store_tests {
    use super::*;
    use crate::workspace::open;
    use crate::workspace::sample::make_sample;
    use crate::workspace::timelines::{EventDraft, create_collection, load, save_event};

    // S10.B on disk: a saved 1~2화 link picks up an event added later; deleting the view
    // leaves events alone; deleting an event is explicit and needs the hash.
    #[test]
    fn s10b_saved_view_requery_and_deletes() {
        let base = tempfile::tempdir().unwrap();
        let dir = base.path().join("링크 시험 (10)");
        let made = make_sample(&dir, "회귀", 3).unwrap();
        let s = open(&dir).unwrap();
        let k = create_collection(&s, "k", "회귀 연표", ViewMode::Both)
            .unwrap()
            .collection
            .collection_id;
        let ev = |title: &str, n: usize| EventDraft {
            collection_ids: vec![k.clone()],
            title: title.into(),
            episode_id: Some(made.episodes[n].episode_id.clone()),
            ..Default::default()
        };
        save_event(&s, "a", None, None, &ev("1화", 0)).unwrap();
        let view = create_view(
            &s,
            "v",
            &ViewInput {
                label: "회귀편".into(),
                parent_collection_id: Some(k.clone()),
                mode: Some(ViewMode::Episode),
                filter: ViewFilter {
                    collection_ids: vec![k.clone()],
                    episode_range: Some(Range {
                        from: Some(2.0),
                        to: Some(3.0),
                    }),
                    ..Default::default()
                },
                state_query: None,
            },
        )
        .unwrap();
        assert_eq!(
            create_view(
                &s,
                "v",
                &ViewInput {
                    label: "x".into(),
                    ..Default::default()
                }
            )
            .unwrap()
            .view
            .view_id,
            view.view.view_id
        );
        assert!(query_view(&s, &view.view.filter()).unwrap().is_empty());
        let late = save_event(&s, "b", None, None, &ev("3화에 나중에", 2)).unwrap();
        let d = load(&s).unwrap();
        let v = d
            .views
            .iter()
            .find(|v| v.view.view_id == view.view.view_id)
            .unwrap();
        assert_eq!(
            query_view(&s, &v.view.filter()).unwrap(),
            vec![late.record.event_id.clone()]
        );
        assert_eq!(v.view.parent_collection_id.as_deref(), Some(k.as_str()));
        // the file holds conditions only
        let raw = std::fs::read_to_string(s.root.join(view_rel(&view.view.view_id))).unwrap();
        assert!(raw.contains("\"episodeRange\"") && !raw.contains(&late.record.event_id));

        // rename keeps the ID; stale hash refused
        let renamed = update_view(
            &s,
            "r",
            &view.view.view_id,
            &ViewInput {
                label: "300~350화".into(),
                parent_collection_id: Some(k.clone()),
                mode: None,
                filter: v.view.filter(),
                state_query: None,
            },
            &v.hash,
        )
        .unwrap();
        assert_eq!(
            (
                renamed.view.view_id.as_str(),
                renamed.view.label.as_str(),
                renamed.view.mode
            ),
            (view.view.view_id.as_str(), "300~350화", ViewMode::Episode)
        );
        assert!(matches!(
            delete_view(&s, &view.view.view_id, &v.hash),
            Err(WsError::WriteConflict { .. })
        ));
        delete_view(&s, &view.view.view_id, &renamed.hash).unwrap();
        let d = load(&s).unwrap();
        assert!(d.views.is_empty());
        assert_eq!(d.events.len(), 2);

        // explicit event delete
        let e = d
            .events
            .iter()
            .find(|e| e.record.event_id == late.record.event_id)
            .unwrap();
        assert!(matches!(
            timelines::delete_event(&s, &e.record.event_id, "stale"),
            Err(WsError::WriteConflict { .. })
        ));
        timelines::delete_event(&s, &e.record.event_id, &e.hash).unwrap();
        assert_eq!(load(&s).unwrap().events.len(), 1);
        // a pinned state view needs an entity and, for story time, a track
        let bad = ViewInput {
            label: "25화 기준".into(),
            state_query: Some(StateQuery {
                entity_id: "c".into(),
                basis: Basis::Story,
                ..Default::default()
            }),
            ..Default::default()
        };
        assert_eq!(
            create_view(&s, "s", &bad).unwrap_err(),
            invalid("stateTrack")
        );
    }

    #[test]
    fn changes_are_validated_and_kept_in_order() {
        use crate::workspace::timelines::StateChange;
        let base = tempfile::tempdir().unwrap();
        let dir = base.path().join("상태 변화");
        let made = make_sample(&dir, "x", 1).unwrap();
        let s = open(&dir).unwrap();
        let k = create_collection(&s, "k", "능력", ViewMode::Episode)
            .unwrap()
            .collection
            .collection_id;
        let mut d = EventDraft {
            collection_ids: vec![k],
            title: "각성".into(),
            episode_id: Some(made.episodes[0].episode_id.clone()),
            changes: vec![
                StateChange {
                    entity_id: "c1".into(),
                    property_key: "능력".into(),
                    value: "불꽃".into(),
                },
                StateChange::default(),
                StateChange {
                    entity_id: "c1".into(),
                    property_key: "소속".into(),
                    value: "".into(),
                },
            ],
            ..Default::default()
        };
        let e = save_event(&s, "a", None, None, &d).unwrap();
        assert_eq!(
            e.record
                .changes
                .iter()
                .map(|c| c.property_key.as_str())
                .collect::<Vec<_>>(),
            vec!["능력", "소속"]
        );
        d.changes.push(StateChange {
            entity_id: "".into(),
            property_key: "x".into(),
            value: "y".into(),
        });
        assert_eq!(
            save_event(&s, "b", None, None, &d).unwrap_err(),
            invalid("changeIncomplete")
        );
    }
}
