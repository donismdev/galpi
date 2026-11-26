// Session 07: summaries list/detail, review buttons, previous-episode note.
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { EpisodeBackendProvider, EpisodesProvider } from "../episodes/EpisodesProvider";
import type { EpisodeBackend, EpisodeInfo, LaunchResult } from "../episodes/api";
import { HistoryBackendProvider } from "../history/HistoryPanel";
import type { HistoryBackend } from "../history/api";
import { I18nProvider } from "../i18n/I18nProvider";
import type { LanguageStore } from "../settings/languageStore";
import type { OpenedWorkspace, WorkspaceBackend } from "../workspace/api";
import { WorkspaceProvider } from "../workspace/WorkspaceProvider";
import { SummaryBackendCtx, type SaveSummaryRequest, type SummaryBackend, type SummaryDoc, type SummaryStatus } from "./api";

afterEach(cleanup);
const koStore: LanguageStore = { kind: "desktop", load: async () => "ko", save: async () => {} };

const work: OpenedWorkspace = {
  sessionId: "s1",
  root: "C:\\작품",
  workspaceId: "w1",
  title: "잿빛 항구",
  schemaVersion: 1,
  mode: "readWrite",
  readOnlyReason: null,
  recovery: { tmpFilesRemoved: 0, initMarkerCleared: false },
};
const wsBackend = {
  supported: true,
  pickFolder: async () => null,
  inspect: vi.fn(),
  create: vi.fn(),
  open: vi.fn(),
  close: vi.fn(async () => {}),
  current: async () => work,
  recent: async () => [],
  forgetRecent: async () => [],
} as unknown as WorkspaceBackend;

function ep(n: number): EpisodeInfo {
  return { episodeId: `e${n}`, number: n, title: "", createdAt: "t", folder: `episodes/00000${n}`, manuscriptRel: "x", manuscriptPath: `C:\\작품\\e${n}.md` };
}

function status(n: number, over: Partial<SummaryStatus> = {}): SummaryStatus {
  return {
    episodeId: `e${n}`,
    number: n,
    title: "",
    firstLine: "",
    state: "unwritten",
    reviewedRevisionId: null,
    reviewedOrdinal: null,
    reviewedAt: null,
    latestRevisionId: null,
    latestOrdinal: null,
    uncommittedEdits: false,
    summaryEditedSinceReview: false,
    hasNote: false,
    ...over,
  };
}

/** Scripted summaries: per episode summary/note text + review record; state derived like Rust. */
function summaryBackend(init: Record<string, { summary?: string; note?: string; latest?: number; reviewed?: number }>) {
  const db = Object.fromEntries(Object.entries(init).map(([k, v]) => [k, { summary: "", note: "", ...v }]));
  let ver = 0;
  const h = (t: string) => (t ? `h:${t}` : null);
  const doc = (id: string): SummaryDoc => {
    const d = db[id] ?? { summary: "", note: "" };
    const n = Number(id.slice(1));
    const state = !d.summary.trim()
      ? "unwritten"
      : !d.latest
        ? "noRevision"
        : !d.reviewed
          ? "unreviewed"
          : d.reviewed === d.latest
            ? "reviewed"
            : "recheck";
    return {
      summary: { text: d.summary, hash: h(d.summary) },
      note: { text: d.note, hash: h(d.note) },
      metaHash: null,
      status: status(n, {
        firstLine: d.summary.split("\n").find((l) => l.trim()) ?? "",
        state,
        latestRevisionId: d.latest ? `r${d.latest}` : null,
        latestOrdinal: d.latest ?? null,
        reviewedRevisionId: d.reviewed ? `r${d.reviewed}` : null,
        reviewedOrdinal: d.reviewed ?? null,
        hasNote: !!d.note.trim(),
      }),
    };
  };
  const saves: SaveSummaryRequest[] = [];
  const b = {
    list: vi.fn(async () => Object.keys(db).sort().map((id) => doc(id).status)),
    read: vi.fn(async (_s: string, id: string) => doc(id)),
    save: vi.fn(async (req: SaveSummaryRequest) => {
      saves.push(req);
      const d = db[req.episodeId];
      const cur = req.kind === "summary" ? d.summary : d.note;
      if (h(cur) !== req.expectedHash) throw { code: "writeConflict" };
      if (req.kind === "summary") d.summary = req.text;
      else d.note = req.text;
      ver++;
      return doc(req.episodeId);
    }),
    confirm: vi.fn(async (_s: string, _r: string, id: string, rev: string) => {
      const d = db[id];
      if (`r${d.latest}` !== rev) throw { code: "writeConflict" };
      d.reviewed = d.latest;
      return doc(id);
    }),
  };
  return { b, db, saves, version: () => ver };
}

const historyBackend: HistoryBackend = {
  list: async () => ({ revisions: [], problems: [] }),
  read: async (_s, _e, id) => ({
    revisionId: id,
    ordinal: Number(id.slice(1)),
    text: id === "r1" ? "서린은 손끝에 불을 피웠다." : "서린은 남은 불씨를 감지했다.",
    bom: false,
    lineEnding: "lf",
    contentHash: id,
  }),
  commit: vi.fn(),
  backup: vi.fn(),
};

function episodeBackend(eps: EpisodeInfo[]): EpisodeBackend {
  const list = [...eps];
  return {
    supported: true,
    list: async () => ({ episodes: [...list], problems: [] }),
    create: vi.fn(async () => {
      const e = ep(list.length + 1);
      list.push(e);
      return { episode: e, created: true };
    }),
    rename: vi.fn(),
    openExternal: vi.fn(async (_s, _id, editor): Promise<LaunchResult> => ({ editor, program: "x", args: [], requestSent: true })),
    detectEditors: async () => ({ vscode: null, vscodeTried: [], notepad: null }),
    editorSettings: async () => ({ kind: "vscode" }),
    setEditorSettings: async (s) => s,
  } as EpisodeBackend;
}

async function renderApp(sb: SummaryBackend, eb: EpisodeBackend) {
  render(
    <I18nProvider store={koStore}>
      <WorkspaceProvider backend={wsBackend}>
        <HistoryBackendProvider backend={historyBackend}>
          <SummaryBackendCtx.Provider value={sb}>
            <EpisodeBackendProvider backend={eb}>
              <EpisodesProvider>
                <App />
              </EpisodesProvider>
            </EpisodeBackendProvider>
          </SummaryBackendCtx.Provider>
        </HistoryBackendProvider>
      </WorkspaceProvider>
    </I18nProvider>,
  );
  await screen.findByText("잿빛 항구", { selector: ".work-title" });
}

async function openSummaries(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /회차 요약/ }));
  return waitFor(() => {
    const el = document.querySelector(".summary-list");
    if (!el) throw new Error("no summary list yet");
    return el as HTMLElement;
  });
}

describe("07 summaries", () => {
  it("S07.A all episodes listed, missing summary still shows its number", async () => {
    const { b } = summaryBackend({ e1: { summary: "1화: 서린 각성.\n둘째 줄" }, e2: {}, e3: { summary: "\n3화: 불씨 감지." } });
    const user = userEvent.setup();
    await renderApp(b, episodeBackend([ep(1), ep(2), ep(3)]));
    const list = await openSummaries(user);
    const rows = within(list).getAllByRole("button");
    expect(rows.map((r) => r.querySelector("strong")?.textContent)).toEqual(["1화", "2화", "3화"]);
    expect(rows[1].textContent).toContain("(요약 없음)");
    expect(rows[0].textContent).toContain("1화: 서린 각성.");
    expect(rows[2].textContent).toContain("3화: 불씨 감지.");
    expect(within(rows[2]).getByTestId("summary-state").textContent).toBe("커밋 전 (확인할 판 없음)");
  });

  it("write and save a summary and a next-episode note with the hash that was read", async () => {
    const { b, saves } = summaryBackend({ e1: {} });
    const user = userEvent.setup();
    await renderApp(b, episodeBackend([ep(1)]));
    const list = await openSummaries(user);
    await user.click(within(list).getByRole("button", { name: /1화/ }));
    await user.type(await screen.findByLabelText("회차 요약"), "서린이 각성한다.");
    await user.click(screen.getByRole("button", { name: "요약 저장" }));
    expect(await screen.findByText("요약을 저장했습니다.")).toBeTruthy();
    expect(saves[0]).toMatchObject({ kind: "summary", text: "서린이 각성한다.", expectedHash: null });
    await user.type(screen.getByLabelText("다음 화(2화)에 쓸 메모"), "검은 편지");
    await user.click(screen.getByRole("button", { name: "메모 저장" }));
    expect(await screen.findByText("다음 화 메모를 저장했습니다.")).toBeTruthy();
    expect(saves[1]).toMatchObject({ kind: "note", text: "검은 편지" });
  });

  it("S07.B recheck → compare the two revisions → confirm as is", async () => {
    const { b } = summaryBackend({ e3: { summary: "3화 요약", latest: 2, reviewed: 1 } });
    const user = userEvent.setup();
    await renderApp(b, episodeBackend([ep(3)]));
    const list = await openSummaries(user);
    await user.click(within(list).getByRole("button", { name: /3화/ }));
    expect((await screen.findByTestId("summary-state")).textContent).toBe("재확인 필요 (r1 확인 → 지금 r2)");
    await user.click(screen.getByRole("button", { name: "확인했던 r1 ↔ 현재 r2 비교" }));
    expect(await screen.findByTestId("diff")).toBeTruthy();
    expect(screen.getByText("감지했다", { selector: "ins", exact: false })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "이대로 확인 (r2)" }));
    expect(await screen.findByText("r2 기준으로 요약을 확인했습니다.")).toBeTruthy();
    expect(screen.getByTestId("summary-state").textContent).toBe("최신 확인 (r2)");
    expect(b.confirm).toHaveBeenCalledWith("s1", expect.any(String), "e3", "r2");
  });

  it("edited summary: 'check as is' is off; 'save edits and check' saves first then confirms", async () => {
    const { b, saves } = summaryBackend({ e3: { summary: "옛 요약", latest: 2, reviewed: 1 } });
    const user = userEvent.setup();
    await renderApp(b, episodeBackend([ep(3)]));
    const list = await openSummaries(user);
    await user.click(within(list).getByRole("button", { name: /3화/ }));
    const area = await screen.findByLabelText("회차 요약");
    await user.clear(area);
    await user.type(area, "새 요약: 불씨 감지");
    expect((screen.getByRole("button", { name: "이대로 확인 (r2)" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "수정 후 확인 (저장하고 r2 기준 확인)" }));
    expect(await screen.findByText("r2 기준으로 요약을 확인했습니다.")).toBeTruthy();
    expect(saves).toHaveLength(1);
    expect(b.confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("summary-state").textContent).toBe("최신 확인 (r2)");
  });

  it("a newer commit arriving before confirming is not auto-confirmed", async () => {
    const { b, db } = summaryBackend({ e3: { summary: "요약", latest: 1 } });
    const user = userEvent.setup();
    await renderApp(b, episodeBackend([ep(3)]));
    const list = await openSummaries(user);
    await user.click(within(list).getByRole("button", { name: /3화/ }));
    await screen.findByText("미확인");
    db.e3.latest = 2; // a commit happened meanwhile
    await user.click(screen.getByRole("button", { name: "이대로 확인 (r1)" }));
    expect(await screen.findByText(/그 사이 새 커밋이 생겼습니다/)).toBeTruthy();
    expect(db.e3.reviewed).toBeUndefined();
    await waitFor(() => expect(screen.getByRole("button", { name: "이대로 확인 (r2)" })).toBeTruthy());
  });

  it("summary changed outside while editing: not saved, text kept", async () => {
    const { b, db } = summaryBackend({ e1: { summary: "처음" } });
    const user = userEvent.setup();
    await renderApp(b, episodeBackend([ep(1)]));
    const list = await openSummaries(user);
    await user.click(within(list).getByRole("button", { name: /1화/ }));
    const area = (await screen.findByLabelText("회차 요약")) as HTMLTextAreaElement;
    await user.type(area, " + 앱");
    db.e1.summary = "밖에서 바뀜";
    await user.click(screen.getByRole("button", { name: "요약 저장" }));
    expect(await screen.findByText(/요약 파일이 앱 밖에서 바뀌어 저장하지 않았습니다/)).toBeTruthy();
    expect(area.value).toBe("처음 + 앱");
    expect(db.e1.summary).toBe("밖에서 바뀜");
  });

  it("S07.C the previous episode's note is shown once next to the new episode, never inserted", async () => {
    const { b, saves } = summaryBackend({ e1: { summary: "1화 요약", note: "2화에서 쓸 것: 검은 편지를 꺼낸다." } });
    const eb = episodeBackend([ep(1)]);
    const user = userEvent.setup();
    await renderApp(b, eb);
    await user.click(await screen.findByRole("button", { name: "다음 화 쓰기 (2화)" }));
    const panel = await screen.findByTestId("prev-note");
    expect((panel as HTMLDetailsElement).open).toBe(true);
    expect(within(panel).getByText(/방금 만든 회차를 위해 1화에서 남긴 메모/)).toBeTruthy();
    expect(screen.getAllByText("2화에서 쓸 것: 검은 편지를 꺼낸다.")).toHaveLength(1);
    expect(saves).toHaveLength(0); // nothing was written into episode 2's summary
    // Selecting 1화: no note (there is no episode 0); back to 2화: folded, not "fresh" any more.
    await user.click(screen.getByRole("button", { name: "1화" }));
    await waitFor(() => expect(screen.queryByTestId("prev-note")).toBeNull());
    await user.click(screen.getByRole("button", { name: "2화" }));
    const again = (await screen.findByTestId("prev-note")) as HTMLDetailsElement;
    expect(again.open).toBe(false);
    expect(within(again).getByText("1화에서 남긴 다음 화 메모")).toBeTruthy();
  });
});
