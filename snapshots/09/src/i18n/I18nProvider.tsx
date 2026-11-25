import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LANGUAGE, interpolate, lookup, type Language, type MessageKey } from "./messages";
import type { LanguageStore } from "../settings/languageStore";

interface I18nValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: MessageKey) => string;
  tf: (key: MessageKey, vars: Record<string, string | number>) => string;
  saveError: boolean;
  runtime: LanguageStore["kind"];
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ store, children }: { store: LanguageStore; children: ReactNode }) {
  const [language, setLang] = useState<Language | null>(null);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    let alive = true;
    store
      .load()
      .catch(() => DEFAULT_LANGUAGE)
      .then((l) => alive && setLang(l));
    return () => {
      alive = false;
    };
  }, [store]);

  useEffect(() => {
    if (language) document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback(
    (next: Language) => {
      setLang(next); // reflect immediately, then persist
      store.save(next).then(
        () => setSaveError(false),
        () => setSaveError(true),
      );
    },
    [store],
  );

  const value = useMemo<I18nValue | null>(
    () =>
      language && {
        language,
        setLanguage,
        t: (key: MessageKey) => lookup(language, key),
        tf: (key: MessageKey, vars: Record<string, string | number>) => interpolate(lookup(language, key), vars),
        saveError,
        runtime: store.kind,
      },
    [language, setLanguage, saveError, store.kind],
  );

  // Render nothing until the stored language is known, so the wrong language never flashes.
  if (!value) return null;
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const v = useContext(I18nContext);
  if (!v) throw new Error("useI18n must be used inside I18nProvider");
  return v;
}
