// S01.A: four roots visible in both languages, switching applies immediately and persists.
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { I18nProvider } from "./i18n/I18nProvider";
import type { Language } from "./i18n/messages";
import type { LanguageStore } from "./settings/languageStore";
import { WorkspaceProvider } from "./workspace/WorkspaceProvider";
import { EpisodesProvider } from "./episodes/EpisodesProvider";
import { browserBackend } from "./workspace/api";

function memoryStore(initial: Language): LanguageStore & { saved: Language[] } {
  let current = initial;
  const saved: Language[] = [];
  return {
    kind: "desktop",
    saved,
    load: async () => current,
    save: vi.fn(async (l: Language) => {
      current = l;
      saved.push(l);
    }),
  };
}

async function renderApp(store: LanguageStore) {
  const utils = render(
    <I18nProvider store={store}>
      <WorkspaceProvider backend={browserBackend}>
        <EpisodesProvider>
          <App />
        </EpisodesProvider>
      </WorkspaceProvider>
    </I18nProvider>,
  );
  await screen.findByRole("navigation");
  return utils;
}

afterEach(cleanup);

const KO_ROOTS =["회차", "회차 요약", "타임라인", "세계관"];
const EN_ROOTS = ["Episodes", "Episode summaries", "Timeline", "World"];

function rootLabels() {
  const nav = screen.getByRole("navigation");
  return within(nav)
    .getAllByRole("button")
    .map((b) => b.textContent?.replace(/^[^\p{L}]+/u, "").trim());
}

describe("App shell", () => {
  it("shows the four roots in Korean by default", async () => {
    await renderApp(memoryStore("ko"));
    expect(rootLabels()).toEqual(KO_ROOTS);
    await waitFor(() => expect(document.documentElement.lang).toBe("ko"));
  });

  it("shows the four roots in English when that is stored", async () => {
    await renderApp(memoryStore("en"));
    expect(rootLabels()).toEqual(EN_ROOTS);
    await waitFor(() => expect(document.documentElement.lang).toBe("en"));
  });

  it("switches language immediately and keeps it after a remount (restart)", async () => {
    const store = memoryStore("ko");
    const user = userEvent.setup();
    const { unmount } = await renderApp(store);

    await user.selectOptions(screen.getByLabelText("화면 언어"), "en");
    expect(rootLabels()).toEqual(EN_ROOTS);
    expect(screen.getByLabelText("Interface language")).toBeTruthy();
    expect(store.saved).toEqual(["en"]);

    unmount();
    await renderApp(store);
    expect(rootLabels()).toEqual(EN_ROOTS);
  });

  it("selecting a root changes the main panel", async () => {
    const user = userEvent.setup();
    await renderApp(memoryStore("ko"));
    await user.click(screen.getByRole("button", { name: /세계관/ }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("세계관");
    expect(screen.getByRole("button", { name: /세계관/ }).getAttribute("aria-current")).toBe("page");
  });

  it("browser preview explains that work folders need the desktop app", async () => {
    await renderApp(memoryStore("ko"));
    expect(screen.queryByRole("button", { name: "작품 폴더 선택…" })).toBeNull();
    expect(screen.getByText(/브라우저 미리보기에서는 작품 폴더를 열 수 없습니다/)).toBeTruthy();
  });

  it("surfaces a save failure instead of failing silently", async () => {
    const store = memoryStore("ko");
    store.save = vi.fn(async () => {
      throw new Error("disk full");
    });
    const user = userEvent.setup();
    await renderApp(store);
    await user.selectOptions(screen.getByLabelText("화면 언어"), "en");
    expect((await screen.findByRole("alert")).textContent).toContain("Could not save");
    expect(rootLabels()).toEqual(EN_ROOTS);
  });
});
