// "타임라인" root.
// 09: several named timelines sharing events; three views of one timeline (episode rows /
// in-story tracks / both coordinates); an event editor that keeps typed values when a coordinate
// is missing; per-event review (CH1); track names and certainty (CH2).
// 10: filters (episode range, story track range, tag include OR / hide wins), saved views
// ("links") attached to a timeline and followed one level at a time with back restoring filter
// and scroll; state changes on events and ‘그 시점의 상태’ queries by reader / story / both;
// explicit event delete separate from clearing a filter.
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n/messages";
import { useEpisodes } from "../episodes/EpisodesProvider";
import { asWsError, newRequestId } from "../workspace/api";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { requestOpenCard, useWorldBackend, type CardInfo, type TagInfo } from "../world/api";
import {
  CERTAINTIES,
  EMPTY_FILTER,
  VIEW_MODES,
  byEpisode,
  byStory,
  draftProblem,
  filterIsEmpty,
  hasStory,
  useTimelineBackend,
  viewFilter,
  type Basis,
  type Certainty,
  type EventDraft,
  type EventInfo,
  type StateQuery,
  type StateResult,
  type StoryTrack,
  type TimelineData,
  type ViewFilter,
  type ViewInfo,
  type ViewMode,
} from "./api";

const EMPTY: TimelineData = { collections: [], events: [], tracks: [], tracksHash: "", views: [], problems: [] };
type Msg = { kind: "ok" | "error"; text: string } | null;

function useErrorText() {
  const { t } = useI18n();
  return (e: unknown) => {
    const err = asWsError(e);
    if (err.code === "invalidEvent" && typeof err.reason === "string") return t(`timeline.invalid.${err.reason}` as MessageKey);
    if (err.code === "writeConflict") return t("timeline.changedOutside");
    return t(`errors.${err.code}` as MessageKey);
  };
}

function Notice({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <p role={msg.kind === "error" ? "alert" : "status"} className={msg.kind === "error" ? "notice notice-error" : "banner"}>
      {msg.text}
    </p>
  );
}

export function ReviewBadge({ e }: { e: Pick<EventInfo, "review" | "reviewedOrdinal" | "latestOrdinal"> }) {
  const { t, tf } = useI18n();
  if (e.review === "noEpisode") return null;
  const text =
    e.review === "reviewed"
      ? tf("timeline.review.reviewed", { n: e.latestOrdinal ?? "?" })
      : e.review === "recheck"
        ? tf("timeline.review.recheck", { from: e.reviewedOrdinal ?? "?", to: e.latestOrdinal ?? "?" })
        : t(`timeline.review.${e.review}` as MessageKey);
  return (
    <span className={`state-badge state-${e.review === "noRevision" ? "noRevision" : e.review}`} data-testid="event-review">
      {text}
    </span>
  );
}

function CertaintyBadge({ c }: { c: Certainty }) {
  const { t } = useI18n();
  if (c === "confirmed") return null;
  return <span className={`certainty certainty-${c}`}>{t(`timeline.certainty.${c}` as MessageKey)}</span>;
}

function useCoords(tracks: StoryTrack[]) {
  const { t, tf } = useI18n();
  return {
    episode: (e: EventInfo) =>
      e.episodeNumber != null ? tf("timeline.episodeCoord", { n: e.episodeNumber, order: e.episodeOrder ?? "?" }) : t("timeline.unset"),
    story: (e: EventInfo) => {
      if (!hasStory(e)) return e.certainty === "unknown" ? t("timeline.storyUnknown") : t("timeline.unset");
      const track = tracks.find((x) => x.trackId === e.storyTrackId)?.label ?? "?";
      return tf("timeline.storyCoord", { track, label: e.storyLabel || String(e.storyOrder) });
    },
  };
}

function EventChip({ e, onOpen }: { e: EventInfo; onOpen: (e: EventInfo) => void }) {
  return (
    <button type="button" className="event-chip" data-event-id={e.eventId} onClick={() => onOpen(e)}>
      <span>{e.title}</span> <CertaintyBadge c={e.certainty} /> <ReviewBadge e={e} />
    </button>
  );
}

const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));
const numText = (v: number | null | undefined) => (v == null ? "" : String(v));

// ---------------------------------------------------------------- editor

function toDraft(e: EventInfo): EventDraft {
  return {
    collectionIds: [...e.collectionIds],
    title: e.title,
    detail: e.detail,
    tagIds: [...e.tagIds],
    relatedCardIds: [...e.relatedCardIds],
    changes: (e.changes ?? []).map((c) => ({ ...c })),
    episodeId: e.episodeId ?? null,
    episodeOrder: e.episodeOrder ?? null,
    storyCertainty: e.certainty,
    storyTrackId: e.storyTrackId ?? null,
    storyOrder: e.storyOrder ?? null,
    storyLabel: e.storyLabel ?? null,
  };
}

function EventEditor({ sessionId, readOnly, data, editing, initial, cards, tags, onSaved, onDeleted, onClose }: {
  sessionId: string;
  readOnly: boolean;
  data: TimelineData;
  editing: EventInfo | null;
  initial: EventDraft;
  cards: CardInfo[];
  tags: TagInfo[];
  onSaved: (e: EventInfo) => void;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const { t, tf } = useI18n();
  const backend = useTimelineBackend();
  const eps = useEpisodes();
  const errText = useErrorText();
  const ids = { title: useId(), detail: useId(), ep: useId(), epOrder: useId(), track: useId(), order: useId(), label: useId() };
  const [d, setD] = useState<EventDraft>(initial);
  const [epOrderText, setEpOrderText] = useState(numText(initial.episodeOrder));
  const [orderText, setOrderText] = useState(numText(initial.storyOrder));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [askDelete, setAskDelete] = useState(false);
  const [requestId] = useState(newRequestId); // one create intent per open editor
  const current = editing ? data.events.find((x) => x.eventId === editing.eventId) ?? editing : null;

  const set = (patch: Partial<EventDraft>) => setD((x) => ({ ...x, ...patch }));
  const toggle = (key: "collectionIds" | "tagIds" | "relatedCardIds", id: string) =>
    setD((x) => ({ ...x, [key]: x[key].includes(id) ? x[key].filter((y) => y !== id) : [...x[key], id] }));
  const setChange = (i: number, patch: Partial<EventDraft["changes"][number]>) =>
    setD((x) => ({ ...x, changes: x.changes.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));

  const save = async () => {
    const draft: EventDraft = { ...d, episodeOrder: numOrNull(epOrderText), storyOrder: numOrNull(orderText) };
    if (!draft.episodeId) draft.episodeOrder = null;
    const problem = draftProblem(draft);
    if (problem) {
      // Nothing is sent; every typed value stays in the form (S09.B).
      setMsg({ kind: "error", text: t(`timeline.invalid.${problem}` as MessageKey) });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const saved = await backend.saveEvent({
        sessionId,
        requestId: current ? newRequestId() : requestId,
        eventId: current?.eventId ?? null,
        expectedHash: current?.hash ?? null,
        draft,
      });
      onSaved(saved);
      setMsg({ kind: "ok", text: t("timeline.saved") });
    } catch (e) {
      setMsg({ kind: "error", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!current?.latestRevisionId) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await backend.confirmEvent(sessionId, newRequestId(), current.eventId, current.latestRevisionId);
      onSaved(r);
      setMsg({ kind: "ok", text: tf("timeline.confirmed", { n: r.latestOrdinal ?? "?" }) });
    } catch (e) {
      setMsg({ kind: "error", text: asWsError(e).code === "writeConflict" ? t("timeline.newerCommit") : errText(e) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!current) return;
    setBusy(true);
    try {
      await backend.deleteEvent(sessionId, current.eventId, current.hash);
      onDeleted();
    } catch (e) {
      setMsg({ kind: "error", text: errText(e) });
      setBusy(false);
    }
  };

  const story = d.storyCertainty !== "unknown";
  return (
    <section className="open-card event-editor" aria-label={current ? tf("timeline.editLabel", { title: current.title }) : t("timeline.newEvent")}>
      <h2>{current ? current.title : t("timeline.newEvent")}</h2>
      {current && (
        <p className="muted">
          ID <span className="mono" data-testid="event-id">{current.eventId}</span>
        </p>
      )}
      <Notice msg={msg} />
      {current && current.review !== "noEpisode" && (
        <div className="review-box">
          <ReviewBadge e={current} />
          <span className="muted">{t(`timeline.reviewExplain.${current.review}` as MessageKey)}</span>
          {!readOnly && current.latestRevisionId && current.review !== "reviewed" && (
            <button type="button" className="primary" disabled={busy} onClick={() => void confirm()}>
              {tf("timeline.confirm", { n: current.latestOrdinal ?? "?" })}
            </button>
          )}
        </div>
      )}
      <p className="field">
        <label htmlFor={ids.title}>{t("timeline.title")}</label>
        <input id={ids.title} value={d.title} readOnly={readOnly} onChange={(e) => set({ title: e.target.value })} />
      </p>
      <p className="field">
        <label htmlFor={ids.detail}>{t("timeline.detail")}</label>
        <textarea id={ids.detail} className="summary-text" value={d.detail} readOnly={readOnly} onChange={(e) => set({ detail: e.target.value })} />
      </p>

      <fieldset className="coord">
        <legend>{t("timeline.episodeCoordTitle")}</legend>
        <p className="field">
          <label htmlFor={ids.ep}>{t("timeline.episode")}</label>
          <select id={ids.ep} value={d.episodeId ?? ""} disabled={readOnly} onChange={(e) => set({ episodeId: e.target.value || null })}>
            <option value="">{t("timeline.unset")}</option>
            {eps.list.episodes.map((ep) => (
              <option key={ep.episodeId} value={ep.episodeId}>
                {tf("episodes.label", { n: ep.number })}
              </option>
            ))}
          </select>
        </p>
        <p className="field">
          <label htmlFor={ids.epOrder}>{t("timeline.episodeOrder")}</label>
          <input id={ids.epOrder} type="number" step="any" value={epOrderText} readOnly={readOnly} disabled={!d.episodeId} placeholder={t("timeline.autoLast")} onChange={(e) => setEpOrderText(e.target.value)} />
        </p>
      </fieldset>

      <fieldset className="coord">
        <legend>{t("timeline.storyCoordTitle")}</legend>
        <p className="certainty-choice" role="radiogroup" aria-label={t("timeline.certaintyLabel")}>
          {CERTAINTIES.map((c) => (
            <label key={c}>
              <input type="radio" name={`${ids.track}-c`} checked={d.storyCertainty === c} disabled={readOnly} onChange={() => set({ storyCertainty: c })} />
              {t(`timeline.certaintyChoice.${c}` as MessageKey)}
            </label>
          ))}
        </p>
        {story ? (
          <>
            <p className="field">
              <label htmlFor={ids.track}>{t("timeline.track")}</label>
              <select id={ids.track} value={d.storyTrackId ?? ""} disabled={readOnly} onChange={(e) => set({ storyTrackId: e.target.value || null })}>
                <option value="">{t("timeline.pickTrack")}</option>
                {data.tracks.map((tr) => (
                  <option key={tr.trackId} value={tr.trackId}>
                    {tr.label}
                  </option>
                ))}
              </select>
            </p>
            <p className="field">
              <label htmlFor={ids.order}>{t("timeline.storyOrder")}</label>
              <input id={ids.order} type="number" step="any" value={orderText} readOnly={readOnly} onChange={(e) => setOrderText(e.target.value)} />
            </p>
            <p className="field">
              <label htmlFor={ids.label}>{t("timeline.storyLabel")}</label>
              <input id={ids.label} value={d.storyLabel ?? ""} readOnly={readOnly} placeholder={t("timeline.storyLabelPlaceholder")} onChange={(e) => set({ storyLabel: e.target.value || null })} />
            </p>
          </>
        ) : (
          <p className="muted">{t("timeline.unknownHint")}</p>
        )}
      </fieldset>

      <fieldset className="changes">
        <legend>{t("timeline.changes")}</legend>
        <p className="muted">{t("timeline.changesHelp")}</p>
        {d.changes.map((c, i) => (
          <p key={i} className="change-row" data-testid={`change-${i}`}>
            <select aria-label={t("timeline.changeEntity")} value={c.entityId} disabled={readOnly} onChange={(e) => setChange(i, { entityId: e.target.value })}>
              <option value="">{t("timeline.pickEntity")}</option>
              {cards.map((card) => (
                <option key={card.cardId} value={card.cardId}>
                  {card.name}
                </option>
              ))}
              {c.entityId && !cards.some((card) => card.cardId === c.entityId) && <option value={c.entityId}>{t("timeline.missingCard")}</option>}
            </select>
            <input aria-label={t("timeline.changeProperty")} placeholder={t("timeline.changePropertyPlaceholder")} value={c.propertyKey} readOnly={readOnly} onChange={(e) => setChange(i, { propertyKey: e.target.value })} />
            <input aria-label={t("timeline.changeValue")} placeholder={t("timeline.changeValuePlaceholder")} value={c.value} readOnly={readOnly} onChange={(e) => setChange(i, { value: e.target.value })} />
            {!readOnly && (
              <button type="button" className="link" onClick={() => setD((x) => ({ ...x, changes: x.changes.filter((_, j) => j !== i) }))}>
                {t("timeline.removeChange")}
              </button>
            )}
          </p>
        ))}
        {!readOnly && (
          <button type="button" onClick={() => setD((x) => ({ ...x, changes: [...x.changes, { entityId: x.relatedCardIds[0] ?? "", propertyKey: "", value: "" }] }))}>
            {t("timeline.addChange")}
          </button>
        )}
      </fieldset>

      <fieldset className="card-tags">
        <legend>{t("timeline.timelines")}</legend>
        {data.collections.map((c) => (
          <label key={c.collectionId} className="tag-check">
            <input type="checkbox" checked={d.collectionIds.includes(c.collectionId)} disabled={readOnly} onChange={() => toggle("collectionIds", c.collectionId)} />
            {c.name}
          </label>
        ))}
      </fieldset>
      <fieldset className="card-tags">
        <legend>{t("timeline.tags")}</legend>
        {tags.length === 0 && <span className="muted">{t("timeline.noTags")}</span>}
        {tags.map((tag) => (
          <label key={tag.tagId} className="tag-check">
            <input type="checkbox" checked={d.tagIds.includes(tag.tagId)} disabled={readOnly} onChange={() => toggle("tagIds", tag.tagId)} />
            {tag.label}
          </label>
        ))}
      </fieldset>
      <fieldset className="card-tags">
        <legend>{t("timeline.cards")}</legend>
        {cards.length === 0 && <span className="muted">{t("timeline.noCards")}</span>}
        {cards.map((c) => (
          <label key={c.cardId} className="tag-check">
            <input type="checkbox" checked={d.relatedCardIds.includes(c.cardId)} disabled={readOnly} onChange={() => toggle("relatedCardIds", c.cardId)} />
            {c.name} <span className="muted">({c.folder})</span>
          </label>
        ))}
        {d.relatedCardIds
          .filter((id) => !cards.some((c) => c.cardId === id))
          .map((id) => (
            <span key={id} className="muted">
              {t("timeline.missingCard")} <span className="mono">{id.slice(0, 8)}</span>
            </span>
          ))}
      </fieldset>

      <p className="actions">
        {!readOnly && (
          <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
            {current ? t("timeline.saveEvent") : t("timeline.addEvent")}
          </button>
        )}
        <button type="button" onClick={onClose}>
          {t("timeline.close")}
        </button>
        {!readOnly && current && (
          <button type="button" className="danger" disabled={busy} onClick={() => setAskDelete(true)}>
            {t("timeline.deleteEvent")}
          </button>
        )}
      </p>
      {askDelete && current && (
        <div role="alertdialog" aria-label={t("timeline.deleteEvent")} className="review-box">
          <p>{tf("timeline.deleteImpact", { title: current.title, n: current.collectionIds.length })}</p>
          <button type="button" className="danger" disabled={busy} onClick={() => void remove()}>
            {t("timeline.deleteConfirm")}
          </button>
          <button type="button" onClick={() => setAskDelete(false)}>
            {t("timeline.cancel")}
          </button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- views

type BothSort = "episode" | "story";
type BothFilter = "all" | "noEpisode" | "noStory" | "both";

function TimelineView({ data, events, mode, episodeRange, onOpen, onAdd }: {
  data: TimelineData;
  events: EventInfo[];
  mode: ViewMode;
  episodeRange: { from: number | null; to: number | null } | null;
  onOpen: (e: EventInfo) => void;
  onAdd: ((episodeId: string | null) => void) | null;
}) {
  const { t, tf } = useI18n();
  const eps = useEpisodes();
  const coords = useCoords(data.tracks);
  const sortId = useId();
  const filterId = useId();
  const [sort, setSort] = useState<BothSort>("episode");
  const [filter, setFilter] = useState<BothFilter>("all");

  if (mode === "episode") {
    const unplaced = events.filter((e) => e.episodeNumber == null).sort(byEpisode);
    const rows = [...eps.list.episodes]
      .filter((ep) => !episodeRange || ((episodeRange.from == null || ep.number >= episodeRange.from) && (episodeRange.to == null || ep.number <= episodeRange.to)))
      .sort((a, b) => a.number - b.number);
    return (
      <div className="tl-episode">
        <ul className="tl-rows">
          {rows.map((ep) => {
            const here = events.filter((e) => e.episodeId === ep.episodeId).sort(byEpisode);
            return (
              <li key={ep.episodeId} className="tl-row" data-testid={`ep-row-${ep.number}`}>
                <strong className="tl-row-head">{tf("episodes.label", { n: ep.number })}</strong>
                <span className="tl-row-events">
                  {here.length === 0 && <span className="muted">{t("timeline.noEvents")}</span>}
                  {here.map((e) => (
                    <EventChip key={e.eventId} e={e} onOpen={onOpen} />
                  ))}
                </span>
                {onAdd && (
                  <button type="button" className="link" onClick={() => onAdd(ep.episodeId)}>
                    {t("timeline.addEventHere")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {!episodeRange && (
          <>
            <h3>{t("timeline.noEpisodeSection")}</h3>
            <p className="tl-row-events" data-testid="unplaced-episode">
              {unplaced.length === 0 ? <span className="muted">{t("timeline.none")}</span> : unplaced.map((e) => <EventChip key={e.eventId} e={e} onOpen={onOpen} />)}
            </p>
          </>
        )}
      </div>
    );
  }

  if (mode === "story") {
    const unknown = events.filter((e) => !hasStory(e)).sort(byEpisode);
    return (
      <div className="tl-story">
        {onAdd && (
          <p className="actions">
            <button type="button" onClick={() => onAdd(null)}>
              {t("timeline.addEvent")}
            </button>
          </p>
        )}
        {data.tracks.map((tr) => {
          const on = events.filter((e) => hasStory(e) && e.storyTrackId === tr.trackId).sort(byStory(data.tracks));
          return (
            <section key={tr.trackId} className="tl-track" data-testid={`track-${tr.label}`}>
              <h3>{tr.label}</h3>
              {on.length === 0 ? (
                <p className="muted">{t("timeline.noEvents")}</p>
              ) : (
                <ol className="tl-rows">
                  {on.map((e) => (
                    <li key={e.eventId} className="tl-row">
                      <span className="tl-row-head mono">{e.storyLabel || e.storyOrder}</span>
                      <EventChip e={e} onOpen={onOpen} />
                      <span className="muted">{coords.episode(e)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          );
        })}
        <h3>{t("timeline.noStorySection")}</h3>
        <p className="tl-row-events" data-testid="unplaced-story">
          {unknown.length === 0 ? <span className="muted">{t("timeline.none")}</span> : unknown.map((e) => <EventChip key={e.eventId} e={e} onOpen={onOpen} />)}
        </p>
      </div>
    );
  }

  const shown = events
    .filter((e) => {
      const ep = e.episodeNumber != null;
      const st = hasStory(e);
      return filter === "all" || (filter === "noEpisode" && !ep) || (filter === "noStory" && !st) || (filter === "both" && ep && st);
    })
    .sort(sort === "episode" ? byEpisode : byStory(data.tracks));
  return (
    <div className="tl-both">
      <div className="world-filters">
        <p className="field">
          <label htmlFor={sortId}>{t("timeline.sortBy")}</label>
          <select id={sortId} value={sort} onChange={(e) => setSort(e.target.value as BothSort)}>
            <option value="episode">{t("timeline.sortEpisode")}</option>
            <option value="story">{t("timeline.sortStory")}</option>
          </select>
        </p>
        <p className="field">
          <label htmlFor={filterId}>{t("timeline.filter")}</label>
          <select id={filterId} value={filter} onChange={(e) => setFilter(e.target.value as BothFilter)}>
            {(["all", "noEpisode", "noStory", "both"] as const).map((f) => (
              <option key={f} value={f}>
                {t(`timeline.filters.${f}` as MessageKey)}
              </option>
            ))}
          </select>
        </p>
        {onAdd && (
          <p className="actions">
            <button type="button" onClick={() => onAdd(null)}>
              {t("timeline.addEvent")}
            </button>
          </p>
        )}
      </div>
      <table className="tl-table">
        <thead>
          <tr>
            <th>{t("timeline.title")}</th>
            <th>{t("timeline.episodeCoordTitle")}</th>
            <th>{t("timeline.storyCoordTitle")}</th>
            <th>{t("timeline.reviewCol")}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((e) => (
            <tr key={e.eventId} data-event-id={e.eventId}>
              <td>
                <button type="button" className="link" onClick={() => onOpen(e)}>
                  {e.title}
                </button>
              </td>
              <td className={e.episodeNumber == null ? "unset" : undefined}>{coords.episode(e)}</td>
              <td className={!hasStory(e) ? "unset" : undefined}>
                {coords.story(e)} <CertaintyBadge c={e.certainty} />
              </td>
              <td>
                <ReviewBadge e={e} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {shown.length === 0 && <p className="empty">{t("timeline.none")}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- filters (10)

function FilterBar({ data, tags, filter, onChange }: { data: TimelineData; tags: TagInfo[]; filter: ViewFilter; onChange: (f: ViewFilter) => void }) {
  const { t } = useI18n();
  const ids = { epFrom: useId(), epTo: useId(), track: useId(), stFrom: useId(), stTo: useId() };
  const ep = filter.episodeRange ?? { from: null, to: null };
  const st = filter.storyRange ?? { trackId: "", from: null, to: null };
  const setEp = (patch: Partial<typeof ep>) => {
    const r = { ...ep, ...patch };
    onChange({ ...filter, episodeRange: r.from == null && r.to == null ? null : r });
  };
  const setSt = (patch: Partial<typeof st>) => {
    const r = { ...st, ...patch };
    onChange({ ...filter, storyRange: r.trackId ? r : null });
  };
  const toggle = (key: "includeTagIds" | "hideTagIds", id: string) =>
    onChange({ ...filter, [key]: filter[key].includes(id) ? filter[key].filter((x) => x !== id) : [...filter[key], id] });
  return (
    <details className="filter-bar open-card" open={!filterIsEmpty(filter)}>
      <summary>{filterIsEmpty(filter) ? t("timeline.filterTitle") : t("timeline.filterActive")}</summary>
      <p className="muted">{t("timeline.filterRule")}</p>
      <div className="world-filters">
        <p className="field">
          <label htmlFor={ids.epFrom}>{t("timeline.epFrom")}</label>
          <input id={ids.epFrom} type="number" value={numText(ep.from)} onChange={(e) => setEp({ from: numOrNull(e.target.value) })} />
        </p>
        <p className="field">
          <label htmlFor={ids.epTo}>{t("timeline.epTo")}</label>
          <input id={ids.epTo} type="number" value={numText(ep.to)} onChange={(e) => setEp({ to: numOrNull(e.target.value) })} />
        </p>
        <p className="field">
          <label htmlFor={ids.track}>{t("timeline.filterTrack")}</label>
          <select id={ids.track} value={st.trackId} onChange={(e) => setSt({ trackId: e.target.value })}>
            <option value="">{t("timeline.anyTrack")}</option>
            {data.tracks.map((tr) => (
              <option key={tr.trackId} value={tr.trackId}>
                {tr.label}
              </option>
            ))}
          </select>
        </p>
        <p className="field">
          <label htmlFor={ids.stFrom}>{t("timeline.storyFrom")}</label>
          <input id={ids.stFrom} type="number" step="any" disabled={!st.trackId} value={numText(st.from)} onChange={(e) => setSt({ from: numOrNull(e.target.value) })} />
        </p>
        <p className="field">
          <label htmlFor={ids.stTo}>{t("timeline.storyTo")}</label>
          <input id={ids.stTo} type="number" step="any" disabled={!st.trackId} value={numText(st.to)} onChange={(e) => setSt({ to: numOrNull(e.target.value) })} />
        </p>
      </div>
      <fieldset className="card-tags">
        <legend>{t("timeline.includeTags")}</legend>
        {tags.map((tag) => (
          <label key={tag.tagId} className="tag-check">
            <input type="checkbox" checked={filter.includeTagIds.includes(tag.tagId)} onChange={() => toggle("includeTagIds", tag.tagId)} />
            {tag.label}
          </label>
        ))}
      </fieldset>
      <fieldset className="card-tags">
        <legend>{t("timeline.hideTags")}</legend>
        {tags.map((tag) => (
          <label key={tag.tagId} className="tag-check">
            <input type="checkbox" checked={filter.hideTagIds.includes(tag.tagId)} onChange={() => toggle("hideTagIds", tag.tagId)} />
            {tag.label}
          </label>
        ))}
      </fieldset>
      <p className="actions">
        <button type="button" disabled={filterIsEmpty(filter)} onClick={() => onChange({ ...EMPTY_FILTER, collectionIds: filter.collectionIds })}>
          {t("timeline.clearFilter")}
        </button>
      </p>
    </details>
  );
}

/** Events kept by a filter, asked from Rust (one implementation of the rules). */
function useFiltered(sessionId: string, data: TimelineData, filter: ViewFilter) {
  const backend = useTimelineBackend();
  const [ids, setIds] = useState<string[] | null>(null);
  const key = JSON.stringify(filter);
  useEffect(() => {
    let live = true;
    setIds(null);
    backend
      .queryView(sessionId, filter)
      .then((r) => live && setIds(r))
      .catch(() => live && setIds([]));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, sessionId, key, data]);
  return useMemo(() => (ids ? data.events.filter((e) => ids.includes(e.eventId)) : null), [data.events, ids]);
}

// ---------------------------------------------------------------- state query (10)

function StateResultTable({ data, result, cards }: { data: TimelineData; result: StateResult; cards: CardInfo[] }) {
  const { t, tf } = useI18n();
  const title = (id: string | null) => data.events.find((e) => e.eventId === id)?.title ?? id ?? "";
  const card = cards.find((c) => c.cardId === result.entityId);
  return (
    <div className="state-result" data-testid="state-result">
      {result.values.length === 0 ? (
        <p className="empty">{t("timeline.stateNoProps")}</p>
      ) : (
        <table className="tl-table">
          <thead>
            <tr>
              <th>{t("timeline.stateProperty")}</th>
              <th>{t("timeline.stateValue")}</th>
              <th>{t("timeline.stateSource")}</th>
            </tr>
          </thead>
          <tbody>
            {result.values.map((v) => (
              <tr key={v.propertyKey} data-property={v.propertyKey}>
                <td>{v.propertyKey}</td>
                <td className={v.value == null ? "unset" : undefined}>{v.value ?? t("timeline.unrecorded")}</td>
                <td className="muted">{v.eventId ? title(v.eventId) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted" data-testid="state-considered">
        {tf("timeline.stateConsidered", { n: result.considered.length, list: result.considered.map((id) => title(id)).join(" → ") || "-" })}
      </p>
      {result.estimatedSkipped.length > 0 && (
        <p className="muted" data-testid="state-estimated">
          {tf("timeline.stateEstimated", { list: result.estimatedSkipped.map((id) => title(id)).join(", ") })}
        </p>
      )}
      <p className="muted">{t("timeline.stateNoCardNotes")}</p>
      {card && (
        <button type="button" onClick={() => requestOpenCard(card.cardId)}>
          {tf("timeline.openFullCard", { name: card.name })}
        </button>
      )}
    </div>
  );
}

function StatePanel({ sessionId, readOnly, data, cards, onPinned }: { sessionId: string; readOnly: boolean; data: TimelineData; cards: CardInfo[]; onPinned: () => void }) {
  const { t } = useI18n();
  const backend = useTimelineBackend();
  const errText = useErrorText();
  const ids = { entity: useId(), epMax: useId(), track: useId(), stMax: useId(), label: useId() };
  const entities = useMemo(() => {
    const used = new Set(data.events.flatMap((e) => (e.changes ?? []).map((c) => c.entityId)));
    return cards.filter((c) => used.has(c.cardId));
  }, [cards, data.events]);
  const [q, setQ] = useState<StateQuery>({ entityId: "", basis: "reader", episodeMax: null, trackId: null, storyMax: null, primary: "reader" });
  const [epMax, setEpMax] = useState("");
  const [stMax, setStMax] = useState("");
  const [result, setResult] = useState<StateResult | null>(null);
  const [label, setLabel] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const query = (): StateQuery => ({ ...q, entityId: q.entityId || entities[0]?.cardId || "", episodeMax: numOrNull(epMax), storyMax: numOrNull(stMax), trackId: q.trackId ?? data.tracks[0]?.trackId ?? null });
  const run = async () => {
    setMsg(null);
    try {
      setResult(await backend.queryState(sessionId, query()));
    } catch (e) {
      setResult(null);
      setMsg({ kind: "error", text: errText(e) });
    }
  };
  const pin = async () => {
    setMsg(null);
    try {
      await backend.createView(sessionId, newRequestId(), { label: label.trim(), parentCollectionId: null, mode: "both", filter: EMPTY_FILTER, stateQuery: query() });
      setLabel("");
      onPinned();
      setMsg({ kind: "ok", text: t("timeline.pinned") });
    } catch (e) {
      setMsg({ kind: "error", text: errText(e) });
    }
  };
  return (
    <section className="open-card state-panel" aria-label={t("timeline.stateTitle")}>
      <h2>{t("timeline.stateTitle")}</h2>
      <p className="muted">{t("timeline.stateHelp")}</p>
      <Notice msg={msg} />
      {entities.length === 0 ? (
        <p className="empty">{t("timeline.stateNoEntities")}</p>
      ) : (
        <>
          <div className="world-filters">
            <p className="field">
              <label htmlFor={ids.entity}>{t("timeline.stateEntity")}</label>
              <select id={ids.entity} value={q.entityId || entities[0].cardId} onChange={(e) => setQ({ ...q, entityId: e.target.value })}>
                {entities.map((c) => (
                  <option key={c.cardId} value={c.cardId}>
                    {c.name}
                  </option>
                ))}
              </select>
            </p>
          </div>
          <p className="certainty-choice" role="radiogroup" aria-label={t("timeline.basisLabel")}>
            {(["reader", "story", "both"] as Basis[]).map((b) => (
              <label key={b}>
                <input type="radio" name={`${ids.entity}-b`} checked={q.basis === b} onChange={() => setQ({ ...q, basis: b })} />
                {t(`timeline.basis.${b}` as MessageKey)}
              </label>
            ))}
          </p>
          <div className="world-filters">
            {q.basis !== "story" && (
              <p className="field">
                <label htmlFor={ids.epMax}>{t("timeline.episodeMax")}</label>
                <input id={ids.epMax} type="number" value={epMax} placeholder={t("timeline.allEpisodes")} onChange={(e) => setEpMax(e.target.value)} />
              </p>
            )}
            {q.basis !== "reader" && (
              <>
                <p className="field">
                  <label htmlFor={ids.track}>{t("timeline.track")}</label>
                  <select id={ids.track} value={q.trackId ?? data.tracks[0]?.trackId ?? ""} onChange={(e) => setQ({ ...q, trackId: e.target.value })}>
                    {data.tracks.map((tr) => (
                      <option key={tr.trackId} value={tr.trackId}>
                        {tr.label}
                      </option>
                    ))}
                  </select>
                </p>
                <p className="field">
                  <label htmlFor={ids.stMax}>{t("timeline.storyMax")}</label>
                  <input id={ids.stMax} type="number" step="any" value={stMax} placeholder={t("timeline.wholeTrack")} onChange={(e) => setStMax(e.target.value)} />
                </p>
              </>
            )}
          </div>
          {q.basis === "both" && (
            <p className="certainty-choice" role="radiogroup" aria-label={t("timeline.primaryLabel")}>
              {(["reader", "story"] as const).map((a) => (
                <label key={a}>
                  <input type="radio" name={`${ids.entity}-p`} checked={q.primary === a} onChange={() => setQ({ ...q, primary: a })} />
                  {t(`timeline.primary.${a}` as MessageKey)}
                </label>
              ))}
            </p>
          )}
          <p className="actions">
            <button type="button" className="primary" onClick={() => void run()}>
              {t("timeline.stateRun")}
            </button>
          </p>
          {result && <StateResultTable data={data} result={result} cards={cards} />}
          {!readOnly && result && (
            <p className="field">
              <label htmlFor={ids.label}>{t("timeline.pinLabel")}</label>
              <input id={ids.label} value={label} placeholder={t("timeline.pinPlaceholder")} onChange={(e) => setLabel(e.target.value)} />
              <button type="button" disabled={!label.trim()} onClick={() => void pin()}>
                {t("timeline.pin")}
              </button>
            </p>
          )}
        </>
      )}
    </section>
  );
}

function PinnedState({ sessionId, data, view, cards }: { sessionId: string; data: TimelineData; view: ViewInfo; cards: CardInfo[] }) {
  const backend = useTimelineBackend();
  const errText = useErrorText();
  const [result, setResult] = useState<StateResult | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const key = JSON.stringify(view.stateQuery);
  useEffect(() => {
    if (!view.stateQuery) return;
    backend
      .queryState(sessionId, view.stateQuery)
      .then(setResult)
      .catch((e) => setMsg({ kind: "error", text: errText(e) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, sessionId, key, data]);
  return (
    <>
      <Notice msg={msg} />
      {result && <StateResultTable data={data} result={result} cards={cards} />}
    </>
  );
}

function describeState(q: StateQuery, data: TimelineData, cards: CardInfo[], tf: (k: MessageKey, v: Record<string, string | number>) => string) {
  const who = cards.find((c) => c.cardId === q.entityId)?.name ?? q.entityId;
  const track = data.tracks.find((x) => x.trackId === q.trackId)?.label ?? "?";
  if (q.basis === "reader") return tf("timeline.descReader", { who, n: q.episodeMax ?? "∞" });
  if (q.basis === "story") return tf("timeline.descStory", { who, track, x: q.storyMax ?? "∞" });
  return tf("timeline.descBoth", { who, n: q.episodeMax ?? "∞", track, x: q.storyMax ?? "∞" });
}

// ---------------------------------------------------------------- tracks

function TrackManager({ sessionId, readOnly, data, onChanged }: { sessionId: string; readOnly: boolean; data: TimelineData; onChanged: () => void }) {
  const { t, tf } = useI18n();
  const backend = useTimelineBackend();
  const errText = useErrorText();
  const newId = useId();
  const [label, setLabel] = useState("");
  const [edit, setEdit] = useState<{ trackId: string; label: string } | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const run = async (f: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await f();
      onChanged();
      setMsg({ kind: "ok", text: ok });
      return true;
    } catch (e) {
      setMsg({ kind: "error", text: errText(e) });
      return false;
    }
  };
  return (
    <section className="tag-manager" aria-label={t("timeline.tracks")}>
      <h2>{t("timeline.tracks")}</h2>
      <p className="muted">{t("timeline.tracksHelp")}</p>
      <Notice msg={msg} />
      <ul className="tag-list">
        {data.tracks.map((tr) => (
          <li key={tr.trackId} className="tag-row" data-track={tr.label}>
            {edit?.trackId === tr.trackId ? (
              <>
                <input aria-label={t("timeline.trackName")} value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })} />
                <button
                  type="button"
                  disabled={!edit.label.trim()}
                  onClick={() =>
                    void run(() => backend.renameTrack(sessionId, newRequestId(), tr.trackId, edit.label.trim(), data.tracksHash), tf("timeline.trackRenamed", { label: edit.label.trim() })).then(
                      (ok) => ok && setEdit(null),
                    )
                  }
                >
                  {t("timeline.save")}
                </button>
                <button type="button" onClick={() => setEdit(null)}>
                  {t("timeline.cancel")}
                </button>
              </>
            ) : (
              <>
                <strong>{tr.label}</strong>
                <span className="muted">{tf("timeline.eventCount", { n: data.events.filter((e) => hasStory(e) && e.storyTrackId === tr.trackId).length })}</span>
                {!readOnly && (
                  <button type="button" onClick={() => setEdit({ trackId: tr.trackId, label: tr.label })}>
                    {t("timeline.renameTrack")}
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      {!readOnly && (
        <p className="field">
          <label htmlFor={newId}>{t("timeline.newTrack")}</label>
          <input id={newId} value={label} onChange={(e) => setLabel(e.target.value)} />
          <button
            type="button"
            disabled={!label.trim()}
            onClick={() => {
              const l = label.trim();
              void run(() => backend.addTrack(sessionId, newRequestId(), l, data.tracksHash), tf("timeline.trackAdded", { label: l })).then((ok) => ok && setLabel(""));
            }}
          >
            {t("timeline.addTrack")}
          </button>
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- navigation (10)

/** One place in the timeline root. Back pops a frame and restores its filter and scroll. */
type Frame =
  | { kind: "collection"; id: string; mode: ViewMode; filter: ViewFilter; scroll: number }
  | { kind: "view"; id: string; mode: ViewMode | null; scroll: number };

function scrollBox(): HTMLElement | null {
  return document.querySelector("main");
}

// ---------------------------------------------------------------- root

export function TimelinePanel() {
  const { t, tf } = useI18n();
  const backend = useTimelineBackend();
  const world = useWorldBackend();
  const ws = useWorkspace();
  const errText = useErrorText();
  const sessionId = ws.current?.sessionId ?? null;
  const readOnly = ws.current?.mode === "readOnly";
  const nameId = useId();
  const renameId = useId();
  const linkId = useId();
  const [data, setData] = useState<TimelineData>(EMPTY);
  const [cards, setCards] = useState<CardInfo[]>([]);
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [stack, setStack] = useState<Frame[]>([]);
  const [editor, setEditor] = useState<{ key: number; editing: EventInfo | null; initial: EventDraft } | null>(null);
  const [newName, setNewName] = useState("");
  const [newMode, setNewMode] = useState<ViewMode>("episode");
  const [rename, setRename] = useState<string | null>(null);
  const [linkLabel, setLinkLabel] = useState("");
  const [askDeleteView, setAskDeleteView] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const reload = useCallback(async () => {
    if (!sessionId) return;
    try {
      setData(await backend.load(sessionId));
    } catch (e) {
      setMsg({ kind: "error", text: errText(e) });
    }
    try {
      const [l, tg] = await Promise.all([world.list(sessionId), world.listTags(sessionId)]);
      setCards(l.cards);
      setTags(tg);
    } catch {
      /* cards and tags are optional here */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, sessionId, world]);

  useEffect(() => {
    setStack([]);
    setEditor(null);
    setMsg(null);
    void reload();
  }, [reload]);

  // Files changed outside the app: re-read when the window comes back unless an editor is open.
  useEffect(() => {
    const onFocus = () => {
      if (!editor) void reload();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [editor, reload]);

  const frame = stack.at(-1) ?? null;
  const setFrame = (patch: Partial<Frame>) => setStack((s) => (s.length ? [...s.slice(0, -1), { ...s[s.length - 1], ...patch } as Frame] : s));
  const push = (f: Frame) => {
    const y = scrollBox()?.scrollTop ?? 0;
    setStack((s) => [...(s.length ? [...s.slice(0, -1), { ...s[s.length - 1], scroll: y }] : []), f]);
    setEditor(null);
    setRename(null);
    setAskDeleteView(false);
    setMsg(null);
    void reload(); // following a link re-reads the work: conditions are applied to current events
  };
  const back = () => {
    const prev = stack.at(-2);
    setStack((s) => s.slice(0, -1));
    setEditor(null);
    setRename(null);
    setAskDeleteView(false);
    void reload();
    const y = prev?.scroll ?? 0;
    window.setTimeout(() => scrollBox()?.scrollTo?.(0, y), 0);
  };

  const col = frame?.kind === "collection" ? data.collections.find((c) => c.collectionId === frame.id) ?? null : null;
  const view = frame?.kind === "view" ? data.views.find((v) => v.viewId === frame.id) ?? null : null;
  const activeFilter: ViewFilter = frame?.kind === "collection" ? { ...frame.filter, collectionIds: [frame.id] } : view ? viewFilter(view) : EMPTY_FILTER;
  const filtered = useFiltered(sessionId ?? "", data, activeFilter);

  if (!sessionId) return null;

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    setMsg(null);
    try {
      const c = await backend.createTimeline(sessionId, newRequestId(), name, newMode);
      setNewName("");
      await reload();
      push({ kind: "collection", id: c.collectionId, mode: c.defaultMode, filter: EMPTY_FILTER, scroll: 0 });
    } catch (e) {
      setMsg({ kind: "error", text: errText(e) });
    }
  };

  const openEditor = (editing: EventInfo | null, episodeId: string | null) => {
    const initial: EventDraft = editing
      ? toDraft(data.events.find((x) => x.eventId === editing.eventId) ?? editing)
      : {
          collectionIds: col ? [col.collectionId] : [],
          title: "",
          detail: "",
          tagIds: [],
          relatedCardIds: [],
          changes: [],
          episodeId,
          episodeOrder: null,
          storyCertainty: "unknown",
          storyTrackId: data.tracks[0]?.trackId ?? null,
          storyOrder: null,
          storyLabel: null,
        };
    setEditor({ key: Date.now(), editing, initial });
  };

  const editorEl = editor && (
    <EventEditor
      key={editor.key}
      sessionId={sessionId}
      readOnly={readOnly}
      data={data}
      editing={editor.editing}
      initial={editor.initial}
      cards={cards}
      tags={tags}
      onSaved={(e) => {
        setEditor((cur) => (cur ? { ...cur, editing: e } : cur));
        void reload();
      }}
      onDeleted={() => {
        setEditor(null);
        setMsg({ kind: "ok", text: t("timeline.deleted") });
        void reload();
      }}
      onClose={() => setEditor(null)}
    />
  );

  const modeTabs = (mode: ViewMode, def: ViewMode | null, onPick: (m: ViewMode) => void) => (
    <div className="mode-tabs" role="tablist" aria-label={t("timeline.modeLabel")}>
      {VIEW_MODES.map((m) => (
        <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? "tab active" : "tab"} onClick={() => onPick(m)}>
          {t(`timeline.modes.${m}` as MessageKey)}
          {def === m && <span className="muted"> · {t("timeline.default")}</span>}
        </button>
      ))}
    </div>
  );

  const backButton = (
    <p>
      <button type="button" className="link" onClick={back}>
        {stack.length > 1 ? t("timeline.backOne") : t("timeline.back")}
      </button>
    </p>
  );

  // -- a followed link
  if (frame?.kind === "view") {
    if (!view) {
      return (
        <section className="timeline">
          <p role="alert" className="notice notice-error">
            {t("timeline.linkMissing")}
          </p>
          <button type="button" className="primary" onClick={back}>
            {t("timeline.backToOrigin")}
          </button>
        </section>
      );
    }
    const parent = data.collections.find((c) => c.collectionId === view.parentCollectionId);
    const missingCols = view.collectionIds.filter((id) => !data.collections.some((c) => c.collectionId === id));
    const mode = frame.mode ?? view.mode;
    return (
      <section className="timeline">
        {backButton}
        <Notice msg={msg} />
        <h2 className="tl-name">
          ↪ {view.label} {parent && <span className="muted">· {tf("timeline.linkIn", { name: parent.name })}</span>}
        </h2>
        <p className="muted" data-testid="view-conditions">
          {view.stateQuery ? describeState(view.stateQuery, data, cards, tf) : describeFilter(viewFilter(view), data, tags, t, tf)}
        </p>
        {missingCols.length > 0 && (
          <p role="status" className="banner banner-warn">
            {t("timeline.linkTimelineMissing")}
          </p>
        )}
        {view.stateQuery ? (
          <PinnedState sessionId={sessionId} data={data} view={view} cards={cards} />
        ) : (
          <>
            {modeTabs(mode, view.mode, (m) => setFrame({ mode: m }))}
            {editorEl}
            {filtered === null ? (
              <p className="muted">{t("manuscript.loading")}</p>
            ) : (
              <>
                <p className="muted" data-testid="shown-count">
                  {tf("timeline.shownCount", { n: filtered.length })}
                </p>
                <TimelineView data={data} events={filtered} mode={mode} episodeRange={view.episodeRange ?? null} onOpen={(e) => openEditor(e, null)} onAdd={null} />
              </>
            )}
          </>
        )}
        {!readOnly && (
          <p className="actions">
            <button type="button" className="danger" onClick={() => setAskDeleteView(true)}>
              {t("timeline.deleteLink")}
            </button>
          </p>
        )}
        {askDeleteView && (
          <div role="alertdialog" aria-label={t("timeline.deleteLink")} className="review-box">
            <p>{t("timeline.deleteLinkImpact")}</p>
            <button
              type="button"
              className="danger"
              onClick={async () => {
                try {
                  await backend.deleteView(sessionId, view.viewId, view.hash);
                  back();
                } catch (e) {
                  setMsg({ kind: "error", text: errText(e) });
                }
              }}
            >
              {t("timeline.deleteLinkConfirm")}
            </button>
            <button type="button" onClick={() => setAskDeleteView(false)}>
              {t("timeline.cancel")}
            </button>
          </div>
        )}
      </section>
    );
  }

  // -- one timeline
  if (frame?.kind === "collection" && col) {
    const all = data.events.filter((e) => e.collectionIds.includes(col.collectionId));
    const links = data.views.filter((v) => v.parentCollectionId === col.collectionId);
    const shown = filterIsEmpty(frame.filter) ? all : filtered ?? all;
    return (
      <section className="timeline">
        {backButton}
        <Notice msg={msg} />
        <h2 className="tl-name">
          {rename !== null ? (
            <>
              <label htmlFor={renameId} className="visually-hidden">
                {t("timeline.name")}
              </label>
              <input id={renameId} value={rename} onChange={(e) => setRename(e.target.value)} />
              <button
                type="button"
                disabled={!rename.trim()}
                onClick={async () => {
                  try {
                    await backend.updateTimeline(sessionId, newRequestId(), col.collectionId, rename.trim(), col.defaultMode, col.hash);
                    setRename(null);
                    await reload();
                  } catch (e) {
                    setMsg({ kind: "error", text: errText(e) });
                  }
                }}
              >
                {t("timeline.save")}
              </button>
              <button type="button" onClick={() => setRename(null)}>
                {t("timeline.cancel")}
              </button>
            </>
          ) : (
            <>
              {col.name}{" "}
              {!readOnly && (
                <button type="button" className="link small" onClick={() => setRename(col.name)}>
                  {t("timeline.rename")}
                </button>
              )}
            </>
          )}
        </h2>
        {links.length > 0 && (
          <nav className="tl-links" aria-label={t("timeline.links")}>
            <span className="muted">{t("timeline.links")}:</span>
            {links.map((v) => (
              <button key={v.viewId} type="button" className="event-chip link-chip" data-view-id={v.viewId} onClick={() => push({ kind: "view", id: v.viewId, mode: null, scroll: 0 })}>
                ↪ {v.label}
              </button>
            ))}
          </nav>
        )}
        {modeTabs(frame.mode, col.defaultMode, (m) => setFrame({ mode: m }))}
        <FilterBar data={data} tags={tags} filter={frame.filter} onChange={(f) => setFrame({ filter: f })} />
        {!filterIsEmpty(frame.filter) && (
          <>
            <p className="muted" data-testid="shown-count">
              {tf("timeline.shownOf", { n: shown.length, total: all.length })}
            </p>
            {!readOnly && (
              <p className="field">
                <label htmlFor={linkId}>{t("timeline.linkLabel")}</label>
                <input id={linkId} value={linkLabel} placeholder={t("timeline.linkPlaceholder")} onChange={(e) => setLinkLabel(e.target.value)} />
                <button
                  type="button"
                  disabled={!linkLabel.trim()}
                  onClick={async () => {
                    try {
                      await backend.createView(sessionId, newRequestId(), {
                        label: linkLabel.trim(),
                        parentCollectionId: col.collectionId,
                        mode: frame.mode,
                        filter: { ...frame.filter, collectionIds: [col.collectionId] },
                        stateQuery: null,
                      });
                      setMsg({ kind: "ok", text: tf("timeline.linkSaved", { label: linkLabel.trim() }) });
                      setLinkLabel("");
                      await reload();
                    } catch (e) {
                      setMsg({ kind: "error", text: errText(e) });
                    }
                  }}
                >
                  {t("timeline.saveLink")}
                </button>
              </p>
            )}
          </>
        )}
        {editorEl}
        <TimelineView data={data} events={shown} mode={frame.mode} episodeRange={frame.filter.episodeRange} onOpen={(e) => openEditor(e, null)} onAdd={readOnly ? null : (ep) => openEditor(null, ep)} />
      </section>
    );
  }

  // -- list of timelines
  const pinned = data.views.filter((v) => v.stateQuery);
  return (
    <section className="timeline">
      {stack.length > 0 && backButton}
      <Notice msg={msg} />
      {data.problems.length > 0 && (
        <p role="status" className="banner banner-warn">
          {tf("timeline.problems", { n: data.problems.length, paths: data.problems.map((p) => p.path).join(", ") })}
        </p>
      )}
      {data.collections.length === 0 ? (
        <p className="empty">{t("timeline.noTimelines")}</p>
      ) : (
        <ul className="card-list">
          {data.collections.map((c) => (
            <li key={c.collectionId}>
              <button type="button" className="card-row timeline-row" onClick={() => push({ kind: "collection", id: c.collectionId, mode: c.defaultMode, filter: EMPTY_FILTER, scroll: 0 })}>
                <strong>{c.name}</strong>
                <span className="muted">{tf("timeline.eventCount", { n: c.eventCount })}</span>
                <span className="muted">{tf("timeline.defaultMode", { mode: t(`timeline.modes.${c.defaultMode}` as MessageKey) })}</span>
                {data.views.some((v) => v.parentCollectionId === c.collectionId) && (
                  <span className="muted">{tf("timeline.linkCount", { n: data.views.filter((v) => v.parentCollectionId === c.collectionId).length })}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {pinned.length > 0 && (
        <nav className="tl-links" aria-label={t("timeline.pinnedTitle")}>
          <span className="muted">{t("timeline.pinnedTitle")}:</span>
          {pinned.map((v) => (
            <button key={v.viewId} type="button" className="event-chip link-chip" data-view-id={v.viewId} onClick={() => push({ kind: "view", id: v.viewId, mode: null, scroll: 0 })}>
              📌 {v.label}
            </button>
          ))}
        </nav>
      )}
      {!readOnly && (
        <div className="open-card">
          <h2>{t("timeline.createTitle")}</h2>
          <p className="field">
            <label htmlFor={nameId}>{t("timeline.name")}</label>
            <input id={nameId} value={newName} placeholder={t("timeline.namePlaceholder")} onChange={(e) => setNewName(e.target.value)} />
          </p>
          <p className="certainty-choice" role="radiogroup" aria-label={t("timeline.defaultModeLabel")}>
            {VIEW_MODES.map((m) => (
              <label key={m}>
                <input type="radio" name="tl-new-mode" checked={newMode === m} onChange={() => setNewMode(m)} />
                {t(`timeline.modes.${m}` as MessageKey)}
              </label>
            ))}
          </p>
          <p className="actions">
            <button type="button" className="primary" disabled={!newName.trim()} onClick={() => void create()}>
              {t("timeline.create")}
            </button>
          </p>
        </div>
      )}
      <StatePanel sessionId={sessionId} readOnly={readOnly} data={data} cards={cards} onPinned={() => void reload()} />
      <TrackManager sessionId={sessionId} readOnly={readOnly} data={data} onChanged={() => void reload()} />
    </section>
  );
}

function describeFilter(
  f: ViewFilter,
  data: TimelineData,
  tags: TagInfo[],
  t: (k: MessageKey) => string,
  tf: (k: MessageKey, v: Record<string, string | number>) => string,
): string {
  const parts: string[] = [];
  if (f.episodeRange) parts.push(tf("timeline.descEpisodes", { from: f.episodeRange.from ?? "1", to: f.episodeRange.to ?? "∞" }));
  if (f.storyRange) {
    const track = data.tracks.find((x) => x.trackId === f.storyRange!.trackId)?.label ?? "?";
    parts.push(tf("timeline.descStoryRange", { track, from: f.storyRange.from ?? "-∞", to: f.storyRange.to ?? "∞" }));
  }
  const label = (id: string) => tags.find((x) => x.tagId === id)?.label ?? id;
  if (f.includeTagIds.length) parts.push(tf("timeline.descInclude", { tags: f.includeTagIds.map(label).join(" | ") }));
  if (f.hideTagIds.length) parts.push(tf("timeline.descHide", { tags: f.hideTagIds.map(label).join(", ") }));
  return parts.length ? parts.join(" · ") : t("timeline.descAll");
}
