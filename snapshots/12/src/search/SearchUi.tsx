// Search screens' shared state (12). Lives above the roots so that following a result and
// coming back keeps the query, filters, page, selected result and the list's scroll position.
//
// - Ctrl+P → quick open palette (QuickOpen.tsx); Ctrl+Shift+F → body search panel; the top-bar
//   box opens the panel too. Alt+← or ‘← 검색 결과로’ comes back after opening a result.
// - Every search gets a growing request number. Only the newest answer is shown: an older
//   request that finishes late is dropped (S12.C), and the backend stops it early.
// - Partial results while the index is still being filled (`pending` > 0) are shown as such
//   and the same search is asked again until it is complete.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { asWsError } from "../workspace/api";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { useEpisodes } from "../episodes/EpisodesProvider";
import { requestOpenCard } from "../world/api";
import { requestOpenTimeline } from "../timeline/api";
import { isCancelled, nextRequest, useSearchBackend, type DocKind, type Hit, type SearchOptions, type SearchResult } from "./api";
import { requestReveal, type RevealTarget } from "./reveal";
import type { QuickMatch } from "./quickRank";

export type Root = "episodes" | "summaries" | "timeline" | "world";

export interface Filters {
  kinds: DocKind[];
  from: string;
  to: string;
  tagIds: string[];
  history: boolean;
}
export const NO_FILTERS: Filters = { kinds: [], from: "", to: "", tagIds: [], history: false };

export const PAGE_SIZE = 20;
const PENDING_RETRY_MS = 400;

export interface PanelState {
  /** shown | hidden behind a followed result (back returns) */
  open: boolean;
  away: boolean;
  query: string;
  filters: Filters;
  result: SearchResult | null;
  page: number;
  selected: number; // index into result.hits
  scroll: number; // list scrollTop when we left
  busy: boolean;
  cancelled: boolean;
  error: string | null;
  /** Bumped to ask the panel to focus its query box. */
  focus: number;
}

const INITIAL: PanelState = { open: false, away: false, query: "", filters: NO_FILTERS, result: null, page: 0, selected: -1, scroll: 0, busy: false, cancelled: false, error: null, focus: 0 };

export interface RevisionView {
  target: RevealTarget;
  title: string;
}

interface Ctx {
  panel: PanelState;
  setPanel: (p: Partial<PanelState>) => void;
  openPanel: (query?: string) => void;
  closePanel: () => void;
  run: (query: string, filters: Filters, more?: boolean) => void;
  cancel: () => void;
  openHit: (h: Hit, scroll: number, index: number) => void;
  back: () => void;
  palette: boolean;
  setPalette: (v: boolean) => void;
  openQuick: (m: QuickMatch) => void;
  revision: RevisionView | null;
  closeRevision: () => void;
}

const SearchUiCtx = createContext<Ctx | null>(null);
export function useSearchUi(): Ctx {
  const c = useContext(SearchUiCtx);
  if (!c) throw new Error("SearchUiProvider missing");
  return c;
}

export function toOptions(f: Filters): SearchOptions {
  const n = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? null : Number(v));
  return { includeHistory: f.history, kinds: f.kinds, tagIds: f.tagIds, cursor: null, episodeFrom: n(f.from), episodeTo: n(f.to) };
}

export function SearchUiProvider({ onRoot, children }: { onRoot: (r: Root) => void; children: ReactNode }) {
  const backend = useSearchBackend();
  const ws = useWorkspace();
  const eps = useEpisodes();
  const sessionId = ws.current?.sessionId ?? null;
  const [panel, setPanelState] = useState<PanelState>(INITIAL);
  const panelRef = useRef(panel);
  panelRef.current = panel;
  const setPanel = useCallback((p: Partial<PanelState>) => setPanelState((s) => ({ ...s, ...p })), []);
  const [palette, setPalette] = useState(false);
  const [revision, setRevision] = useState<RevisionView | null>(null);
  const latest = useRef(0);
  const retry = useRef<number | null>(null);

  // A new work starts clean.
  useEffect(() => {
    latest.current = nextRequest();
    setPanelState(INITIAL);
    setRevision(null);
    setPalette(false);
  }, [sessionId]);

  const run = useCallback(
    (query: string, filters: Filters, more = false) => {
      if (retry.current !== null) window.clearTimeout(retry.current);
      retry.current = null;
      const q = query.trim();
      if (!sessionId || !q) {
        latest.current = nextRequest();
        setPanel({ busy: false, result: q ? panelRef.current.result : null, error: null });
        return;
      }
      const req = nextRequest();
      latest.current = req;
      const prev = panelRef.current.result;
      setPanel({ busy: true, cancelled: false, error: null });
      const options = { ...toOptions(filters), cursor: more ? prev?.next ?? null : null };
      void backend.search(sessionId, q, options, req).then(
        (r) => {
          if (latest.current !== req) return; // an older answer: never over the newer query
          const merged = more && prev ? { ...r, hits: [...prev.hits, ...r.hits], meta: prev.meta } : r;
          setPanel({ busy: false, result: merged, ...(more ? {} : { page: 0, selected: -1, scroll: 0 }) });
          if ((r.pending ?? 0) > 0 && !more) {
            retry.current = window.setTimeout(() => {
              if (latest.current === req) run(q, filters);
            }, PENDING_RETRY_MS);
          }
        },
        (e) => {
          if (latest.current !== req || isCancelled(e)) return;
          setPanel({ busy: false, error: asWsError(e).code });
        },
      );
    },
    [backend, sessionId, setPanel],
  );

  const cancel = useCallback(() => {
    latest.current = nextRequest();
    if (retry.current !== null) window.clearTimeout(retry.current);
    void backend.cancelSearch?.().catch(() => {});
    setPanel({ busy: false, cancelled: true });
  }, [backend, setPanel]);

  const openPanel = useCallback(
    (query?: string) => {
      setPalette(false);
      setRevision(null);
      const p = panelRef.current;
      const q = query ?? p.query;
      setPanel({ open: true, away: false, query: q, focus: Date.now() });
      if (query !== undefined && (query !== p.result?.query || !p.result)) run(query, p.filters);
    },
    [run, setPanel],
  );

  const closePanel = useCallback(() => {
    latest.current = nextRequest();
    setPanel({ open: false, away: false, busy: false });
  }, [setPanel]);

  const openHit = useCallback(
    (h: Hit, scroll: number, index: number) => {
      setPanel({ away: true, scroll, selected: index });
      if (h.kind === "card") {
        requestOpenCard(h.docId);
        return;
      }
      if (h.kind === "event") {
        onRoot("timeline");
        return;
      }
      const target: RevealTarget = { episodeId: h.episodeId ?? h.docId, revId: h.revId, offset: h.offset, matched: h.matched, before: h.before, after: h.after };
      if (h.kind === "revision") {
        setRevision({ target, title: h.title });
        return;
      }
      setRevision(null);
      if (h.kind === "manuscript") requestReveal(target);
      if (h.episodeId) void eps.select(h.episodeId);
      onRoot(h.kind === "manuscript" ? "episodes" : "summaries");
    },
    [eps, onRoot, setPanel],
  );

  const back = useCallback(() => {
    if (!panelRef.current.away) return;
    setRevision(null);
    setPanel({ away: false, open: true });
  }, [setPanel]);

  const openQuick = useCallback(
    (m: QuickMatch) => {
      setPalette(false);
      setRevision(null);
      const it = m.item;
      if (it.kind === "episode") {
        void eps.select(it.id);
        onRoot("episodes");
      } else if (it.kind === "card") requestOpenCard(it.id);
      else {
        requestOpenTimeline({ kind: it.kind === "view" ? "view" : "collection", id: it.id });
        onRoot("timeline");
      }
    },
    [eps, onRoot],
  );

  const value = useMemo<Ctx>(
    () => ({ panel, setPanel, openPanel, closePanel, run, cancel, openHit, back, palette, setPalette, openQuick, revision, closeRevision: () => setRevision(null) }),
    [panel, setPanel, openPanel, closePanel, run, cancel, openHit, back, palette, openQuick, revision],
  );
  return <SearchUiCtx.Provider value={value}>{children}</SearchUiCtx.Provider>;
}
