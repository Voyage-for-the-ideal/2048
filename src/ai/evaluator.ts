/**
 * Board evaluation. All features are computed from per-row lookup tables plus
 * per-column bit gymnastics — no allocations in the hot path.
 *
 * Features (see weights.ts):
 *  empty  : number of empty cells
 *  mono   : monotonicity, linear weight toward each edge, row and column,
 *           taking the best direction per row/column
 *  smooth : -sum |log2(a) - log2(b)| over adjacent cells
 *  merge  : number of adjacent equal non-empty pairs
 *  corner : 1 if the largest tile sits in a corner
 *  snake  : best of 8 snake orderings (4 anchor corners x 2 sweep axes)
 *  maxTile: log2 of the largest tile
 */
import type { Board } from "../game/board";
import {
  EMPTY_ROW,
  MONO_DIFF_L2R,
  MONO_DIFF_R2L,
  SMOOTH_ROW,
  MERGE_ROW,
} from "../game/moveTables";
import type { Weights } from "./weights";

/** One snake ordering: 16 cell indices (row-major), anchor first, weight decays. */
function snakeOrders(): number[][] {
  const orders: number[][] = [];
  const pushRowSweep = (anchorLeft: boolean, startRow: 0 | 3) => {
    const order: number[] = [];
    for (let step = 0; step < 4; step++) {
      const r = startRow === 0 ? step : 3 - step;
      for (let c = 0; c < 4; c++) order.push(r * 4 + (anchorLeft ? c : 3 - c));
    }
    orders.push(order);
  };
  const pushColSweep = (anchorTop: boolean, startCol: 0 | 3) => {
    const order: number[] = [];
    for (let step = 0; step < 4; step++) {
      const c = startCol === 0 ? step : 3 - step;
      // Anchor at the top (r=0 first) or bottom (r=3 first); sweep column by column.
      for (let r = 0; r < 4; r++) order.push((anchorTop ? r : 3 - r) * 4 + c);
    }
    orders.push(order);
  };
  pushRowSweep(true, 0);
  pushRowSweep(true, 3);
  pushRowSweep(false, 0);
  pushRowSweep(false, 3);
  pushColSweep(true, 0);
  pushColSweep(true, 3);
  pushColSweep(false, 0);
  pushColSweep(false, 3);
  return orders;
}

export const SNAKE_ORDERS: number[][] = snakeOrders();
export const SNAKE_WEIGHTS: Int16Array[] = SNAKE_ORDERS.map((order) => {
  const w = new Int16Array(16);
  for (let i = 0; i < 16; i++) w[order[i]] = 16 - i;
  return w;
});

/**
 * Precomputed snake contribution per (direction, sweep position, row/col state).
 * Directions 0-3 sweep row-wise (rows are contiguous in the ordering);
 * directions 4-7 sweep column-wise. The weight of a cell is (16 - order index).
 * snakeScore becomes 8*4 table lookups instead of 8*16 multiply-adds.
 */
function buildSnakeParts(): { row: Int32Array[]; col: Int32Array[] } {
  const row: Int32Array[] = [];
  const col: Int32Array[] = [];
  for (let dir = 0; dir < 8; dir++) {
    // cell index (0..15) -> its position in this snake ordering
    const linePos = new Uint8Array(16);
    for (let i = 0; i < 16; i++) linePos[SNAKE_ORDERS[dir][i]] = i;
    for (let pos = 0; pos < 4; pos++) {
      const part = new Int32Array(65536);
      for (let line = 0; line < 65536; line++) {
        let s = 0;
        for (let c = 0; c < 4; c++) {
          const n = (line >>> (c * 4)) & 15;
          if (n !== 0) {
            const cellIdx = dir < 4 ? pos * 4 + c : c * 4 + pos;
            s += n * (16 - linePos[cellIdx]);
          }
        }
        part[line] = s;
      }
      if (dir < 4) row.push(part);
      else col.push(part);
    }
  }
  return { row, col };
}

const SNAKE_PARTS = buildSnakeParts();
const SNAKE_ROW_PART = SNAKE_PARTS.row; // 16 tables: [dir*4 + rowPos]
const SNAKE_COL_PART = SNAKE_PARTS.col; // 16 tables: [dir*4 + colPos]

function snakeScore(b: Board, c0: number, c1: number, c2: number, c3: number): number {
  let best = -Infinity;
  for (let dir = 0; dir < 4; dir++) {
    const parts = SNAKE_ROW_PART;
    const s = parts[dir * 4][b[0]] + parts[dir * 4 + 1][b[1]] + parts[dir * 4 + 2][b[2]] + parts[dir * 4 + 3][b[3]];
    if (s > best) best = s;
  }
  for (let dir = 0; dir < 4; dir++) {
    const parts = SNAKE_COL_PART;
    const s = parts[dir * 4][c0] + parts[dir * 4 + 1][c1] + parts[dir * 4 + 2][c2] + parts[dir * 4 + 3][c3];
    if (s > best) best = s;
  }
  return best;
}

// --- column helpers (reuse the row tables on packed columns) ---

function colPacked(b: Board, c: number): number {
  const shift = c * 4;
  return (
    ((b[0] >>> shift) & 15) |
    (((b[1] >>> shift) & 15) << 4) |
    (((b[2] >>> shift) & 15) << 8) |
    (((b[3] >>> shift) & 15) << 12)
  );
}

/** Column nibbles of a board as a length-4 array (0 = top). */
function colsPacked(b: Board): number[] {
  return [colPacked(b, 0), colPacked(b, 1), colPacked(b, 2), colPacked(b, 3)];
}

/**
 * Global differential monotonicity (nneonneo-style): for each of the four
 * directions, sum (a - b) over adjacent pairs aligned with the direction
 * where a > b; take the best direction. Rewards a single consistent
 * decreasing chain, penalizing inversions directly.
 */
function monoGlobal(b: Board, c0: number, c1: number, c2: number, c3: number): number {
  const r0 = b[0], r1 = b[1], r2 = b[2], r3 = b[3];
  const rowL = MONO_DIFF_L2R[r0] + MONO_DIFF_L2R[r1] + MONO_DIFF_L2R[r2] + MONO_DIFF_L2R[r3];
  const rowR = MONO_DIFF_R2L[r0] + MONO_DIFF_R2L[r1] + MONO_DIFF_R2L[r2] + MONO_DIFF_R2L[r3];
  const colL = MONO_DIFF_L2R[c0] + MONO_DIFF_L2R[c1] + MONO_DIFF_L2R[c2] + MONO_DIFF_L2R[c3];
  const colR = MONO_DIFF_R2L[c0] + MONO_DIFF_R2L[c1] + MONO_DIFF_R2L[c2] + MONO_DIFF_R2L[c3];
  return Math.max(rowL, rowR, colL, colR);
}

function rowSmoothSum(b: Board): number {
  return SMOOTH_ROW[b[0]] + SMOOTH_ROW[b[1]] + SMOOTH_ROW[b[2]] + SMOOTH_ROW[b[3]];
}

function rowMergeSum(b: Board): number {
  return MERGE_ROW[b[0]] + MERGE_ROW[b[1]] + MERGE_ROW[b[2]] + MERGE_ROW[b[3]];
}

export function cornerScore(b: Board): number {
  const m = maxTileLog4(b);
  if (m === 0) return 0;
  return (b[0] & 15) === m || ((b[0] >>> 12) & 15) === m ||
    ((b[3] >>> 0) & 15) === m || ((b[3] >>> 12) & 15) === m
    ? 1
    : 0;
}

function maxTileLog4(b: Board): number {
  let m = 0;
  for (let r = 0; r < 4; r++) {
    const row = b[r];
    const mx = Math.max(row & 15, (row >>> 4) & 15, (row >>> 8) & 15, (row >>> 12) & 15);
    if (mx > m) m = mx;
  }
  return m;
}

/** Raw features (for the UI debug panel). */
export function evalFeatures(b: Board): {
  empty: number;
  mono: number;
  smooth: number;
  merge: number;
  corner: number;
  snake: number;
  maxTile: number;
} {
  const c0 = colPacked(b, 0), c1 = colPacked(b, 1), c2 = colPacked(b, 2), c3 = colPacked(b, 3);
  return {
    empty: EMPTY_ROW[b[0]] + EMPTY_ROW[b[1]] + EMPTY_ROW[b[2]] + EMPTY_ROW[b[3]],
    mono: monoGlobal(b, c0, c1, c2, c3),
    smooth: rowSmoothSum(b) + SMOOTH_ROW[c0] + SMOOTH_ROW[c1] + SMOOTH_ROW[c2] + SMOOTH_ROW[c3],
    merge: rowMergeSum(b) + MERGE_ROW[c0] + MERGE_ROW[c1] + MERGE_ROW[c2] + MERGE_ROW[c3],
    corner: cornerScore(b),
    snake: snakeScore(b, c0, c1, c2, c3),
    maxTile: maxTileLog4(b),
  };
}

/** Total linear evaluation with the given weights. */
export function evaluate(b: Board, w: Weights): number {
  const r0 = b[0], r1 = b[1], r2 = b[2], r3 = b[3];
  const c0 = colPacked(b, 0), c1 = colPacked(b, 1), c2 = colPacked(b, 2), c3 = colPacked(b, 3);
  let v = 0;
  if (w.empty !== 0) v += w.empty * (EMPTY_ROW[r0] + EMPTY_ROW[r1] + EMPTY_ROW[r2] + EMPTY_ROW[r3]);
  if (w.mono !== 0) {
    const rowL = MONO_DIFF_L2R[r0] + MONO_DIFF_L2R[r1] + MONO_DIFF_L2R[r2] + MONO_DIFF_L2R[r3];
    const rowR = MONO_DIFF_R2L[r0] + MONO_DIFF_R2L[r1] + MONO_DIFF_R2L[r2] + MONO_DIFF_R2L[r3];
    const colL = MONO_DIFF_L2R[c0] + MONO_DIFF_L2R[c1] + MONO_DIFF_L2R[c2] + MONO_DIFF_L2R[c3];
    const colR = MONO_DIFF_R2L[c0] + MONO_DIFF_R2L[c1] + MONO_DIFF_R2L[c2] + MONO_DIFF_R2L[c3];
    v += w.mono * Math.max(rowL, rowR, colL, colR);
  }
  if (w.smooth !== 0) {
    v += w.smooth * (SMOOTH_ROW[r0] + SMOOTH_ROW[r1] + SMOOTH_ROW[r2] + SMOOTH_ROW[r3] + SMOOTH_ROW[c0] + SMOOTH_ROW[c1] + SMOOTH_ROW[c2] + SMOOTH_ROW[c3]);
  }
  if (w.merge !== 0) {
    v += w.merge * (MERGE_ROW[r0] + MERGE_ROW[r1] + MERGE_ROW[r2] + MERGE_ROW[r3] + MERGE_ROW[c0] + MERGE_ROW[c1] + MERGE_ROW[c2] + MERGE_ROW[c3]);
  }
  if (w.corner !== 0) v += w.corner * cornerScore(b);
  if (w.snake !== 0) v += w.snake * snakeScore(b, c0, c1, c2, c3);
  if (w.maxTile !== 0) v += w.maxTile * maxTileLog4(b);
  return v;
}
