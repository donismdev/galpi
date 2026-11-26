// Shared test kit for the timeline root (09, 10): an in-memory backend with the same rules as
// timelines.rs / views.rs, and helpers to render the app on the timeline root.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
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
  type StateQuery,
  type StateResult,
  type ViewFilter,
  type ViewInfo,
  type Collection,
  type EventDraft,
  type EventInfo,
  type SaveEventRequest,
  type StoryTrack,
  type TimelineBackend,
  type ViewMode,
} from "./api";

export const koStore: LanguageStore = { kind: "desktop", load: async () => "ko", save: async () => {} };
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

export const ep = (n: number): EpisodeInfo => ({ episodeId: `e${n}`, number: n, title: "", createdAt: "t", folder: `episodes/${n}`, manuscriptRel: "x", manuscriptPath: "x" });
export const episodes = { numbers: [1, 2, 3] };
const episodeBackend = {
  supported: true,
  list: async () => ({ episodes: episodes.numbers.map(ep), problems: [] }),
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
  listTags: async () => [
    { tagId: "t1", label: "능력", cardCount: 0 },
    { tagId: "t-reg", label: "회귀", cardCount: 0 },
    { tagId: "t-sec", label: "비밀", cardCount: 0 },
  ],
};

export type Rec = EventDraft & { eventId: string; ver: number; reviewed: number | null; legacyCertainty?: boolean };

/** In-memory timelines with timelines.rs rules (validation, shared events, review vs latest commit). */
export function timelineBackend(opts: { latest?: Record<string, number> } = {}) {
  const latest = opts.latest ?? {};
  const cols = new Map<string, Collection>();
  const recs = new Map<string, Rec>();
  let tracks: StoryTrack[] = [{ trackId: "k0", label: "본편" }];
  let tracksVer = 0;
  let seq = 0;
  const views = new Map<string, ViewInfo>();
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
      views: [...views.values()],
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
    queryView: vi.fn(async (_s, f: ViewFilter) => [...recs.values()].map(info).filter((e) => keep(e, f)).map((e) => e.eventId)),
    queryState: vi.fn(async (_s, q: StateQuery) => state([...recs.values()].map(info), q)),
    createView: vi.fn(async (_s, _r, input) => {
      if (!input.label.trim()) throw { code: "invalidEvent", reason: "nameEmpty" };
      const v: ViewInfo = {
        viewId: `v${++seq}`,
        label: input.label,
        parentCollectionId: input.parentCollectionId,
        mode: input.mode ?? "both",
        ...input.filter,
        stateQuery: input.stateQuery,
        createdAt: "t",
        hash: "h0",
      };
      views.set(v.viewId, v);
      return v;
    }),
    updateView: vi.fn(async () => {
      throw { code: "unsupported" };
    }),
    deleteView: vi.fn(async (_s, id: string) => {
      views.delete(id);
    }),
    deleteEvent: vi.fn(async (_s, id: string, h: string) => {
      if (`h${recs.get(id)!.ver}` !== h) throw { code: "writeConflict" };
      recs.delete(id);
    }),
  };
  return { b, cols, recs, saves, latest, views, tracks: () => tracks };
}

export async function renderApp(tb: TimelineBackend, store: LanguageStore = koStore) {
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

export type U = Awaited<ReturnType<typeof renderApp>>;

export async function makeTimeline(user: U, name: string, mode: "회차" | "작중 시간" | "함께 보기" = "회차") {
  await user.type(screen.getByLabelText("타임라인 이름"), name);
  await user.click(within(screen.getByRole("radiogroup", { name: "기본 보기" })).getByLabelText(mode));
  await user.click(screen.getByRole("button", { name: "타임라인 만들기" }));
  await screen.findByRole("button", { name: "← 타임라인 목록" });
}

export async function addOnEpisode(user: U, n: number, title: string) {
  await user.click(within(screen.getByTestId(`ep-row-${n}`)).getByRole("button", { name: "+ 사건 추가" }));
  await user.type(await screen.findByLabelText("제목"), title);
  await user.click(screen.getByRole("button", { name: "사건 추가" }));
  await screen.findByText("사건을 저장했습니다.");
  await user.click(screen.getByRole("button", { name: "닫기" }));
}

export const tab = (name: string) => screen.getByRole("tab", { name: new RegExp(`^${name}`) });
export const idsIn = (el: ParentNode) => [...el.querySelectorAll("[data-event-id]")].map((x) => x.getAttribute("data-event-id"));


// Same rules as views.rs (filter_events / compute_state), for the fake backend.
const storyPos = (e: EventInfo) => (e.certainty !== "unknown" && e.storyTrackId && typeof e.storyOrder === "number" ? { t: e.storyTrackId, o: e.storyOrder } : null);
const inRange = (x: number, r: { from: number | null; to: number | null }) => (r.from == null || x >= r.from) && (r.to == null || x <= r.to);
export function keep(e: EventInfo, f: ViewFilter): boolean {
  if (f.collectionIds.length && !e.collectionIds.some((c) => f.collectionIds.includes(c))) return false;
  if (f.episodeRange && !(e.episodeNumber != null && inRange(e.episodeNumber, f.episodeRange))) return false;
  if (f.storyRange) {
    const p = storyPos(e);
    if (!p || p.t !== f.storyRange.trackId || !inRange(p.o, f.storyRange)) return false;
  }
  if (f.includeTagIds.length && !e.tagIds.some((t) => f.includeTagIds.includes(t))) return false;
  return !e.tagIds.some((t) => f.hideTagIds.includes(t));
}
export function state(events: EventInfo[], q: StateQuery): StateResult {
  if (q.basis !== "reader" && !q.trackId) throw { code: "invalidEvent", reason: "stateTrack" };
  const reader = (e: EventInfo) => e.episodeNumber != null && (q.episodeMax == null || e.episodeNumber <= q.episodeMax);
  const inStory = (e: EventInfo) => {
    const p = storyPos(e);
    return !!p && p.t === q.trackId && (q.storyMax == null || p.o <= q.storyMax);
  };
  const story = (e: EventInfo) => e.certainty === "confirmed" && inStory(e);
  const ok = (e: EventInfo) => (q.basis === "reader" ? reader(e) : q.basis === "story" ? story(e) : reader(e) && story(e));
  const rk = (e: EventInfo) => [e.episodeNumber ?? Infinity, e.episodeOrder ?? Infinity];
  const sk = (e: EventInfo) => storyPos(e)?.o ?? Infinity;
  const storyFirst = q.basis === "story" || (q.basis === "both" && q.primary === "story");
  const seen = events.filter(ok).sort((a, b) => {
    const r = rk(a)[0] - rk(b)[0] || rk(a)[1] - rk(b)[1];
    const s = sk(a) - sk(b);
    return (storyFirst ? s || r : r || s) || (a.eventId < b.eventId ? -1 : 1);
  });
  const keys = [...new Set(events.flatMap((e) => (e.changes ?? []).filter((c) => c.entityId === q.entityId).map((c) => c.propertyKey)))].sort();
  const values = keys.map((k) => ({ propertyKey: k, value: null as string | null, eventId: null as string | null }));
  for (const e of seen)
    for (const c of e.changes ?? [])
      if (c.entityId === q.entityId) {
        const v = values.find((x) => x.propertyKey === c.propertyKey)!;
        v.value = c.value;
        v.eventId = e.eventId;
      }
  return {
    entityId: q.entityId,
    values,
    considered: seen.map((e) => e.eventId),
    estimatedSkipped: q.basis === "reader" ? [] : events.filter((e) => e.certainty === "estimated" && inStory(e)).map((e) => e.eventId),
  };
}
