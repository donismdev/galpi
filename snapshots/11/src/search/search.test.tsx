// Session 11: top-bar search, result kinds, short-search paging, history only on request,
// index status/rebuild, and the card's two CH3 lookups.
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { EpisodeBackendProvider, EpisodesProvider } from "../episodes/EpisodesProvider";
import type { EpisodeBackend } from "../episodes/api";
import { I18nProvider } from "../i18n/I18nProvider";
import { WorkspaceProvider } from "../workspace/WorkspaceProvider";
import { WorldBackendCtx, browserWorldBackend, type WorldBackend } from "../world/api";
import { ep, episodes, koStore } from "../timeline/testkit";
import type { OpenedWorkspace, WorkspaceBackend } from "../workspace/api";
import { SearchBackendCtx, type Hit, type IndexStatus, type SearchBackend, type SearchOptions, type SearchResult } from "./api";

afterEach(cleanup);

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

const card = { cardId: "c1", templateId: "character" as const, name: "서린", aliases: ["린"], tagIds: [], folder: "characters", createdAt: "t", dir: "lore/characters/c1" };
const world: WorldBackend = {
  ...browserWorldBackend,
  list: async () => ({ cards: [card], folders: [{ path: "characters", count: 1 }, { path: "places", count: 0 }, { path: "groups", count: 0 }, { path: "notes", count: 0 }], problems: [] }),
  read: async () => ({ card, body: "# 서린", bodyHash: "h", metaHash: "m" }),
};

const TEXTS: Record<number, string> = {
  1: "서린은 손끝에 불을 피웠다. \"불씨\"라는 말이 50% 확률로 돌았다. snake_case 와 Hello World.",
  2: "편지에는 린이라고만 적혀 있었다.",
  3: "그 아이는 남은 불씨를 감지했다. 서린이 웃었다.",
};

/** Same matching as search.rs (case-insensitive per char); scan pages of 1 paragraph for short queries. */
function searchBackend() {
  let status: IndexStatus = { state: "ready", generation: 0, docs: 3, fts5: true, path: "C:\\appdata\\index\\x.sqlite", last: { scanned: 3, changed: [], removed: [], touched: 0, unreadable: [] }, lastRebuild: null, error: null };
  const find = (q: string, o: SearchOptions): SearchResult => {
    const short = q.length < 3;
    const docs: [number, string, boolean][] = [...Object.entries(TEXTS).map(([n, t]) => [Number(n), t, false] as [number, string, boolean]), [3, "그 아이는 남은 불씨를 감지했다. (r1)", true]];
    const keep = docs.filter(([, , hist]) => o.includeHistory || !hist);
    const start = short ? o.cursor ?? 0 : 0;
    const page = short ? keep.slice(start, start + 2) : keep;
    const hits: Hit[] = [];
    for (const [n, text, hist] of page) {
      const low = text.toLowerCase();
      let i = low.indexOf(q.toLowerCase());
      while (i >= 0) {
        hits.push({ docKey: `${hist ? "revision" : "manuscript"}:e${n}`, kind: hist ? "revision" : "manuscript", docId: `e${n}`, revId: hist ? "r1" : null, episodeId: `e${n}`, episodeNumber: n, title: `${n}화${hist ? " · r1" : ""}`, para: 0, offset: i, length: q.length, before: text.slice(Math.max(0, i - 5), i), matched: text.slice(i, i + q.length), after: text.slice(i + q.length, i + q.length + 5), history: hist });
        i = low.indexOf(q.toLowerCase(), i + 1);
      }
    }
    return {
      query: q,
      path: short ? "scan" : "fts",
      hits,
      meta: q === "서린" ? [{ docKey: "card:c1", kind: "card", docId: "c1", title: "서린", by: "title", value: "서린" }] : [],
      next: short && start + 2 < keep.length ? start + 2 : null,
    };
  };
  const b: SearchBackend = {
    search: vi.fn(async (_s, q, o) => find(q, o)),
    status: vi.fn(async () => status),
    rebuild: vi.fn(async () => {
      status = { ...status, state: "rebuilding", generation: status.generation + 1 };
      return status.generation;
    }),
    cancel: vi.fn(async () => {
      status = { ...status, state: "ready" };
    }),
    nameSearch: vi.fn(async (_s, _c, from, to) =>
      [
        { episodeId: "e1", number: 1, hits: [{ name: "서린", offset: 0, before: "", after: "은 손끝" }] },
        { episodeId: "e2", number: 2, hits: [{ name: "린", offset: 5, before: "편지에는 ", after: "이라고" }] },
        { episodeId: "e3", number: 3, hits: [{ name: "서린", offset: 18, before: "", after: "이 웃" }] },
      ].filter((e) => (from == null || e.number >= from) && (to == null || e.number <= to)),
    ),
    linked: vi.fn(async (_s, _c, from, to) => [{ episodeId: "e3", number: 3, hits: [{ kind: "event" as const, id: "v1", title: "그 아이의 정체" }] }].filter((e) => (from == null || e.number >= from) && (to == null || e.number <= to))),
  };
  return b;
}

async function renderApp(b: SearchBackend) {
  episodes.numbers = [1, 2, 3];
  const user = userEvent.setup();
  render(
    <I18nProvider store={koStore}>
      <WorkspaceProvider backend={wsBackend}>
        <WorldBackendCtx.Provider value={world}>
          <SearchBackendCtx.Provider value={b}>
            <EpisodeBackendProvider backend={episodeBackend}>
              <EpisodesProvider>
                <App />
              </EpisodesProvider>
            </EpisodeBackendProvider>
          </SearchBackendCtx.Provider>
        </WorldBackendCtx.Provider>
      </WorkspaceProvider>
    </I18nProvider>,
  );
  await screen.findByText("잿빛 항구", { selector: ".work-title" });
  return user;
}

async function searchFor(user: ReturnType<typeof userEvent.setup>, q: string) {
  const box = screen.getByRole("searchbox", { name: "작품 검색" });
  await user.clear(box);
  await user.type(box, `${q}{Enter}`);
  return screen.findByRole("region", { name: "작품 검색" });
}

const hitEpisodes = () => [...document.querySelectorAll(".search-hit")].map((x) => `${x.getAttribute("data-kind")}:${x.getAttribute("data-episode")}`);

describe("11 search", () => {
  it("S11.A searches from the top bar: 3+ chars via index, quotes and % literally, name meta hit", async () => {
    const b = searchBackend();
    const user = await renderApp(b);
    await searchFor(user, "감지했다");
    await waitFor(() => expect(hitEpisodes()).toEqual(["manuscript:3"]));
    expect(screen.getByTestId("search-path").textContent).toBe("색인 검색(3글자 이상)");
    expect(document.querySelector(".search-hit mark")!.textContent).toBe("감지했다");
    await searchFor(user, "\"불씨\"");
    await waitFor(() => expect(hitEpisodes()).toEqual(["manuscript:1"]));
    await searchFor(user, "HELLO");
    await waitFor(() => expect(hitEpisodes()).toEqual(["manuscript:1"]));
    await searchFor(user, "서린");
    await waitFor(() => expect(screen.getAllByTestId("meta-hit")[0].textContent).toContain("이름 ‘서린’"));
  });

  it("short searches scan in pages until every match is found; history only when ticked", async () => {
    const b = searchBackend();
    const user = await renderApp(b);
    await searchFor(user, "린");
    await waitFor(() => expect(hitEpisodes()).toEqual(["manuscript:1", "manuscript:2"]));
    expect(screen.getByTestId("search-path").textContent).toBe("원문 직접 검색(1~2글자)");
    await user.click(screen.getByRole("button", { name: "더 찾기" }));
    await waitFor(() => expect(hitEpisodes()).toEqual(["manuscript:1", "manuscript:2", "manuscript:3"]));
    expect(screen.queryByRole("button", { name: "더 찾기" })).toBeNull();
    // history off by default, merged when asked
    await searchFor(user, "감지했다");
    await waitFor(() => expect(hitEpisodes()).toEqual(["manuscript:3"]));
    await user.click(screen.getByLabelText("과거판(커밋)도 포함"));
    await waitFor(() => expect(hitEpisodes()).toEqual(["manuscript:3", "revision:3"]));
    expect(screen.getByText("과거판", { selector: ".certainty" })).toBeTruthy();
    expect(b.search).toHaveBeenLastCalledWith("s1", "감지했다", expect.objectContaining({ includeHistory: true }));
  });

  it("index status, rebuild and cancel", async () => {
    const b = searchBackend();
    const user = await renderApp(b);
    await searchFor(user, "불씨");
    await waitFor(() => expect(screen.getByTestId("index-status").textContent).toContain("색인: 문서 3개"));
    await user.click(screen.getByRole("button", { name: "색인 다시 만들기" }));
    await waitFor(() => expect(screen.getByTestId("index-status").textContent).toContain("새로 만드는 중"));
    expect(b.rebuild).toHaveBeenCalledWith("s1");
    await user.click(screen.getByRole("button", { name: "다시 만들기 취소" }));
    await waitFor(() => expect(screen.getByTestId("index-status").textContent).toContain("색인: 문서 3개"));
  });
});

describe("11 CH3 card lookups", () => {
  it("S11.D name/alias search shows 2화 by ‘린’; linked episodes do not; range 3~3 drops 2화", async () => {
    const b = searchBackend();
    const user = await renderApp(b);
    await user.click(screen.getByRole("button", { name: /세계관/ }));
    await user.click(await screen.findByRole("button", { name: /^서린/ }));
    const finder = await screen.findByRole("group", { name: "이 카드로 찾기" });
    await user.click(within(finder).getByRole("button", { name: "이름·별칭 본문 검색" }));
    const names = await screen.findByTestId("name-results");
    const row2 = names.querySelector('[data-episode="2"]')!;
    expect(row2.querySelector(".tag-chip")!.textContent).toBe("린");
    await user.click(within(finder).getByRole("button", { name: "연결된 회차" }));
    const linked = await screen.findByTestId("linked-results");
    expect([...linked.querySelectorAll("[data-episode]")].map((x) => x.getAttribute("data-episode"))).toEqual(["3"]);
    await user.type(within(finder).getByLabelText("회차 시작"), "3");
    await user.type(within(finder).getByLabelText("회차 끝"), "3");
    await user.click(within(finder).getByRole("button", { name: "이름·별칭 본문 검색" }));
    await waitFor(() => expect([...screen.getByTestId("name-results").querySelectorAll("[data-episode]")].map((x) => x.getAttribute("data-episode"))).toEqual(["3"]));
    expect(b.nameSearch).toHaveBeenLastCalledWith("s1", "c1", 3, 3);
  });
});
