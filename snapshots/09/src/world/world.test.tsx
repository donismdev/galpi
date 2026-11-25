// Session 08: world cards, templates, aliases, tags (hide / remove from card / rename / cleanup).
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { EpisodeBackendProvider, EpisodesProvider } from "../episodes/EpisodesProvider";
import type { EpisodeBackend } from "../episodes/api";
import { I18nProvider } from "../i18n/I18nProvider";
import type { LanguageStore } from "../settings/languageStore";
import type { OpenedWorkspace, WorkspaceBackend } from "../workspace/api";
import { WorkspaceProvider } from "../workspace/WorkspaceProvider";
import { WorldPanel } from "./WorldPanel";
import {
  DEFAULT_FOLDER,
  TOP_FOLDERS,
  WorldBackendCtx,
  type CardDoc,
  type CardInfo,
  type CreateCardRequest,
  type HiddenTagStore,
  type MetaPatch,
  type TagInfo,
  type WorldBackend,
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

const episodeBackend = {
  supported: true,
  list: async () => ({ episodes: [], problems: [] }),
  create: vi.fn(),
  rename: vi.fn(),
  openExternal: vi.fn(),
  detectEditors: async () => ({ vscode: null, vscodeTried: [], notepad: null }),
  editorSettings: async () => ({ kind: "vscode" }),
  setEditorSettings: async (s: unknown) => s,
} as unknown as EpisodeBackend;

/** In-memory cards and tags with the same rules as lore.rs (IDs fixed, hashes checked). */
function worldBackend() {
  const cards = new Map<string, { info: CardInfo; body: string; ver: number }>();
  const tags = new Map<string, string>();
  const folders = new Set<string>(TOP_FOLDERS);
  let seq = 0;
  const requests = new Map<string, string>();
  const doc = (id: string): CardDoc => {
    const c = cards.get(id)!;
    return { card: { ...c.info, aliases: [...c.info.aliases], tagIds: [...c.info.tagIds] }, body: c.body, bodyHash: `b:${c.body}`, metaHash: `m${c.ver}` };
  };
  const b: WorldBackend = {
    list: vi.fn(async () => ({
      cards: [...cards.values()].map((c) => ({ ...c.info })).sort((x, y) => (x.folder + x.name).localeCompare(y.folder + y.name)),
      folders: [...folders].sort().map((path) => ({ path, count: [...cards.values()].filter((c) => c.info.folder === path).length })),
      problems: [],
    })),
    read: vi.fn(async (_s, id) => doc(id)),
    create: vi.fn(async (req: CreateCardRequest) => {
      const prev = requests.get(req.requestId);
      if (prev) return { ...cards.get(prev)!.info };
      const id = `c${++seq}`;
      const folder = req.folder ?? DEFAULT_FOLDER[req.templateId];
      folders.add(folder);
      cards.set(id, { info: { cardId: id, templateId: req.templateId, name: req.name, aliases: [], tagIds: [], folder, createdAt: "t", dir: `lore/${folder}/${id}` }, body: req.body, ver: 0 });
      requests.set(req.requestId, id);
      return { ...cards.get(id)!.info };
    }),
    saveBody: vi.fn(async (_s, _r, id, text, expected) => {
      const c = cards.get(id)!;
      if (`b:${c.body}` !== expected) throw { code: "writeConflict" };
      c.body = text;
      return doc(id);
    }),
    updateMeta: vi.fn(async (_s, _r, id, patch: MetaPatch, expected) => {
      const c = cards.get(id)!;
      if (`m${c.ver}` !== expected) throw { code: "writeConflict" };
      if (patch.name) c.info.name = patch.name;
      if (patch.aliases) c.info.aliases = patch.aliases.filter((a) => a !== c.info.name);
      if (patch.tagIds) c.info.tagIds = patch.tagIds;
      c.ver++;
      return doc(id);
    }),
    move: vi.fn(async (_s, _r, id, folder) => {
      const c = cards.get(id)!;
      c.info.folder = folder;
      c.info.dir = `lore/${folder}/${id}`;
      c.ver++;
      return doc(id);
    }),
    createFolder: vi.fn(async (_s, f) => {
      folders.add(f);
      return f;
    }),
    listTags: vi.fn(async (): Promise<TagInfo[]> =>
      [...tags].map(([tagId, label]) => ({ tagId, label, cardCount: [...cards.values()].filter((c) => c.info.tagIds.includes(tagId)).length })),
    ),
    createTag: vi.fn(async (_s, _r, label) => {
      const tagId = `t${++seq}`;
      tags.set(tagId, label);
      return { tagId, label, cardCount: 0 };
    }),
    renameTag: vi.fn(async (_s, _r, tagId, label) => {
      tags.set(tagId, label);
      return { tagId, label, cardCount: 0 };
    }),
    deleteTagEverywhere: vi.fn(async (_s, _r, tagId) => {
      let n = 0;
      for (const c of cards.values())
        if (c.info.tagIds.includes(tagId)) {
          c.info.tagIds = c.info.tagIds.filter((x) => x !== tagId);
          n++;
        }
      tags.delete(tagId);
      return n;
    }),
  };
  return { b, cards, tags };
}

function memoryHidden(): HiddenTagStore & { data: Record<string, string[]> } {
  const data: Record<string, string[]> = {};
  return { data, load: (w) => data[w] ?? [], save: (w, ids) => (data[w] = ids) };
}

async function renderWorld(b: WorldBackend, hidden: HiddenTagStore = memoryHidden(), store: LanguageStore = koStore) {
  const ui = (
    <I18nProvider store={store}>
      <WorkspaceProvider backend={wsBackend}>
        <WorldBackendCtx.Provider value={b}>
          <EpisodeBackendProvider backend={episodeBackend}>
            <EpisodesProvider>
              <WorldPanel hiddenStore={hidden} />
            </EpisodesProvider>
          </EpisodeBackendProvider>
        </WorldBackendCtx.Provider>
      </WorkspaceProvider>
    </I18nProvider>
  );
  const r = render(ui);
  await waitFor(() => {
    if (!document.querySelector(".world")) throw new Error("no world yet");
  });
  return r;
}

async function makeCard(user: ReturnType<typeof userEvent.setup>, name: string, opts: { template?: string; folder?: string } = {}) {
  if (opts.template) await user.selectOptions(screen.getByLabelText("템플릿"), opts.template);
  if (opts.folder) await user.selectOptions(screen.getByLabelText("넣을 폴더"), opts.folder);
  await user.type(screen.getByLabelText("이름"), name);
  await user.click(screen.getByRole("button", { name: /카드 만들기$/ }));
  await screen.findByRole("button", { name: "← 카드 목록" });
}

const rows = () => [...document.querySelectorAll<HTMLButtonElement>(".card-row")];

describe("08 world cards", () => {
  it("world root shows the card panel in the app", async () => {
    const { b } = worldBackend();
    const user = userEvent.setup();
    render(
      <I18nProvider store={koStore}>
        <WorkspaceProvider backend={wsBackend}>
          <WorldBackendCtx.Provider value={b}>
            <EpisodeBackendProvider backend={episodeBackend}>
              <EpisodesProvider>
                <App />
              </EpisodesProvider>
            </EpisodeBackendProvider>
          </WorldBackendCtx.Provider>
        </WorkspaceProvider>
      </I18nProvider>,
    );
    await screen.findByText("잿빛 항구", { selector: ".work-title" });
    await user.click(screen.getByRole("button", { name: /세계관/ }));
    expect(await screen.findByText("아직 카드가 없습니다. 위에서 템플릿을 골라 만들어 보세요.")).toBeTruthy();
    expect(screen.queryByText(/나중 회차/)).toBeNull();
  });

  it("each template creates its questions in the default folder; text is copied at creation", async () => {
    const { b, cards } = worldBackend();
    const user = userEvent.setup();
    await renderWorld(b);
    await makeCard(user, "서린");
    const c = [...cards.values()][0];
    expect(c.info.folder).toBe("characters");
    expect(c.body).toBe("# 서린\n\n## 욕구 — 무엇을 가장 원하는가?\n\n\n## 약점 — 무엇에 흔들리는가?\n\n\n## 관계 — 누구와 어떤 사이인가?\n\n");
    await user.click(screen.getByRole("button", { name: "← 카드 목록" }));
    for (const [tpl, folder, q] of [
      ["personality", "characters", "## 압박 반응"],
      ["place", "places", "## 연결 장소"],
      ["group", "groups", "## 목표"],
      ["rule", "notes", "## 예외"],
      ["note", "notes", "# "],
    ] as const) {
      await makeCard(user, `x-${tpl}`, { template: tpl });
      const made = [...cards.values()].find((x) => x.info.name === `x-${tpl}`)!;
      expect(made.info.folder).toBe(folder);
      expect(made.body).toContain(q);
      await user.click(screen.getByRole("button", { name: "← 카드 목록" }));
    }
    expect(rows()).toHaveLength(6);
  });

  it("S08.A same name in two folders: list shows paths; rename + move keep ID, tags, body", async () => {
    const { b, cards } = worldBackend();
    const user = userEvent.setup();
    await renderWorld(b);
    // two subfolders
    for (const sub of ["주연", "조연"]) {
      await user.selectOptions(screen.getByLabelText("폴더"), "characters");
      await user.type(screen.getByLabelText(/아래 새 폴더$/), sub);
      await user.click(screen.getByRole("button", { name: "폴더 만들기" }));
      await screen.findByText(`‘인물/${sub}’ 폴더를 만들었습니다.`);
    }
    await user.selectOptions(screen.getByLabelText("폴더"), "");
    await makeCard(user, "서린", { folder: "characters/주연" });
    await user.click(screen.getByRole("button", { name: "← 카드 목록" }));
    await makeCard(user, "서린", { folder: "characters/조연" });
    await user.click(screen.getByRole("button", { name: "← 카드 목록" }));
    // tag on the first
    await user.type(screen.getByLabelText("새 태그"), "주인공");
    await user.click(screen.getByRole("button", { name: "태그 만들기" }));
    await screen.findByText("태그 ‘주인공’를 만들었습니다.");
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(rows().map((r) => r.querySelector(".card-folder")?.textContent)).toEqual(["인물/조연", "인물/주연"]);
    expect(rows().every((r) => r.querySelector(".same-name"))).toBe(true);

    await user.click(rows()[1]);
    const id = (await screen.findByTestId("card-id")).textContent!;
    await user.click(screen.getByRole("checkbox", { name: "주인공" }));
    await screen.findByText("태그 ‘주인공’를 붙였습니다.");
    const body = screen.getByLabelText(/카드 본문/);
    await user.clear(body);
    await user.type(body, "# 서린\n욕구: 불");
    await user.click(screen.getByRole("button", { name: "본문 저장" }));
    await screen.findByText("본문을 저장했습니다.");

    const name = screen.getAllByLabelText("이름")[0];
    await user.clear(name);
    await user.type(name, "한서린");
    await user.click(screen.getByRole("button", { name: "이름 바꾸기" }));
    await screen.findByText("이름을 바꿨습니다. 카드 ID는 그대로입니다.");
    await user.selectOptions(screen.getByLabelText("폴더"), "characters");
    await user.click(screen.getByRole("button", { name: "이 폴더로 옮기기" }));
    await screen.findByText(/‘인물’\(으\)로 옮겼습니다/);

    expect(screen.getByTestId("card-id").textContent).toBe(id);
    expect(screen.getByTestId("card-path").textContent).toBe("인물");
    expect((screen.getByRole("checkbox", { name: "주인공" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/카드 본문/) as HTMLTextAreaElement).value).toBe("# 서린\n욕구: 불");
    const stored = cards.get(id)!;
    expect(stored.info).toMatchObject({ name: "한서린", folder: "characters", tagIds: [expect.any(String)] });
    // The other 서린 is untouched.
    expect([...cards.values()].find((c) => c.info.cardId !== id)!.info).toMatchObject({ name: "서린", folder: "characters/조연", tagIds: [] });
  });

  it("S08.B alias 린 is saved and found by search after remount; hiding tag A keeps data", async () => {
    const { b, cards } = worldBackend();
    const hidden = memoryHidden();
    const user = userEvent.setup();
    const r = await renderWorld(b, hidden);
    await makeCard(user, "서린");
    await user.type(screen.getByLabelText(/^별칭/), "린");
    await user.click(screen.getByRole("button", { name: "별칭 저장" }));
    await screen.findByText("별칭을 저장했습니다.");
    await user.click(screen.getByRole("button", { name: "← 카드 목록" }));
    await makeCard(user, "도윤");
    await user.click(screen.getByRole("button", { name: "← 카드 목록" }));
    await user.type(screen.getByLabelText("새 태그"), "A");
    await user.click(screen.getByRole("button", { name: "태그 만들기" }));
    await screen.findByText("태그 ‘A’를 만들었습니다.");
    // tag A on 서린
    await waitFor(() => expect(rows()).toHaveLength(2));
    await user.click(rows().find((x) => x.textContent!.includes("서린"))!);
    await user.click(await screen.findByRole("checkbox", { name: "A" }));
    await screen.findByText("태그 ‘A’를 붙였습니다.");
    await user.click(screen.getByRole("button", { name: "← 카드 목록" }));

    r.unmount();
    await renderWorld(b, hidden); // reopen
    await waitFor(() => expect(rows()).toHaveLength(2));
    await user.type(screen.getByLabelText("이름·별칭 검색"), "린");
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0].textContent).toContain("서린");
    expect(rows()[0].textContent).toContain("(린)");
    await user.clear(screen.getByLabelText("이름·별칭 검색"));

    const tagRow = () => document.querySelector<HTMLElement>('.tag-row[data-tag="A"]')!;
    await waitFor(() => expect(tagRow().textContent).toContain("카드 1개"));
    await user.click(within(tagRow()).getByRole("button", { name: "보기에서 숨기기" }));
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0].textContent).toContain("도윤");
    expect(screen.getByTestId("hidden-note").textContent).toContain("카드 1개");
    expect(hidden.data.w1).toHaveLength(1);
    expect(tagRow().textContent).toContain("카드 1개"); // data count unchanged
    expect(b.updateMeta).toHaveBeenCalledTimes(2); // hide wrote nothing (alias + tag only)

    await user.click(within(tagRow()).getByRole("button", { name: "다시 보이기" }));
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(tagRow().textContent).toContain("카드 1개");
    expect([...cards.values()].find((c) => c.info.name === "서린")!.info.tagIds).toHaveLength(1);
  });

  it("tag rename keeps the ID; remove-from-card vs global cleanup with impact count first", async () => {
    const { b, cards, tags } = worldBackend();
    const user = userEvent.setup();
    await renderWorld(b);
    await user.type(screen.getByLabelText("새 태그"), "B");
    await user.click(screen.getByRole("button", { name: "태그 만들기" }));
    await screen.findByText("태그 ‘B’를 만들었습니다.");
    for (const n of ["가", "나", "다"]) {
      await makeCard(user, n);
      await user.click(await screen.findByRole("checkbox", { name: "B" }));
      await screen.findByText("태그 ‘B’를 붙였습니다.");
      await user.click(screen.getByRole("button", { name: "← 카드 목록" }));
    }
    const tagId = [...tags.keys()][0];
    // remove from one card only
    await waitFor(() => expect(rows()).toHaveLength(3));
    await user.click(rows()[0]);
    await user.click(await screen.findByRole("checkbox", { name: "B" }));
    await screen.findByText(/이 카드에서만 태그 ‘B’를 뗐습니다/);
    await user.click(screen.getByRole("button", { name: "← 카드 목록" }));
    const tagRow = () => document.querySelector<HTMLElement>(".tag-row")!;
    await waitFor(() => expect(tagRow().textContent).toContain("카드 2개"));
    // rename
    await user.click(within(tagRow()).getByRole("button", { name: "이름 바꾸기" }));
    const input = within(tagRow()).getByLabelText("태그 이름");
    await user.clear(input);
    await user.type(input, "보조");
    await user.click(within(tagRow()).getByRole("button", { name: "저장" }));
    await screen.findByText(/태그 이름을 ‘보조’/);
    expect([...tags.entries()]).toEqual([[tagId, "보조"]]);
    // cleanup: impact first, cancel does nothing
    await user.click(within(tagRow()).getByRole("button", { name: "전역 정리…" }));
    const dlg = screen.getByRole("alertdialog");
    expect(dlg.textContent).toContain("카드 2개에서 떼고");
    await user.click(within(dlg).getByRole("button", { name: "취소" }));
    expect(b.deleteTagEverywhere).not.toHaveBeenCalled();
    await user.click(within(tagRow()).getByRole("button", { name: "전역 정리…" }));
    await user.click(screen.getByRole("button", { name: "카드 2개에서 떼고 태그 지우기" }));
    await screen.findByText("태그 ‘보조’를 카드 2개에서 떼고 지웠습니다.");
    expect(tags.size).toBe(0);
    expect(cards.size).toBe(3);
  });

  it("S08.C a Korean character card keeps its questions and answers in the English UI", async () => {
    const { b, cards } = worldBackend();
    const user = userEvent.setup();
    let lang: "ko" | "en" = "ko";
    const store: LanguageStore = { kind: "desktop", load: async () => lang, save: async (l) => void (lang = l) };
    const r = await renderWorld(b, memoryHidden(), store);
    await makeCard(user, "서린");
    const body = screen.getByLabelText(/카드 본문/) as HTMLTextAreaElement;
    await user.click(body);
    const answered = body.value.replace("## 욕구 — 무엇을 가장 원하는가?\n\n", "## 욕구 — 무엇을 가장 원하는가?\n잃어버린 불을 되찾기\n");
    await user.clear(body);
    await user.type(body, answered.replace(/[[{]/g, (m) => m + m));
    await user.click(screen.getByRole("button", { name: "본문 저장" }));
    await screen.findByText("본문을 저장했습니다.");
    const id = [...cards.keys()][0];
    expect(cards.get(id)!.body).toBe(answered);

    r.unmount();
    lang = "en";
    await renderWorld(b, memoryHidden(), store);
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0].textContent).toContain("Character card");
    await user.click(rows()[0]);
    const enBody = (await screen.findByLabelText(/Card text/)) as HTMLTextAreaElement;
    expect(enBody.value).toBe(answered);
    expect(enBody.value).toContain("잃어버린 불을 되찾기");
    expect(enBody.value).not.toContain("Want");
    expect(cards.get(id)!.body).toBe(answered);
  });

  it("a stale body save reports the outside change and keeps the typed text", async () => {
    const { b, cards } = worldBackend();
    const user = userEvent.setup();
    await renderWorld(b);
    await makeCard(user, "메모", { template: "note" });
    const id = [...cards.keys()][0];
    cards.get(id)!.body = "밖에서 고침";
    const body = screen.getByLabelText(/카드 본문/) as HTMLTextAreaElement;
    await user.type(body, "앱에서 씀");
    await user.click(screen.getByRole("button", { name: "본문 저장" }));
    expect((await screen.findByRole("alert")).textContent).toContain("앱 밖에서 바뀌어");
    expect(body.value).toContain("앱에서 씀");
    expect(cards.get(id)!.body).toBe("밖에서 고침");
  });

  it("a double click on create makes one card (same request id)", async () => {
    const { b, cards } = worldBackend();
    const user = userEvent.setup();
    await renderWorld(b);
    await user.type(screen.getByLabelText("이름"), "서린");
    const btn = screen.getByRole("button", { name: /카드 만들기$/ });
    await user.dblClick(btn);
    await screen.findByRole("button", { name: "← 카드 목록" });
    expect(cards.size).toBe(1);
  });
});
