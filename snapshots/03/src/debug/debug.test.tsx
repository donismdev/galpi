import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { EpisodesProvider } from "../episodes/EpisodesProvider";
import { I18nProvider } from "../i18n/I18nProvider";
import type { LanguageStore } from "../settings/languageStore";
import type { OpenedWorkspace, WorkspaceBackend } from "../workspace/api";
import { WorkspaceProvider } from "../workspace/WorkspaceProvider";
import type { BuildInfo, DebugBackend } from "./api";
import { DebugBackendProvider } from "./DebugPanel";
import { SESSIONS } from "./features";

afterEach(cleanup);
beforeEach(() => window.localStorage.clear());

const koStore: LanguageStore = { kind: "desktop", load: async () => "ko", save: async () => {} };

function info(debug: boolean): BuildInfo {
  return { debug, version: "0.1.0", os: "windows", arch: "x86_64", settingsPath: "C:\\cfg\\settings.json", runtime: "desktop" };
}

function wsBackend(): WorkspaceBackend {
  return {
    supported: true,
    pickFolder: async () => null,
    inspect: vi.fn(),
    create: vi.fn(),
    open: vi.fn(
      async (path: string): Promise<OpenedWorkspace> => ({
        sessionId: "s9",
        root: path,
        workspaceId: "w9",
        title: "잿빛 항구 테스트",
        schemaVersion: 1,
        mode: "readWrite",
        readOnlyReason: null,
        recovery: { tmpFilesRemoved: 0, initMarkerCleared: false },
      }),
    ),
    close: vi.fn(),
    current: async () => null,
    recent: async () => [],
    forgetRecent: async () => [],
  } as unknown as WorkspaceBackend;
}

async function renderApp(debug: DebugBackend, ws = wsBackend()) {
  render(
    <I18nProvider store={koStore}>
      <WorkspaceProvider backend={ws}>
        <DebugBackendProvider backend={debug}>
          <EpisodesProvider>
            <App />
          </EpisodesProvider>
        </DebugBackendProvider>
      </WorkspaceProvider>
    </I18nProvider>,
  );
  await screen.findByRole("navigation");
  return ws;
}

function debugBackend(debug: boolean, over: Partial<DebugBackend> = {}): DebugBackend {
  return {
    buildInfo: async () => info(debug),
    settings: async () => ({ uiLanguage: "ko", recentWorkspaces: [] }),
    makeSample: vi.fn(async (path: string) => ({ path, workspaceId: "w9", episodes: [] })),
    ...over,
  };
}

describe("debug tab", () => {
  it("is hidden in a release build", async () => {
    await renderApp(debugBackend(false));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("button", { name: /디버그/ })).toBeNull();
  });

  it("shows build info, sessions 01–03 and the latest session open", async () => {
    const user = userEvent.setup();
    await renderApp(debugBackend(true));
    await user.click(await screen.findByRole("button", { name: /디버그/ }));
    expect(screen.getByRole("heading", { level: 1, name: "디버그" })).toBeTruthy();
    expect(screen.getByText("C:\\cfg\\settings.json")).toBeTruthy();
    for (const s of SESSIONS) {
      expect(screen.getByText(`${s.session}회 · ${s.title}`)).toBeTruthy();
    }
    const latest = screen.getByText(`03회 · ${SESSIONS[2].title}`).closest("details")!;
    expect(latest.open).toBe(true);
    expect(within(latest).getByText("다음 화 쓰기 → VS Code")).toBeTruthy();
  });

  it("checklist marks persist for this viewer and can be reset", async () => {
    const user = userEvent.setup();
    await renderApp(debugBackend(true));
    await user.click(await screen.findByRole("button", { name: /디버그/ }));
    const box = screen.getByRole("checkbox", { name: "확인함: 다음 화 쓰기 → VS Code" }) as HTMLInputElement;
    await user.click(box);
    expect(box.checked).toBe(true);
    expect(JSON.parse(window.localStorage.getItem("galpi.debug.checks")!)["03.next"]).toBe(true);
    await user.click(screen.getByRole("button", { name: "체크 초기화" }));
    expect(box.checked).toBe(false);
  });

  it("sample-work tool creates and opens the work", async () => {
    const dbg = debugBackend(true);
    const user = userEvent.setup();
    const ws = await renderApp(dbg);
    await user.click(await screen.findByRole("button", { name: /디버그/ }));
    await user.type(screen.getByLabelText("만들 폴더 (전체 경로)"), "C:\\tmp\\샘플");
    await user.click(screen.getByRole("button", { name: "만들기" }));
    expect(dbg.makeSample).toHaveBeenCalledWith("C:\\tmp\\샘플", "잿빛 항구 테스트", 3);
    await user.click(await screen.findByRole("button", { name: "이 작품 열기" }));
    expect(ws.open).toHaveBeenCalledWith("C:\\tmp\\샘플");
  });
});

describe("feature data", () => {
  it("has unique step ids and complete entries", () => {
    const ids = SESSIONS.flatMap((s) => s.manual.map((m) => m.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SESSIONS) {
      expect(s.implemented.length).toBeGreaterThan(0);
      expect(s.automated.length).toBeGreaterThan(0);
      for (const m of s.manual) {
        expect(m.id.startsWith(`${s.session}.`)).toBe(true);
        expect(m.steps.length).toBeGreaterThan(0);
        expect(m.expect.length).toBeGreaterThan(0);
      }
    }
    expect(SESSIONS.map((s) => s.session)).toEqual(["01", "02", "03"]);
  });
});
