// Session 12: quick open ranking and keyboard, body search filters / paging / states, stale
// answers never over the newer query, back keeps query·filters·selection, revision hits open
// read-only, jump to the exact place (emoji, moved, missing), card lookups grouped by episode.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { EpisodeBackendProvider, EpisodesProvider } from "../episodes/EpisodesProvider";
import type { EpisodeBackend } from "../episodes/api";
import { I18nProvider } from "../i18n/I18nProvider";
import { WorkspaceProvider } from "../workspace/WorkspaceProvider";
import { WorldBackendCtx, browserWorldBackend, type WorldBackend } from "../world/api";
import { HistoryBackendProvider } from "../history/HistoryPanel";
import { browserHistoryBackend, type HistoryBackend } from "../history/api";
import { EditorGuardProvider, ManuscriptBackendProvider } from "../manuscript/EditorGuard";
import { ManuscriptEditor } from "../manuscript/ManuscriptEditor";
import type { ManuscriptBackend, ManuscriptRead } from "../manuscript/api";
import { OPEN_TIMELINE_EVENT } from "../timeline/api";
import { ep, episodes, koStore } from "../timeline/testkit";
import type { OpenedWorkspace, WorkspaceBackend } from "../workspace/api";
import { SearchBackendCtx, type Hit, type IndexStatus, type QuickItem, type SearchBackend, type SearchOptions, type SearchResult } from "./api";
import { rankQuick } from "./quickRank";
import { charToUtf16, clearReveal, requestReveal, resolveReveal } from "./reveal";
import { CardFinder } from "../world/CardFinder";

afterEach(() => {
  cleanup();
  clearReveal();
});

// ---------------------------------------------------------------- pure parts

const items: QuickItem[] = [
  { kind: "episode", id: "e351", title: "", aliases: [], number: 351, detail: null, path: "episodes/000351/manuscript.md" },
  { kind: "episode", id: "e35", title: "", aliases: [], number: 35, detail: null, path: "episodes/000035/manuscript.md" },
  { kind: "episode", id: "e3", title: "서린의 귀환", aliases: [], number: 3, detail: null, path: "episodes/000003/manuscript.md" },
  { kind: "card", id: "c-serin", title: "서린", aliases: ["린"], number: null, detail: "character", path: "lore/characters/c-serin/card.md" },
  { kind: "card", id: "c-serin-place", title: "서린", aliases: [], number: null, detail: "place", path: "lore/places/c-serin-place/card.md" },
  { kind: "card", id: "c-rindo", title: "린도윤", aliases: [], number: null, detail: "character", path: "lore/characters/c-rindo/card.md" },
  { kind: "view", id: "v-reg", title: "회귀편", aliases: [], number: null, detail: "회귀 연표", path: "timelines/views/v-reg.json" },
  { kind: "timeline", id: "k-reg", title: "회귀 연표", aliases: [], number: null, detail: null, path: "timelines/collections/k-reg.json" },
];

describe("12 quick open ranking", () => {
  it("S12.A number exact → name/alias exact → prefix → substring; kind/detail/path apart", () => {
    const first = (q: string) => rankQuick(items, q)[0];
    expect(first("351").item.id).toBe("e351");
    expect(first("351화").item.id).toBe("e351");
    expect(rankQuick(items, "35").map((m) => m.item.id).slice(0, 2)).toEqual(["e35", "e351"]);
    const serin = rankQuick(items, "서린");
    expect(serin.map((m) => [m.item.id, m.tier])).toEqual([
      ["c-serin", 1],
      ["c-serin-place", 1],
      ["e3", 2],
    ]);
    const rin = rankQuick(items, "린");
    expect(rin[0].item.id).toBe("c-serin");
    expect(rin[0].by).toBe("alias");
    expect(rin.map((m) => m.item.id)).toEqual(["c-serin", "c-rindo", "e3", "c-serin-place"]);
    expect(first("회귀편").item.id).toBe("v-reg");
    expect(rankQuick(items, "회귀").map((m) => m.item.kind)).toEqual(["view", "timeline"]);
    expect(rankQuick(items, "  ")).toEqual([]);
  });
});

describe("12 position", () => {
  it("S12.B emoji before the hit: char offset → UTF-16, exact Korean sentence", () => {
    const doc = "🔥🌙 새벽이 왔다. 사라진 맹세는 불꽃 속에 남았다.";
    expect(charToUtf16(doc, 2)).toBe(4);
    const r = resolveReveal(doc, { offset: 11, matched: "사라진 맹세는", before: "새벽이 왔다. ", after: " 불꽃" });
    expect(r.how).toBe("exact");
    expect(doc.slice(r.from, r.to)).toBe("사라진 맹세는");
  });
  it("text changed before the click: found again (by its context) or reported missing", () => {
    const now = "새 줄을 앞에 넣었다.\n\n불씨가 남았다. 다른 불씨도 있다.";
    const moved = resolveReveal(now, { offset: 0, matched: "불씨", before: "다른 ", after: "도" });
    expect(moved.how).toBe("moved");
    expect(now.slice(moved.from - 3, moved.to + 1)).toBe("다른 불씨도");
    expect(resolveReveal(now, { offset: 3, matched: "맹세", before: "", after: "" }).how).toBe("missing");
  });
});

// ---------------------------------------------------------------- app

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

const world: WorldBackend = {
  ...browserWorldBackend,
  list: async () => ({ cards: [], folders: [], problems: [] }),
  listTags: async () => [{ tagId: "t-secret", label: "비밀", cardCount: 0 }],
};

const status: IndexStatus = { state: "ready", generation: 0, docs: 3, fts5: true, path: "x", last: null, lastRebuild: null, error: null };

function hit(n: number, text: string, q: string, over: Partial<Hit> = {}): Hit {
  const i = text.indexOf(q);
  return { docKey: `manuscript:e${n}`, kind: "manuscript", docId: `e${n}`, revId: null, episodeId: `e${n}`, episodeNumber: n, title: `${n}화`, para: 0, offset: i, length: q.length, before: text.slice(0, i), matched: q, after: text.slice(i + q.length), history: false, ...over };
}
const result = (q: string, hits: Hit[], over: Partial<SearchResult> = {}): SearchResult => ({ query: q, path: q.length >= 3 ? "fts" : "scan", hits, meta: [], next: null, ...over });

type Deferred = { q: string; o: SearchOptions; request?: number; resolve: (r: SearchResult) => void };

function backendWith(over: Partial<SearchBackend> = {}) {
  const b: SearchBackend = {
    search: vi.fn(async (_s: string, q: string) => result(q, [])),
    status: async () => status,
    rebuild: vi.fn(),
    cancel: async () => {},
    cancelSearch: vi.fn(async () => {}),
    nameSearch: vi.fn(async () => []),
    linked: vi.fn(async () => []),
    quickItems: vi.fn(async () => items),
    ...over,
  };
  return b;
}

async function renderApp(b: SearchBackend, history: HistoryBackend = browserHistoryBackend) {
  episodes.numbers = [1, 2, 3, 4, 351];
  const user = userEvent.setup();
  render(
    <I18nProvider store={koStore}>
      <HistoryBackendProvider backend={history}>
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
      </HistoryBackendProvider>
    </I18nProvider>,
  );
  await screen.findByText("잿빛 항구", { selector: ".work-title" });
  return user;
}

const ctrl = (code: string, shift = false) => fireEvent.keyDown(window, { key: code.replace("Key", "").toLowerCase(), code, ctrlKey: true, shiftKey: shift });

describe("12 quick open palette", () => {
  it("S12.A Ctrl+P → ‘351’ Enter opens 351화 / ‘린’ the card / ‘회귀편’ the link; keyboard only; Esc cancels", async () => {
    const b = backendWith();
    const user = await renderApp(b);
    ctrl("KeyP");
    const box = await screen.findByRole("combobox", { name: "빠른 열기" });
    expect(document.activeElement).toBe(box);
    await user.type(box, "351");
    await waitFor(() => expect(within(screen.getByTestId("quick-list")).getAllByRole("option")[0].textContent).toContain("351화"));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await screen.findByRole("region", { name: "351화" });

    ctrl("KeyP");
    const box2 = await screen.findByRole("combobox", { name: "빠른 열기" });
    await user.type(box2, "린");
    await waitFor(() => expect(within(screen.getByTestId("quick-list")).getAllByRole("option")[0].textContent).toContain("별칭 ‘린’"));
    expect(within(screen.getByTestId("quick-list")).getAllByRole("option")[0].textContent).toContain("lore/characters/c-serin/card.md");
    // the same name twice: kind and path differ
    await user.clear(box2);
    await user.type(box2, "서린");
    await waitFor(() => expect(within(screen.getByTestId("quick-list")).getAllByRole("option").length).toBeGreaterThanOrEqual(3));
    const [a, c] = within(screen.getByTestId("quick-list")).getAllByRole("option");
    expect(a.textContent).toContain("인물");
    expect(c.textContent).toContain("장소");
    // IME composing Enter opens nothing
    fireEvent.keyDown(box2, { key: "Enter", keyCode: 229 });
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const seen: unknown[] = [];
    const on = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener(OPEN_TIMELINE_EVENT, on);
    ctrl("KeyP");
    const box3 = await screen.findByRole("combobox", { name: "빠른 열기" });
    await user.type(box3, "회귀편");
    await user.keyboard("{Enter}");
    window.removeEventListener(OPEN_TIMELINE_EVENT, on);
    expect(seen).toEqual([{ kind: "view", id: "v-reg" }]);
    await screen.findByRole("heading", { name: "타임라인", level: 1 });
  });

  it("already on 세계관: Ctrl+P → 서린 opens the card in place (no remount)", async () => {
    const card = { cardId: "c-serin", templateId: "character" as const, name: "서린", aliases: ["린"], tagIds: [], folder: "characters", createdAt: "t", dir: "lore/characters/c-serin" };
    world.list = async () => ({ cards: [card], folders: [{ path: "characters", count: 1 }], problems: [] });
    world.read = async () => ({ card, body: "# 서린 본문", bodyHash: "h", metaHash: "m" });
    try {
      const b = backendWith();
      const user = await renderApp(b);
      await user.click(screen.getByRole("button", { name: /세계관/ }));
      await screen.findByRole("heading", { name: "세계관", level: 1 });
      ctrl("KeyP");
      const box = await screen.findByRole("combobox", { name: "빠른 열기" });
      await user.type(box, "린");
      await waitFor(() => expect(within(screen.getByTestId("quick-list")).getAllByRole("option")[0].textContent).toContain("서린"));
      await user.keyboard("{Enter}");
      await screen.findByRole("group", { name: "이 카드로 찾기" });
    } finally {
      world.list = async () => ({ cards: [], folders: [], problems: [] });
      world.read = browserWorldBackend.read;
    }
  });

  it("last row hands the text to the body search (Ctrl+Shift+F)", async () => {
    const b = backendWith();
    const user = await renderApp(b);
    ctrl("KeyP");
    const box = await screen.findByRole("combobox", { name: "빠른 열기" });
    await user.type(box, "불씨");
    await user.click(screen.getByTestId("quick-body"));
    const panel = await screen.findByRole("region", { name: "작품 검색" });
    expect((within(panel).getByLabelText("찾을 말") as HTMLInputElement).value).toBe("불씨");
    await waitFor(() => expect(b.search).toHaveBeenCalledWith("s1", "불씨", expect.anything(), expect.any(Number)));
  });
});

describe("12 body search", () => {
  it("S12.C ‘불’ answered late never covers the longer query; back keeps filters, selection and query", async () => {
    const calls: Deferred[] = [];
    const b = backendWith({
      search: vi.fn((_s: string, q: string, o: SearchOptions, request?: number) => new Promise<SearchResult>((resolve) => calls.push({ q, o, request, resolve }))),
    });
    const user = await renderApp(b);
    ctrl("KeyF", true);
    const panel = await screen.findByRole("region", { name: "작품 검색" });
    const box = within(panel).getByLabelText("찾을 말");
    await user.type(box, "불");
    await waitFor(() => expect(calls.length).toBe(1));
    await user.type(box, "씨를");
    await waitFor(() => expect(calls.at(-1)!.q).toBe("불씨를"));
    const long = calls.at(-1)!;
    const short = calls[0];
    expect(long.request!).toBeGreaterThan(short.request!);
    await act(async () => long.resolve(result("불씨를", [hit(3, "그 아이는 남은 불씨를 감지했다.", "불씨를")])));
    await act(async () => short.resolve(result("불", [hit(1, "손끝에 불을 피웠다.", "불"), hit(3, "불씨", "불")])));
    await waitFor(() => expect(document.querySelectorAll(".search-hit").length).toBe(1));
    expect(document.querySelector(".search-hit mark")!.textContent).toBe("불씨를");

    // filter + keyboard selection, then open and come back
    await user.click(within(panel).getByLabelText("요약"));
    await waitFor(() => expect(calls.at(-1)!.o.kinds).toEqual(["summary"]));
    await act(async () => calls.at(-1)!.resolve(result("불씨를", [hit(3, "그 아이는 남은 불씨를 감지했다.", "불씨를", { kind: "summary", docKey: "summary:e3", title: "3화 요약" }), hit(4, "불씨를 다시 보았다.", "불씨를", { kind: "summary", docKey: "summary:e4", title: "4화 요약" })])));
    await waitFor(() => expect(document.querySelectorAll(".search-hit").length).toBe(2));
    box.focus();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(document.activeElement?.getAttribute("data-index")).toBe("1");
    fireEvent.keyDown(document.activeElement!, { key: "Enter", keyCode: 229 }); // composing: nothing
    expect(screen.queryByTestId("search-back")).toBeNull();
    await user.keyboard("{Enter}");
    await screen.findByTestId("search-back");
    expect(screen.queryByRole("region", { name: "작품 검색" })).toBeNull();
    await screen.findByRole("heading", { name: "회차 요약", level: 1 });
    fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true });
    const again = await screen.findByRole("region", { name: "작품 검색" });
    expect((within(again).getByLabelText("찾을 말") as HTMLInputElement).value).toBe("불씨를");
    expect((within(again).getByLabelText("요약") as HTMLInputElement).checked).toBe(true);
    await waitFor(() => expect(document.activeElement?.getAttribute("data-index")).toBe("1"));
    expect(document.querySelector('[data-index="1"]')!.getAttribute("aria-current")).toBe("true");
  });

  it("filters reach the backend: kinds, episode range, tags, history; long results page by 20", async () => {
    const many = Array.from({ length: 45 }, (_, i) => hit(i + 1, `${i + 1}화의 불씨`, "불씨"));
    const b = backendWith({ search: vi.fn(async (_s: string, q: string) => result(q, many)) });
    const user = await renderApp(b);
    ctrl("KeyF", true);
    const panel = await screen.findByRole("region", { name: "작품 검색" });
    await user.type(within(panel).getByLabelText("찾을 말"), "불씨");
    await waitFor(() => expect(document.querySelectorAll(".search-hit").length).toBe(20));
    expect(screen.getByTestId("search-pager").textContent).toContain("1–20 / 45개");
    await user.click(screen.getByRole("button", { name: "다음 쪽 →" }));
    expect(screen.getByTestId("search-pager").textContent).toContain("21–40 / 45개");
    await user.type(within(panel).getByLabelText("회차 부터"), "2");
    await user.type(within(panel).getByLabelText("회차 까지"), "9");
    await user.click(within(panel).getByLabelText("비밀"));
    await user.click(within(panel).getByLabelText("과거판(커밋)도 포함"));
    await waitFor(() => expect(b.search).toHaveBeenLastCalledWith("s1", "불씨", expect.objectContaining({ episodeFrom: 2, episodeTo: 9, tagIds: ["t-secret"], includeHistory: true }), expect.any(Number)));
    // a new answer starts at the first page
    await waitFor(() => expect(screen.getByTestId("search-pager").textContent).toContain("1–20 / 45개"));
  });

  it("zero hits, partial results while indexing, damaged cache rebuilt, cancel", async () => {
    let n = 0;
    const b = backendWith({
      search: vi.fn(async (_s: string, q: string) => {
        n += 1;
        if (q === "없는말") return result(q, []);
        return n === 2 ? result(q, [hit(1, "불씨", "불씨")], { pending: 7, reopened: "replacedDamaged" }) : result(q, [hit(1, "불씨", "불씨"), hit(3, "불씨", "불씨")]);
      }),
    });
    const user = await renderApp(b);
    ctrl("KeyF", true);
    const panel = await screen.findByRole("region", { name: "작품 검색" });
    const box = within(panel).getByLabelText("찾을 말");
    await user.type(box, "없는말");
    await screen.findByTestId("search-none");
    expect(screen.getByTestId("search-none").textContent).toContain("‘없는말’을(를) 찾지 못했습니다.");
    expect(screen.getByTestId("search-none").textContent).toContain("과거판(커밋)도 포함");
    await user.clear(box);
    await user.type(box, "불씨");
    await screen.findByTestId("search-partial");
    expect(screen.getByTestId("search-partial").textContent).toContain("7개 문서");
    expect(screen.getByTestId("search-reopened").textContent).toContain("손상");
    // asked again by itself until complete
    await waitFor(() => expect(screen.queryByTestId("search-partial")).toBeNull(), { timeout: 3000 });
    expect(document.querySelectorAll(".search-hit").length).toBe(2);
  });

  it("cancel stops waiting and keeps the screen usable", async () => {
    const b = backendWith({ search: vi.fn(() => new Promise<SearchResult>(() => {})) });
    const user = await renderApp(b);
    ctrl("KeyF", true);
    const panel = await screen.findByRole("region", { name: "작품 검색" });
    await user.type(within(panel).getByLabelText("찾을 말"), "아주 긴 검색");
    await user.click(await screen.findByTestId("search-cancel"));
    expect(b.cancelSearch).toHaveBeenCalled();
    await screen.findByTestId("search-cancelled");
    expect(screen.queryByTestId("search-busy")).toBeNull();
  });

  it("S12.B a past-revision hit opens that revision read-only with the sentence marked", async () => {
    const r1 = "🔥🌙 새벽이 왔다. 사라진 맹세는 불꽃 속에 남았다. 서린은 말이 없었다.";
    const q = "사라진 맹세는";
    const h = { ...hit(4, r1, q), offset: 11, docKey: "revision:e4:r1", kind: "revision" as const, revId: "r1", title: "4화 · r1", history: true };
    const history: HistoryBackend = { ...browserHistoryBackend, read: vi.fn(async () => ({ revisionId: "r1", ordinal: 1, text: r1, bom: false, lineEnding: "lf" as const, contentHash: "h" })) };
    const b = backendWith({ search: vi.fn(async (_s: string, qq: string, o: SearchOptions) => result(qq, o.includeHistory ? [h] : [])) });
    const user = await renderApp(b, history);
    ctrl("KeyF", true);
    const panel = await screen.findByRole("region", { name: "작품 검색" });
    await user.type(within(panel).getByLabelText("찾을 말"), q);
    await screen.findByTestId("search-none");
    await user.click(within(panel).getByLabelText("과거판(커밋)도 포함"));
    const row = await screen.findByText("4화 · r1");
    expect(document.querySelector(".search-hit")!.textContent).toContain("과거판");
    await user.click(row);
    const reader = await screen.findByTestId("revision-reader");
    expect(reader.textContent).toContain("읽기 전용");
    await waitFor(() => expect(screen.getByTestId("revision-mark").textContent).toBe(q));
    expect(history.read).toHaveBeenCalledWith("s1", "e4", "r1");
    expect(reader.querySelector("textarea, [contenteditable='true']")).toBeNull();
    await user.click(within(reader).getByRole("button", { name: "← 검색 결과로 (Alt+←)" }));
    await screen.findByRole("region", { name: "작품 검색" });
    expect(screen.queryByTestId("revision-reader")).toBeNull();
  });
});

// ---------------------------------------------------------------- editor lands on the hit

function manuscript(text: string): ManuscriptBackend {
  const read: ManuscriptRead = { state: "ok", episodeId: "e4", text, hash: "sha256:h0", bom: false, lineEnding: "lf", mixedLineEndings: false, path: "C:\\작품\\m.md" };
  return {
    read: vi.fn(async () => read),
    save: vi.fn(),
    saveDraft: vi.fn(),
    probe: vi.fn(async () => ({ exists: true, hash: "sha256:h0" })),
    onDiskChange: vi.fn(async () => () => {}),
    loadDraft: vi.fn(async () => null),
    discardDraft: vi.fn(async () => {}),
    reveal: vi.fn(async () => {}),
  } as unknown as ManuscriptBackend;
}

async function editorAt(text: string) {
  render(
    <I18nProvider store={koStore}>
      <EditorGuardProvider>
        <ManuscriptBackendProvider backend={manuscript(text)}>
          <ManuscriptEditor sessionId="s1" episodeId="e4" readOnly={false} />
        </ManuscriptBackendProvider>
      </EditorGuardProvider>
    </I18nProvider>,
  );
  const note = await screen.findByTestId("reveal-note");
  const view = EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement)!;
  const sel = view.state.selection.main;
  return { note, picked: view.state.sliceDoc(sel.from, sel.to) };
}

describe("12 editor jump", () => {
  it("lands on the exact Korean sentence after emoji", async () => {
    requestReveal({ episodeId: "e4", revId: null, offset: 11, matched: "사라진 맹세는", before: "", after: "" });
    const { note, picked } = await editorAt("🔥🌙 새벽이 왔다. 사라진 맹세는 불꽃 속에 남았다.");
    expect(note.getAttribute("data-how")).toBe("exact");
    expect(picked).toBe("사라진 맹세는");
  });
  it("text changed since the search: found again and said so; gone: said so, nothing selected", async () => {
    requestReveal({ episodeId: "e4", revId: null, offset: 2, matched: "불씨", before: "남은 ", after: "를" });
    const a = await editorAt("앞에 새 문단을 넣었다.\n\n남은 불씨를 감지했다.");
    expect(a.note.getAttribute("data-how")).toBe("moved");
    expect(a.picked).toBe("불씨");
    cleanup();
    requestReveal({ episodeId: "e4", revId: null, offset: 2, matched: "맹세", before: "", after: "" });
    const b = await editorAt("맹 세가 아니다.");
    expect(b.note.getAttribute("data-how")).toBe("missing");
    expect(b.picked).toBe("");
  });
});

// ---------------------------------------------------------------- S12.D

describe("12 CH3 card lookups", () => {
  it("S12.D two lookups stay apart; two events of one episode are one row with two pieces of evidence", async () => {
    const b = backendWith({
      nameSearch: vi.fn(async () => [{ episodeId: "e1", number: 1, hits: [{ name: "서린", offset: 0, before: "", after: "은 손끝" }] }]),
      linked: vi.fn(async () => [{ episodeId: "e3", number: 3, hits: [{ kind: "event" as const, id: "v1", title: "그 아이의 정체" }, { kind: "event" as const, id: "v2", title: "서린의 첫 대사" }] }]),
    });
    const user = userEvent.setup();
    render(
      <I18nProvider store={koStore}>
        <SearchBackendCtx.Provider value={b}>
          <CardFinder sessionId="s1" cardId="c1" />
        </SearchBackendCtx.Provider>
      </I18nProvider>,
    );
    await user.click(await screen.findByRole("button", { name: "이름·별칭 본문 검색" }));
    await user.click(screen.getByRole("button", { name: "연결된 회차" }));
    const names = await screen.findByTestId("name-results");
    const linked = await screen.findByTestId("linked-results");
    expect([...names.querySelectorAll("[data-episode]")].map((x) => x.getAttribute("data-episode"))).toEqual(["1"]);
    const rows = linked.querySelectorAll("[data-episode]");
    expect(rows.length).toBe(1);
    expect(rows[0].querySelectorAll(".event-chip").length).toBe(2);
    expect(linked.textContent).not.toContain("은 손끝");
    expect(names.textContent).not.toContain("그 아이의 정체");
  });
});
