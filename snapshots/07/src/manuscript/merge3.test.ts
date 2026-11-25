import { describe, expect, it } from "vitest";
import { diskChanges } from "./ManuscriptEditor";
import { MARK_DISK, MARK_MINE, hasConflictMarkers, merge3 } from "./merge3";

const base = ["# 3화", "", "서린은 손끝에 불을 피웠다.", "린은 말이 없었다.", "", "끝."].join("\n");

describe("merge3", () => {
  it("one side changed → that side", () => {
    expect(merge3(base, base, base + "\n추가")).toEqual({ text: base + "\n추가", conflicts: 0 });
    expect(merge3(base, base.replace("끝.", "계속"), base).text).toContain("계속");
  });

  it("different lines changed on each side are both kept", () => {
    const mine = base.replace("서린은 손끝에 불을 피웠다.", "서린은 남은 불씨를 감지했다.");
    const disk = base.replace("린은 말이 없었다.", "린은 창밖을 보았다.");
    const r = merge3(base, mine, disk);
    expect(r.conflicts).toBe(0);
    expect(r.text).toContain("서린은 남은 불씨를 감지했다.");
    expect(r.text).toContain("린은 창밖을 보았다.");
    expect(r.text).not.toContain("손끝에 불을 피웠다");
  });

  it("additions at the end and the start from each side are both kept", () => {
    const mine = base + "\n앱에서 쓴 마지막 줄";
    const disk = "머리말\n" + base;
    const r = merge3(base, mine, disk);
    expect(r.conflicts).toBe(0);
    expect(r.text.startsWith("머리말\n# 3화")).toBe(true);
    expect(r.text.endsWith("앱에서 쓴 마지막 줄")).toBe(true);
  });

  it("the same line changed differently is marked, never decided", () => {
    const mine = base.replace("린은 말이 없었다.", "린은 웃었다.");
    const disk = base.replace("린은 말이 없었다.", "린은 울었다.");
    const r = merge3(base, mine, disk);
    expect(r.conflicts).toBe(1);
    const lines = r.text.split("\n");
    const at = lines.indexOf(MARK_MINE);
    expect(lines.slice(at, at + 5)).toEqual([MARK_MINE, "린은 웃었다.", "=======", "린은 울었다.", MARK_DISK]);
    expect(hasConflictMarkers(r.text)).toBe(true);
    expect(r.text).toContain("서린은 손끝에 불을 피웠다.");
  });

  it("identical edits on both sides are taken once", () => {
    const both = base.replace("끝.", "다음 화에 계속.");
    expect(merge3(base, both, both)).toEqual({ text: both, conflicts: 0 });
    const mine = both + "\n앱";
    const r = merge3(base, mine, both);
    expect(r.conflicts).toBe(0);
    expect(r.text).toBe(mine);
  });

  it("empty base (new episode written in both places) conflicts as a whole", () => {
    const r = merge3("", "앱에서 쓴 첫 문장", "VS Code에서 쓴 첫 문장");
    expect(r.conflicts).toBe(1);
    expect(r.text).toContain("앱에서 쓴 첫 문장");
    expect(r.text).toContain("VS Code에서 쓴 첫 문장");
  });

  it("handles long texts", () => {
    const long = Array.from({ length: 3000 }, (_, i) => `문장 ${i}`).join("\n");
    const mine = long.replace("문장 10\n", "앱이 고친 문장 10\n");
    const disk = long.replace("문장 2990\n", "외부가 고친 문장 2990\n");
    const r = merge3(long, mine, disk);
    expect(r.conflicts).toBe(0);
    expect(r.text).toContain("앱이 고친 문장 10");
    expect(r.text).toContain("외부가 고친 문장 2990");
  });
});


function apply(from: string, cs: { from: number; to: number; insert: string }[]) {
  let out = "";
  let pos = 0;
  for (const c of cs) {
    out += from.slice(pos, c.from) + c.insert;
    pos = c.to;
  }
  return out + from.slice(pos);
}

describe("diskChanges (outside edits applied line by line)", () => {
  const cases: [string, string][] = [
    ["a\nb\nc", "x\na\nb\nc\ny"],
    ["a\nb\nc\n", "a\nc\n"],
    ["a\nb\nc", "a\nb"],
    ["a\nb\nc", "a\nb\nc\n"],
    ["", "새 문장"],
    ["문장", ""],
    ["a\r", "a"],
    ["서린은 🔥\n린", "서린은 🔥🔥\n린\n끝"],
  ];
  for (const [a, b] of cases) {
    it(`${JSON.stringify(a)} → ${JSON.stringify(b)}`, () => {
      expect(apply(a, diskChanges(a, b))).toBe(b);
    });
  }
  it("leaves untouched lines out of the edits", () => {
    const cs = diskChanges("머리\n가운데\n꼬리", "새 머리\n머리\n가운데\n꼬리\n새 꼬리");
    expect(cs.every((c) => !c.insert.includes("가운데"))).toBe(true);
  });
});
