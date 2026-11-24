import { invoke, isTauri } from "@tauri-apps/api/core";

// Mirrors src-tauri/src/workspace/episodes.rs and src-tauri/src/editor.rs.

export interface EpisodeInfo {
  episodeId: string;
  number: number;
  title: string;
  createdAt: string;
  folder: string;
  manuscriptRel: string;
  manuscriptPath: string;
}

export interface EpisodeList {
  episodes: EpisodeInfo[];
  problems: { folder: string; detail: string }[];
}

export interface CreatedEpisode {
  episode: EpisodeInfo;
  created: boolean;
}

export type EditorKind = "vscode" | "notepad" | "builtin";
export const EDITOR_KINDS: readonly EditorKind[] = ["vscode", "notepad", "builtin"];

export interface EditorSettings {
  kind: EditorKind;
  vscodePath?: string | null;
}

export interface LaunchResult {
  editor: EditorKind;
  program: string;
  args: string[];
  requestSent: boolean;
}

export interface DetectedEditors {
  vscode: string | null;
  vscodeTried: string[];
  notepad: string | null;
}

export interface EpisodeBackend {
  readonly supported: boolean;
  list(sessionId: string): Promise<EpisodeList>;
  create(sessionId: string, requestId: string): Promise<CreatedEpisode>;
  rename(sessionId: string, requestId: string, episodeId: string, title: string): Promise<EpisodeInfo>;
  openExternal(sessionId: string, episodeId: string, editor: EditorKind): Promise<LaunchResult>;
  detectEditors(): Promise<DetectedEditors>;
  editorSettings(): Promise<EditorSettings>;
  setEditorSettings(s: EditorSettings): Promise<EditorSettings>;
}

const desktop: EpisodeBackend = {
  supported: true,
  list: (sessionId) => invoke("list_episodes", { sessionId }),
  create: (sessionId, requestId) => invoke("create_episode", { sessionId, requestId }),
  rename: (sessionId, requestId, episodeId, title) =>
    invoke("rename_episode", { sessionId, requestId, episodeId, title }),
  openExternal: (sessionId, episodeId, editor) =>
    invoke("open_episode_external", { sessionId, episodeId, editor }),
  detectEditors: () => invoke("detect_editors"),
  async editorSettings() {
    const s = await invoke<{ editor?: EditorSettings }>("get_app_settings");
    return s.editor ?? { kind: "vscode" };
  },
  async setEditorSettings(editor) {
    const s = await invoke<{ editor?: EditorSettings }>("set_editor_settings", { editor });
    return s.editor ?? editor;
  },
};

const unsupported = async (): Promise<never> => {
  throw { code: "unsupported" };
};

export const browserEpisodeBackend: EpisodeBackend = {
  supported: false,
  list: async () => ({ episodes: [], problems: [] }),
  create: unsupported,
  rename: unsupported,
  openExternal: unsupported,
  detectEditors: async () => ({ vscode: null, vscodeTried: [], notepad: null }),
  editorSettings: async () => ({ kind: "vscode" }),
  setEditorSettings: async (s) => s,
};

export function defaultEpisodeBackend(): EpisodeBackend {
  return isTauri() ? desktop : browserEpisodeBackend;
}
