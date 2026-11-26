// Session 05: disk changes and conflicts in the built-in editor. The Rust watcher is played by
// `emit`, the disk by a scripted backend whose `read` the tests swap.
import { EditorView } from "@codemirror/view";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider";
import type { LanguageStore } from "../settings/languageStore";
import type { DiskChange, ManuscriptBackend, ManuscriptRead, SaveRequest } from "./api";
import { EditorGuardProvider, ManuscriptBackendProvider, useEditorGuard } from "./EditorGuard";
import { ManuscriptEditor } from "./ManuscriptEditor";

const listeners = new Set<(c: DiskChange) => void>();
afterEach(() => {
  cleanup();
  listeners.clear();
});

const koStore: LanguageStore = { kind: "desktop", load: async () => "ko", save: async () => {} };

function okRead(text: string, hash = "sha256:h0"): ManuscriptRead {
  return { state: "ok", episodeId: "e1", text, hash, bom: false, lineEnding: "lf", mixedLineEndings: false, path: "C:\\m.md" };
}

function emit(c: Partial<DiskChange> & { hash: string | null }) {
  act(() => {
    for (const l of [...listeners]) l({ sessionId: "s1", workspaceId: "w1", episodeId: "e1", exists: c.hash !== null, ...c });
  });
}

function fakeBackend(first: ManuscriptRead) {
  let n = 0;
  const saves: SaveRequest[] = [];
  const b = {
    read: vi.fn(async () => first),
    save: vi.fn(async (req: SaveRequest) => {
      saves.push(req);
      n += 1;
      return { hash: `sha256:h${n}`, savedAt: new Date().toISOString() };
    }),
    probe: vi.fn(async () => ({ exists: true, hash: "sha256:h0" })),
    saveDraft: vi.fn(
      async (_s: string, episodeId: string, baseHash: string | null, baseText: string | null, text: string) => ({
        episodeId,
        baseHash,
        baseText,
        text,
        savedAt: new Date().toISOString(),
      }),
    ),
    loadDraft: vi.fn(async (): Promise<null | { episodeId: string; baseHash: string | null; baseText?: string | null; text: string; savedAt: string }> => null),
    discardDraft: vi.fn(async () => {}),
    reveal: vi.fn(async () => {}),
    onDiskChange: vi.fn(async (l: (c: DiskChange) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    }),
  };
  return { b, saves };
}

let guardRef: ReturnType<typeof useEditorGuard> | null = null;
function GuardProbe() {
  guardRef = useEditorGuard();
  return null;
}

async function renderEditor(b: ManuscriptBackend) {
  render(
    <I18nProvider store={koStore}>
      <EditorGuardProvider>
        <ManuscriptBackendProvider backend={b}>
          <GuardProbe />
          <ManuscriptEditor sessionId="s1" episodeId="e1" readOnly={false} />
        </ManuscriptBackendProvider>
      </EditorGuardProvider>
    </I18nProvider>,
  );
}

async function editorView(): Promise<EditorView> {
  const content = await waitFor(() => {
    const el = document.querySelector(".cm-content");
    if (!el) throw new Error("no editor yet");
    return el as HTMLElement;
  });
  await waitFor(() => expect(screen.getByTestId("save-state").textContent).not.toBe("원고를 읽는 중…"));
  return EditorView.findFromDOM(content)!;
}

function type(v: EditorView, text: string) {
  act(() => {
    v.dispatch({ changes: { from: v.state.doc.length, insert: text }, userEvent: "input.type" });
  });
}

const state = () => screen.getByTestId("save-state").textContent;

describe("05 · external changes and conflicts", () => {
  it("S05.A outside-only edit: clean editor takes the new text, keeps the cursor, does not save", async () => {
    const { b, saves } = fakeBackend(okRead("첫 줄\n둘째 줄\n"));
    await renderEditor(b);
    const v = await editorView();
    act(() => v.dispatch({ selection: { anchor: 3 } })); // inside "첫 줄"
    b.read = vi.fn(async () => okRead("머리말\n첫 줄\n둘째 줄\n셋째 줄\n", "sha256:x1"));
    emit({ hash: "sha256:x1" });
    await waitFor(() => expect(v.state.doc.toString()).toBe("머리말\n첫 줄\n둘째 줄\n셋째 줄\n"));
    expect(v.state.selection.main.head).toBe(3 + "머리말\n".length); // still inside "첫 줄"
    expect(await screen.findByTestId("external-loaded")).toBeTruthy();
    expect(state()).toBe("변경 없음");
    await new Promise((r) => setTimeout(r, 1400));
    expect(saves).toHaveLength(0);
  });

  it("S05.A outside re-edit: a second outside change is applied too", async () => {
    const { b } = fakeBackend(okRead("하나"));
    await renderEditor(b);
    const v = await editorView();
    b.read = vi.fn(async () => okRead("하나 둘", "sha256:x1"));
    emit({ hash: "sha256:x1" });
    await waitFor(() => expect(v.state.doc.toString()).toBe("하나 둘"));
    b.read = vi.fn(async () => okRead("하나 둘 셋", "sha256:x2"));
    emit({ hash: "sha256:x2" });
    await waitFor(() => expect(v.state.doc.toString()).toBe("하나 둘 셋"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("S05.D same hash (program only opened/closed, timestamp changed) changes nothing", async () => {
    const { b } = fakeBackend(okRead("그대로"));
    await renderEditor(b);
    await editorView();
    const reads = b.read.mock.calls.length;
    emit({ hash: "sha256:h0" });
    await new Promise((r) => setTimeout(r, 50));
    expect(b.read.mock.calls.length).toBe(reads);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("S05.C events for another session or episode are ignored", async () => {
    const { b } = fakeBackend(okRead("B 작품 원고"));
    await renderEditor(b);
    const v = await editorView();
    b.read = vi.fn(async () => okRead("A 작품의 늦은 변경", "sha256:late"));
    emit({ hash: "sha256:late", sessionId: "s-old-A" });
    emit({ hash: "sha256:late", episodeId: "other-episode" });
    await new Promise((r) => setTimeout(r, 50));
    expect(b.read).not.toHaveBeenCalled();
    expect(v.state.doc.toString()).toBe("B 작품 원고");
  });

  it("S05.A both edited: three versions shown, recovery copy kept, no autosave until a choice", async () => {
    const { b, saves } = fakeBackend(okRead("기준 문장"));
    await renderEditor(b);
    const v = await editorView();
    type(v, " + 앱");
    b.read = vi.fn(async () => okRead("기준 문장 + VS Code", "sha256:d1"));
    emit({ hash: "sha256:d1" });
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(screen.getByTestId("conflict-base").textContent).toBe("기준 문장");
    expect(screen.getByTestId("conflict-disk").textContent).toBe("기준 문장 + VS Code");
    expect(v.state.doc.toString()).toBe("기준 문장 + 앱");
    await waitFor(() => expect(b.saveDraft).toHaveBeenCalledWith("s1", "e1", "sha256:h0", "기준 문장", "기준 문장 + 앱"));
    await new Promise((r) => setTimeout(r, 1400));
    expect(saves).toHaveLength(0);
  });

  it("keep mine: saves over exactly the disk version that was shown", async () => {
    const { b, saves } = fakeBackend(okRead("기준"));
    const user = userEvent.setup();
    await renderEditor(b);
    const v = await editorView();
    type(v, " 앱");
    b.read = vi.fn(async () => okRead("기준 외부", "sha256:d1"));
    emit({ hash: "sha256:d1" });
    await user.click(await screen.findByRole("button", { name: "내 초안으로 저장" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toMatchObject({ text: "기준 앱", baseHash: "sha256:d1" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(state()).toMatch(/^저장됨/);
  });

  it("take disk: editor gets the disk text, recovery copy discarded, nothing saved", async () => {
    const { b, saves } = fakeBackend(okRead("기준"));
    const user = userEvent.setup();
    await renderEditor(b);
    const v = await editorView();
    type(v, " 앱");
    b.read = vi.fn(async () => okRead("기준 외부", "sha256:d1"));
    emit({ hash: "sha256:d1" });
    await user.click(await screen.findByRole("button", { name: "디스크 내용 쓰기 (내 초안 버림)" }));
    await waitFor(() => expect(v.state.doc.toString()).toBe("기준 외부"));
    expect(b.discardDraft).toHaveBeenCalled();
    expect(saves).toHaveLength(0);
    expect(state()).toBe("변경 없음");
  });

  it("merge: non-overlapping lines combine; overlapping ones must be resolved before saving", async () => {
    const { b, saves } = fakeBackend(okRead("1\n2\n3"));
    const user = userEvent.setup();
    await renderEditor(b);
    const v = await editorView();
    act(() => v.dispatch({ changes: { from: 0, to: 1, insert: "일" } })); // mine: line 1
    b.read = vi.fn(async () => okRead("1\n2\n삼", "sha256:d1")); // disk: line 3
    emit({ hash: "sha256:d1" });
    await user.click(await screen.findByRole("button", { name: "직접 합치기" }));
    const area = screen.getByRole("textbox", { name: "합친 내용" }) as HTMLTextAreaElement;
    expect(area.value).toBe("일\n2\n삼");
    await user.click(screen.getByRole("button", { name: "합친 내용 저장" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toMatchObject({ text: "일\n2\n삼", baseHash: "sha256:d1" });
    expect(v.state.doc.toString()).toBe("일\n2\n삼");
  });

  it("merge with the same line changed on both sides cannot be saved until the markers are gone", async () => {
    const { b, saves } = fakeBackend(okRead("린은 말이 없었다."));
    const user = userEvent.setup();
    await renderEditor(b);
    const v = await editorView();
    act(() => v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: "린은 웃었다." } }));
    b.read = vi.fn(async () => okRead("린은 울었다.", "sha256:d1"));
    emit({ hash: "sha256:d1" });
    await user.click(await screen.findByRole("button", { name: "직접 합치기" }));
    const save = screen.getByRole("button", { name: "합친 내용 저장" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    const area = screen.getByRole("textbox", { name: "합친 내용" });
    await user.clear(area);
    await user.type(area, "린은 웃다가 울었다.");
    expect(save.disabled).toBe(false);
    await user.click(save);
    await waitFor(() => expect(saves[0]?.text).toBe("린은 웃다가 울었다."));
  });

  it("file changed again while resolving: refused save → new conflict with the newer disk", async () => {
    const { b } = fakeBackend(okRead("기준"));
    const user = userEvent.setup();
    await renderEditor(b);
    const v = await editorView();
    type(v, " 앱");
    b.read = vi.fn(async () => okRead("기준 외부1", "sha256:d1"));
    emit({ hash: "sha256:d1" });
    await screen.findByRole("alertdialog");
    b.save = vi.fn(async () => {
      throw { code: "writeConflict", expected: "sha256:d1", actual: "sha256:d2" };
    });
    b.read = vi.fn(async () => okRead("기준 외부2", "sha256:d2"));
    await user.click(screen.getByRole("button", { name: "내 초안으로 저장" }));
    expect(await screen.findByText(/파일이 또 바뀌었습니다/)).toBeTruthy();
    expect(screen.getByTestId("conflict-disk").textContent).toBe("기준 외부2");
    expect(v.state.doc.toString()).toBe("기준 앱");
  });

  it("S05.B after a crash the conflict comes back from the recovery copy", async () => {
    const { b } = fakeBackend(okRead("VS Code 문장", "sha256:disk"));
    b.loadDraft = vi.fn(async () => ({
      episodeId: "e1",
      baseHash: "sha256:base",
      baseText: "처음 문장",
      text: "앱 문장",
      savedAt: "t",
    }));
    await renderEditor(b);
    expect(await screen.findByText("지난번에 고르지 못한 충돌을 복구했습니다")).toBeTruthy();
    expect(screen.getByTestId("conflict-base").textContent).toBe("처음 문장");
    expect(screen.getByTestId("conflict-disk").textContent).toBe("VS Code 문장");
    const v = EditorView.findFromDOM(document.querySelector(".cm-content") as HTMLElement)!;
    expect(v.state.doc.toString()).toBe("앱 문장");
    expect(b.save).not.toHaveBeenCalled();
    let ok = true;
    await act(async () => {
      ok = await guardRef!.flush();
    });
    expect(ok).toBe(false); // unresolved: closing keeps the recovery copy instead of saving
    expect(b.save).not.toHaveBeenCalled();
  });

  it("S05.A outside delete while clean: notice + re-create expects the file to be absent", async () => {
    const { b, saves } = fakeBackend(okRead("남은 문장"));
    const user = userEvent.setup();
    await renderEditor(b);
    await editorView();
    b.read = vi.fn(async () => ({ state: "missing", episodeId: "e1", path: "x" }) as ManuscriptRead);
    emit({ hash: null, exists: false });
    expect(await screen.findByText(/원고 파일이 없습니다/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "편집기 내용으로 다시 만들기" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toMatchObject({ text: "남은 문장", baseHash: null });
  });

  it("S05.A outside delete while editing: conflict with the disk side 'missing'", async () => {
    const { b } = fakeBackend(okRead("남은 문장"));
    await renderEditor(b);
    const v = await editorView();
    type(v, " 추가");
    b.read = vi.fn(async () => ({ state: "missing", episodeId: "e1", path: "x" }) as ManuscriptRead);
    emit({ hash: null, exists: false });
    expect(await screen.findByText(/파일이 없습니다 \(지워졌거나/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "디스크 내용 쓰기 (내 초안 버림)" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("CH1 disk turned into CP949 while editing: shown as undecodable, bytes kept until an explicit choice", async () => {
    const { b, saves } = fakeBackend(okRead("문장"));
    await renderEditor(b);
    const v = await editorView();
    type(v, " 추가");
    b.read = vi.fn(async () => ({ state: "undecodable", episodeId: "e1", hash: "sha256:cp", size: 23, validUpTo: 0, path: "x" }) as ManuscriptRead);
    emit({ hash: "sha256:cp" });
    expect(await screen.findByText(/UTF-8이 아닌 내용으로 바뀌었습니다/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "내 초안으로 덮어쓰기 (UTF-8로 저장)" })).toBeTruthy();
    await new Promise((r) => setTimeout(r, 1400));
    expect(saves).toHaveLength(0);
  });

  it("our own save's watcher event (arriving mid-save) is not treated as a conflict", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { b, saves } = fakeBackend(okRead("가"));
    const realSave = b.save;
    b.save = vi.fn(async (req: SaveRequest) => {
      await gate;
      return realSave(req); // → hash sha256:h1
    });
    await renderEditor(b);
    const v = await editorView();
    type(v, "나");
    let done!: Promise<boolean>;
    act(() => {
      done = guardRef!.flush();
    });
    emit({ hash: "sha256:h1" }); // the watcher sees our write before the save call returns
    await act(async () => {
      release();
      await done;
    });
    expect(saves).toHaveLength(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(state()).toMatch(/^저장됨/));
  });
});
