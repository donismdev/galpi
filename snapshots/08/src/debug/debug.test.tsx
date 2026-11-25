import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { EpisodesProvider } from "../episodes/EpisodesProvider";
import { I18nProvider } from "../i18n/I18nProvider";
import type { LanguageStore } from "../settings/languageStore";
import type { OpenedWorkspace, WorkspaceBackend } from "../workspace/api";
import { WorkspaceProvider } from "../workspace/WorkspaceProvider";
import type { BuildInfo, DebugBackend, FileInfo } from "./api";
import { EpisodeBackendProvider } from "../episodes/EpisodesProvider";
import { browserEpisodeBackend, type EpisodeBackend } from "../episodes/api";
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

function fileInfo(over: Partial<FileInfo> = {}): FileInfo {
  return {
    path: "C:\\tmp\\m.md",
    exists: true,
    size: 0,
    hash: "sha256:e",
    bom: false,
    crlf: 0,
    loneLf: 0,
    loneCr: 0,
    utf8: true,
    readonly: false,
    lockedByDebug: false,
    headHex: "",
    isSample: true,
    ...over,
  };
}

function debugBackend(debug: boolean, over: Partial<DebugBackend> = {}): DebugBackend {
  return {
    buildInfo: async () => info(debug),
    settings: async () => ({ uiLanguage: "ko", recentWorkspaces: [] }),
    makeSample: vi.fn(async (path: string) => ({ path, workspaceId: "w9", episodes: [] })),
    fileInfo: vi.fn(async () => fileInfo()),
    writeFixture: vi.fn(async () => {}),
    setLock: vi.fn(async () => {}),
    setReadonly: vi.fn(async () => {}),
    externalEdit: vi.fn(async () => {}),
    historyFixture: vi.fn(async () => "r1, r2, r3"),
    summaryFixture: vi.fn(async () => "1화 요약·다음 화 메모"),
    loreFixture: vi.fn(async () => "서린 ×2 (characters/주연, characters/조연) · 태그 A"),
    ...over,
  };
}

/** Renders the app with a work open and one episode, then selects 1화 and opens the debug tab. */
async function renderWithEpisode(debug: DebugBackend) {
  const opened: OpenedWorkspace = {
    sessionId: "s9",
    root: "C:\\tmp\\합성",
    workspaceId: "w9",
    title: "합성 작품",
    schemaVersion: 1,
    mode: "readWrite",
    readOnlyReason: null,
    recovery: { tmpFilesRemoved: 0, initMarkerCleared: false },
  };
  const ws = { ...wsBackend(), current: async () => opened } as WorkspaceBackend;
  const ep = {
    episodeId: "e1",
    number: 1,
    title: "",
    createdAt: "t",
    folder: "episodes/000001-x",
    manuscriptRel: "episodes/000001-x/manuscript.md",
    manuscriptPath: "C:\\tmp\\합성\\episodes\\000001-x\\manuscript.md",
  };
  const eb = {
    ...browserEpisodeBackend,
    supported: true,
    list: async () => ({ episodes: [ep], problems: [] }),
  } as EpisodeBackend;
  const user = userEvent.setup();
  render(
    <I18nProvider store={koStore}>
      <WorkspaceProvider backend={ws}>
        <DebugBackendProvider backend={debug}>
          <EpisodeBackendProvider backend={eb}>
            <EpisodesProvider>
              <App />
            </EpisodesProvider>
          </EpisodeBackendProvider>
        </DebugBackendProvider>
      </WorkspaceProvider>
    </I18nProvider>,
  );
  await user.click(await screen.findByRole("button", { name: "1화" }));
  await user.click(await screen.findByRole("button", { name: /디버그/ }));
  return user;
}

describe("debug tab", () => {
  it("is hidden in a release build", async () => {
    await renderApp(debugBackend(false));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("button", { name: /디버그/ })).toBeNull();
  });

  it("shows build info, every session and the latest session open", async () => {
    const user = userEvent.setup();
    await renderApp(debugBackend(true));
    await user.click(await screen.findByRole("button", { name: /디버그/ }));
    expect(screen.getByRole("heading", { level: 1, name: "디버그" })).toBeTruthy();
    expect(screen.getByText("C:\\cfg\\settings.json")).toBeTruthy();
    for (const s of SESSIONS) {
      expect(screen.getByText(`${s.session}회 · ${s.title}`)).toBeTruthy();
    }
    const last = SESSIONS.at(-1)!;
    const latest = screen.getByText(`${last.session}회 · ${last.title}`).closest("details")!;
    expect(latest.open).toBe(true);
    expect(within(latest).getByText(last.manual[0].title)).toBeTruthy();
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

describe("session 04 debug tools", () => {
  it("shows which snapshot this build is", async () => {
    const user = userEvent.setup();
    await renderApp(debugBackend(true));
    await user.click(await screen.findByRole("button", { name: /디버그/ }));
    expect(screen.getByTestId("snapshot").textContent).toContain(`snapshots/${__SNAPSHOT__}`);
  });

  it("writes a CP949 fixture into the selected episode of a sample work", async () => {
    const dbg = debugBackend(true);
    const user = await renderWithEpisode(dbg);
    await user.click(await screen.findByRole("button", { name: /CP949\(ANSI\) 한글/ }));
    expect(dbg.writeFixture).toHaveBeenCalledWith("s9", "e1", "cp949");
    expect(await screen.findByText(/CP949\(ANSI\) 한글 완료/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "다른 프로그램처럼 잠그기" }));
    expect(dbg.setLock).toHaveBeenCalledWith("s9", "e1", true);
  });

  it("disables the tools on a work that is not a sample", async () => {
    const dbg = debugBackend(true, { fileInfo: vi.fn(async () => fileInfo({ isSample: false })) });
    await renderWithEpisode(dbg);
    expect(await screen.findByText(/합성 작품이 아니어서/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /CP949\(ANSI\) 한글/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(dbg.writeFixture).not.toHaveBeenCalled();
  });
});

describe("session 05 debug tools", () => {
  it("sends an external-editor action for the selected episode", async () => {
    const dbg = debugBackend(true);
    const user = await renderWithEpisode(dbg);
    await user.click(await screen.findByRole("button", { name: /임시 파일 교체 저장/ }));
    expect(dbg.externalEdit).toHaveBeenCalledWith("s9", "e1", "replaceViaTemp");
    expect(await screen.findByText(/임시 파일 교체 저장 \(VS Code처럼\) 완료/)).toBeTruthy();
  });
});

describe("session 06 debug tools", () => {
  it("makes three revisions for the selected episode", async () => {
    const dbg = debugBackend(true);
    const user = await renderWithEpisode(dbg);
    await user.click(await screen.findByRole("button", { name: /판 3개 빨리 만들기/ }));
    expect(dbg.historyFixture).toHaveBeenCalledWith("s9", "e1", "threeRevisions");
    expect(await screen.findByText(/판 3개 빨리 만들기 \(r1 초고 → r2 → r3\) 완료: r1, r2, r3/)).toBeTruthy();
  });
});

describe("session 07 debug tools", () => {
  it("writes a summary and a note for the selected episode", async () => {
    const dbg = debugBackend(true);
    const user = await renderWithEpisode(dbg);
    await user.click(await screen.findByRole("button", { name: /요약·다음 화 메모 쓰기/ }));
    expect(dbg.summaryFixture).toHaveBeenCalledWith("s9", "e1", "writeSummaryAndNote");
    expect(await screen.findByText(/요약·다음 화 메모 쓰기 완료: 1화 요약·다음 화 메모/)).toBeTruthy();
  });
});

describe("session 08 debug tools", () => {
  it("makes same-name cards in the open synthetic work", async () => {
    const dbg = debugBackend(true);
    const user = await renderWithEpisode(dbg);
    await user.click(await screen.findByRole("button", { name: /같은 이름 카드 2개 \+ 태그 A/ }));
    expect(dbg.loreFixture).toHaveBeenCalledWith("s9", "sameNameCards");
    expect(await screen.findByText(/같은 이름 카드 2개 \+ 태그 A 완료: 서린 ×2/)).toBeTruthy();
  });
});

describe("feature data", () => {
  it("includes this snapshot's own session (update src/debug/features.ts before closing a session)", () => {
    expect(SESSIONS.at(-1)?.session).toBe(__SNAPSHOT__);
    expect(SESSIONS.at(-1)?.snapshot).toBe(`snapshots/${__SNAPSHOT__}`);
  });

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
    // 01, 02, … up to this snapshot, in order, none missing.
    const expected = Array.from({ length: Number(__SNAPSHOT__) }, (_, i) => String(i + 1).padStart(2, "0"));
    expect(SESSIONS.map((s) => s.session)).toEqual(expected);
  });
});
