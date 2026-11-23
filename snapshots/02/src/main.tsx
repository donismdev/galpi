import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { I18nProvider } from "./i18n/I18nProvider";
import { defaultLanguageStore } from "./settings/languageStore";
import { WorkspaceProvider } from "./workspace/WorkspaceProvider";
import { defaultWorkspaceBackend } from "./workspace/api";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider store={defaultLanguageStore()}>
      <WorkspaceProvider backend={defaultWorkspaceBackend()}>
        <App />
      </WorkspaceProvider>
    </I18nProvider>
  </React.StrictMode>,
);
