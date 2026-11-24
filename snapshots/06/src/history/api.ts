import { invoke, isTauri } from "@tauri-apps/api/core";
import type { LineEnding } from "../manuscript/api";

// Mirrors src-tauri/src/workspace/history.rs.

export interface RevisionInfo {
  revisionId: string;
  episodeId: string;
  parentRevisionId: string | null;
  ordinal: number;
  createdAt: string;
  message: string;
  contentHash: string;
  size: number;
  folder: string;
}

export interface History {
  revisions: RevisionInfo[];
  problems: { folder: string; detail: string }[];
}

export type CommitOutcome = "created" | "sameRequest" | "noChange";

export interface CommitResult {
  outcome: CommitOutcome;
  revision: RevisionInfo;
}

export interface RevisionText {
  revisionId: string;
  ordinal: number;
  text: string;
  bom: boolean;
  lineEnding: LineEnding;
  contentHash: string;
}

export interface CommitRequest {
  sessionId: string;
  requestId: string;
  episodeId: string;
  message: string;
  expectedHash: string | null;
}

export interface HistoryBackend {
  list(sessionId: string, episodeId: string): Promise<History>;
  read(sessionId: string, episodeId: string, revisionId: string): Promise<RevisionText>;
  commit(req: CommitRequest): Promise<CommitResult>;
  backup(sessionId: string, episodeId: string): Promise<string>;
}

const desktop: HistoryBackend = {
  list: (sessionId, episodeId) => invoke("list_revisions", { sessionId, episodeId }),
  read: (sessionId, episodeId, revisionId) => invoke("read_revision", { sessionId, episodeId, revisionId }),
  commit: (request) => invoke("commit_episode", { request }),
  backup: (sessionId, episodeId) => invoke("backup_working_copy", { sessionId, episodeId }),
};

const unsupported = async (): Promise<never> => {
  throw { code: "unsupported" };
};

export const browserHistoryBackend: HistoryBackend = {
  list: async () => ({ revisions: [], problems: [] }),
  read: unsupported,
  commit: unsupported,
  backup: unsupported,
};

export function defaultHistoryBackend(): HistoryBackend {
  return isTauri() ? desktop : browserHistoryBackend;
}
