import { useEffect, useId, useState } from "react";
import { useI18n } from "./i18n/I18nProvider";
import { LANGUAGES, isLanguage, type MessageKey } from "./i18n/messages";
import { StartPanel, NoticeLine } from "./workspace/StartPanel";
import { useWorkspace } from "./workspace/WorkspaceProvider";
import { EpisodeNav, EpisodesPanel } from "./episodes/EpisodesPanel";
import { SummariesPanel } from "./summaries/SummariesPanel";
import { WorldPanel } from "./world/WorldPanel";
import { OPEN_CARD_EVENT } from "./world/api";
import { TimelinePanel } from "./timeline/TimelinePanel";
import { SearchPanel } from "./search/SearchPanel";
import type { OpenedWorkspace } from "./workspace/api";
import { DebugPanel, useBuildInfo } from "./debug/DebugPanel";
import { WindowCloseGuard } from "./manuscript/WindowCloseGuard";
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
  const ws = useWorkspace();
  const work = ws.current;
  const [selected, setSelected] = useState<RootId | "debug">("episodes");
  // Work search (11): the box in the top bar opens results above the current root.
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState<{ q: string; n: number } | null>(null);
  const searchId = useId();
  // ‘현재 전체 설정 열기’ from another root (10): switch to 세계관; WorldPanel opens the card.
  useEffect(() => {
    const go = () => setSelected("world");
    window.addEventListener(OPEN_CARD_EVENT, go);
    return () => window.removeEventListener(OPEN_CARD_EVENT, go);
  }, []);
  const build = useBuildInfo();
  const showDebug = build?.debug === true;
  const langSelectId = useId();

  return (
    <div className="shell">
      <WindowCloseGuard />
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
                {root === "episodes" && work && <EpisodeNav onPick={() => setSelected("episodes")} />}
              </li>
            ))}
            {showDebug && (
              <li>
                <button
                  type="button"
                  className="root debug-tab"
                  aria-current={selected === "debug" ? "page" : undefined}
                  onClick={() => setSelected("debug")}
                >
                  <span className="root-icon" aria-hidden="true">
                    ⚙
                  </span>
                  <span>{t("debug.tab")}</span>
                </button>
              </li>
            )}
          </ul>
        </nav>
        <p className="sidebar-hint">{t("nav.rootHint")}</p>
      </aside>

      <div className="content">
        <header className="topbar">
          <div className="work-head">
            {work ? (
              <>
                <span className="work-title">{work.title || work.root}</span>
                {work.mode === "readOnly" && <span className="badge">{t("workspace.readOnly")}</span>}
                <span className="work-path mono" title={work.root}>
                  {work.root}
                </span>
                <button type="button" onClick={ws.closeWork}>
                  {t("workspace.close")}
                </button>
              </>
            ) : (
              <span className="work-name">{t("workspace.none")}</span>
            )}
          </div>
          {work && (
            <form
              className="top-search"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                if (searchText.trim()) setSearch({ q: searchText.trim(), n: Date.now() });
              }}
            >
              <label htmlFor={searchId} className="visually-hidden">
                {t("search.box")}
              </label>
              <input id={searchId} type="search" value={searchText} placeholder={t("search.box")} onChange={(e) => setSearchText(e.target.value)} />
            </form>
          )}
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
          {selected === "debug" && showDebug ? (
            <DebugPanel />
          ) : selected === "debug" ? null : work ? (
            <>
              <NoticeLine notice={ws.notice} />
              <WorkBanners work={work} />
              {search && (
                <SearchPanel
                  key={search.n}
                  initialQuery={search.q}
                  onClose={() => setSearch(null)}
                  onNavigate={(root) => setSelected(root)}
                />
              )}
              <section className="root-panel">
                <h1>{t(`roots.${selected}` as MessageKey)}</h1>
                <p className="root-desc">{t(`rootDescriptions.${selected}` as MessageKey)}</p>
              </section>
              {selected === "episodes" && <EpisodesPanel />}
              {selected === "summaries" && <SummariesPanel />}
              {selected === "timeline" && <TimelinePanel />}
              {selected === "world" && <WorldPanel />}
            </>
          ) : (
            <>
              <section className="root-panel">
                <h1>{t(`roots.${selected}` as MessageKey)}</h1>
                <p className="root-desc">{t(`rootDescriptions.${selected}` as MessageKey)}</p>
                <p className="empty">{t("main.emptyRoot")}</p>
              </section>
              <StartPanel />
            </>
          )}
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

function WorkBanners({ work }: { work: OpenedWorkspace }) {
  const { t, tf } = useI18n();
  const reasonKey: Record<string, MessageKey> = {
    newerSchema: "workspace.readOnlyNewer",
    lockedByOther: "workspace.readOnlyLocked",
    noWritePermission: "workspace.readOnlyPermission",
  };
  return (
    <>
      {work.readOnlyReason && (
        <p role="status" className="banner banner-warn">
          {tf(reasonKey[work.readOnlyReason], { version: work.schemaVersion })}
        </p>
      )}
      {work.recovery.tmpFilesRemoved > 0 && (
        <p role="status" className="banner">
          {tf("workspace.recoveredTmp", { count: work.recovery.tmpFilesRemoved })}
        </p>
      )}
      {work.recovery.initMarkerCleared && (
        <p role="status" className="banner">
          {t("workspace.recoveredInit")}
        </p>
      )}
    </>
  );
}
