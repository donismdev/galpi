// Session 03 UI: next episode, editor launch outcomes, retries. File rules are in cargo tests.
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { I18nProvider } from "../i18n/I18nProvider";
import type { LanguageStore } from "../settings/languageStore";
import type { OpenedWorkspace, WorkspaceBackend } from "../workspace/api";
import { WorkspaceProvider } from "../workspace/WorkspaceProvider";
import type { EditorKind, EpisodeBackend, EpisodeInfo, LaunchResult } from "./api";
import { EpisodeBackendProvider, EpisodesProvider } from "./EpisodesProvider";
import { EditorGuardProvider, ManuscriptBackendProvider } from "../manuscript/EditorGuard";
import type { ManuscriptBackend } from "../manuscript/api";

/** Every manuscript is an empty UTF-8 LF file that saves fine. */
const emptyManuscripts: ManuscriptBackend = {
  read: async (_s, episodeId) => ({
    state: "ok",
    episodeId,
    text: "",
    hash: "sha256:e",
    bom: false,
    lineEnding: "lf",
    mixedLineEndings: false,
    path: "x",
  }),
  save: async () => ({ hash: "sha256:n", savedAt: new Date().toISOString() }),
  saveDraft: async (_s, episodeId, baseHash, baseText, text) => ({ episodeId, baseHash, baseText, text, savedAt: "t" }),
  probe: async () => ({ exists: true, hash: "sha256:e" }),
  onDiskChange: async () => () => {},
  loadDraft: async () => null,
  discardDraft: async () => {},
  reveal: async () => {},
};

afterEach(cleanup);

const ROOT = "C:\\작품\\잿빛 항구 (테스트) #1 & 'x' 100%";
const koStore: LanguageStore = { kind: "desktop", load: async () => "ko", save: async () => {} };

function work(over: Partial<OpenedWorkspace> = {}): OpenedWorkspace {
  return {
    sessionId: "s1",
    root: ROOT,
    workspaceId: "w1",
    title: "잿빛 항구",
    schemaVersion: 1,
    mode: "readWrite",
    readOnlyReason: null,
    recovery: { tmpFilesRemoved: 0, initMarkerCleared: false },
    ...over,
  };
}

function wsBackend(current: OpenedWorkspace): WorkspaceBackend {
  return {
    supported: true,
    pickFolder: async () => null,
    inspect: vi.fn(),
    create: vi.fn(),
    open: vi.fn(),
    close: vi.fn(async () => {}),
    current: async () => current,
    recent: async () => [],
    forgetRecent: async () => [],
  } as unknown as WorkspaceBackend;
}

function ep(n: number, title = ""): EpisodeInfo {
  const folder = `episodes/${String(n).padStart(6, "0")}-abcd${n}`;
  return {
    episodeId: `e${n}`,
    number: n,
    title,
    createdAt: "t",
    folder,
    manuscriptRel: `${folder}/manuscript.md`,
    manuscriptPath: `${ROOT}\\${folder.replace("/", "\\")}\\manuscript.md`,
  };
}

function epBackend(over: Partial<EpisodeBackend> = {}) {
  const episodes: EpisodeInfo[] = [];
  const seen = new Map<string, EpisodeInfo>();
  const b = {
    supported: true,
    list: vi.fn(async () => ({ episodes: [...episodes], problems: [] })),
    create: vi.fn(async (_sid: string, requestId: string) => {
      const prior = seen.get(requestId);
      if (prior) return { episode: prior, created: false };
      const e = ep(episodes.length + 1);
      episodes.push(e);
      seen.set(requestId, e);
      return { episode: e, created: true };
    }),
    rename: vi.fn(async (_s: string, _r: string, id: string, title: string) => {
      const e = episodes.find((x) => x.episodeId === id)!;
      e.title = title.trim();
      return e;
    }),
    openExternal: vi.fn(
      async (_s: string, _id: string, editor: EditorKind): Promise<LaunchResult> => ({
        editor,
        program: "Code.exe",
        args: [],
        requestSent: true,
      }),
    ),
    detectEditors: async () => ({ vscode: "C:\\VS Code\\Code.exe", vscodeTried: [], notepad: "C:\\Windows\\notepad.exe" }),
    editorSettings: async () => ({ kind: "vscode" as EditorKind }),
    setEditorSettings: vi.fn(async (s) => s),
    ...over,
  };
  return { b, episodes };
}

async function renderApp(eb: EpisodeBackend, w = work()) {
  render(
    <I18nProvider store={koStore}>
      <EditorGuardProvider>
      <ManuscriptBackendProvider backend={emptyManuscripts}>
      <WorkspaceProvider backend={wsBackend(w)}>
        <EpisodeBackendProvider backend={eb}>
          <EpisodesProvider>
            <App />
          </EpisodesProvider>
        </EpisodeBackendProvider>
      </WorkspaceProvider>
      </ManuscriptBackendProvider>
      </EditorGuardProvider>
    </I18nProvider>,
  );
  await screen.findByText("잿빛 항구", { selector: ".work-title" });
}

describe("episodes", () => {
  it("‘다음 화 쓰기’ creates episode 1, selects it, opens VS Code and shows the path", async () => {
    const { b } = epBackend();
    const user = userEvent.setup();
    await renderApp(b);
    await user.click(await screen.findByRole("button", { name: "다음 화 쓰기 (1화)" }));
    expect(await screen.findByText(/VS Code에 열기 요청을 보냈습니다/)).toBeTruthy();
    expect(b.openExternal).toHaveBeenCalledWith("s1", "e1", "vscode");
    expect(screen.getByTestId("manuscript-path").textContent).toContain("000001-abcd1\\manuscript.md");
    expect(screen.getByRole("button", { name: "1화" }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: "다음 화 쓰기 (2화)" })).toBeTruthy();
  });

  it("1·2·3화 are listed in order", async () => {
    const { b } = epBackend();
    const user = userEvent.setup();
    await renderApp(b);
    for (const n of [1, 2, 3]) {
      await user.click(await screen.findByRole("button", { name: `다음 화 쓰기 (${n}화)` }));
    }
    await screen.findByRole("button", { name: "다음 화 쓰기 (4화)" });
    const rows = screen.getAllByRole("button").filter((x) => x.className === "episode-row");
    expect(rows.map((r) => r.textContent)).toEqual(["1화", "2화", "3화"]);
  });

  it("a failed create keeps the same request id for the retry", async () => {
    let calls = 0;
    const { b } = epBackend();
    const real = b.create;
    b.create = vi.fn(async (sid: string, req: string) => {
      calls += 1;
      if (calls === 1) throw { code: "io", detail: "disk busy" };
      return real(sid, req);
    });
    const user = userEvent.setup();
    await renderApp(b);
    await user.click(await screen.findByRole("button", { name: "다음 화 쓰기 (1화)" }));
    expect(await screen.findByText(/같은 요청으로 이어서 시도/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "다음 화 쓰기 (1화)" }));
    await screen.findByRole("button", { name: "다음 화 쓰기 (2화)" });
    const ids = vi.mocked(b.create).mock.calls.map((c) => c[1]);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  it("a double click sends one intent; two separate clicks make two episodes", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { b, episodes } = epBackend();
    const real = b.create;
    b.create = vi.fn(async (sid: string, req: string) => {
      await gate;
      return real(sid, req);
    });
    await renderApp(b);
    const btn = await screen.findByRole("button", { name: "다음 화 쓰기 (1화)" });
    act(() => {
      btn.click();
      btn.click();
    });
    await act(async () => release());
    await screen.findByRole("button", { name: "다음 화 쓰기 (2화)" });
    expect(new Set(vi.mocked(b.create).mock.calls.map((c) => c[1])).size).toBe(1);
    expect(episodes).toHaveLength(1);
    await act(async () => screen.getByRole("button", { name: "다음 화 쓰기 (2화)" }).click());
    await screen.findByRole("button", { name: "다음 화 쓰기 (3화)" });
    expect(episodes.map((e) => e.number)).toEqual([1, 2]);
  });

  it("editor not found: episode stays, other editor offered, reopening never creates", async () => {
    const { b, episodes } = epBackend();
    b.openExternal = vi.fn(async (_s: string, _id: string, editor: EditorKind) => {
      if (editor === "vscode") throw { code: "editorNotFound", editor, tried: ["C:\\없는 경로\\Code.exe"] };
      return { editor, program: "notepad.exe", args: [], requestSent: true };
    });
    const user = userEvent.setup();
    await renderApp(b);
    await user.click(await screen.findByRole("button", { name: "다음 화 쓰기 (1화)" }));
    expect(await screen.findByText(/VS Code\(으\)로 열지 못했습니다/)).toBeTruthy();
    expect(screen.getByText(/없는 경로/)).toBeTruthy();
    const alert = screen.getByText(/VS Code\(으\)로 열지 못했습니다/).closest("[role=alert]")!;
    await user.click(alert.querySelector("button")!);
    expect(await screen.findByText(/메모장에 열기 요청을 보냈습니다/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "VS Code(으)로 다시 열기" }));
    expect(b.create).toHaveBeenCalledTimes(1);
    expect(episodes).toHaveLength(1);
  });

  it("built-in editor as default: creates, stays in the app and shows the editor", async () => {
    const { b } = epBackend({
      editorSettings: async () => ({ kind: "builtin" as EditorKind }),
    });
    const user = userEvent.setup();
    await renderApp(b);
    await waitFor(() => expect(screen.getByText(/내장 편집기\(으\)로 엽니다/)).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "다음 화 쓰기 (1화)" }));
    expect(await screen.findByText(/아래 내장 편집기에서 씁니다/)).toBeTruthy();
    expect(b.openExternal).not.toHaveBeenCalled();
    expect(await screen.findByText("변경 없음")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "VS Code(으)로 열기" }).length).toBeGreaterThan(0);
  });

  it("renaming keeps the episode id and path", async () => {
    const { b } = epBackend();
    const user = userEvent.setup();
    await renderApp(b);
    await user.click(await screen.findByRole("button", { name: "다음 화 쓰기 (1화)" }));
    const before = (await screen.findByTestId("manuscript-path")).textContent;
    const input = screen.getByLabelText(/회차 제목/);
    await user.type(input, "각성{Enter}");
    expect(await screen.findByRole("button", { name: "1화 · 각성" })).toBeTruthy();
    expect(b.rename).toHaveBeenCalledWith("s1", expect.any(String), "e1", "각성");
    expect(screen.getByTestId("manuscript-path").textContent).toBe(before);
  });

  it("read-only work cannot create episodes", async () => {
    const { b } = epBackend();
    await renderApp(b, work({ mode: "readOnly", readOnlyReason: "lockedByOther" }));
    const btn = (await screen.findByRole("button", { name: "다음 화 쓰기 (1화)" })) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByText(/새 회차를 만들 수 없습니다/)).toBeTruthy();
  });
});
