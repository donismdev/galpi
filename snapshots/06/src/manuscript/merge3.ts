// Line-based three-way merge for "직접 합치기" (05). Starts the merge editor with:
// - changes made on only one side applied automatically,
// - places changed on both sides (differently) wrapped in readable markers for the writer to fix.
// It never decides between two different edits of the same lines.

export interface Merge3Result {
  text: string;
  /** Number of blocks the writer must resolve (marked in `text`). */
  conflicts: number;
}

export const MARK_MINE = "<<<<<<< 앱에서 쓴 내용";
export const MARK_SPLIT = "=======";
export const MARK_DISK = ">>>>>>> 디스크(외부) 내용";

export type Hunk = { baseStart: number; baseEnd: number; lines: string[] };

/** Longest common subsequence pairs of equal lines (index in a, index in b), ascending. */
function lcsPairs(a: string[], b: string[]): [number, number][] {
  // Trim common prefix/suffix first so the quadratic part only sees the changed middle.
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf);
  const B = b.slice(pre, b.length - suf);
  const n = A.length;
  const m = B.length;
  const dp: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: [number, number][] = [];
  for (let k = 0; k < pre; k++) pairs.push([k, k]);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      pairs.push([pre + i, pre + j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  for (let k = 0; k < suf; k++) pairs.push([a.length - suf + k, b.length - suf + k]);
  return pairs;
}

/** Edits turning `base` into `other`, as replaced base ranges. */
export function hunks(base: string[], other: string[]): Hunk[] {
  const out: Hunk[] = [];
  let bi = 0;
  let oi = 0;
  for (const [pb, po] of [...lcsPairs(base, other), [base.length, other.length] as [number, number]]) {
    if (pb > bi || po > oi) out.push({ baseStart: bi, baseEnd: pb, lines: other.slice(oi, po) });
    bi = pb + 1;
    oi = po + 1;
  }
  return out;
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const startsWith = (a: string[], b: string[]) => b.length > 0 && b.length < a.length && b.every((x, i) => a[i] === x);
const endsWith = (a: string[], b: string[]) =>
  b.length > 0 && b.length < a.length && b.every((x, i) => a[a.length - b.length + i] === x);

export function merge3(base: string, mine: string, disk: string): Merge3Result {
  if (mine === disk) return { text: mine, conflicts: 0 };
  if (base === mine) return { text: disk, conflicts: 0 };
  if (base === disk) return { text: mine, conflicts: 0 };
  const B = base.split("\n");
  const M = hunks(B, mine.split("\n"));
  const D = hunks(B, disk.split("\n"));
  const out: string[] = [];
  let conflicts = 0;
  let pos = 0; // next base line to copy
  let mi = 0;
  let di = 0;
  // Two base ranges touch the same text if they intersect, or are insertions at the same point.
  const overlaps = (h: Hunk, start: number, end: number) =>
    (h.baseStart < end && start < h.baseEnd) ||
    (h.baseStart === h.baseEnd && start < h.baseStart && h.baseStart < end) ||
    (start === end && h.baseStart < start && start < h.baseEnd) ||
    (h.baseStart === h.baseEnd && start === end && h.baseStart === start);
  while (mi < M.length || di < D.length) {
    // Start a region with the earliest hunk, then pull in every hunk (either side) touching it.
    const takeMine = di >= D.length || (mi < M.length && M[mi].baseStart <= D[di].baseStart);
    const first = takeMine ? M[mi++] : D[di++];
    const mineIn: Hunk[] = takeMine ? [first] : [];
    const diskIn: Hunk[] = takeMine ? [] : [first];
    const start = first.baseStart;
    let end = first.baseEnd;
    for (let grew = true; grew; ) {
      grew = false;
      while (mi < M.length && overlaps(M[mi], start, end)) {
        end = Math.max(end, M[mi].baseEnd);
        mineIn.push(M[mi++]);
        grew = true;
      }
      while (di < D.length && overlaps(D[di], start, end)) {
        end = Math.max(end, D[di].baseEnd);
        diskIn.push(D[di++]);
        grew = true;
      }
    }
    for (; pos < start; pos++) out.push(B[pos]);
    const apply = (hs: Hunk[]) => {
      const res: string[] = [];
      let p = start;
      for (const h of hs) {
        for (; p < h.baseStart; p++) res.push(B[p]);
        res.push(...h.lines);
        p = h.baseEnd;
      }
      for (; p < end; p++) res.push(B[p]);
      return res;
    };
    const mineLines = apply(mineIn);
    const diskLines = apply(diskIn);
    if (!diskIn.length) out.push(...mineLines);
    else if (!mineIn.length) out.push(...diskLines);
    else if (same(mineLines, diskLines)) out.push(...mineLines);
    // Same change on both sides, one side added more right after/before it: keep the longer one
    // (it contains everything the other side wrote).
    else if (startsWith(mineLines, diskLines) || endsWith(mineLines, diskLines)) out.push(...mineLines);
    else if (startsWith(diskLines, mineLines) || endsWith(diskLines, mineLines)) out.push(...diskLines);
    else {
      conflicts++;
      out.push(MARK_MINE, ...mineLines, MARK_SPLIT, ...diskLines, MARK_DISK);
    }
    pos = end;
  }
  for (; pos < B.length; pos++) out.push(B[pos]);
  return { text: out.join("\n"), conflicts };
}

export function hasConflictMarkers(text: string): boolean {
  return text.split("\n").some((l) => l === MARK_MINE || l === MARK_DISK);
}
