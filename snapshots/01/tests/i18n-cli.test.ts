// S01.B: the CLI used by `npm run check:i18n` must name the missing key.
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function runCheck(dir: string) {
  return spawnSync(process.execPath, ["scripts/check-i18n.ts", dir], { encoding: "utf8" });
}

describe("check-i18n CLI", () => {
  it("fails and names the key missing from the en fixture", () => {
    const r = runCheck("tests/fixtures/i18n-missing-key");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("[en] roots.timeline: missing key");
  });

  it("passes on the real locale tables", () => {
    const r = runCheck("src/i18n/locales");
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
});
