import { describe, expect, it } from "vitest";
import { charCount, inlineDiff, textDiff } from "./diff";

describe("charCount (user-perceived characters)", () => {
  it("counts composed Hangul, emoji with modifiers and flags as one each", () => {
    expect(charCount("서린")).toBe(2);
    expect(charCount("👍🏽")).toBe(1);
    expect(charCount("🇰🇷")).toBe(1);
    expect(charCount("가́")).toBe(1); // base + combining mark
    expect(charCount("")).toBe(0);
  });
});

describe("textDiff", () => {
  it("identical texts", () => {
    const d = textDiff("가\n나", "가\n나");
    expect(d.identical).toBe(true);
    expect(d.stats.changedLines).toBe(0);
  });

  it("r1 → r2: one word changed inside a sentence is highlighted, counts are graphemes", () => {
    const r1 = "서린은 손끝에 불을 피웠다.\n린은 말이 없었다.";
    const r2 = "서린은 남은 불씨를 감지했다.\n린은 말이 없었다.";
    const d = textDiff(r1, r2);
    expect(d.stats).toMatchObject({ changedLines: 1, modifiedLines: 1, addedLines: 0, removedLines: 0 });
    const mod = d.lines.find((l) => l.kind === "mod");
    if (!mod || mod.kind !== "mod") throw new Error("no mod line");
    expect(mod.segs[0]).toEqual({ kind: "same", text: "서린은 " });
    expect(mod.segs.filter((s) => s.kind === "del").map((s) => s.text).join("")).toContain("손끝에");
    expect(mod.segs.filter((s) => s.kind === "add").map((s) => s.text).join("")).toContain("감지했다");
    expect(mod.segs[mod.segs.length - 1]).toEqual({ kind: "same", text: "." });
    // Spaces between the words are the same on both sides, so only the words count:
    // removed 손끝에·불을·피웠다 (3+2+3), added 남은·불씨를·감지했다 (2+3+4).
    expect(d.stats.removedChars).toBe(8);
    expect(d.stats.addedChars).toBe(9);
  });

  it("added and removed lines keep their own numbers on each side", () => {
    const d = textDiff("하나\n둘\n셋", "영\n하나\n셋\n넷");
    const kinds = d.lines.map((l) => l.kind);
    expect(kinds).toEqual(["add", "same", "del", "same", "add"]);
    expect(d.stats).toMatchObject({ addedLines: 2, removedLines: 1, changedLines: 3 });
    expect(d.stats.addedChars).toBe(2);
    expect(d.stats.removedChars).toBe(1);
  });

  it("line breaks are not characters; BOM/CRLF never reach the diff (LF text in)", () => {
    const d = textDiff("가", "가\n");
    expect(d.stats).toMatchObject({ addedLines: 1, addedChars: 0 });
  });

  it("a long Korean paragraph: only the changed phrase is marked, and it is fast", () => {
    const words = Array.from({ length: 1500 }, (_, i) => `문장${i}은 잿빛 항구에서 이어졌다`);
    const a = words.join(" ");
    const b = a.replace("문장700은 잿빛", "문장700은 푸른");
    const t0 = performance.now();
    const d = textDiff(a, b);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(1500);
    const mod = d.lines[0];
    if (mod.kind !== "mod") throw new Error("expected mod");
    const changed = mod.segs.filter((s) => s.kind !== "same");
    expect(changed.map((s) => s.text)).toEqual(["잿빛", "푸른"]);
    expect(d.stats).toMatchObject({ addedChars: 2, removedChars: 2 });
  });

  it("inlineDiff joins back to both sides", () => {
    const a = "\"린, 괜찮아?\" 서린이 물었다. 🔥";
    const b = "\"린, 정말 괜찮아?\" 서린이 조용히 물었다. 🔥🔥";
    const segs = inlineDiff(a, b);
    expect(segs.filter((s) => s.kind !== "add").map((s) => s.text).join("")).toBe(a);
    expect(segs.filter((s) => s.kind !== "del").map((s) => s.text).join("")).toBe(b);
  });
});
