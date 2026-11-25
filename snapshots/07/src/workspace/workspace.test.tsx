// Session 02 UI flows against a scripted backend (the real file rules are covered by cargo tests).
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { I18nProvider } from "../i18n/I18nProvider";
import type { LanguageStore } from "../settings/languageStore";
import type { CreateRequest, Inspection, OpenedWorkspace, RecentWorkspace, WorkspaceBackend } from "./api";
import { WorkspaceProvider } from "./WorkspaceProvider";
import { EpisodesProvider } from "../episodes/EpisodesProvider";

afterEach(cleanup);

const koStore: LanguageStore = { kind: "desktop", load: async () => "ko", save: async () => {} };

const DIR = "C:\\Users\\작가\\문서\\내 소설 (초고)";

function inspection(over: Partial<Inspection> = {}): Inspection {
  return {
    path: DIR,
    kind: "empty",
    title: null,
    workspaceId: null,
    schemaVersion: null,
    entryCount: 0,
    conflicts: [],
    suggestion: null,
    detail: null,
    ...over,
  };
}

function opened(over: Partial<OpenedWorkspace> = {}): OpenedWorkspace {
  return {
    sessionId: "s1",
    root: DIR,
    workspaceId: "w1",
    title: "잿빛 항구",
    schemaVersion: 1,
    mode: "readWrite",
    readOnlyReason: null,
    recovery: { tmpFilesRemoved: 0, initMarkerCleared: false },
    ...over,
  };
}

function backend(over: Partial<WorkspaceBackend> = {}) {
  let current: OpenedWorkspace | null = null;
  let recent: RecentWorkspace[] = [];
  const b = {
    supported: true,
    pickFolder: vi.fn(async (): Promise<string | null> => DIR),
    inspect: vi.fn(async (): Promise<Inspection> => inspection()),
    create: vi.fn(async (req: CreateRequest) => {
      current = opened({ root: req.path, title: req.title });
      recent = [{ path: req.path, title: req.title, workspaceId: "w1", lastOpenedAt: "now" }];
      return current;
    }),
    open: vi.fn(async (path: string) => {
      current = opened({ root: path });
      return current;
    }),
    close: vi.fn(async () => {
      current = null;
    }),
    current: vi.fn(async () => current),
    recent: vi.fn(async () => recent),
    forgetRecent: vi.fn(async (path: string) => {
      recent = recent.filter((r) => r.path !== path);
      return recent;
    }),
    ...over,
  };
  return b;
}

async function renderWith(b: WorkspaceBackend) {
  render(
    <I18nProvider store={koStore}>
      <WorkspaceProvider backend={b}>
        <EpisodesProvider>
          <App />
        </EpisodesProvider>
      </WorkspaceProvider>
    </I18nProvider>,
  );
  await screen.findByRole("navigation");
}

describe("work folder flows", () => {
  it("empty folder → title → create opens the work and lists it as recent", async () => {
    const b = backend();
    const user = userEvent.setup();
    await renderWith(b);
    await user.click(screen.getByRole("button", { name: "작품 폴더 선택…" }));
    expect(await screen.findByText("빈 폴더입니다")).toBeTruthy();
    const title = screen.getByLabelText("작품 제목");
    await user.clear(title);
    await user.type(title, "잿빛 항구");
    await user.click(screen.getByRole("button", { name: "새 작품 만들기" }));
    expect(b.create).toHaveBeenCalledWith(
      expect.objectContaining({ path: DIR, title: "잿빛 항구", trackLabel: "본편", confirmNonEmpty: false }),
    );
    expect(await screen.findByText("잿빛 항구", { selector: ".work-title" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "작품 닫기" }));
    expect(await screen.findByText("작품을 닫았습니다.")).toBeTruthy();
    expect(await screen.findByText(DIR, { selector: ".recent .mono" })).toBeTruthy();
  });

  it("cancelling the folder dialog changes nothing", async () => {
    const b = backend({ pickFolder: vi.fn(async () => null) });
    const user = userEvent.setup();
    await renderWith(b);
    await user.click(screen.getByRole("button", { name: "작품 폴더 선택…" }));
    expect(await screen.findByText(/폴더 선택을 취소했습니다/)).toBeTruthy();
    expect(b.inspect).not.toHaveBeenCalled();
    expect(b.create).not.toHaveBeenCalled();
  });

  it("non-empty folder requires explicit confirmation before creating", async () => {
    const b = backend({ inspect: vi.fn(async () => inspection({ kind: "nonEmpty", entryCount: 3 })) });
    const user = userEvent.setup();
    await renderWith(b);
    await user.click(screen.getByRole("button", { name: "작품 폴더 선택…" }));
    expect(await screen.findByText(/항목 3개/)).toBeTruthy();
    const create = screen.getByRole("button", { name: "새 작품 만들기" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    await user.click(screen.getByRole("checkbox"));
    await user.click(create);
    expect(b.create).toHaveBeenCalledWith(expect.objectContaining({ confirmNonEmpty: true }));
  });

  it("name conflicts are listed and the suggested subfolder is offered", async () => {
    const suggestion = `${DIR}\\새 작품`;
    const b = backend({
      inspect: vi.fn(async () =>
        inspection({ kind: "nonEmpty", entryCount: 2, conflicts: ["Episodes", "lore"], suggestion }),
      ),
    });
    const user = userEvent.setup();
    await renderWith(b);
    await user.click(screen.getByRole("button", { name: "작품 폴더 선택…" }));
    expect(await screen.findByText("Episodes")).toBeTruthy();
    expect(screen.getByText("lore")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "새 작품 만들기" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "대신 이 새 하위 폴더에 만들기" }));
    expect(b.create).toHaveBeenCalledWith(expect.objectContaining({ path: suggestion, createFolder: true }));
  });

  it("an existing work opens directly; read-only reasons are shown", async () => {
    const b = backend({
      inspect: vi.fn(async () => inspection({ kind: "newerWorkspace", schemaVersion: 7 })),
      open: vi.fn(async () =>
        opened({ mode: "readOnly", readOnlyReason: "newerSchema", schemaVersion: 7, workspaceId: "" }),
      ),
    });
    const user = userEvent.setup();
    await renderWith(b);
    await user.click(screen.getByRole("button", { name: "작품 폴더 선택…" }));
    expect(await screen.findByText(/형식 7/)).toBeTruthy();
    expect(screen.getByText("읽기 전용", { selector: ".badge" })).toBeTruthy();
    expect(b.create).not.toHaveBeenCalled();
  });

  it("an incomplete create offers to resume", async () => {
    const b = backend({
      inspect: vi.fn(async () => inspection({ kind: "incompleteInit", title: "잿빛 항구", workspaceId: "w-old" })),
    });
    const user = userEvent.setup();
    await renderWith(b);
    await user.click(screen.getByRole("button", { name: "작품 폴더 선택…" }));
    expect(await screen.findByText(/‘잿빛 항구’ 작품을 만들다가 멈췄습니다/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "이어서 완료" }));
    expect(b.create).toHaveBeenCalledTimes(1);
  });

  it("retrying the same create screen reuses one request id", async () => {
    let calls = 0;
    const b = backend();
    b.create = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw { code: "io", detail: "disk busy" };
      return opened();
    });
    b.inspect = vi.fn(async () => inspection());
    const user = userEvent.setup();
    await renderWith(b);
    await user.click(screen.getByRole("button", { name: "작품 폴더 선택…" }));
    await user.click(await screen.findByRole("button", { name: "새 작품 만들기" }));
    expect(await screen.findByText("파일을 다루는 중 오류가 났습니다.")).toBeTruthy();
    // The error returns to the start card; the writer picks the same folder again.
    await user.click(screen.getByRole("button", { name: "작품 폴더 선택…" }));
    await user.click(await screen.findByRole("button", { name: "새 작품 만들기" }));
    const ids = (b.create as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[0] as CreateRequest).requestId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBeTruthy();
  });

  it("a late answer about the previous work never replaces the work opened after it", async () => {
    let releaseA!: (w: OpenedWorkspace) => void;
    const slowA = new Promise<OpenedWorkspace>((r) => (releaseA = r));
    const recent: RecentWorkspace[] = [
      { path: "C:\\A", title: "작품 A", workspaceId: "wa", lastOpenedAt: "x" },
      { path: "C:\\B", title: "작품 B", workspaceId: "wb", lastOpenedAt: "x" },
    ];
    const b = backend({
      recent: vi.fn(async () => recent),
      open: vi.fn((path: string) =>
        path === "C:\\A"
          ? slowA
          : Promise.resolve(opened({ sessionId: "sB", root: "C:\\B", title: "작품 B", workspaceId: "wb" })),
      ),
    });
    const user = userEvent.setup();
    await renderWith(b);
    const openButtons = await screen.findAllByRole("button", { name: "열기" });
    // Click A (slow), then B (fast) — B opens; A answers late.
    act(() => openButtons[0].click());
    await user.click(openButtons[1]);
    expect(await screen.findByText("작품 B", { selector: ".work-title" })).toBeTruthy();
    await act(async () => releaseA(opened({ sessionId: "sA", root: "C:\\A", title: "작품 A", workspaceId: "wa" })));
    await waitFor(() => expect(screen.getByText("작품 B", { selector: ".work-title" })).toBeTruthy());
    expect(screen.queryByText("작품 A", { selector: ".work-title" })).toBeNull();
  });

  it("a missing recent folder shows an error with its path", async () => {
    const b = backend({
      recent: vi.fn(async () => [{ path: "C:\\없어짐", title: "옛 작품", workspaceId: "w", lastOpenedAt: "x" }]),
      open: vi.fn(async () => {
        throw { code: "notFound", path: "C:\\없어짐" };
      }),
    });
    const user = userEvent.setup();
    await renderWith(b);
    await user.click(await screen.findByRole("button", { name: "열기" }));
    expect(await screen.findByText(/폴더를 찾을 수 없습니다/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "목록에서 빼기" }));
    expect(b.forgetRecent).toHaveBeenCalledWith("C:\\없어짐");
  });
});
