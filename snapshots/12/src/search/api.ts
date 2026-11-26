import { invoke, isTauri } from "@tauri-apps/api/core";
import { createContext, useContext } from "react";

// Mirrors src-tauri/src/workspace/search.rs, quick.rs and index_service.rs (11, 12).

export type DocKind = "manuscript" | "revision" | "summary" | "note" | "card" | "event";
export const SEARCH_KINDS: DocKind[] = ["manuscript", "summary", "note", "event", "card"];

export interface SearchOptions {
  includeHistory: boolean;
  kinds: DocKind[];
  /** Cards / events carrying any of these tags (12). Empty = no tag filter. */
  tagIds: string[];
  cursor: number | null;
  episodeFrom: number | null;
  episodeTo: number | null;
}

export interface Hit {
  docKey: string;
  kind: DocKind;
  docId: string;
  revId: string | null;
  episodeId: string | null;
  episodeNumber: number | null;
  title: string;
  para: number;
  offset: number;
  length: number;
  before: string;
  matched: string;
  after: string;
  history: boolean;
}

export interface MetaHit {
  docKey: string;
  kind: DocKind;
  docId: string;
  title: string;
  by: "title" | "alias" | "number";
  value: string;
}

export type OpenHow = "existing" | "new" | "replacedDamaged" | "replacedVersion";

export interface SearchResult {
  query: string;
  path: "fts" | "scan" | "none";
  hits: Hit[];
  meta: MetaHit[];
  next: number | null;
  /** 12: time spent in the index; the request number it answers; documents still waiting to be
   * indexed (partial results while > 0); a background rebuild; a cache replaced on open. */
  elapsedMs?: number;
  request?: number;
  pending?: number;
  rebuilding?: boolean;
  reopened?: OpenHow | null;
}

/** Ctrl+P candidates (12, quick.rs). */
export type QuickKind = "episode" | "card" | "view" | "timeline";
export interface QuickItem {
  kind: QuickKind;
  id: string;
  title: string;
  aliases: string[];
  number: number | null;
  detail: string | null;
  path: string;
}

export interface SyncStats {
  scanned: number;
  changed: string[];
  removed: string[];
  touched: number;
  unreadable: string[];
  pending?: number;
}

export interface IndexStatus {
  state: "idle" | "ready" | "rebuilding" | "error";
  generation: number;
  docs: number;
  fts5: boolean;
  path: string;
  last: SyncStats | null;
  lastRebuild: SyncStats | null;
  error: string | null;
  opened?: OpenHow | null;
}

export interface NameHit {
  name: string;
  offset: number;
  before: string;
  after: string;
}

export interface LinkEvidence {
  kind: "event";
  id: string;
  title: string;
}

export interface EpisodeHits<T> {
  episodeId: string;
  number: number;
  hits: T[];
}

export interface SearchBackend {
  /** `request` grows with every call; a newer one cancels the older (12). */
  search(sessionId: string, query: string, options: SearchOptions, request?: number): Promise<SearchResult>;
  cancelSearch?(): Promise<void>;
  quickItems?(sessionId: string): Promise<QuickItem[]>;
  status(): Promise<IndexStatus>;
  rebuild(sessionId: string): Promise<number>;
  cancel(): Promise<void>;
  nameSearch(sessionId: string, cardId: string, from: number | null, to: number | null): Promise<EpisodeHits<NameHit>[]>;
  linked(sessionId: string, cardId: string, from: number | null, to: number | null): Promise<EpisodeHits<LinkEvidence>[]>;
}

const desktop: SearchBackend = {
  search: (sessionId, query, options, request) => invoke("search_work", { sessionId, query, options, request: request ?? null }),
  cancelSearch: () => invoke("search_cancel"),
  quickItems: (sessionId) => invoke("quick_open_items", { sessionId }),
  status: () => invoke("index_status"),
  rebuild: (sessionId) => invoke("index_rebuild", { sessionId }),
  cancel: () => invoke("index_cancel"),
  nameSearch: (sessionId, cardId, from, to) => invoke("card_name_search", { sessionId, cardId, from, to }),
  linked: (sessionId, cardId, from, to) => invoke("card_linked_episodes", { sessionId, cardId, from, to }),
};

const unsupported = async (): Promise<never> => {
  throw { code: "unsupported" };
};

export const browserSearchBackend: SearchBackend = {
  search: unsupported,
  status: async () => ({ state: "idle", generation: 0, docs: 0, fts5: false, path: "", last: null, lastRebuild: null, error: null }),
  rebuild: unsupported,
  cancel: async () => {},
  nameSearch: unsupported,
  linked: unsupported,
};

export function defaultSearchBackend(): SearchBackend {
  return isTauri() ? desktop : browserSearchBackend;
}

export const SearchBackendCtx = createContext<SearchBackend>(browserSearchBackend);
export const useSearchBackend = () => useContext(SearchBackendCtx);

export const DEFAULT_OPTIONS: SearchOptions = { includeHistory: false, kinds: [], tagIds: [], cursor: null, episodeFrom: null, episodeTo: null };

/** Error code of a search replaced by a newer one (Rust `search::cancelled`): not shown. */
export function isCancelled(e: unknown): boolean {
  const x = e as { code?: string; kind?: string } | null;
  return !!x && x.code === "io" && x.kind === "Cancelled";
}

let lastRequest = 0;
/** Request numbers that keep growing even across a page reload (the backend keeps the max). */
export function nextRequest(): number {
  lastRequest = Math.max(lastRequest + 1, Date.now() * 1000);
  return lastRequest;
}
