// Usage: node scripts/check-i18n.ts <locale-dir> [referenceLocale]
// Compares every <code>.json in the directory and exits 1 naming each missing/extra/empty key.
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { checkLocales, formatIssues } from "../src/i18n/keyCheck.ts";

const dir = process.argv[2] ?? "src/i18n/locales";
const reference = process.argv[3] ?? "ko";

const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
if (files.length < 2) {
  console.error(`check-i18n: expected at least two locale files in ${dir}, found ${files.length}`);
  process.exit(1);
}

const locales: Record<string, unknown> = {};
for (const f of files) {
  const code = basename(f, ".json");
  try {
    locales[code] = JSON.parse(readFileSync(join(dir, f), "utf8"));
  } catch (e) {
    console.error(`check-i18n: ${join(dir, f)} is not valid JSON: ${(e as Error).message}`);
    process.exit(1);
  }
}

const ref = reference in locales ? reference : Object.keys(locales)[0];
const issues = checkLocales(locales, ref);
if (issues.length > 0) {
  console.error(`check-i18n: ${issues.length} problem(s) in ${dir} (reference: ${ref})`);
  console.error(formatIssues(issues));
  process.exit(1);
}
console.log(`check-i18n: OK - ${Object.keys(locales).join(", ")} share the same keys (${dir})`);
