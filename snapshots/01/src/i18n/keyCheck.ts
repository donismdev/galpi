// Pure locale-table checker shared by the CLI (scripts/check-i18n.ts) and unit tests.
// Every locale must have exactly the same set of leaf keys, each a non-empty string.

export type IssueKind = "missing" | "extra" | "empty" | "notString";

export interface KeyIssue {
  locale: string;
  key: string;
  kind: IssueKind;
}

export function flattenKeys(value: unknown, prefix = "", out = new Map<string, unknown>()): Map<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      flattenKeys(v, prefix ? `${prefix}.${k}` : k, out);
    }
  } else {
    out.set(prefix, value);
  }
  return out;
}

/**
 * @param locales locale code -> parsed JSON table
 * @param reference locale whose keys are the source of truth (defaults to the first one)
 */
export function checkLocales(locales: Record<string, unknown>, reference?: string): KeyIssue[] {
  const codes = Object.keys(locales);
  if (codes.length === 0) return [];
  const refCode = reference ?? codes[0];
  const flat = new Map(codes.map((c) => [c, flattenKeys(locales[c])]));
  const allKeys = new Set<string>();
  for (const table of flat.values()) for (const k of table.keys()) allKeys.add(k);
  const refKeys = flat.get(refCode) ?? new Map<string, unknown>();

  const issues: KeyIssue[] = [];
  for (const code of codes) {
    const table = flat.get(code)!;
    for (const key of [...allKeys].sort()) {
      if (!table.has(key)) {
        issues.push({ locale: code, key, kind: "missing" });
        continue;
      }
      const v = table.get(key);
      if (typeof v !== "string") issues.push({ locale: code, key, kind: "notString" });
      else if (v.trim() === "") issues.push({ locale: code, key, kind: "empty" });
      if (code !== refCode && !refKeys.has(key)) issues.push({ locale: code, key, kind: "extra" });
    }
  }
  return issues;
}

const KIND_TEXT: Record<IssueKind, string> = {
  missing: "missing key",
  extra: "key not in reference locale",
  empty: "empty string",
  notString: "value is not a string",
};

export function formatIssues(issues: KeyIssue[]): string {
  return issues.map((i) => `[${i.locale}] ${i.key}: ${KIND_TEXT[i.kind]}`).join("\n");
}
