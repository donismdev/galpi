// Revision comparison (06).
//
// Normalization: both sides are the LF text the app works with — a UTF-8 BOM and CRLF/LF
// differences are not changes. Nothing else is normalized (spaces, punctuation, full/half width
// all count).
// Units: "lines" are text lines split at line breaks. "Characters" are user-perceived characters
// (grapheme clusters: a composed Hangul syllable, an emoji with modifiers = 1). Line breaks are
// not counted as characters.
// Inside a changed line, words/spaces/punctuation (Intl.Segmenter word segments) are compared so
// only the changed part is highlighted, even in one long Korean paragraph.
import { hunks } from "../manuscript/merge3";

export type Seg = { kind: "same" | "add" | "del"; text: string };
export type DiffLine =
  | { kind: "same"; text: string; a: number; b: number }
  | { kind: "add"; text: string; b: number }
  | { kind: "del"; text: string; a: number }
  | { kind: "mod"; segs: Seg[]; a: number; b: number };

export interface DiffStats {
  /** Lines touched (added + removed + modified). */
  changedLines: number;
  addedLines: number;
  removedLines: number;
  modifiedLines: number;
  addedChars: number;
  removedChars: number;
}

export interface TextDiff {
  lines: DiffLine[];
  stats: DiffStats;
  identical: boolean;
}

const graphemer = new Intl.Segmenter("ko", { granularity: "grapheme" });
const worder = new Intl.Segmenter("ko", { granularity: "word" });

export function charCount(s: string): number {
  let n = 0;
  for (const _ of graphemer.segment(s)) n++;
  return n;
}

function tokens(s: string): string[] {
  return Array.from(worder.segment(s), (x) => x.segment);
}

/** Token-level diff of one changed line. */
export function inlineDiff(a: string, b: string): Seg[] {
  const A = tokens(a);
  const B = tokens(b);
  const out: Seg[] = [];
  const push = (kind: Seg["kind"], text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let ai = 0; // `hunks` works on any string arrays: tokens here
  for (const h of hunks(A, B)) {
    push("same", A.slice(ai, h.baseStart).join(""));
    push("del", A.slice(h.baseStart, h.baseEnd).join(""));
    push("add", h.lines.join(""));
    ai = h.baseEnd;
  }
  push("same", A.slice(ai).join(""));
  return out;
}

export function textDiff(a: string, b: string): TextDiff {
  const A = a.split("\n");
  const B = b.split("\n");
  const lines: DiffLine[] = [];
  const stats: DiffStats = { changedLines: 0, addedLines: 0, removedLines: 0, modifiedLines: 0, addedChars: 0, removedChars: 0 };
  let ai = 0;
  let bi = 0;
  const same = (to: number) => {
    for (; ai < to; ai++, bi++) lines.push({ kind: "same", text: A[ai], a: ai + 1, b: bi + 1 });
  };
  for (const h of hunks(A, B)) {
    same(h.baseStart);
    const del = A.slice(h.baseStart, h.baseEnd);
    const add = h.lines;
    const pairs = Math.min(del.length, add.length);
    for (let k = 0; k < pairs; k++) {
      const segs = inlineDiff(del[k], add[k]);
      lines.push({ kind: "mod", segs, a: ai + 1, b: bi + 1 });
      stats.modifiedLines++;
      for (const s of segs) {
        if (s.kind === "add") stats.addedChars += charCount(s.text);
        if (s.kind === "del") stats.removedChars += charCount(s.text);
      }
      ai++;
      bi++;
    }
    for (let k = pairs; k < del.length; k++) {
      lines.push({ kind: "del", text: del[k], a: ai + 1 });
      stats.removedLines++;
      stats.removedChars += charCount(del[k]);
      ai++;
    }
    for (let k = pairs; k < add.length; k++) {
      lines.push({ kind: "add", text: add[k], b: bi + 1 });
      stats.addedLines++;
      stats.addedChars += charCount(add[k]);
      bi++;
    }
  }
  same(A.length);
  stats.changedLines = stats.addedLines + stats.removedLines + stats.modifiedLines;
  return { lines, stats, identical: a === b };
}
