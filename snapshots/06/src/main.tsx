import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { I18nProvider } from "./i18n/I18nProvider";
import { defaultLanguageStore } from "./settings/languageStore";
import { WorkspaceProvider } from "./workspace/WorkspaceProvider";
import { defaultWorkspaceBackend } from "./workspace/api";
import { EpisodeBackendProvider, EpisodesProvider } from "./episodes/EpisodesProvider";
import { defaultEpisodeBackend } from "./episodes/api";
import { EditorGuardProvider, ManuscriptBackendProvider } from "./manuscript/EditorGuard";
import { defaultManuscriptBackend } from "./manuscript/api";
import { HistoryBackendProvider } from "./history/HistoryPanel";
import { defaultHistoryBackend } from "./history/api";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider store={defaultLanguageStore()}>
      <EditorGuardProvider>
      <ManuscriptBackendProvider backend={defaultManuscriptBackend()}>
      <HistoryBackendProvider backend={defaultHistoryBackend()}>
      <WorkspaceProvider backend={defaultWorkspaceBackend()}>
        <EpisodeBackendProvider backend={defaultEpisodeBackend()}>
          <EpisodesProvider>
            <App />
          </EpisodesProvider>
        </EpisodeBackendProvider>
      </WorkspaceProvider>
      </HistoryBackendProvider>
      </ManuscriptBackendProvider>
      </EditorGuardProvider>
    </I18nProvider>
  </React.StrictMode>,
);
