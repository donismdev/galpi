import ko from "./locales/ko.json";
import en from "./locales/en.json";

export const LANGUAGES = ["ko", "en"] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = "ko";

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

/** Every UI string key, derived from the Korean (reference) table. */
export type MessageKey = Leaves<typeof ko>;

export const MESSAGES: Record<Language, unknown> = { ko, en };

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

/** Replaces `{name}` placeholders. Unknown placeholders are left visible rather than blanked. */
export function interpolate(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

export function lookup(language: Language, key: MessageKey): string {
  let node: unknown = MESSAGES[language];
  for (const part of key.split(".")) {
    node = node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined;
  }
  if (typeof node === "string") return node;
  // Never show a blank control: fall back to the reference language, then the key itself.
  if (language !== DEFAULT_LANGUAGE) return lookup(DEFAULT_LANGUAGE, key);
  return key;
}
