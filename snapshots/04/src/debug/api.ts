import { invoke, isTauri } from "@tauri-apps/api/core";
import type { EpisodeInfo } from "../episodes/api";

export interface BuildInfo {
  /** Rust debug_assertions (tauri dev / tauri build --debug), or Vite DEV in the browser preview. */
  debug: boolean;
  version: string;
  os: string;
  arch: string;
  settingsPath: string;
  runtime: "desktop" | "browser";
}

export interface SampleResult {
  path: string;
  workspaceId: string;
  episodes: EpisodeInfo[];
}

export type Fixture = "bomCrlfEmoji" | "cp949" | "empty" | "long" | "mixed";

export interface FileInfo {
  path: string;
  exists: boolean;
  size: number;
  hash: string;
  bom: boolean;
  crlf: number;
  loneLf: number;
  loneCr: number;
  utf8: boolean;
  readonly: boolean;
  lockedByDebug: boolean;
  headHex: string;
  isSample: boolean;
}

export interface DebugBackend {
  buildInfo(): Promise<BuildInfo>;
  settings(): Promise<unknown>;
  makeSample(path: string, title: string, count: number): Promise<SampleResult>;
  // 04: manuscript tools (synthetic works only; refused by Rust otherwise)
  fileInfo(sessionId: string, episodeId: string): Promise<FileInfo>;
  writeFixture(sessionId: string, episodeId: string, fixture: Fixture): Promise<void>;
  setLock(sessionId: string, episodeId: string, on: boolean): Promise<void>;
  setReadonly(sessionId: string, episodeId: string, on: boolean): Promise<void>;
}

const desktop: DebugBackend = {
  async buildInfo() {
    const b = await invoke<Omit<BuildInfo, "runtime">>("build_info");
    return { ...b, runtime: "desktop" };
  },
  settings: () => invoke("get_app_settings"),
  makeSample: (path, title, count) => invoke("debug_make_sample_work", { path, title, count }),
  fileInfo: (sessionId, episodeId) => invoke("debug_file_info", { sessionId, episodeId }),
  writeFixture: (sessionId, episodeId, fixture) => invoke("debug_write_fixture", { sessionId, episodeId, fixture }),
  setLock: (sessionId, episodeId, on) => invoke("debug_set_lock", { sessionId, episodeId, on }),
  setReadonly: (sessionId, episodeId, on) => invoke("debug_set_readonly", { sessionId, episodeId, on }),
};

const browser: DebugBackend = {
  buildInfo: async () => ({
    debug: import.meta.env.DEV,
    version: "-",
    os: "browser",
    arch: "-",
    settingsPath: "localStorage (galpi.uiLanguage)",
    runtime: "browser",
  }),
  settings: async () => {
    try {
      return { uiLanguage: window.localStorage.getItem("galpi.uiLanguage") };
    } catch {
      return {};
    }
  },
  makeSample: async () => {
    throw { code: "unsupported" };
  },
  fileInfo: async () => {
    throw { code: "unsupported" };
  },
  writeFixture: async () => {
    throw { code: "unsupported" };
  },
  setLock: async () => {
    throw { code: "unsupported" };
  },
  setReadonly: async () => {
    throw { code: "unsupported" };
  },
};

export function defaultDebugBackend(): DebugBackend {
  return isTauri() ? desktop : browser;
}
