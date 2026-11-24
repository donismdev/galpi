// Session 04: built-in editor save states, IME composition, file form, failures, drafts.
// The editor is real CodeMirror running in jsdom; the Rust side is a scripted backend.
import { EditorView } from "@codemirror/view";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider";
import type { LanguageStore } from "../settings/languageStore";
import type { ManuscriptBackend, ManuscriptRead, SaveRequest } from "./api";
import { EditorGuardProvider, ManuscriptBackendProvider, useEditorGuard } from "./EditorGuard";
import { ManuscriptEditor } from "./ManuscriptEditor";

afterEach(cleanup);

const koStore: LanguageStore = { kind: "desktop", load: async () => "ko", save: async () => {} };

function okRead(text: string, over: Partial<Extract<ManuscriptRead, { state: "ok" }>> = {}): ManuscriptRead {
  return {
    state: "ok",
    episodeId: "e1",
    text,
    hash: "sha256:h0",
    bom: false,
    lineEnding: "lf",
    mixedLineEndings: false,
    path: "C:\\작품\\episodes\\000001-x\\manuscript.md",
    ...over,
  };
}

function fakeBackend(first: ManuscriptRead, over: Partial<ManuscriptBackend> = {}) {
  let n = 0;
  const saves: SaveRequest[] = [];
  const b = {
    read: vi.fn(async () => first),
    save: vi.fn(async (req: SaveRequest) => {
      saves.push(req);
      n += 1;
      return { hash: `sha256:h${n}`, savedAt: new Date().toISOString() };
    }),
    saveDraft: vi.fn(async (_s: string, episodeId: string, baseHash: string | null, text: string) => ({
      episodeId,
      baseHash,
      text,
      savedAt: new Date().toISOString(),
    })),
    loadDraft: vi.fn(async () => null),
    discardDraft: vi.fn(async () => {}),
    reveal: vi.fn(async () => {}),
    ...over,
  };
  return { b, saves };
}

let guardRef: ReturnType<typeof useEditorGuard> | null = null;
function GuardProbe() {
  guardRef = useEditorGuard();
  return null;
}

async function renderEditor(b: ManuscriptBackend, readOnly = false) {
  render(
    <I18nProvider store={koStore}>
      <EditorGuardProvider>
        <ManuscriptBackendProvider backend={b}>
          <GuardProbe />
          <ManuscriptEditor sessionId="s1" episodeId="e1" readOnly={readOnly} />
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
  // The view exists; wait until React has rendered the loaded state as well.
  await waitFor(() => expect(screen.getByTestId("save-state").textContent).not.toBe("원고를 읽는 중…"));
  return EditorView.findFromDOM(content)!;
}

function type(v: EditorView, text: string) {
  act(() => {
    v.dispatch({ changes: { from: v.state.doc.length, insert: text }, userEvent: "input.type" });
  });
}

const state = () => screen.getByTestId("save-state").textContent;

describe("built-in editor", () => {
  it("shows the file, goes dirty on typing and autosaves after a pause", async () => {
    const { b, saves } = fakeBackend(okRead("서린은 "));
    await renderEditor(b);
    const v = await editorView();
    expect(v.state.doc.toString()).toBe("서린은 ");
    expect(state()).toBe("변경 없음");
    type(v, "불씨를 감지했다.");
    expect(state()).toBe("편집 중");
    await waitFor(() => expect(saves).toHaveLength(1), { timeout: 3000 });
    expect(saves[0]).toMatchObject({ text: "서린은 불씨를 감지했다.", baseHash: "sha256:h0", episodeId: "e1" });
    await waitFor(() => expect(state()).toMatch(/^저장됨/));
  });

  it("Ctrl+S saves immediately and the next save is based on the new hash", async () => {
    const { b, saves } = fakeBackend(okRead(""));
    const user = userEvent.setup();
    await renderEditor(b);
    const v = await editorView();
    type(v, "첫 문장");
    v.focus();
    await user.keyboard("{Control>}s{/Control}");
    await waitFor(() => expect(saves).toHaveLength(1));
    type(v, " 둘째");
    await act(async () => {
      await guardRef!.flush();
    });
    expect(saves).toHaveLength(2);
    expect(saves[1].baseHash).toBe("sha256:h1");
    expect(saves[1].text).toBe("첫 문장 둘째");
  });

  it("keeps the file's BOM and CRLF form on save", async () => {
    const { b, saves } = fakeBackend(okRead("줄1\n줄2\n", { bom: true, lineEnding: "crlf" }));
    await renderEditor(b);
    const v = await editorView();
    expect(await screen.findByText(/UTF-8 \(BOM\) · CRLF/)).toBeTruthy();
    type(v, "줄3\n");
    await act(async () => {
      await guardRef!.flush();
    });
    expect(saves[0]).toMatchObject({ text: "줄1\n줄2\n줄3\n", bom: true, lineEnding: "crlf" });
  });

  it("never saves during IME composition; saves the composed text when it ends", async () => {
    const { b, saves } = fakeBackend(okRead("서린은 "));
    await renderEditor(b);
    const v = await editorView();
    act(() => {
      v.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    });
    // (jsdom: CodeMirror counts composition only after real DOM changes; the editor tracks the event itself)
    type(v, "불씨");
    let flushed = false;
    const p = act(async () => {
      flushed = await guardRef!.flush();
    });
    await new Promise((r) => setTimeout(r, 1500)); // longer than the autosave pause
    expect(saves).toHaveLength(0); // nothing while composing
    act(() => {
      v.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "불씨" }));
    });
    await p;
    expect(flushed).toBe(true);
    expect(saves).toHaveLength(1);
    expect(saves[0].text).toBe("서린은 불씨");
  });

  it("text typed while a save is running is a new generation and is saved too", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { b, saves } = fakeBackend(okRead(""));
    const realSave = b.save;
    b.save = vi.fn(async (req: SaveRequest) => {
      if (saves.length === 0) await gate;
      return realSave(req);
    });
    await renderEditor(b);
    const v = await editorView();
    type(v, "가");
    let first!: Promise<boolean>;
    act(() => {
      first = guardRef!.flush();
    });
    type(v, "나"); // arrives while the first save waits
    await act(async () => {
      release();
      await first;
    });
    expect(state()).toBe("편집 중");
    await act(async () => {
      await guardRef!.flush();
    });
    expect(saves.map((s) => s.text)).toEqual(["가", "가나"]);
    expect(state()).toMatch(/^저장됨/);
  });

  it("a failed save keeps a draft, says so, and 'save again' recovers", async () => {
    let fail = true;
    const { b, saves } = fakeBackend(okRead(""));
    const realSave = b.save;
    b.save = vi.fn(async (req: SaveRequest) => {
      if (fail) throw { code: "io", kind: "PermissionDenied", detail: "Access is denied." };
      return realSave(req);
    });
    const user = userEvent.setup();
    await renderEditor(b);
    const v = await editorView();
    type(v, "권한 없는 폴더");
    let ok = true;
    await act(async () => {
      ok = await guardRef!.flush();
    });
    expect(ok).toBe(false);
    expect(screen.getByText(/복구 초안으로 따로 보관/)).toBeTruthy();
    expect(b.saveDraft).toHaveBeenCalledWith("s1", "e1", "sha256:h0", "권한 없는 폴더");
    fail = false;
    await user.click(screen.getByRole("button", { name: "다시 저장" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(state()).toMatch(/^저장됨/);
  });

  it("disk changed elsewhere: save is held, draft kept, autosave stops", async () => {
    const { b } = fakeBackend(okRead("원래"));
    b.save = vi.fn(async () => {
      throw { code: "writeConflict", expected: "sha256:h0", actual: "sha256:zz" };
    });
    await renderEditor(b);
    const v = await editorView();
    type(v, " 앱 수정");
    await act(async () => {
      await guardRef!.flush();
    });
    expect(state()).toBe("저장 보류");
    expect(screen.getByText(/05회/)).toBeTruthy();
    expect(b.saveDraft).toHaveBeenCalledWith("s1", "e1", "sha256:h0", "원래 앱 수정");
    type(v, " 더");
    await new Promise((r) => setTimeout(r, 1500));
    expect(b.save).toHaveBeenCalledTimes(1); // no autosave after a conflict
  });

  it("undecodable (CP949) file: no editor, no save, no draft write; offers location and read again", async () => {
    const { b } = fakeBackend({
      state: "undecodable",
      episodeId: "e1",
      hash: "sha256:cp",
      size: 23,
      validUpTo: 0,
      path: "C:\\작품\\m.md",
    });
    b.loadDraft = vi.fn(async () => ({ episodeId: "e1", baseHash: null, text: "기존 초안", savedAt: "t" }));
    const user = userEvent.setup();
    await renderEditor(b);
    expect(await screen.findByText(/UTF-8로 읽을 수 없습니다/)).toBeTruthy();
    expect(screen.getByText(/저장하지 못한 복구 초안이 있습니다/)).toBeTruthy();
    expect(document.querySelector(".cm-content")).toBeNull();
    let ok = false;
    await act(async () => {
      ok = await guardRef!.flush();
    });
    expect(ok).toBe(true);
    expect(b.save).not.toHaveBeenCalled();
    expect(b.saveDraft).not.toHaveBeenCalled();
    expect(b.discardDraft).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "원본 위치 열기" }));
    expect(b.reveal).toHaveBeenCalledWith("s1", "e1");
  });

  it("locked file: read again recovers", async () => {
    const reads: ManuscriptRead[] = [
      { state: "locked", episodeId: "e1", path: "C:\\m.md", detail: "sharing violation" },
      okRead("이제 읽힘"),
    ];
    const { b } = fakeBackend(reads[0]);
    b.read = vi.fn(async () => reads.shift()!);
    const user = userEvent.setup();
    await renderEditor(b);
    expect(await screen.findByText(/다른 프로그램이 원고 파일을 사용 중/)).toBeTruthy();
    await user.click(screen.getAllByRole("button", { name: "다시 읽기" })[0]);
    const v = await editorView();
    expect(v.state.doc.toString()).toBe("이제 읽힘");
  });

  it("a recovery draft can replace the text, then saves normally", async () => {
    const { b, saves } = fakeBackend(okRead("디스크 문장"));
    b.loadDraft = vi.fn(async () => ({ episodeId: "e1", baseHash: "sha256:h0", text: "초안 문장", savedAt: "t" }));
    const user = userEvent.setup();
    await renderEditor(b);
    const v = await editorView();
    await user.click(await screen.findByRole("button", { name: "초안 내용으로 바꾸기" }));
    expect(v.state.doc.toString()).toBe("초안 문장");
    await act(async () => {
      await guardRef!.flush();
    });
    expect(saves[0].text).toBe("초안 문장");
    await waitFor(() => expect(screen.queryByText(/복구 초안이 있습니다/)).toBeNull());
  });

  it("read-only work: the editor does not accept edits or save", async () => {
    const { b } = fakeBackend(okRead("읽기만"));
    await renderEditor(b, true);
    const v = await editorView();
    expect(v.state.readOnly).toBe(true);
    expect((screen.getByRole("button", { name: "저장 (Ctrl+S)" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
