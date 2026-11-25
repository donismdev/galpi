import { invoke, isTauri } from "@tauri-apps/api/core";
import { DEFAULT_LANGUAGE, isLanguage, type Language } from "../i18n/messages";

/**
 * Where the UI language is persisted.
 * - Desktop shell: Rust core writes settings.json in the OS app-config dir.
 * - Browser dev preview: localStorage of that browser only.
 */
export interface LanguageStore {
  readonly kind: "desktop" | "browser";
  load(): Promise<Language>;
  save(language: Language): Promise<void>;
}

interface AppSettingsDto {
  schemaVersion: number;
  uiLanguage: string;
}

const desktopStore: LanguageStore = {
  kind: "desktop",
  async load() {
    const s = await invoke<AppSettingsDto>("get_app_settings");
    return isLanguage(s.uiLanguage) ? s.uiLanguage : DEFAULT_LANGUAGE;
  },
  async save(language) {
    await invoke<AppSettingsDto>("set_ui_language", { language });
  },
};

const BROWSER_KEY = "galpi.uiLanguage";

const browserStore: LanguageStore = {
  kind: "browser",
  async load() {
    try {
      const v = window.localStorage.getItem(BROWSER_KEY);
      return isLanguage(v) ? v : DEFAULT_LANGUAGE;
    } catch {
      return DEFAULT_LANGUAGE;
    }
  },
  async save(language) {
    window.localStorage.setItem(BROWSER_KEY, language);
  },
};

export function defaultLanguageStore(): LanguageStore {
  return isTauri() ? desktopStore : browserStore;
}
