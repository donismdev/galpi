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

export interface DebugBackend {
  buildInfo(): Promise<BuildInfo>;
  settings(): Promise<unknown>;
  makeSample(path: string, title: string, count: number): Promise<SampleResult>;
}

const desktop: DebugBackend = {
  async buildInfo() {
    const b = await invoke<Omit<BuildInfo, "runtime">>("build_info");
    return { ...b, runtime: "desktop" };
  },
  settings: () => invoke("get_app_settings"),
  makeSample: (path, title, count) => invoke("debug_make_sample_work", { path, title, count }),
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
};

export function defaultDebugBackend(): DebugBackend {
  return isTauri() ? desktop : browser;
}
