import { invoke, isTauri } from "@tauri-apps/api/core";

// Mirrors src-tauri/src/workspace/manuscript.rs and watch.rs.

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
  | { state: "missing"; episodeId: string; path: string }
  | { state: "locked"; episodeId: string; path: string; detail: string };

export interface SavedManuscript {
  hash: string;
  savedAt: string;
}

export interface Draft {
  episodeId: string;
  baseHash: string | null;
  /** Text of the version `baseHash` stands for (05). Missing in 04 drafts. */
  baseText?: string | null;
  text: string;
  savedAt: string;
}

export interface SaveRequest {
  sessionId: string;
  requestId: string;
  episodeId: string;
  text: string;
  /** null = the file must not exist (re-create after an outside delete). */
  baseHash: string | null;
  bom: boolean;
  lineEnding: LineEnding;
}

export interface DiskProbe {
  exists: boolean;
  hash: string | null;
}

/** "manuscript-changed" event from the Rust watcher (content-hash based). */
export interface DiskChange {
  sessionId: string;
  workspaceId: string;
  episodeId: string;
  exists: boolean;
  hash: string | null;
}

export interface ManuscriptBackend {
  read(sessionId: string, episodeId: string): Promise<ManuscriptRead>;
  save(req: SaveRequest): Promise<SavedManuscript>;
  probe(sessionId: string, episodeId: string): Promise<DiskProbe>;
  saveDraft(
    sessionId: string,
    episodeId: string,
    baseHash: string | null,
    baseText: string | null,
    text: string,
  ): Promise<Draft>;
  loadDraft(sessionId: string, episodeId: string): Promise<Draft | null>;
  discardDraft(sessionId: string, episodeId: string): Promise<void>;
  reveal(sessionId: string, episodeId: string): Promise<void>;
  /** Subscribes to disk-change hints; returns an unsubscribe function. */
  onDiskChange(listener: (c: DiskChange) => void): Promise<() => void>;
}

const desktop: ManuscriptBackend = {
  read: (sessionId, episodeId) => invoke("read_manuscript", { sessionId, episodeId }),
  save: (request) => invoke("save_manuscript", { request }),
  probe: (sessionId, episodeId) => invoke("probe_manuscript", { sessionId, episodeId }),
  saveDraft: (sessionId, episodeId, baseHash, baseText, text) =>
    invoke("save_draft", { sessionId, episodeId, baseHash, baseText, text }),
  loadDraft: (sessionId, episodeId) => invoke("load_draft", { sessionId, episodeId }),
  discardDraft: (sessionId, episodeId) => invoke("discard_draft", { sessionId, episodeId }),
  reveal: (sessionId, episodeId) => invoke("reveal_episode_file", { sessionId, episodeId }),
  async onDiskChange(listener) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<DiskChange>("manuscript-changed", (e) => listener(e.payload));
  },
};

const unsupported = async (): Promise<never> => {
  throw { code: "unsupported" };
};

export const browserManuscriptBackend: ManuscriptBackend = {
  read: unsupported,
  save: unsupported,
  probe: unsupported,
  saveDraft: unsupported,
  loadDraft: async () => null,
  discardDraft: async () => {},
  reveal: unsupported,
  onDiskChange: async () => () => {},
};

export function defaultManuscriptBackend(): ManuscriptBackend {
  return isTauri() ? desktop : browserManuscriptBackend;
}
