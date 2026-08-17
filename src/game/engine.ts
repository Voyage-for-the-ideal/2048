/**
 * Fast game engine on the 4×Uint16 board representation.
 * Moves are pure lookup-table operations; no allocation in hot paths
 * (applyMove writes into a caller-provided output board).
 */

import { Board, UP, DOWN, LEFT, RIGHT } from "./board";
import {
  MOVE_LEFT,
  MOVE_RIGHT,
  SCORE_LEFT,
  SCORE_RIGHT,
  EMPTY_ROW,
} from "./moveTables";
import type { RNG } from "./rng";

export const DIR_MOVE = [MOVE_LEFT, MOVE_RIGHT, MOVE_LEFT, MOVE_RIGHT];
export const DIR_SCORE = [SCORE_LEFT, SCORE_RIGHT, SCORE_LEFT, SCORE_RIGHT];

function colBits(b: Board, c: number): number {
  return (
    ((b[0] >>> (c * 4)) & 15) |
    (((b[1] >>> (c * 4)) & 15) << 4) |
    (((b[2] >>> (c * 4)) & 15) << 8) |
    (((b[3] >>> (c * 4)) & 15) << 12)
  );
}

/**
 * Apply a move to `b`, writing the result into `out` (may be the same array as
 * `b`). Returns the score gained by the move.
 */
export function applyMove(b: Board, dir: number, out: Board): number {
  const moveTable = DIR_MOVE[dir];
  const scoreTable = DIR_SCORE[dir];
  let gain = 0;
  if (dir === LEFT || dir === RIGHT) {
    for (let r = 0; r < 4; r++) {
      const row = b[r];
      out[r] = moveTable[row];
      gain += scoreTable[row];
    }
  } else {
    // Vertical moves: operate on columns, need old rows captured first.
    const r0 = b[0], r1 = b[1], r2 = b[2], r3 = b[3];
    for (let c = 0; c < 4; c++) {
      const col = ((r0 >>> (c * 4)) & 15) | (((r1 >>> (c * 4)) & 15) << 4) |
        (((r2 >>> (c * 4)) & 15) << 8) | (((r3 >>> (c * 4)) & 15) << 12);
      const movedCol = moveTable[col];
      gain += scoreTable[col];
      const shift = c * 4;
      out[0] = (out[0] & ~(15 << shift)) | (((movedCol >>> 0) & 15) << shift);
      out[1] = (out[1] & ~(15 << shift)) | (((movedCol >>> 4) & 15) << shift);
      out[2] = (out[2] & ~(15 << shift)) | (((movedCol >>> 8) & 15) << shift);
      out[3] = (out[3] & ~(15 << shift)) | (((movedCol >>> 12) & 15) << shift);
    }
  }
  return gain;
}

export function moved(b: Board, dir: number): boolean {
  const moveTable = DIR_MOVE[dir];
  if (dir === LEFT || dir === RIGHT) {
    for (let r = 0; r < 4; r++) if (moveTable[b[r]] !== b[r]) return true;
    return false;
  }
  for (let c = 0; c < 4; c++) {
    if (moveTable[colBits(b, c)] !== colBits(b, c)) return true;
  }
  return false;
}

/** Bitmask of legal moves (bit i set => dir i legal). */
export function legalMask(b: Board): number {
  let mask = 0;
  for (let d = 0; d < 4; d++) if (moved(b, d)) mask |= 1 << d;
  return mask;
}

export function legalMoves(b: Board): number[] {
  const out: number[] = [];
  for (let d = 0; d < 4; d++) if (moved(b, d)) out.push(d);
  return out;
}

export function emptyCount(b: Board): number {
  return EMPTY_ROW[b[0]] + EMPTY_ROW[b[1]] + EMPTY_ROW[b[2]] + EMPTY_ROW[b[3]];
}

export function isGameOver(b: Board): boolean {
  return legalMask(b) === 0;
}

/** Empty cell indices, row-major (0..15), in the given (reused) array. */
export function emptyCells(b: Board, out: number[]): number {
  let k = 0;
  for (let r = 0; r < 4; r++) {
    const row = b[r];
    if ((row & 15) === 0) out[k++] = r * 4;
    if (((row >>> 4) & 15) === 0) out[k++] = r * 4 + 1;
    if (((row >>> 8) & 15) === 0) out[k++] = r * 4 + 2;
    if (((row >>> 12) & 15) === 0) out[k++] = r * 4 + 3;
  }
  return k;
}

/**
 * Add a random tile (90% 2, 10% 4) to a uniformly random empty cell.
 * `rng` is a function returning a float in [0, 1).
 * Returns the index (0..15) of the spawned cell, or -1 when the board is full.
 */
export function addRandomTile(b: Board, rng: RNG): number {
  const empties: number[] = [];
  const n = emptyCells(b, empties);
  if (n === 0) return -1;
  const idx = empties[Math.floor(rng() * n)];
  const r = idx >> 2;
  const c = idx & 3;
  const v = rng() < 0.9 ? 1 : 2;
  b[r] = (b[r] & ~(15 << (c * 4))) | (v << (c * 4));
  return idx;
}

/** Initial board for a new game: two random tiles. */
export function newGameBoard(rng: RNG): Board {
  const b = new Uint16Array(4);
  addRandomTile(b, rng);
  addRandomTile(b, rng);
  return b;
}
