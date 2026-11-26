import { invoke, isTauri } from "@tauri-apps/api/core";
import { createContext, useContext } from "react";

// Mirrors src-tauri/src/workspace/search.rs and index_service.rs (11).

export type DocKind = "manuscript" | "revision" | "summary" | "note" | "card" | "event";
export const SEARCH_KINDS: DocKind[] = ["manuscript", "summary", "note", "event", "card"];

export interface SearchOptions {
  includeHistory: boolean;
  kinds: DocKind[];
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

export interface SearchResult {
  query: string;
  path: "fts" | "scan" | "none";
  hits: Hit[];
  meta: MetaHit[];
  next: number | null;
}

export interface SyncStats {
  scanned: number;
  changed: string[];
  removed: string[];
  touched: number;
  unreadable: string[];
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
  search(sessionId: string, query: string, options: SearchOptions): Promise<SearchResult>;
  status(): Promise<IndexStatus>;
  rebuild(sessionId: string): Promise<number>;
  cancel(): Promise<void>;
  nameSearch(sessionId: string, cardId: string, from: number | null, to: number | null): Promise<EpisodeHits<NameHit>[]>;
  linked(sessionId: string, cardId: string, from: number | null, to: number | null): Promise<EpisodeHits<LinkEvidence>[]>;
}

const desktop: SearchBackend = {
  search: (sessionId, query, options) => invoke("search_work", { sessionId, query, options }),
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

export const DEFAULT_OPTIONS: SearchOptions = { includeHistory: false, kinds: [], cursor: null, episodeFrom: null, episodeTo: null };
