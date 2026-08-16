/**
 * Precomputed lookup tables for every possible 16-bit row state (2^16 = 65536).
 * A row packs 4 cells, cell c at bits (c*4)..(c*4+3), cell 0 = leftmost.
 * Cell value n: 0 = empty, n = log2(tile).
 *
 * Tables:
 *  MOVE_LEFT / MOVE_RIGHT : resulting row after a move
 *  SCORE_LEFT / SCORE_RIGHT : score gained by the move (sum of merged tile values)
 *  EMPTY_ROW : number of empty cells in the row
 *  MONO_L2R / MONO_R2L : linear monotonicity score (big tiles weighted toward
 *                        the edge; weights decay [8,4,2,1])
 *  SMOOTH_ROW : -sum |n[a]-n[b]| over adjacent cells (log-scale smoothness)
 *  MERGE_ROW : number of adjacent equal non-empty pairs (merge potential)
 */

export const MOVE_LEFT = new Uint16Array(65536);
export const MOVE_RIGHT = new Uint16Array(65536);
export const SCORE_LEFT = new Uint32Array(65536);
export const SCORE_RIGHT = new Uint32Array(65536);
export const EMPTY_ROW = new Uint8Array(65536);
// Differential monotonicity (nneonneo-style): sum over adjacent pairs of
// (a - b) where a > b and the pair is aligned with the direction.
// MONO_DIFF_L2R: pairs (c-1, c) contribute when left > right (decreasing L2R).
export const MONO_DIFF_L2R = new Int16Array(65536);
export const MONO_DIFF_R2L = new Int16Array(65536);
// Smoothness in log2 scale: -sum |log2(a) - log2(b)| over adjacent cells.
export const SMOOTH_ROW = new Int16Array(65536);
export const MERGE_ROW = new Uint8Array(65536);

/** Reverse the order of the 4 cells of a 16-bit row. */
function revRow(r: number): number {
  return ((r & 15) << 12) | ((r & 0xf0) << 4) | ((r & 0xf00) >> 4) | ((r & 0xf000) >> 12);
}

function rowCells(row: number): number[] {
  const cells: number[] = [];
  for (let c = 0; c < 4; c++) cells.push((row >>> (c * 4)) & 15);
  return cells;
}

/** Standard 2048 single-row merge. tiles merge at most once per move: 2 2 2 2 -> 4 4 0 0. */
function mergeRow(row: number): { moved: number; score: number } {
  const cells = rowCells(row);
  const seq: number[] = [];
  for (const v of cells) if (v !== 0) seq.push(v);
  const out = [0, 0, 0, 0];
  let k = 0;
  let score = 0;
  let i = 0;
  while (i < seq.length) {
    if (i + 1 < seq.length && seq[i] === seq[i + 1]) {
      const merged = seq[i] + 1;
      out[k++] = merged;
      score += 1 << merged; // actual tile value of the merged tile
      i += 2;
    } else {
      out[k++] = seq[i];
      i += 1;
    }
  }
  let moved = 0;
  for (let c = 0; c < 4; c++) moved |= out[c] << (c * 4);
  return { moved, score };
}

function smoothOf(row: number): number {
  const n = rowCells(row);
  let s = 0;
  // Only non-empty pairs contribute (empty cells are not treated as 0 —
  // otherwise merging a big tile would be punished for the temporary hole
  // next to it, and the AI would never merge).
  for (let c = 1; c < 4; c++) {
    if (n[c] !== 0 && n[c - 1] !== 0) s += Math.abs(n[c] - n[c - 1]);
  }
  return -s;
}

function monoDiffOf(row: number): [number, number] {
  const n = rowCells(row);
  let l2r = 0; // decreasing left -> right
  let r2l = 0; // decreasing right -> left
  for (let c = 1; c < 4; c++) {
    if (n[c - 1] !== 0 && n[c] !== 0) {
      if (n[c - 1] > n[c]) l2r += n[c - 1] - n[c];
      if (n[c] > n[c - 1]) r2l += n[c] - n[c - 1];
    }
  }
  return [l2r, r2l];
}

function mergeOf(row: number): number {
  const n = rowCells(row);
  let s = 0;
  for (let c = 1; c < 4; c++) if (n[c] === n[c - 1] && n[c] !== 0) s++;
  return s;
}

for (let row = 0; row < 65536; row++) {
  const { moved, score } = mergeRow(row);
  MOVE_LEFT[row] = moved;
  SCORE_LEFT[row] = score;
  EMPTY_ROW[row] = rowCells(row).filter((v) => v === 0).length;
  const [l2r, r2l] = monoDiffOf(row);
  MONO_DIFF_L2R[row] = l2r;
  MONO_DIFF_R2L[row] = r2l;
  SMOOTH_ROW[row] = smoothOf(row);
  MERGE_ROW[row] = mergeOf(row);
}
// Second pass: move right = reverse the row, move left, reverse back.
// Requires MOVE_LEFT[revRow(row)] which may not be filled yet in a single pass.
for (let row = 0; row < 65536; row++) {
  const rr = revRow(row);
  MOVE_RIGHT[row] = revRow(MOVE_LEFT[rr]);
  SCORE_RIGHT[row] = SCORE_LEFT[rr];
}
