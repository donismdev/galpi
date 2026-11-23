import { useId, useState } from "react";
import { useI18n } from "./i18n/I18nProvider";
import { LANGUAGES, isLanguage, type MessageKey } from "./i18n/messages";
import "./App.css";

export const ROOTS = ["episodes", "summaries", "timeline", "world"] as const;
export type RootId = (typeof ROOTS)[number];

const ROOT_ICON: Record<RootId, string> = {
  episodes: "¶",
  summaries: "≡",
  timeline: "↧",
  world: "◎",
};

export default function App() {
  const { t, language, setLanguage, saveError, runtime } = useI18n();
  const [selected, setSelected] = useState<RootId>("episodes");
  const langSelectId = useId();
  const notYetId = useId();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-name">{t("app.name")}</span>
          <span className="brand-tagline">{t("app.tagline")}</span>
        </div>
        <nav aria-label={t("nav.label")}>
          <ul className="roots">
            {ROOTS.map((root) => (
              <li key={root}>
                <button
                  type="button"
                  className="root"
                  aria-current={selected === root ? "page" : undefined}
                  onClick={() => setSelected(root)}
                >
                  <span className="root-icon" aria-hidden="true">
                    {ROOT_ICON[root]}
                  </span>
                  <span>{t(`roots.${root}` as MessageKey)}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <p className="sidebar-hint">{t("nav.rootHint")}</p>
      </aside>

      <div className="content">
        <header className="topbar">
          <span className="work-name">{t("workspace.none")}</span>
          <div className="lang">
            <label htmlFor={langSelectId}>{t("language.label")}</label>
            <select
              id={langSelectId}
              value={language}
              onChange={(e) => isLanguage(e.target.value) && setLanguage(e.target.value)}
            >
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {t(`language.${l}` as MessageKey)}
                </option>
              ))}
            </select>
          </div>
        </header>

        <main className="main" aria-label={t("main.label")}>
          <section className="root-panel">
            <h1>{t(`roots.${selected}` as MessageKey)}</h1>
            <p className="root-desc">{t(`rootDescriptions.${selected}` as MessageKey)}</p>
            <p className="empty">{t("main.emptyRoot")}</p>
          </section>

          <section className="open-card">
            <h2>{t("workspace.openTitle")}</h2>
            <p>{t("workspace.openBody")}</p>
            <button type="button" disabled aria-describedby={notYetId}>
              {t("workspace.openAction")}
            </button>
            <p id={notYetId} className="not-yet">
              {t("workspace.notYet")}
            </p>
          </section>
        </main>

        <footer className="statusbar" aria-label={t("status.label")}>
          <span data-testid="runtime">
            {runtime === "desktop" ? t("status.runtimeDesktop") : t("status.runtimeBrowser")}
          </span>
          {saveError && (
            <span role="alert" className="status-error">
              {t("language.saveFailed")}
            </span>
          )}
        </footer>
      </div>
    </div>
  );
}
