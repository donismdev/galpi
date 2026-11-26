// Work search (11): body text of manuscripts, summaries, notes, events and cards from the
// search index; titles / aliases / episode numbers as separate exact matches; committed
// revisions only when asked. The index is a cache outside the work and can be rebuilt.
import { useCallback, useEffect, useId, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n/messages";
import { useEpisodes } from "../episodes/EpisodesProvider";
import { asWsError } from "../workspace/api";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { requestOpenCard } from "../world/api";
import { DEFAULT_OPTIONS, SEARCH_KINDS, useSearchBackend, type DocKind, type Hit, type IndexStatus, type MetaHit, type SearchResult } from "./api";

type Root = "episodes" | "summaries" | "timeline" | "world";

export function SearchPanel({ initialQuery, onClose, onNavigate }: { initialQuery: string; onClose: () => void; onNavigate: (root: Root) => void }) {
  const { t, tf } = useI18n();
  const backend = useSearchBackend();
  const ws = useWorkspace();
  const eps = useEpisodes();
  const sessionId = ws.current?.sessionId ?? null;
  const ids = { q: useId(), kind: useId() };
  const [query, setQuery] = useState(initialQuery);
  const [history, setHistory] = useState(false);
  const [kind, setKind] = useState<DocKind | "">("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<IndexStatus | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await backend.status());
    } catch {
      /* status is informational */
    }
  }, [backend]);

  const run = useCallback(
    async (q: string, more = false) => {
      if (!sessionId || !q.trim()) return;
      setBusy(true);
      setError(null);
      try {
        const r = await backend.search(sessionId, q, {
          ...DEFAULT_OPTIONS,
          includeHistory: history,
          kinds: kind ? [kind] : [],
          cursor: more ? result?.next ?? null : null,
        });
        setResult((prev) => (more && prev ? { ...r, hits: [...prev.hits, ...r.hits], meta: prev.meta } : r));
      } catch (e) {
        setError(t(`errors.${asWsError(e).code}` as MessageKey));
      } finally {
        setBusy(false);
        void refreshStatus();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [backend, sessionId, history, kind, result?.next, refreshStatus],
  );

  useEffect(() => {
    setQuery(initialQuery);
    void run(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery, history, kind]);

  // While a rebuild runs, poll its state.
  useEffect(() => {
    void refreshStatus();
    if (status?.state !== "rebuilding") return;
    const h = window.setInterval(() => void refreshStatus(), 700);
    return () => window.clearInterval(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.state]);

  const open = async (kind: DocKind, docId: string, episodeId: string | null) => {
    if (kind === "card") {
      requestOpenCard(docId);
      return;
    }
    if (kind === "event") {
      onNavigate("timeline");
      return;
    }
    if (episodeId) await eps.select(episodeId);
    onNavigate(kind === "summary" || kind === "note" ? "summaries" : "episodes");
  };

  const kindLabel = (k: DocKind) => t(`search.kinds.${k}` as MessageKey);

  return (
    <section className="open-card search-panel" aria-label={t("search.title")}>
      <div className="search-head">
        <h2>{t("search.title")}</h2>
        <button type="button" className="link" onClick={onClose}>
          {t("search.close")}
        </button>
      </div>
      <form
        className="world-filters"
        onSubmit={(e) => {
          e.preventDefault();
          void run(query);
        }}
      >
        <p className="field">
          <label htmlFor={ids.q}>{t("search.query")}</label>
          <input id={ids.q} type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </p>
        <p className="field">
          <label htmlFor={ids.kind}>{t("search.kind")}</label>
          <select id={ids.kind} value={kind} onChange={(e) => setKind(e.target.value as DocKind | "")}>
            <option value="">{t("search.allKinds")}</option>
            {SEARCH_KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </select>
        </p>
        <label className="tag-check">
          <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} />
          {t("search.includeHistory")}
        </label>
        <button type="submit" className="primary" disabled={busy || !query.trim()}>
          {t("search.run")}
        </button>
      </form>
      <p className="muted">{t("search.rules")}</p>
      {error && (
        <p role="alert" className="notice notice-error">
          {error}
        </p>
      )}
      {result && (
        <>
          {result.meta.length > 0 && (
            <div className="search-meta">
              <h3>{t("search.metaTitle")}</h3>
              <ul className="card-list">
                {result.meta.map((m: MetaHit) => (
                  <li key={`${m.docKey}-${m.by}`}>
                    <button type="button" className="card-row" data-testid="meta-hit" onClick={() => void open(m.kind, m.docId, m.kind === "manuscript" ? m.docId : null)}>
                      <strong>{m.title}</strong>
                      <span className="muted">{kindLabel(m.kind)}</span>
                      <span className="tag-chip">{tf(`search.by.${m.by}` as MessageKey, { value: m.value })}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <h3>{tf("search.bodyTitle", { n: result.hits.length })}</h3>
          <p className="muted" data-testid="search-path">
            {t(`search.path.${result.path}` as MessageKey)}
          </p>
          {result.hits.length === 0 && !result.next ? (
            <p className="empty">{t("search.none")}</p>
          ) : (
            <ul className="card-list">
              {result.hits.map((h: Hit, i) => (
                <li key={`${h.docKey}-${h.offset}-${i}`}>
                  <button type="button" className="card-row search-hit" data-kind={h.kind} data-episode={h.episodeNumber ?? ""} onClick={() => void open(h.kind, h.docId, h.episodeId)}>
                    <strong>{h.title}</strong>
                    <span className="muted">{kindLabel(h.kind)}</span>
                    {h.history && <span className="certainty">{t("search.historyBadge")}</span>}
                    <span className="snippet">
                      {h.before}
                      <mark>{h.matched}</mark>
                      {h.after}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {result.next != null && (
            <p className="actions">
              <span className="muted">{t("search.moreHint")}</span>
              <button type="button" disabled={busy} onClick={() => void run(result.query, true)}>
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
              try {
                await backend.rebuild(sessionId);
              } catch (e) {
                setError(t(`errors.${asWsError(e).code}` as MessageKey));
              }
              void refreshStatus();
            }}
          >
            {t("search.rebuild")}
          </button>
        )}
        {status?.path && (
          <span className="muted mono" title={status.path}>
            {t("search.cacheHint")}
          </span>
        )}
      </div>
    </section>
  );
}
