// Body search (11, screens 12 · Ctrl+Shift+F): manuscripts, summaries, notes, events and cards
// from the search index; titles / aliases / episode numbers as separate exact matches; committed
// revisions only when asked. Filters: kinds, episode range, tags, history. Results come a page
// at a time; each shows kind, episode / revision, the sentence before and after and the match.
// Keyboard: ↓ from the query box into the results, ↑/↓ between them, Enter opens (never while
// an IME is composing), Esc goes back to the query box / closes. The state lives in SearchUi so
// following a result and coming back (Alt+←) keeps query, filters, page, selection and scroll.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n/messages";
import { asWsError } from "../workspace/api";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { useWorldBackend, type TagInfo } from "../world/api";
import { SEARCH_KINDS, useSearchBackend, type DocKind, type Hit, type IndexStatus, type MetaHit } from "./api";
import { requestOpenCard } from "../world/api";
import { PAGE_SIZE, useSearchUi, type Filters } from "./SearchUi";

const TYPE_DELAY_MS = 150;

/** True while an IME is composing: Enter then commits the syllable, it must not open a result. */
export function composingKey(e: KeyboardEvent): boolean {
  return e.nativeEvent.isComposing || e.keyCode === 229;
}

export function SearchPanel({ onNavigate }: { onNavigate: (root: "episodes" | "summaries" | "timeline" | "world") => void }) {
  const { t, tf } = useI18n();
  const backend = useSearchBackend();
  const world = useWorldBackend();
  const ui = useSearchUi();
  const p = ui.panel;
  const ws = useWorkspace();
  const sessionId = ws.current?.sessionId ?? null;
  const ids = { q: useId(), from: useId(), to: useId() };
  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [rebuildError, setRebuildError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const list = useRef<HTMLUListElement | null>(null);
  const typing = useRef<number | null>(null);

  const refreshStatus = async () => {
    try {
      setStatus(await backend.status());
    } catch {
      /* status is informational */
    }
  };

  useEffect(() => {
    if (!sessionId) return;
    void world
      .listTags(sessionId)
      .then(setTags)
      .catch(() => setTags([]));
  }, [world, sessionId]);

  // Coming back from a result: list scroll and the selected result's focus as they were.
  useEffect(() => {
    if (list.current) list.current.scrollTop = p.scroll;
    if (p.selected >= 0) {
      const b = list.current?.querySelector<HTMLButtonElement>(`[data-index="${p.selected}"]`);
      b?.focus({ preventScroll: true });
    } else input.current?.focus();
    void refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ctrl+Shift+F while the panel is already up: back to the query box (not on mount, where the
  // restored selection keeps the focus).
  const seenFocus = useRef(p.focus);
  useEffect(() => {
    if (p.focus && p.focus !== seenFocus.current) {
      input.current?.focus();
      input.current?.select();
    }
    seenFocus.current = p.focus;
  }, [p.focus]);

  useEffect(() => {
    void refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.result]);

  // While a rebuild runs, poll its state.
  useEffect(() => {
    if (status?.state !== "rebuilding") return;
    const h = window.setInterval(() => void refreshStatus(), 700);
    return () => window.clearInterval(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.state]);

  useEffect(() => () => void (typing.current !== null && window.clearTimeout(typing.current)), []);

  const setQuery = (q: string) => {
    ui.setPanel({ query: q });
    if (typing.current !== null) window.clearTimeout(typing.current);
    typing.current = window.setTimeout(() => ui.run(q, p.filters), TYPE_DELAY_MS);
  };
  const setFilters = (f: Partial<Filters>) => {
    const next = { ...p.filters, ...f };
    ui.setPanel({ filters: next });
    ui.run(p.query, next);
  };
  const toggleKind = (k: DocKind) => setFilters({ kinds: p.filters.kinds.includes(k) ? p.filters.kinds.filter((x) => x !== k) : [...p.filters.kinds, k] });
  const toggleTag = (id: string) => setFilters({ tagIds: p.filters.tagIds.includes(id) ? p.filters.tagIds.filter((x) => x !== id) : [...p.filters.tagIds, id] });

  const r = p.result;
  const hits = r?.hits ?? [];
  const pages = Math.max(1, Math.ceil(hits.length / PAGE_SIZE));
  const page = Math.min(p.page, pages - 1);
  const shown = hits.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const focusResult = (i: number) => {
    const clamped = Math.max(0, Math.min(hits.length - 1, i));
    const pg = Math.floor(clamped / PAGE_SIZE);
    ui.setPanel({ selected: clamped, page: pg });
    window.setTimeout(() => list.current?.querySelector<HTMLButtonElement>(`[data-index="${clamped}"]`)?.focus(), 0);
  };
  const openHit = (h: Hit, i: number) => {
    ui.openHit(h, list.current?.scrollTop ?? 0, i);
  };
  const openMeta = (m: MetaHit) => {
    if (m.kind === "card") requestOpenCard(m.docId);
    else if (m.kind === "event") onNavigate("timeline");
    else
      ui.openHit(
        { docKey: m.docKey, kind: m.kind, docId: m.docId, revId: null, episodeId: m.kind === "manuscript" ? m.docId : null, episodeNumber: null, title: m.title, para: 0, offset: 0, length: 0, before: "", matched: "", after: "", history: false },
        list.current?.scrollTop ?? 0,
        p.selected,
      );
    ui.setPanel({ away: true });
  };

  const onQueryKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (composingKey(e)) return; // the IME owns this key
    if (e.key === "ArrowDown" && hits.length) {
      e.preventDefault();
      focusResult(p.selected >= 0 ? p.selected : page * PAGE_SIZE);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (typing.current !== null) window.clearTimeout(typing.current);
      ui.run(p.query, p.filters);
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (p.busy) ui.cancel();
      else ui.closePanel();
    }
  };
  const onResultKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (composingKey(e)) return;
    if (e.key === "Enter") {
      e.preventDefault(); // opened here, not by the button's default click (no double open)
      openHit(hits[i], i);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      focusResult(i + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (i === 0) input.current?.focus();
      else focusResult(i - 1);
    } else if (e.key === "PageDown") {
      e.preventDefault();
      focusResult(Math.min(hits.length - 1, (page + 1) * PAGE_SIZE));
    } else if (e.key === "PageUp") {
      e.preventDefault();
      focusResult(Math.max(0, (page - 1) * PAGE_SIZE));
    } else if (e.key === "Escape") {
      e.preventDefault();
      input.current?.focus();
    }
  };

  const kindLabel = (k: DocKind) => t(`search.kinds.${k}` as MessageKey);

  return (
    <section className="open-card search-panel" aria-label={t("search.title")}>
      <div className="search-head">
        <h2>{t("search.title")}</h2>
        <span className="muted">{t("search.keys")}</span>
        <button type="button" className="link" onClick={ui.closePanel}>
          {t("search.close")}
        </button>
      </div>
      <div className="world-filters search-filters">
        <p className="field">
          <label htmlFor={ids.q}>{t("search.query")}</label>
          <input ref={input} id={ids.q} type="search" value={p.query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onQueryKey} autoComplete="off" />
        </p>
        <fieldset className="search-kinds">
          <legend>{t("search.kind")}</legend>
          {SEARCH_KINDS.map((k) => (
            <label key={k} className="tag-check">
              <input type="checkbox" checked={p.filters.kinds.includes(k)} onChange={() => toggleKind(k)} />
              {kindLabel(k)}
            </label>
          ))}
          <span className="muted">{p.filters.kinds.length === 0 ? t("search.allKinds") : ""}</span>
        </fieldset>
        <p className="field narrow">
          <label htmlFor={ids.from}>{t("search.from")}</label>
          <input id={ids.from} type="number" min={1} value={p.filters.from} onChange={(e) => setFilters({ from: e.target.value })} />
        </p>
        <p className="field narrow">
          <label htmlFor={ids.to}>{t("search.to")}</label>
          <input id={ids.to} type="number" min={1} value={p.filters.to} onChange={(e) => setFilters({ to: e.target.value })} />
        </p>
        {tags.length > 0 && (
          <fieldset className="search-tags">
            <legend>{t("search.tags")}</legend>
            {tags.map((g) => (
              <label key={g.tagId} className="tag-check">
                <input type="checkbox" checked={p.filters.tagIds.includes(g.tagId)} onChange={() => toggleTag(g.tagId)} />
                {g.label}
              </label>
            ))}
          </fieldset>
        )}
        <label className="tag-check">
          <input type="checkbox" checked={p.filters.history} onChange={(e) => setFilters({ history: e.target.checked })} />
          {t("search.includeHistory")}
        </label>
        {p.busy ? (
          <button type="button" onClick={ui.cancel} data-testid="search-cancel">
            {t("search.cancel")}
          </button>
        ) : (
          <button type="button" className="primary" disabled={!p.query.trim()} onClick={() => ui.run(p.query, p.filters)}>
            {t("search.run")}
          </button>
        )}
      </div>
      <p className="muted">{t("search.rules")}</p>
      {p.busy && (
        <p role="status" className="muted" data-testid="search-busy">
          {t("search.busy")}
        </p>
      )}
      {p.cancelled && !p.busy && (
        <p role="status" className="muted" data-testid="search-cancelled">
          {t("search.cancelled")}
        </p>
      )}
      {p.error && (
        <p role="alert" className="notice notice-error">
          {t(`errors.${p.error}` as MessageKey)}
        </p>
      )}
      {r?.reopened && (r.reopened === "replacedDamaged" || r.reopened === "replacedVersion") && (
        <p role="status" className="banner banner-warn" data-testid="search-reopened">
          {t(`search.reopened.${r.reopened}` as MessageKey)}
        </p>
      )}
      {r && (r.pending ?? 0) > 0 && (
        <p role="status" className="banner banner-warn" data-testid="search-partial">
          {tf("search.partial", { n: r.pending ?? 0 })}
        </p>
      )}
      {r?.rebuilding && (
        <p role="status" className="banner" data-testid="search-rebuilding">
          {t("search.rebuildingResults")}
        </p>
      )}
      {r && (
        <>
          {r.meta.length > 0 && (
            <div className="search-meta">
              <h3>{t("search.metaTitle")}</h3>
              <ul className="card-list">
                {r.meta.map((m: MetaHit) => (
                  <li key={`${m.docKey}-${m.by}`}>
                    <button type="button" className="card-row" data-testid="meta-hit" onClick={() => openMeta(m)}>
                      <strong>{m.title}</strong>
                      <span className="muted">{kindLabel(m.kind)}</span>
                      <span className="tag-chip">{tf(`search.by.${m.by}` as MessageKey, { value: m.value })}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <h3>
            {tf("search.bodyTitle", { n: hits.length })}
            {r.next != null ? "+" : ""}
          </h3>
          <p className="muted" data-testid="search-path">
            {t(`search.path.${r.path}` as MessageKey)}
            {r.elapsedMs != null && ` · ${tf("search.elapsed", { ms: r.elapsedMs })}`}
          </p>
          {hits.length === 0 && r.next == null ? (
            <div className="empty" data-testid="search-none">
              <p>{tf("search.noneFor", { q: r.query })}</p>
              <p className="muted">{p.filters.history ? t("search.noneHint") : t("search.noneHintHistory")}</p>
            </div>
          ) : (
            <ul className="card-list search-results" ref={list} data-testid="search-results">
              {shown.map((h: Hit, j) => {
                const i = page * PAGE_SIZE + j;
                return (
                  <li key={`${h.docKey}-${h.offset}-${i}`}>
                    <button
                      type="button"
                      className="card-row search-hit"
                      data-index={i}
                      data-kind={h.kind}
                      data-episode={h.episodeNumber ?? ""}
                      aria-current={p.selected === i ? "true" : undefined}
                      onFocus={() => p.selected !== i && ui.setPanel({ selected: i })}
                      onKeyDown={(e) => onResultKey(e, i)}
                      onClick={() => openHit(h, i)}
                    >
                      <span className="search-hit-head">
                        <span className="tag-chip">{kindLabel(h.kind)}</span>
                        <strong>{h.title}</strong>
                        {h.history && <span className="certainty">{t("search.historyBadge")}</span>}
                      </span>
                      <span className="snippet">
                        {h.before}
                        <mark>{h.matched}</mark>
                        {h.after}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {hits.length > PAGE_SIZE && (
            <p className="actions pager" data-testid="search-pager">
              <button type="button" disabled={page === 0} onClick={() => ui.setPanel({ page: page - 1, selected: -1 })}>
                {t("search.prevPage")}
              </button>
              <span className="muted">{tf("search.pageOf", { from: page * PAGE_SIZE + 1, to: Math.min(hits.length, (page + 1) * PAGE_SIZE), n: hits.length })}</span>
              <button type="button" disabled={page >= pages - 1} onClick={() => ui.setPanel({ page: page + 1, selected: -1 })}>
                {t("search.nextPage")}
              </button>
            </p>
          )}
          {r.next != null && (
            <p className="actions">
              <span className="muted">{t("search.moreHint")}</span>
              <button type="button" disabled={p.busy} onClick={() => ui.run(r.query, p.filters, true)}>
                {t("search.more")}
              </button>
            </p>
          )}
        </>
      )}
      <div className="index-status" data-testid="index-status">
        <span className="muted">
          {status
            ? tf(`search.status.${status.state}` as MessageKey, { docs: status.docs, changed: status.last?.changed.length ?? 0, gen: status.generation })
            : t("manuscript.loading")}
        </span>
        {status && !status.fts5 && <span className="notice notice-error">{t("search.noFts5")}</span>}
        {status?.last && status.last.unreadable.length > 0 && <span className="muted">{tf("search.unreadable", { n: status.last.unreadable.length })}</span>}
        {status?.state === "rebuilding" ? (
          <button type="button" onClick={() => void backend.cancel().then(refreshStatus)}>
            {t("search.cancelRebuild")}
          </button>
        ) : (
          <button
            type="button"
            disabled={!sessionId}
            onClick={async () => {
              if (!sessionId) return;
              setRebuildError(null);
              try {
                await backend.rebuild(sessionId);
              } catch (e) {
                setRebuildError(t(`errors.${asWsError(e).code}` as MessageKey));
              }
              void refreshStatus();
            }}
          >
            {t("search.rebuild")}
          </button>
        )}
        {rebuildError && <span className="notice notice-error">{rebuildError}</span>}
        {status?.path && (
          <span className="muted mono" title={status.path}>
            {t("search.cacheHint")}
          </span>
        )}
      </div>
    </section>
  );
}
