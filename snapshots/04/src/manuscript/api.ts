import { invoke, isTauri } from "@tauri-apps/api/core";

// Mirrors src-tauri/src/workspace/manuscript.rs.

export type LineEnding = "lf" | "crlf";

export type ManuscriptRead =
  | {
      state: "ok";
      episodeId: string;
      text: string;
      hash: string;
      bom: boolean;
      lineEnding: LineEnding;
      mixedLineEndings: boolean;
      path: string;
    }
  | { state: "undecodable"; episodeId: string; hash: string; size: number; validUpTo: number; path: string }
  | { state: "locked"; episodeId: string; path: string; detail: string };

export interface SavedManuscript {
  hash: string;
  savedAt: string;
}

export interface Draft {
  episodeId: string;
  baseHash: string | null;
  text: string;
  savedAt: string;
}

export interface SaveRequest {
  sessionId: string;
  requestId: string;
  episodeId: string;
  text: string;
  baseHash: string;
  bom: boolean;
  lineEnding: LineEnding;
}

export interface ManuscriptBackend {
  read(sessionId: string, episodeId: string): Promise<ManuscriptRead>;
  save(req: SaveRequest): Promise<SavedManuscript>;
  saveDraft(sessionId: string, episodeId: string, baseHash: string | null, text: string): Promise<Draft>;
  loadDraft(sessionId: string, episodeId: string): Promise<Draft | null>;
  discardDraft(sessionId: string, episodeId: string): Promise<void>;
  reveal(sessionId: string, episodeId: string): Promise<void>;
}

const desktop: ManuscriptBackend = {
  read: (sessionId, episodeId) => invoke("read_manuscript", { sessionId, episodeId }),
  save: (request) => invoke("save_manuscript", { request }),
  saveDraft: (sessionId, episodeId, baseHash, text) => invoke("save_draft", { sessionId, episodeId, baseHash, text }),
  loadDraft: (sessionId, episodeId) => invoke("load_draft", { sessionId, episodeId }),
  discardDraft: (sessionId, episodeId) => invoke("discard_draft", { sessionId, episodeId }),
  reveal: (sessionId, episodeId) => invoke("reveal_episode_file", { sessionId, episodeId }),
};

const unsupported = async (): Promise<never> => {
  throw { code: "unsupported" };
};

export const browserManuscriptBackend: ManuscriptBackend = {
  read: unsupported,
  save: unsupported,
  saveDraft: unsupported,
  loadDraft: async () => null,
  discardDraft: async () => {},
  reveal: unsupported,
};

export function defaultManuscriptBackend(): ManuscriptBackend {
  return isTauri() ? desktop : browserManuscriptBackend;
}
