// Session 09: timelines, events in three views, coordinate validation, shared events, event
// review (CH1), tracks and certainty (CH2).
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { EpisodeBackendProvider, EpisodesProvider } from "../episodes/EpisodesProvider";
import type { EpisodeBackend, EpisodeInfo } from "../episodes/api";
import { I18nProvider } from "../i18n/I18nProvider";
import type { LanguageStore } from "../settings/languageStore";
import type { OpenedWorkspace, WorkspaceBackend } from "../workspace/api";
import { WorkspaceProvider } from "../workspace/WorkspaceProvider";
import { WorldBackendCtx, browserWorldBackend, type WorldBackend } from "../world/api";
import {
  TimelineBackendCtx,
  draftProblem,
  type Collection,
  type EventDraft,
  type EventInfo,
  type SaveEventRequest,
  type StoryTrack,
  type TimelineBackend,
  type ViewMode,
} from "./api";

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

const ep = (n: number): EpisodeInfo => ({ episodeId: `e${n}`, number: n, title: "", createdAt: "t", folder: `episodes/${n}`, manuscriptRel: "x", manuscriptPath: "x" });
const episodeBackend = {
  supported: true,
  list: async () => ({ episodes: [ep(1), ep(2), ep(3)], problems: [] }),
  create: vi.fn(),
  rename: vi.fn(),
  openExternal: vi.fn(),
  detectEditors: async () => ({ vscode: null, vscodeTried: [], notepad: null }),
  editorSettings: async () => ({ kind: "builtin" }),
  setEditorSettings: async (s: unknown) => s,
} as unknown as EpisodeBackend;

const world: WorldBackend = {
  ...browserWorldBackend,
  list: async () => ({ cards: [{ cardId: "c1", templateId: "character", name: "서린", aliases: ["린"], tagIds: [], folder: "characters", createdAt: "t", dir: "x" }], folders: [], problems: [] }),
  listTags: async () => [{ tagId: "t1", label: "능력", cardCount: 0 }],
};

type Rec = EventDraft & { eventId: string; ver: number; reviewed: number | null; legacyCertainty?: boolean };

/** In-memory timelines with timelines.rs rules (validation, shared events, review vs latest commit). */
function timelineBackend(opts: { latest?: Record<string, number> } = {}) {
  const latest = opts.latest ?? {};
  const cols = new Map<string, Collection>();
  const recs = new Map<string, Rec>();
  let tracks: StoryTrack[] = [{ trackId: "k0", label: "본편" }];
  let tracksVer = 0;
  let seq = 0;
  const info = (r: Rec): EventInfo => {
    const n = r.episodeId ? Number(r.episodeId.slice(1)) : null;
    const l = r.episodeId ? latest[r.episodeId] ?? null : null;
    const review = !r.episodeId ? "noEpisode" : !l ? "noRevision" : r.reviewed == null ? "unreviewed" : r.reviewed === l ? "reviewed" : "recheck";
    const certainty = r.legacyCertainty ? (r.storyTrackId && r.storyOrder != null ? "confirmed" : "unknown") : r.storyCertainty;
    return {
      ...r,
      createdAt: "t",
      certainty,
      episodeNumber: n,
      review,
      reviewedOrdinal: r.reviewed,
      latestRevisionId: l ? `r${l}` : null,
      latestOrdinal: l,
      hash: `h${r.ver}`,
    };
  };
  const saves: SaveEventRequest[] = [];
  const b: TimelineBackend = {
    load: vi.fn(async () => ({
      collections: [...cols.values()].map((c) => ({ ...c, eventCount: [...recs.values()].filter((r) => r.collectionIds.includes(c.collectionId)).length })),
      events: [...recs.values()].map(info),
      tracks: tracks.map((x) => ({ ...x })),
      tracksHash: `t${tracksVer}`,
      problems: [],
    })),
    createTimeline: vi.fn(async (_s, _r, name: string, defaultMode: ViewMode) => {
      const c: Collection = { schemaVersion: 1, collectionId: `k${++seq}`, name, defaultMode, createdAt: "t", eventCount: 0, hash: "h" };
      cols.set(c.collectionId, c);
      return c;
    }),
    updateTimeline: vi.fn(async (_s, _r, id: string, name: string, mode: ViewMode) => {
      cols.set(id, { ...cols.get(id)!, name, defaultMode: mode });
    }),
    saveEvent: vi.fn(async (req: SaveEventRequest) => {
      saves.push(req);
      const p = draftProblem(req.draft);
      if (p) throw { code: "invalidEvent", reason: p };
      const d = { ...req.draft };
      if (d.storyCertainty === "unknown") Object.assign(d, { storyTrackId: null, storyOrder: null, storyLabel: null });
      if (d.episodeId && d.episodeOrder == null) {
        d.episodeOrder = Math.max(0, ...[...recs.values()].filter((r) => r.episodeId === d.episodeId && r.eventId !== req.eventId).map((r) => r.episodeOrder ?? 0)) + 1;
      }
      if (req.eventId) {
        const old = recs.get(req.eventId)!;
        if (`h${old.ver}` !== req.expectedHash) throw { code: "writeConflict" };
        recs.set(req.eventId, { ...old, ...d, ver: old.ver + 1, reviewed: old.episodeId === d.episodeId ? old.reviewed : null, legacyCertainty: false });
        return info(recs.get(req.eventId)!);
      }
      const id = `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
      recs.set(id, { ...d, eventId: id, ver: 0, reviewed: null });
      return info(recs.get(id)!);
    }),
    confirmEvent: vi.fn(async (_s, _r, id: string, rev: string) => {
      const r = recs.get(id)!;
      if (`r${latest[r.episodeId!]}` !== rev) throw { code: "writeConflict" };
      r.reviewed = latest[r.episodeId!];
      r.ver++;
      return info(r);
    }),
    addTrack: vi.fn(async (_s, _r, label: string, h: string) => {
      if (h !== `t${tracksVer}`) throw { code: "writeConflict" };
      tracks = [...tracks, { trackId: `k${++seq}`, label }];
      tracksVer++;
      return tracks;
    }),
    renameTrack: vi.fn(async (_s, _r, id: string, label: string, h: string) => {
      if (h !== `t${tracksVer}`) throw { code: "writeConflict" };
      tracks = tracks.map((x) => (x.trackId === id ? { ...x, label } : x));
      tracksVer++;
      return tracks;
    }),
  };
  return { b, cols, recs, saves, latest, tracks: () => tracks };
}

async function renderApp(tb: TimelineBackend, store: LanguageStore = koStore) {
  const user = userEvent.setup();
  render(
    <I18nProvider store={store}>
      <WorkspaceProvider backend={wsBackend}>
        <WorldBackendCtx.Provider value={world}>
          <TimelineBackendCtx.Provider value={tb}>
            <EpisodeBackendProvider backend={episodeBackend}>
              <EpisodesProvider>
                <App />
              </EpisodesProvider>
            </EpisodeBackendProvider>
          </TimelineBackendCtx.Provider>
        </WorldBackendCtx.Provider>
      </WorkspaceProvider>
    </I18nProvider>,
  );
  await screen.findByText("잿빛 항구", { selector: ".work-title" });
  await user.click(screen.getByRole("button", { name: /타임라인/ }));
  await waitFor(() => {
    if (!document.querySelector(".timeline")) throw new Error("no timeline panel");
  });
  return user;
}

type U = Awaited<ReturnType<typeof renderApp>>;

async function makeTimeline(user: U, name: string, mode: "회차" | "작중 시간" | "함께 보기" = "회차") {
  await user.type(screen.getByLabelText("타임라인 이름"), name);
  await user.click(within(screen.getByRole("radiogroup", { name: "기본 보기" })).getByLabelText(mode));
  await user.click(screen.getByRole("button", { name: "타임라인 만들기" }));
  await screen.findByRole("button", { name: "← 타임라인 목록" });
}

async function addOnEpisode(user: U, n: number, title: string) {
  await user.click(within(screen.getByTestId(`ep-row-${n}`)).getByRole("button", { name: "+ 사건 추가" }));
  await user.type(await screen.findByLabelText("제목"), title);
  await user.click(screen.getByRole("button", { name: "사건 추가" }));
  await screen.findByText("사건을 저장했습니다.");
  await user.click(screen.getByRole("button", { name: "닫기" }));
}

const tab = (name: string) => screen.getByRole("tab", { name: new RegExp(`^${name}`) });
const idsIn = (el: ParentNode) => [...el.querySelectorAll("[data-event-id]")].map((x) => x.getAttribute("data-event-id"));

describe("09 timelines", () => {
  it("S09.A events on the right episodes; adding story time keeps the same ID in all three views", async () => {
    const { b, recs } = timelineBackend();
    const user = await renderApp(b);
    expect(screen.getByText("아직 타임라인이 없습니다. 아래에서 이름과 기본 보기를 골라 만드세요.")).toBeTruthy();
    await makeTimeline(user, "주인공의 능력");
    await addOnEpisode(user, 1, "각성");
    await addOnEpisode(user, 3, "불을 다룸");
    await waitFor(() => expect(within(screen.getByTestId("ep-row-3")).queryByText("불을 다룸")).toBeTruthy());
    expect(within(screen.getByTestId("ep-row-1")).getByText("각성")).toBeTruthy();
    expect(within(screen.getByTestId("ep-row-2")).getByText("사건 없음")).toBeTruthy();
    const fireId = [...recs.values()].find((r) => r.title === "불을 다룸")!.eventId;
    expect(idsIn(screen.getByTestId("ep-row-3"))).toEqual([fireId]);

    // add story time to the 3화 event
    await user.click(within(screen.getByTestId("ep-row-3")).getByRole("button", { name: /불을 다룸/ }));
    expect((await screen.findByTestId("event-id")).textContent).toBe(fireId);
    await user.click(screen.getByLabelText("확정"));
    await user.selectOptions(screen.getByLabelText("트랙"), "k0");
    await user.type(screen.getByLabelText("정렬 숫자"), "10");
    await user.type(screen.getByLabelText("표시 이름"), "10일차");
    await user.click(screen.getByRole("button", { name: "사건 저장" }));
    await screen.findByText("사건을 저장했습니다.");
    await user.click(screen.getByRole("button", { name: "닫기" }));
    expect(recs.size).toBe(2);

    await user.click(tab("작중 시간"));
    const track = await screen.findByTestId("track-본편");
    expect(idsIn(track)).toEqual([fireId]);
    expect(within(track).getByText("10일차")).toBeTruthy();
    expect(within(screen.getByTestId("unplaced-story")).getByText("각성")).toBeTruthy();

    await user.click(tab("함께 보기"));
    const row = document.querySelector(`tr[data-event-id="${fireId}"]`)!;
    expect(row.textContent).toContain("3화 · 순서 1");
    expect(row.textContent).toContain("본편 · 10일차");
    const awaken = [...document.querySelectorAll("tr[data-event-id]")].find((r) => r.textContent!.includes("각성"))!;
    expect(awaken.textContent).toContain("미상");
  });

  it("S09.B episode only / story only / both / neither; invalid input keeps every typed value", async () => {
    const { b, recs } = timelineBackend();
    const user = await renderApp(b);
    await makeTimeline(user, "왕국 연표", "함께 보기");
    // neither
    await user.click(screen.getByRole("button", { name: "사건 추가" }));
    await user.type(await screen.findByLabelText("제목"), "모두 비움");
    await user.type(screen.getByLabelText("내용"), "아직 시점을 모름");
    await user.click(within(screen.getByRole("group", { name: "태그" })).getByLabelText("능력"));
    const saveBtn = () => screen.getAllByRole("button", { name: "사건 추가" }).find((x) => x.closest(".event-editor"))!;
    await user.click(saveBtn());
    expect((await screen.findByRole("alert")).textContent).toContain("회차와 작중 시점이 모두 비어 있습니다");
    expect(b.saveEvent).not.toHaveBeenCalled();
    expect((screen.getByLabelText("제목") as HTMLInputElement).value).toBe("모두 비움");
    expect((screen.getByLabelText("내용") as HTMLTextAreaElement).value).toBe("아직 시점을 모름");
    expect((within(screen.getByRole("group", { name: "태그" })).getByLabelText("능력") as HTMLInputElement).checked).toBe(true);
    // estimated without a number
    await user.click(screen.getByLabelText("추정"));
    await user.click(saveBtn());
    expect((await screen.findByRole("alert")).textContent).toContain("트랙과 정렬 숫자가 모두 필요합니다");
    // story only
    await user.type(screen.getByLabelText("정렬 숫자"), "2");
    await user.click(saveBtn());
    await screen.findByText("사건을 저장했습니다.");
    await user.click(screen.getByRole("button", { name: "닫기" }));
    // episode only, both
    for (const [title, story] of [["회차만", false], ["둘 다", true]] as const) {
      await user.click(screen.getByRole("button", { name: "사건 추가" }));
      await user.type(await screen.findByLabelText("제목"), title);
      await user.selectOptions(screen.getByLabelText("회차"), "e2");
      if (story) {
        await user.click(screen.getByLabelText("확정"));
        await user.type(screen.getByLabelText("정렬 숫자"), "5");
      }
      await user.click(saveBtn());
      await screen.findByText("사건을 저장했습니다.");
      await user.click(screen.getByRole("button", { name: "닫기" }));
    }
    expect([...recs.values()].map((r) => r.title).sort()).toEqual(["둘 다", "모두 비움", "회차만"].sort());
    const story = [...recs.values()].find((r) => r.title === "모두 비움")!;
    expect(story).toMatchObject({ episodeId: null, storyCertainty: "estimated", storyOrder: 2, detail: "아직 시점을 모름", tagIds: ["t1"] });

    // filters for missing sides
    const titles = () => [...document.querySelectorAll("tr[data-event-id] button")].map((x) => x.textContent);
    await waitFor(() => expect(titles()).toHaveLength(3));
    await user.selectOptions(screen.getByLabelText("보기"), "noEpisode");
    expect(titles()).toEqual(["모두 비움"]);
    expect(document.querySelector("tr[data-event-id] td.unset")!.textContent).toBe("미정");
    await user.selectOptions(screen.getByLabelText("보기"), "noStory");
    expect(titles()).toEqual(["회차만"]);
    await user.selectOptions(screen.getByLabelText("보기"), "both");
    expect(titles()).toEqual(["둘 다"]);
    await user.selectOptions(screen.getByLabelText("보기"), "all");
    await user.selectOptions(screen.getByLabelText("정렬"), "story");
    expect(titles()).toEqual(["모두 비움", "둘 다", "회차만"]);
    await user.selectOptions(screen.getByLabelText("정렬"), "episode");
    expect(titles()).toEqual(["회차만", "둘 다", "모두 비움"]);
  });

  it("S09.C one event in two timelines: edit in one, the other shows it", async () => {
    const { b, recs } = timelineBackend();
    const user = await renderApp(b);
    await makeTimeline(user, "왕국 연표");
    await user.click(screen.getByRole("button", { name: "← 타임라인 목록" }));
    await makeTimeline(user, "주인공의 능력");
    await user.click(within(screen.getByTestId("ep-row-3")).getByRole("button", { name: "+ 사건 추가" }));
    await user.type(await screen.findByLabelText("제목"), "불을 다룸");
    await user.click(within(screen.getByRole("group", { name: /올릴 타임라인/ })).getByLabelText("왕국 연표"));
    await user.click(screen.getAllByRole("button", { name: "사건 추가" }).find((x) => x.closest(".event-editor"))!);
    await screen.findByText("사건을 저장했습니다.");
    // edit the title here
    const title = screen.getByLabelText("제목");
    await user.clear(title);
    await user.type(title, "남은 불씨를 감지");
    await user.click(screen.getByRole("button", { name: "사건 저장" }));
    await screen.findByText("사건을 저장했습니다.");
    expect(recs.size).toBe(1);
    await user.click(screen.getByRole("button", { name: "← 타임라인 목록" }));
    await waitFor(() => expect([...document.querySelectorAll(".timeline-row")].every((r) => r.textContent!.includes("사건 1개"))).toBe(true));
    await user.click([...document.querySelectorAll<HTMLButtonElement>(".timeline-row")].find((r) => r.textContent!.includes("왕국 연표"))!);
    expect(await within(await screen.findByTestId("ep-row-3")).findByText("남은 불씨를 감지")).toBeTruthy();
  });

  it("CH1 event review: recheck after a new commit, confirm records the newest revision only for the event", async () => {
    const t = timelineBackend({ latest: { e3: 1 } });
    const user = await renderApp(t.b);
    await makeTimeline(user, "주인공의 능력");
    await addOnEpisode(user, 3, "불을 다룸");
    const row = () => within(screen.getByTestId("ep-row-3"));
    await waitFor(() => expect(row().getByTestId("event-review").textContent).toBe("미확인"));
    await user.click(row().getByRole("button", { name: /불을 다룸/ }));
    await user.click(await screen.findByRole("button", { name: "이대로 확인 (r1)" }));
    await screen.findByText("r1 기준으로 사건을 확인했습니다.");
    await user.click(screen.getByRole("button", { name: "닫기" }));
    await waitFor(() => expect(row().getByTestId("event-review").textContent).toBe("최신 확인 (r1)"));
    // a new commit (r2) arrives
    t.latest.e3 = 2;
    await user.click(screen.getByRole("button", { name: "← 타임라인 목록" }));
    await user.click(document.querySelector<HTMLButtonElement>(".timeline-row")!);
    await waitFor(() => expect(row().getByTestId("event-review").textContent).toBe("재확인 필요 (r1 확인 → 지금 r2)"));
    await user.click(row().getByRole("button", { name: /불을 다룸/ }));
    expect(screen.getByText(/요약을 확인해도 이 표시는 남습니다/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "이대로 확인 (r2)" }));
    expect(t.b.confirmEvent).toHaveBeenLastCalledWith("s1", expect.any(String), expect.any(String), "r2");
    await screen.findByText("r2 기준으로 사건을 확인했습니다.");
  });

  it("S09.E tracks named, certainty shown, older event files read as confirmed or unknown", async () => {
    const t = timelineBackend();
    const user = await renderApp(t.b);
    // name the existing track and add one
    const trackRow = (l: string) => document.querySelector<HTMLElement>(`.tag-row[data-track="${l}"]`)!;
    await user.click(within(trackRow("본편")).getByRole("button", { name: "이름 바꾸기" }));
    const input = within(trackRow("본편")).getByLabelText("트랙 이름");
    await user.clear(input);
    await user.type(input, "회귀 전");
    await user.click(within(trackRow("본편")).getByRole("button", { name: "저장" }));
    await screen.findByText("트랙 이름을 ‘회귀 전’(으)로 바꿨습니다.");
    await user.type(screen.getByLabelText("새 트랙"), "1차 회귀");
    await user.click(screen.getByRole("button", { name: "트랙 추가" }));
    await screen.findByText("트랙 ‘1차 회귀’을(를) 추가했습니다.");
    expect(t.tracks().map((x) => x.label)).toEqual(["회귀 전", "1차 회귀"]);
    expect(t.tracks()[0].trackId).toBe("k0");

    await makeTimeline(user, "회귀 연표", "작중 시간");
    // older files: no certainty field
    const k = [...t.cols.keys()][0];
    const base = { collectionIds: [k], detail: "", tagIds: [], relatedCardIds: [], episodeOrder: null, storyLabel: null, ver: 0, reviewed: null, legacyCertainty: true, storyCertainty: "unknown" as const };
    t.recs.set("old-a", { ...base, eventId: "old-a", title: "예전 확정", episodeId: null, storyTrackId: "k0", storyOrder: 2 });
    t.recs.set("old-b", { ...base, eventId: "old-b", title: "예전 미상", episodeId: "e1", storyTrackId: null, storyOrder: null });
    // a new estimated event on 1차 회귀
    await user.click(screen.getByRole("button", { name: "사건 추가" }));
    await user.type(await screen.findByLabelText("제목"), "불씨 감지");
    await user.click(screen.getByLabelText("추정"));
    await user.selectOptions(screen.getByLabelText("트랙"), t.tracks()[1].trackId);
    await user.type(screen.getByLabelText("정렬 숫자"), "2");
    await user.click(screen.getAllByRole("button", { name: "사건 추가" }).find((x) => x.closest(".event-editor"))!);
    await screen.findByText("사건을 저장했습니다.");
    await user.click(screen.getByRole("button", { name: "닫기" }));
    const before = await screen.findByTestId("track-회귀 전");
    await waitFor(() => expect(within(before).queryByText("예전 확정")).toBeTruthy());
    const loop = screen.getByTestId("track-1차 회귀");
    expect(within(loop).getByText("불씨 감지")).toBeTruthy();
    expect(within(loop).getByText("추정")).toBeTruthy();
    expect(within(screen.getByTestId("unplaced-story")).getByText("예전 미상")).toBeTruthy();
    // an older file opened in the editor shows its derived certainty
    await user.click(within(before).getByRole("button", { name: /예전 확정/ }));
    expect((screen.getByLabelText("확정") as HTMLInputElement).checked).toBe(true);
  });
});

describe("draftProblem mirrors the Rust rules", () => {
  const d = (over: Partial<EventDraft>): EventDraft => ({
    collectionIds: ["k"],
    title: "x",
    detail: "",
    tagIds: [],
    relatedCardIds: [],
    episodeId: null,
    episodeOrder: null,
    storyCertainty: "unknown",
    storyTrackId: null,
    storyOrder: null,
    storyLabel: null,
    ...over,
  });
  it("classifies every combination", () => {
    expect(draftProblem(d({}))).toBe("noCoordinate");
    expect(draftProblem(d({ episodeId: "e1" }))).toBeNull();
    expect(draftProblem(d({ storyCertainty: "confirmed", storyTrackId: "k0", storyOrder: 1 }))).toBeNull();
    expect(draftProblem(d({ storyCertainty: "estimated", storyTrackId: "k0" }))).toBe("storyIncomplete");
    expect(draftProblem(d({ storyCertainty: "confirmed", storyOrder: 1 }))).toBe("storyIncomplete");
    expect(draftProblem(d({ title: " ", episodeId: "e1" }))).toBe("titleEmpty");
    expect(draftProblem(d({ collectionIds: [], episodeId: "e1" }))).toBe("noTimeline");
    expect(draftProblem(d({ episodeId: "e1", episodeOrder: Number.NaN }))).toBe("episodeOrder");
  });
});
