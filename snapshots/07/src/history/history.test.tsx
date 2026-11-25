// Session 06 history panel: commit flow, results, comparison, restore.
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider";
import { EditorGuardProvider, useEditorGuard, type CommitReady, type EditorHandle } from "../manuscript/EditorGuard";
import type { LanguageStore } from "../settings/languageStore";
import type { CommitRequest, CommitResult, HistoryBackend, RevisionInfo } from "./api";
import { HistoryBackendProvider, HistoryPanel } from "./HistoryPanel";

afterEach(cleanup);
const koStore: LanguageStore = { kind: "desktop", load: async () => "ko", save: async () => {} };

function rev(n: number): RevisionInfo {
  return {
    revisionId: `r${n}id`,
    episodeId: "e1",
    parentRevisionId: n > 1 ? `r${n - 1}id` : null,
    ordinal: n,
    createdAt: "2026-11-24T10:00:00Z",
    message: n === 1 ? "초고" : `퇴고 ${n - 1}`,
    contentHash: `sha256:c${n}`,
    size: 10,
    folder: `episodes/x/history/r00${n}`,
  };
}

const TEXTS: Record<string, string> = {
  r1id: "서린은 손끝에 불을 피웠다.\n린은 말이 없었다.",
  r2id: "서린은 남은 불씨를 감지했다.\n린은 말이 없었다.",
  r3id: "서린은 남은 불씨를 감지했다.\n린은 창밖을 보았다.\n끝.",
};

function backend(initial: number) {
  let revs = Array.from({ length: initial }, (_, i) => rev(i + 1));
  const commits: CommitRequest[] = [];
  const texts: Record<string, string> = { ...TEXTS };
  const b = {
    list: vi.fn(async () => ({ revisions: revs, problems: [] })),
    read: vi.fn(async (_s: string, _e: string, id: string) => ({
      revisionId: id,
      ordinal: Number(id[1]),
      text: texts[id] ?? "",
      bom: false,
      lineEnding: "lf" as const,
      contentHash: "x",
    })),
    commit: vi.fn(async (req: CommitRequest): Promise<CommitResult> => {
      commits.push(req);
      const r = rev(revs.length + 1);
      revs = [...revs, r];
      texts[r.revisionId] = "새 판";
      return { outcome: "created", revision: r };
    }),
    backup: vi.fn(async () => "C:\\작품\\.galpi\\backups\\e1\\x.md"),
  };
  return { b, commits };
}

type FakeEditor = EditorHandle & { text: string };
function fakeEditor(text: string, ready?: () => Promise<CommitReady>): FakeEditor {
  const ed: FakeEditor = {
    text,
    flush: vi.fn(async () => true),
    focus: () => {},
    isDirty: () => false,
    prepareCommit: vi.fn(ready ?? (async () => ({ ok: true as const, hash: "sha256:work", text: ed.text }))),
    replaceText: vi.fn((t: string) => {
      ed.text = t;
      return true;
    }),
    currentText: () => ed.text,
  };
  return ed;
}

function Register({ h }: { h: EditorHandle }) {
  const g = useEditorGuard();
  useEffect(() => g.register(h), [g, h]);
  return null;
}

async function renderPanel(b: HistoryBackend, ed: EditorHandle, readOnly = false) {
  render(
    <I18nProvider store={koStore}>
      <EditorGuardProvider>
        <HistoryBackendProvider backend={b}>
          <Register h={ed} />
          <HistoryPanel sessionId="s1" episodeId="e1" readOnly={readOnly} />
        </HistoryBackendProvider>
      </EditorGuardProvider>
    </I18nProvider>,
  );
  await screen.findByRole("heading", { name: "회차 커밋과 이력" });
}

describe("06 history panel", () => {
  it("commit: saves/rereads first, sends the expected hash and message, lists the new revision", async () => {
    const { b, commits } = backend(0);
    const ed = fakeEditor("서린은 손끝에 불을 피웠다.");
    const user = userEvent.setup();
    await renderPanel(b, ed);
    expect(screen.getByText("아직 커밋한 판이 없습니다.")).toBeTruthy();
    await user.type(screen.getByRole("textbox", { name: "커밋 메모" }), "초고");
    await user.click(screen.getByRole("button", { name: "회차 커밋" }));
    expect(await screen.findByText("r1을(를) 커밋했습니다.")).toBeTruthy();
    expect(ed.prepareCommit).toHaveBeenCalledTimes(1);
    expect(commits[0]).toMatchObject({ sessionId: "s1", episodeId: "e1", message: "초고", expectedHash: "sha256:work" });
    expect(await screen.findByTestId("rev-1")).toBeTruthy();
  });

  it("no change: says so and keeps the history", async () => {
    const { b } = backend(1);
    b.commit = vi.fn(async () => ({ outcome: "noChange" as const, revision: rev(1) }));
    const user = userEvent.setup();
    await renderPanel(b, fakeEditor(TEXTS.r1id));
    await user.click(await screen.findByRole("button", { name: "회차 커밋" }));
    expect(await screen.findByText("직전 판(r1)과 내용이 같아 커밋하지 않았습니다.")).toBeTruthy();
  });

  it("a failed attempt keeps the same request id for the retry", async () => {
    const { b, commits } = backend(0);
    const real = b.commit;
    let first = true;
    b.commit = vi.fn(async (req: CommitRequest) => {
      if (first) {
        first = false;
        commits.push(req);
        throw { code: "io", detail: "disk busy" };
      }
      return real(req);
    });
    const user = userEvent.setup();
    await renderPanel(b, fakeEditor("x"));
    await user.click(screen.getByRole("button", { name: "회차 커밋" }));
    expect(await screen.findByText(/커밋하지 못했습니다/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "회차 커밋" }));
    await screen.findByText("r1을(를) 커밋했습니다.");
    expect(commits.map((c) => c.requestId)).toHaveLength(2);
    expect(commits[0].requestId).toBe(commits[1].requestId);
  });

  it("disk changed between the check and the commit: re-read once and retry the same request", async () => {
    const { b, commits } = backend(0);
    const real = b.commit;
    let n = 0;
    b.commit = vi.fn(async (req: CommitRequest) => {
      n += 1;
      if (n === 1) {
        commits.push(req);
        throw { code: "writeConflict" };
      }
      return real(req);
    });
    let k = 0;
    const ed = fakeEditor("x", async () => ({ ok: true, hash: `sha256:v${++k}`, text: "x" }));
    const user = userEvent.setup();
    await renderPanel(b, ed);
    await user.click(screen.getByRole("button", { name: "회차 커밋" }));
    await screen.findByText("r1을(를) 커밋했습니다.");
    expect(commits.map((c) => c.expectedHash)).toEqual(["sha256:v1", "sha256:v2"]);
    expect(commits[0].requestId).toBe(commits[1].requestId);
  });

  it("an unresolved conflict blocks the commit (CH1: resolve first)", async () => {
    const { b } = backend(0);
    const user = userEvent.setup();
    await renderPanel(b, fakeEditor("x", async () => ({ ok: false, reason: "conflict" })));
    await user.click(screen.getByRole("button", { name: "회차 커밋" }));
    expect(await screen.findByText(/충돌이나 복구 사본이 있어 커밋할 수 없습니다/)).toBeTruthy();
    expect(b.commit).not.toHaveBeenCalled();
  });

  it("list shows per-revision change counts; compare with previous highlights inside the line", async () => {
    const { b } = backend(3);
    const user = userEvent.setup();
    await renderPanel(b, fakeEditor(TEXTS.r3id));
    const r2 = await screen.findByTestId("rev-2");
    await waitFor(() => expect(within(r2).getByText(/바뀐 줄 1 · \+9자 \/ −8자/)).toBeTruthy());
    await user.click(within(r2).getByRole("button", { name: "r2 이전 판과 비교" }));
    const diff = await screen.findByTestId("diff");
    expect(within(diff).getByText("감지했다", { selector: "ins", exact: false })).toBeTruthy();
    expect(diff.querySelectorAll("del").length).toBeGreaterThan(0);
  });

  it("any two: r1 against the working copy", async () => {
    const { b } = backend(3);
    const user = userEvent.setup();
    await renderPanel(b, fakeEditor("서린은 손끝에 불을 피웠다.\n린은 말이 없었다.\n새로 쓴 줄"));
    await screen.findByTestId("rev-1");
    await waitFor(() => expect(b.read).toHaveBeenCalledTimes(3));
    await user.selectOptions(screen.getByRole("combobox", { name: "왼쪽" }), "r1id");
    await user.selectOptions(screen.getByRole("combobox", { name: "오른쪽" }), "work");
    const diff = await screen.findByTestId("diff");
    expect(within(diff).getByText("새로 쓴 줄")).toBeTruthy();
    expect(screen.getByText(/바뀐 줄 1 · \+6자 \/ −0자/)).toBeTruthy();
  });

  it("restore with uncommitted work: backs it up, puts r2 into the working copy, saves; history untouched", async () => {
    const { b } = backend(3);
    const ed = fakeEditor("커밋 안 한 새 문장");
    const user = userEvent.setup();
    await renderPanel(b, ed);
    await waitFor(() => expect(b.read).toHaveBeenCalledTimes(3));
    const r2 = screen.getByTestId("rev-2");
    await user.click(within(r2).getByRole("button", { name: "r2(으)로 복원" }));
    await user.click(within(r2).getByRole("button", { name: "r2 내용을 작업본에 넣기" }));
    expect(await screen.findByText(/r2 내용을 작업본에 복원했습니다.*커밋하면 r4/)).toBeTruthy();
    expect(screen.getByText(/복원 전 작업본 사본/)).toBeTruthy();
    expect(b.backup).toHaveBeenCalledTimes(1);
    expect(ed.replaceText).toHaveBeenCalledWith(TEXTS.r2id);
    expect(ed.flush).toHaveBeenCalled();
    expect(b.commit).not.toHaveBeenCalled();
  });

  it("restore when the working copy equals the latest revision needs no backup", async () => {
    const { b } = backend(3);
    const user = userEvent.setup();
    await renderPanel(b, fakeEditor(TEXTS.r3id));
    await waitFor(() => expect(b.read).toHaveBeenCalledTimes(3));
    const r1 = screen.getByTestId("rev-1");
    await user.click(within(r1).getByRole("button", { name: "r1(으)로 복원" }));
    await act(async () => within(r1).getByRole("button", { name: "r1 내용을 작업본에 넣기" }).click());
    await screen.findByText(/r1 내용을 작업본에 복원했습니다/);
    expect(b.backup).not.toHaveBeenCalled();
  });

  it("read-only work: no commit or restore", async () => {
    const { b } = backend(2);
    await renderPanel(b, fakeEditor(""), true);
    await screen.findByTestId("rev-2");
    expect(screen.queryByRole("button", { name: "회차 커밋" })).toBeNull();
    expect(screen.queryByRole("button", { name: /복원/ })).toBeNull();
  });
});
