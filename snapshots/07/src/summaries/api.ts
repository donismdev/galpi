import { invoke, isTauri } from "@tauri-apps/api/core";
import { createContext, useContext } from "react";

// Mirrors src-tauri/src/workspace/summaries.rs.

export type ReviewState = "unwritten" | "noRevision" | "unreviewed" | "reviewed" | "recheck";

export interface SummaryStatus {
  episodeId: string;
  number: number;
  title: string;
  firstLine: string;
  state: ReviewState;
  reviewedRevisionId: string | null;
  reviewedOrdinal: number | null;
  reviewedAt: string | null;
  latestRevisionId: string | null;
  latestOrdinal: number | null;
  uncommittedEdits: boolean;
  summaryEditedSinceReview: boolean;
  hasNote: boolean;
}

export interface TextFile {
  text: string;
  hash: string | null;
}

export interface SummaryDoc {
  summary: TextFile;
  note: TextFile;
  metaHash: string | null;
  status: SummaryStatus;
}

export type TextKind = "summary" | "note";

export interface SaveSummaryRequest {
  sessionId: string;
  requestId: string;
  episodeId: string;
  kind: TextKind;
  text: string;
  expectedHash: string | null;
}

export interface SummaryBackend {
  list(sessionId: string): Promise<SummaryStatus[]>;
  read(sessionId: string, episodeId: string): Promise<SummaryDoc>;
  save(req: SaveSummaryRequest): Promise<SummaryDoc>;
  confirm(sessionId: string, requestId: string, episodeId: string, revisionId: string): Promise<SummaryDoc>;
}

const desktop: SummaryBackend = {
  list: (sessionId) => invoke("list_summaries", { sessionId }),
  read: (sessionId, episodeId) => invoke("read_summary", { sessionId, episodeId }),
  save: (request) => invoke("save_summary_text", { request }),
  confirm: (sessionId, requestId, episodeId, revisionId) =>
    invoke("confirm_summary", { sessionId, requestId, episodeId, revisionId }),
};

const unsupported = async (): Promise<never> => {
  throw { code: "unsupported" };
};

export const browserSummaryBackend: SummaryBackend = {
  list: async () => [],
  read: unsupported,
  save: unsupported,
  confirm: unsupported,
};

export function defaultSummaryBackend(): SummaryBackend {
  return isTauri() ? desktop : browserSummaryBackend;
}

export const SummaryBackendCtx = createContext<SummaryBackend>(browserSummaryBackend);
export const useSummaryBackend = () => useContext(SummaryBackendCtx);
