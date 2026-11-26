// Quick open ranking (12, Ctrl+P). The contract, in order:
//   0. episode number exact   — "351", "351화"
//   1. title or alias exact   — "서린" (title), "린" (alias of 서린), "회귀편" (saved link)
//   2. prefix of a title / alias
//   3. substring of a title / alias / episode number
// Case is ignored; surrounding spaces are trimmed. Ties: kind (episode, card, view, timeline),
// then episode number, then title, then path — so the same name always lists in the same order and
// kind + detail + path tell same-named items apart.
import type { QuickItem, QuickKind } from "./api";

export type QuickTier = 0 | 1 | 2 | 3;
export interface QuickMatch {
  item: QuickItem;
  tier: QuickTier;
  /** What matched: the title, an alias, or the episode number. */
  by: "number" | "title" | "alias";
  value: string;
}

const KIND_ORDER: QuickKind[] = ["episode", "card", "view", "timeline"];
const norm = (s: string) => s.trim().toLowerCase();

function numberOf(q: string): number | null {
  const m = /^(\d+)\s*화?$/.exec(q);
  return m ? Number(m[1]) : null;
}

function best(item: QuickItem, q: string, n: number | null): QuickMatch | null {
  if (item.kind === "episode" && n !== null && item.number === n) return { item, tier: 0, by: "number", value: String(n) };
  const names: { by: "title" | "alias"; value: string }[] = [
    ...(item.title ? [{ by: "title" as const, value: item.title }] : []),
    ...item.aliases.filter((a) => a.trim()).map((a) => ({ by: "alias" as const, value: a })),
  ];
  let found: QuickMatch | null = null;
  const consider = (tier: QuickTier, by: QuickMatch["by"], value: string) => {
    if (!found || tier < found.tier) found = { item, tier, by, value };
  };
  for (const { by, value } of names) {
    const v = norm(value);
    if (v === q) consider(1, by, value);
    else if (v.startsWith(q)) consider(2, by, value);
    else if (v.includes(q)) consider(3, by, value);
  }
  if (item.kind === "episode" && item.number !== null && String(item.number).includes(q.replace(/화$/, ""))) consider(3, "number", String(item.number));
  return found;
}

export function rankQuick(items: QuickItem[], query: string, limit = 50): QuickMatch[] {
  const q = norm(query);
  if (!q) return [];
  const n = numberOf(q);
  const out: QuickMatch[] = [];
  for (const it of items) {
    const m = best(it, q, n);
    if (m) out.push(m);
  }
  out.sort(
    (a, b) =>
      a.tier - b.tier ||
      KIND_ORDER.indexOf(a.item.kind) - KIND_ORDER.indexOf(b.item.kind) ||
      (a.item.number ?? 0) - (b.item.number ?? 0) ||
      a.item.title.localeCompare(b.item.title, "ko") ||
      a.item.path.localeCompare(b.item.path),
  );
  return out.slice(0, limit);
}
