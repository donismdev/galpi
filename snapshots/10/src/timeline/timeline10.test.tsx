// Session 10: filters, saved links (follow one level, back restores filter), state queries by
// reader / story / both with CH2 certainty, pinned basis, explicit event delete.
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Certainty, Collection } from "./api";
import { episodes, renderApp, timelineBackend, type Rec, type U } from "./testkit";

afterEach(cleanup);
beforeEach(() => {
  episodes.numbers = [1, 20, 25, 299, 300, 305, 310, 327, 350, 351];
});

const MAIN = "k0";
const BEFORE = "k-before";
const LOOP1 = "k-loop1";

/** The S10 fixture (same shape as views.rs `fixture`). */
function seed() {
  const t = timelineBackend();
  const col: Collection = { schemaVersion: 1, collectionId: "k-reg", name: "회귀 연표", defaultMode: "episode", createdAt: "t", eventCount: 0, hash: "h" };
  t.cols.set(col.collectionId, col);
  // tracks: 본편 + 회귀 전 + 1차 회귀
  (t.b.addTrack as unknown as (...a: unknown[]) => Promise<unknown>)("s1", "r", "회귀 전", "t0");
  (t.b.addTrack as unknown as (...a: unknown[]) => Promise<unknown>)("s1", "r", "1차 회귀", "t1");
  const ids = t.tracks().map((x) => x.trackId);
  const track: Record<string, string> = { [MAIN]: ids[0], [BEFORE]: ids[1], [LOOP1]: ids[2] };
  const put = (id: string, ep: number | null, story: [string, number, Certainty] | null, tags: string[], change?: [string, string]) => {
    const r: Rec = {
      eventId: id,
      collectionIds: [col.collectionId],
      title: id,
      detail: "",
      tagIds: tags,
      relatedCardIds: [],
      changes: change ? [{ entityId: "c1", propertyKey: change[0], value: change[1] }] : [],
      episodeId: ep == null ? null : `e${ep}`,
      episodeOrder: ep == null ? null : 1,
      storyCertainty: story ? story[2] : "unknown",
      storyTrackId: story ? track[story[0]] : null,
      storyOrder: story ? story[1] : null,
      storyLabel: story ? `${story[1]}일차` : null,
      ver: 0,
      reviewed: null,
    };
    t.recs.set(id, r);
  };
  put("각성", 1, [MAIN, 1, "confirmed"], [], ["능력", "불꽃 각성"]);
  put("능력 강화", 20, [MAIN, 6, "confirmed"], [], ["능력", "화염 조종"]);
  put("299화", 299, [MAIN, 9, "confirmed"], []);
  put("화염 사용", 300, [BEFORE, 2, "confirmed"], ["t-reg"], ["능력", "화염 사용"]);
  put("능력 없음", 305, [LOOP1, 1, "confirmed"], ["t-reg"], ["능력", "능력 없음"]);
  put("불씨 감지", 310, [LOOP1, 2, "estimated"], ["t-reg"], ["능력", "불씨 감지"]);
  put("327화 과거", 327, [MAIN, 2, "confirmed"], ["t-reg", "t-sec"], ["과거", "회귀자"]);
  put("350화", 350, null, ["t-reg"]);
  put("351화", 351, [MAIN, 10, "confirmed"], []);
  put("회차 미정", null, [MAIN, 5, "confirmed"], []);
  return t;
}

async function openTimeline(user: U, name: string) {
  await user.click(await screen.findByRole("button", { name: new RegExp(name) }));
  await screen.findByRole("tablist");
}

const shownTitles = () => [...document.querySelectorAll(".event-chip[data-event-id] > span:first-child")].map((x) => x.textContent);
const rowNumbers = () => [...document.querySelectorAll("[data-testid^=ep-row-]")].map((x) => Number(x.getAttribute("data-testid")!.slice(7)));

describe("10 filters and links", () => {
  it("S10.B episode range 300~350 → link; a later 327 event shows on re-query; back restores the filter; hide/unhide restores count", async () => {
    const t = seed();
    const user = await renderApp(t.b);
    await openTimeline(user, "회귀 연표");
    await user.click(screen.getByText("필터"));
    await user.type(screen.getByLabelText("회차 시작"), "300");
    await user.type(screen.getByLabelText("회차 끝"), "350");
    await waitFor(() => expect(screen.getByTestId("shown-count").textContent).toBe("사건 10개 중 5개 표시"));
    expect(rowNumbers()).toEqual([300, 305, 310, 327, 350]);
    expect(shownTitles().sort()).toEqual(["327화 과거", "350화", "능력 없음", "불씨 감지", "화염 사용"].sort());
    // hide 비밀 → one less; clear the hide → back to 5 (data untouched)
    await user.click(within(screen.getByRole("group", { name: "숨김 태그 (우선)" })).getByLabelText("비밀"));
    await waitFor(() => expect(screen.getByTestId("shown-count").textContent).toBe("사건 10개 중 4개 표시"));
    await user.click(within(screen.getByRole("group", { name: "숨김 태그 (우선)" })).getByLabelText("비밀"));
    await waitFor(() => expect(screen.getByTestId("shown-count").textContent).toBe("사건 10개 중 5개 표시"));
    expect(t.recs.size).toBe(10);
    // save as link
    await user.type(screen.getByLabelText("이 조건을 링크로 저장"), "회귀편");
    await user.click(screen.getByRole("button", { name: "링크 저장" }));
    await screen.findByText(/링크 ‘회귀편’을\(를\) 저장했습니다/);
    const saved = [...t.views.values()][0];
    expect(saved).toMatchObject({ label: "회귀편", parentCollectionId: "k-reg", episodeRange: { from: 300, to: 350 }, collectionIds: ["k-reg"] });
    // a 327 event added later
    t.recs.set("327화 추가", { ...t.recs.get("350화")!, eventId: "327화 추가", title: "327화 추가", episodeId: "e327", tagIds: [] });
    // follow the link: one level, conditions shown, new event included
    await user.click(await screen.findByRole("button", { name: "↪ 회귀편" }));
    expect((await screen.findByTestId("view-conditions")).textContent).toBe("300~350화");
    await waitFor(() => expect(screen.getByTestId("shown-count").textContent).toBe("사건 6개"));
    expect(shownTitles()).toContain("327화 추가");
    // back: filter and mode of the timeline are restored
    await user.click(screen.getByRole("button", { name: "← 뒤로" }));
    expect((await screen.findByLabelText("회차 시작") as HTMLInputElement).value).toBe("300");
    expect((screen.getByLabelText("회차 끝") as HTMLInputElement).value).toBe("350");
    // clearing the filter is not deleting
    await user.click(screen.getByRole("button", { name: "필터 해제" }));
    await waitFor(() => expect(rowNumbers()).toHaveLength(10));
    expect(t.recs.size).toBe(11);
  });

  it("a link whose target vanished offers the way back", async () => {
    const t = seed();
    const user = await renderApp(t.b);
    await openTimeline(user, "회귀 연표");
    await user.click(screen.getByText("필터"));
    await user.type(screen.getByLabelText("회차 시작"), "300");
    await user.type(screen.getByLabelText("이 조건을 링크로 저장"), "회귀편");
    await user.click(screen.getByRole("button", { name: "링크 저장" }));
    await user.click(await screen.findByRole("button", { name: "↪ 회귀편" }));
    await screen.findByTestId("view-conditions");
    t.views.clear(); // deleted outside the app
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect((await screen.findByRole("alert")).textContent).toContain("링크 대상을 찾을 수 없습니다");
    await user.click(screen.getByRole("button", { name: "← 원래 위치로" }));
    expect((await screen.findByLabelText("회차 시작") as HTMLInputElement).value).toBe("300");
  });

  it("deleting an event is explicit and shows how many timelines lose it", async () => {
    const t = seed();
    const user = await renderApp(t.b);
    await openTimeline(user, "회귀 연표");
    await user.click(within(screen.getByTestId("ep-row-350")).getByRole("button", { name: /350화/ }));
    await user.click(await screen.findByRole("button", { name: "사건 삭제…" }));
    expect(screen.getByRole("alertdialog").textContent).toContain("타임라인 1개 모두에서 사라집니다");
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "취소" }));
    expect(t.recs.has("350화")).toBe(true);
    await user.click(screen.getByRole("button", { name: "사건 삭제…" }));
    await user.click(screen.getByRole("button", { name: "사건 지우기" }));
    await screen.findByText("사건을 지웠습니다.");
    expect(t.recs.has("350화")).toBe(false);
    await waitFor(() => expect(within(screen.getByTestId("ep-row-350")).getByText("사건 없음")).toBeTruthy());
  });
});

describe("10 state at a point", () => {
  const value = (k: string) => document.querySelector(`[data-property="${k}"] td:nth-child(2)`)?.textContent;

  it("S10.C reader 25화 hides the late-revealed past; story day 2 shows it; intersection hides it", async () => {
    const t = seed();
    const user = await renderApp(t.b);
    const panel = await screen.findByRole("region", { name: "그 시점의 상태" });
    await user.type(within(panel).getByLabelText("몇 화까지"), "25");
    await user.click(within(panel).getByRole("button", { name: "조회" }));
    await waitFor(() => expect(value("능력")).toBe("화염 조종"));
    expect(value("과거")).toBe("미기록");
    expect(screen.getByTestId("state-considered").textContent).not.toContain("327화 과거");

    await user.click(within(panel).getByLabelText("작중 시간 기준"));
    await user.selectOptions(within(panel).getByLabelText("트랙"), t.tracks()[0].trackId);
    await user.type(within(panel).getByLabelText("작중 정렬 숫자까지"), "2");
    await user.click(within(panel).getByRole("button", { name: "조회" }));
    await waitFor(() => expect(value("과거")).toBe("회귀자"));
    expect(value("능력")).toBe("불꽃 각성");

    await user.click(within(panel).getByLabelText("둘 다 (교집합)"));
    await user.click(within(panel).getByRole("button", { name: "조회" }));
    await waitFor(() => expect(value("과거")).toBe("미기록"));
    expect(screen.getByText("카드 본문(자유 메모)은 이 결과에 섞지 않습니다.")).toBeTruthy();
  });

  it("S10.D 1차 회귀 2일차: confirmed state ignores the estimated event until it is confirmed", async () => {
    const t = seed();
    const user = await renderApp(t.b);
    const panel = await screen.findByRole("region", { name: "그 시점의 상태" });
    await user.click(within(panel).getByLabelText("작중 시간 기준"));
    await user.selectOptions(within(panel).getByLabelText("트랙"), t.tracks()[2].trackId);
    await user.type(within(panel).getByLabelText("작중 정렬 숫자까지"), "2");
    await user.click(within(panel).getByRole("button", { name: "조회" }));
    await waitFor(() => expect(value("능력")).toBe("능력 없음"));
    expect(screen.getByTestId("state-estimated").textContent).toContain("불씨 감지");
    // confirm the date
    t.recs.get("불씨 감지")!.storyCertainty = "confirmed";
    await user.click(within(panel).getByRole("button", { name: "조회" }));
    await waitFor(() => expect(value("능력")).toBe("불씨 감지"));
    expect(screen.queryByTestId("state-estimated")).toBeNull();
  });

  it("pin ‘25화 기준’, reopen it, and open the full card only by an explicit button", async () => {
    const t = seed();
    const user = await renderApp(t.b);
    const panel = await screen.findByRole("region", { name: "그 시점의 상태" });
    await user.type(within(panel).getByLabelText("몇 화까지"), "25");
    await user.click(within(panel).getByRole("button", { name: "조회" }));
    await waitFor(() => expect(value("능력")).toBe("화염 조종"));
    await user.type(within(panel).getByLabelText("이 기준으로 고정"), "25화 기준");
    await user.click(within(panel).getByRole("button", { name: "고정" }));
    await screen.findByText(/고정했습니다/);
    expect([...t.views.values()][0].stateQuery).toMatchObject({ entityId: "c1", basis: "reader", episodeMax: 25 });
    await user.click(await screen.findByRole("button", { name: "📌 25화 기준" }));
    expect((await screen.findByTestId("view-conditions")).textContent).toBe("서린 · 독자 기준 25화까지 공개된 사실");
    await waitFor(() => expect(value("과거")).toBe("미기록"));
    await user.click(screen.getByRole("button", { name: "현재 전체 설정 열기 (서린 카드)" }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("세계관"));
  });
});
