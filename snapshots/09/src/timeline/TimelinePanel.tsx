// "타임라인" root (09): several named timelines sharing events; three views of one timeline
// (episode rows / in-story tracks / both coordinates side by side); an event editor that keeps
// the typed values when a coordinate is missing (S09.B); per-event review against the episode's
// newest commit, independent of the summary review (CH1); track names and certainty (CH2).
import { Fragment, useCallback, useEffect, useId, useMemo, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n/messages";
import { useEpisodes } from "../episodes/EpisodesProvider";
import { asWsError, newRequestId } from "../workspace/api";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { useWorldBackend, type CardInfo, type TagInfo } from "../world/api";
import {
  CERTAINTIES,
  VIEW_MODES,
  byEpisode,
  byStory,
  draftProblem,
  hasStory,
  useTimelineBackend,
  type Certainty,
  type Collection,
  type EventDraft,
  type EventInfo,
  type StoryTrack,
  type TimelineData,
  type ViewMode,
} from "./api";

const EMPTY: TimelineData = { collections: [], events: [], tracks: [], tracksHash: "", problems: [] };
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

// ---------------------------------------------------------------- editor

function toDraft(e: EventInfo): EventDraft {
  return {
    collectionIds: [...e.collectionIds],
    title: e.title,
    detail: e.detail,
    tagIds: [...e.tagIds],
    relatedCardIds: [...e.relatedCardIds],
    episodeId: e.episodeId ?? null,
    episodeOrder: e.episodeOrder ?? null,
    storyCertainty: e.certainty,
    storyTrackId: e.storyTrackId ?? null,
    storyOrder: e.storyOrder ?? null,
    storyLabel: e.storyLabel ?? null,
  };
}

const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

function EventEditor({ sessionId, readOnly, data, editing, initial, cards, tags, onSaved, onClose }: {
  sessionId: string;
  readOnly: boolean;
  data: TimelineData;
  editing: EventInfo | null;
  initial: EventDraft;
  cards: CardInfo[];
  tags: TagInfo[];
  onSaved: (e: EventInfo) => void;
  onClose: () => void;
}) {
  const { t, tf } = useI18n();
  const backend = useTimelineBackend();
  const eps = useEpisodes();
  const errText = useErrorText();
  const ids = { title: useId(), detail: useId(), ep: useId(), epOrder: useId(), track: useId(), order: useId(), label: useId() };
  const [d, setD] = useState<EventDraft>(initial);
  const [epOrderText, setEpOrderText] = useState(initial.episodeOrder?.toString() ?? "");
  const [orderText, setOrderText] = useState(initial.storyOrder?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [requestId] = useState(newRequestId); // one create intent per open editor
  const current = editing ? data.events.find((x) => x.eventId === editing.eventId) ?? editing : null;

  const set = (patch: Partial<EventDraft>) => setD((x) => ({ ...x, ...patch }));
  const toggle = (key: "collectionIds" | "tagIds" | "relatedCardIds", id: string) =>
    setD((x) => ({ ...x, [key]: x[key].includes(id) ? x[key].filter((y) => y !== id) : [...x[key], id] }));

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

  const story = d.storyCertainty !== "unknown";
  return (
    <section className="open-card event-editor" aria-label={current ? tf("timeline.editLabel", { title: current.title }) : t("timeline.newEvent")}>
      <h2>{current ? current.title : t("timeline.newEvent")}</h2>
      {current && (
        <p className="muted">
          ID <span className="mono" data-testid="event-id">{current.eventId}</span>
        </p>
      )}
      {msg && (
        <p role={msg.kind === "error" ? "alert" : "status"} className={msg.kind === "error" ? "notice notice-error" : "banner"}>
          {msg.text}
        </p>
      )}
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
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- views

type BothSort = "episode" | "story";
type BothFilter = "all" | "noEpisode" | "noStory" | "both";

function TimelineView({ data, col, mode, onOpen, onAdd }: {
  data: TimelineData;
  col: Collection;
  mode: ViewMode;
  onOpen: (e: EventInfo) => void;
  onAdd: (episodeId: string | null) => void;
}) {
  const { t, tf } = useI18n();
  const eps = useEpisodes();
  const coords = useCoords(data.tracks);
  const sortId = useId();
  const filterId = useId();
  const [sort, setSort] = useState<BothSort>("episode");
  const [filter, setFilter] = useState<BothFilter>("all");
  const events = useMemo(() => data.events.filter((e) => e.collectionIds.includes(col.collectionId)), [col.collectionId, data.events]);

  if (mode === "episode") {
    const unplaced = events.filter((e) => e.episodeNumber == null).sort(byEpisode);
    return (
      <div className="tl-episode">
        <ul className="tl-rows">
          {[...eps.list.episodes]
            .sort((a, b) => a.number - b.number)
            .map((ep) => {
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
                  <button type="button" className="link" onClick={() => onAdd(ep.episodeId)}>
                    {t("timeline.addEventHere")}
                  </button>
                </li>
              );
            })}
        </ul>
        <h3>{t("timeline.noEpisodeSection")}</h3>
        <p className="tl-row-events" data-testid="unplaced-episode">
          {unplaced.length === 0 ? <span className="muted">{t("timeline.none")}</span> : unplaced.map((e) => <EventChip key={e.eventId} e={e} onOpen={onOpen} />)}
        </p>
      </div>
    );
  }

  if (mode === "story") {
    const unknown = events.filter((e) => !hasStory(e)).sort(byEpisode);
    return (
      <div className="tl-story">
        <p className="actions">
          <button type="button" onClick={() => onAdd(null)}>
            {t("timeline.addEvent")}
          </button>
        </p>
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
        <p className="actions">
          <button type="button" onClick={() => onAdd(null)}>
            {t("timeline.addEvent")}
          </button>
        </p>
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
      {msg && (
        <p role={msg.kind === "error" ? "alert" : "status"} className={msg.kind === "error" ? "notice notice-error" : "banner"}>
          {msg.text}
        </p>
      )}
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
  const [data, setData] = useState<TimelineData>(EMPTY);
  const [cards, setCards] = useState<CardInfo[]>([]);
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>("episode");
  const [editor, setEditor] = useState<{ key: number; editing: EventInfo | null; initial: EventDraft } | null>(null);
  const [newName, setNewName] = useState("");
  const [newMode, setNewMode] = useState<ViewMode>("episode");
  const [rename, setRename] = useState<string | null>(null);
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
    setOpenId(null);
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

  const col = data.collections.find((c) => c.collectionId === openId) ?? null;

  if (!sessionId) return null;

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    setMsg(null);
    try {
      const c = await backend.createTimeline(sessionId, newRequestId(), name, newMode);
      setNewName("");
      await reload();
      setOpenId(c.collectionId);
      setMode(c.defaultMode);
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
          episodeId,
          episodeOrder: null,
          storyCertainty: "unknown",
          storyTrackId: data.tracks[0]?.trackId ?? null,
          storyOrder: null,
          storyLabel: null,
        };
    setEditor({ key: Date.now(), editing, initial });
  };

  const message = msg && (
    <p role={msg.kind === "error" ? "alert" : "status"} className={msg.kind === "error" ? "notice notice-error" : "banner"}>
      {msg.text}
    </p>
  );

  if (col) {
    return (
      <section className="timeline">
        <p>
          <button
            type="button"
            className="link"
            onClick={() => {
              setOpenId(null);
              setEditor(null);
              void reload();
            }}
          >
            {t("timeline.back")}
          </button>
        </p>
        {message}
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
                <button type="button" className="link" onClick={() => setRename(col.name)}>
                  {t("timeline.rename")}
                </button>
              )}
            </>
          )}
        </h2>
        <div className="mode-tabs" role="tablist" aria-label={t("timeline.modeLabel")}>
          {VIEW_MODES.map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? "tab active" : "tab"} onClick={() => setMode(m)}>
              {t(`timeline.modes.${m}` as MessageKey)}
              {col.defaultMode === m && <span className="muted"> · {t("timeline.default")}</span>}
            </button>
          ))}
        </div>
        {editor && (
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
            onClose={() => setEditor(null)}
          />
        )}
        <TimelineView data={data} col={col} mode={mode} onOpen={(e) => openEditor(e, null)} onAdd={(ep) => openEditor(null, ep)} />
      </section>
    );
  }

  return (
    <section className="timeline">
      {message}
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
              <button
                type="button"
                className="card-row timeline-row"
                onClick={() => {
                  setOpenId(c.collectionId);
                  setMode(c.defaultMode);
                  setEditor(null);
                }}
              >
                <strong>{c.name}</strong>
                <span className="muted">{tf("timeline.eventCount", { n: c.eventCount })}</span>
                <span className="muted">{tf("timeline.defaultMode", { mode: t(`timeline.modes.${c.defaultMode}` as MessageKey) })}</span>
              </button>
            </li>
          ))}
        </ul>
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
              <Fragment key={m}>
                <label>
                  <input type="radio" name="tl-new-mode" checked={newMode === m} onChange={() => setNewMode(m)} />
                  {t(`timeline.modes.${m}` as MessageKey)}
                </label>
              </Fragment>
            ))}
          </p>
          <p className="actions">
            <button type="button" className="primary" disabled={!newName.trim()} onClick={() => void create()}>
              {t("timeline.create")}
            </button>
          </p>
        </div>
      )}
      <TrackManager sessionId={sessionId} readOnly={readOnly} data={data} onChanged={() => void reload()} />
    </section>
  );
}
