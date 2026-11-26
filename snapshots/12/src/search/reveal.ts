// Jumping from a search hit to the exact place (12, ‘문단 위치 해석’).
//
// The index stores offsets as Unicode scalar (char) indices into the document with the BOM
// removed and CRLF turned into LF. Editors and the DOM count UTF-16 code units, so an emoji
// before the hit shifts every position by one per emoji: `charToUtf16` converts.
//
// Between the search and the click the manuscript may have changed. `resolveReveal` checks the
// stored offset first; if the text there is no longer the hit it looks for the same words again
// (preferring the place whose surrounding text still matches, then the nearest one) and says so;
// if the words are gone it says that instead of jumping somewhere wrong.

export interface RevealTarget {
  episodeId: string;
  /** Set for a committed revision (opens read-only). */
  revId: string | null;
  /** Char offset in the document (from the index). */
  offset: number;
  matched: string;
  before: string;
  after: string;
}

export type RevealHow = "exact" | "moved" | "missing";
export interface Resolved {
  from: number; // UTF-16
  to: number;
  how: RevealHow;
}

/** UTF-16 index of char (code point) index `n` in `text` (clamped to the end). */
export function charToUtf16(text: string, n: number): number {
  let units = 0;
  let chars = 0;
  for (const ch of text) {
    if (chars >= n) break;
    units += ch.length;
    chars += 1;
  }
  return units;
}

function lowerSameLength(s: string): string {
  // per-char lowercase like search.rs `fold`, keeping UTF-16 positions
  let out = "";
  for (const ch of s) {
    const l = ch.toLowerCase();
    out += l.length === ch.length ? l : ch;
  }
  return out;
}

export function resolveReveal(doc: string, t: Pick<RevealTarget, "offset" | "matched" | "before" | "after">): Resolved {
  const want = lowerSameLength(t.matched);
  const hay = lowerSameLength(doc);
  const len = t.matched.length;
  if (!want) return { from: 0, to: 0, how: "missing" };
  const at = charToUtf16(doc, t.offset);
  if (hay.slice(at, at + len) === want) return { from: at, to: at + len, how: "exact" };
  const found: number[] = [];
  for (let i = hay.indexOf(want); i >= 0; i = hay.indexOf(want, i + 1)) found.push(i);
  if (found.length === 0) return { from: at, to: at, how: "missing" };
  const b = lowerSameLength(t.before);
  const a = lowerSameLength(t.after);
  const score = (i: number) => (b && hay.slice(Math.max(0, i - b.length), i) === b ? 2 : 0) + (a && hay.slice(i + len, i + len + a.length) === a ? 1 : 0);
  found.sort((x, y) => score(y) - score(x) || Math.abs(x - at) - Math.abs(y - at));
  return { from: found[0], to: found[0] + len, how: "moved" };
}

// A reveal waiting for the editor (or revision reader) of its episode to load.
let pending: RevealTarget | null = null;
export const REVEAL_EVENT = "galpi:reveal";
export function requestReveal(t: RevealTarget) {
  pending = t;
  window.dispatchEvent(new CustomEvent(REVEAL_EVENT, { detail: t }));
}
/** Takes the pending reveal if it is for this working manuscript. */
export function takeReveal(episodeId: string): RevealTarget | null {
  if (!pending || pending.episodeId !== episodeId || pending.revId) return null;
  const t = pending;
  pending = null;
  return t;
}
export function clearReveal() {
  pending = null;
}
