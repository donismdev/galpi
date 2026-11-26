import { describe, expect, it } from "vitest";
import { checkLocales, flattenKeys, formatIssues } from "./keyCheck";

describe("flattenKeys", () => {
  it("produces dotted leaf keys", () => {
    expect([...flattenKeys({ a: { b: "x", c: { d: "y" } } }).keys()]).toEqual(["a.b", "a.c.d"]);
  });
});

describe("checkLocales", () => {
  it("reports nothing for matching tables", () => {
    expect(checkLocales({ ko: { a: "가" }, en: { a: "A" } })).toEqual([]);
  });

  it("names a key missing from one locale", () => {
    const issues = checkLocales({ ko: { roots: { timeline: "타임라인" } }, en: { roots: {} } }, "ko");
    expect(issues).toEqual([{ locale: "en", key: "roots.timeline", kind: "missing" }]);
    expect(formatIssues(issues)).toBe("[en] roots.timeline: missing key");
  });

  it("names a key only present in a non-reference locale", () => {
    const issues = checkLocales({ ko: {}, en: { extra: "E" } }, "ko");
    expect(issues).toContainEqual({ locale: "ko", key: "extra", kind: "missing" });
    expect(issues).toContainEqual({ locale: "en", key: "extra", kind: "extra" });
  });

  it("flags empty and non-string values", () => {
    const issues = checkLocales({ ko: { a: " ", b: "ok" }, en: { a: "A", b: 3 } }, "ko");
    expect(issues).toContainEqual({ locale: "ko", key: "a", kind: "empty" });
    expect(issues).toContainEqual({ locale: "en", key: "b", kind: "notString" });
  });
});
