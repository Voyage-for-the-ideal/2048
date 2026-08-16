/**
 * Search correctness: compare the optimized Expectimax (shared scratch pools,
 * TT off) against a purely functional reference expectimax on random boards.
 * The reference has no shared mutable state and re-derives everything.
 */
import { describe, it, expect } from "vitest";
import { newBoard, setCell, getCell, cellValue } from "../src/game/board";
import { applyMove, legalMask, emptyCells } from "../src/game/engine";
import { evaluate } from "../src/ai/evaluator";
import { Expectimax, type AIConfig } from "../src/ai/expectimax";
import { DEFAULT_WEIGHTS, type Weights } from "../src/ai/weights";
import { mulberry32, type RNG } from "../src/game/rng";

// --- functional reference (no shared state) ---

function refLeaf(b: Uint16Array, pathScore: number, w: Weights): number {
  return evaluate(b, w) + w.score * Math.log(1 + pathScore);
}

function refPlayer(b: Uint16Array, depth: number, pathScore: number, w: Weights): number {
  if (depth <= 0) return refLeaf(b, pathScore, w);
  const mask = legalMask(b);
  if (mask === 0) return refLeaf(b, pathScore, w);
  let best = -Infinity;
  for (let d = 0; d < 4; d++) {
    if ((mask & (1 << d)) === 0) continue;
    const after = new Uint16Array(4);
    const gain = applyMove(b, d, after);
    const v = refChance(after, depth - 1, pathScore + gain, w);
    if (v > best) best = v;
  }
  return best;
}

function refChance(after: Uint16Array, depth: number, pathScore: number, w: Weights): number {
  if (depth <= 0) return refLeaf(after, pathScore, w);
  const empties: number[] = [];
  const k = emptyCells(after, empties);
  if (k === 0) return refLeaf(after, pathScore, w);
  const inv = 1 / k;
  let sum = 0;
  for (let i = 0; i < k; i++) {
    const idx = empties[i];
    const r = idx >> 2;
    const c = idx & 3;
    for (const tile of [1, 2]) {
      const child = new Uint16Array(after);
      child[r] = (child[r] & ~(15 << (c * 4))) | (tile << (c * 4));
      sum += (tile === 1 ? 0.9 : 0.1) * inv * refPlayer(child, depth - 1, pathScore, w);
    }
  }
  return sum;
}

function refTopLevel(b: Uint16Array, depth: number, score: number, w: Weights): number[] {
  const vals = [-Infinity, -Infinity, -Infinity, -Infinity];
  for (let d = 0; d < 4; d++) {
    const after = new Uint16Array(4);
    const gain = applyMove(b, d, after);
    if (gain === 0 && after.every((v, i) => v === b[i])) continue; // no-op
    vals[d] = refChance(after, depth, score + gain, w);
  }
  return vals;
}

function randomBoard(rng: RNG): Uint16Array {
  const b = newBoard();
  const nTiles = 2 + Math.floor(rng() * 8);
  for (let i = 0; i < nTiles; i++) {
    const r = Math.floor(rng() * 4);
    const c = Math.floor(rng() * 4);
    setCell(b, r, c, 1 + Math.floor(rng() * 10));
  }
  return b;
}

function makeCfg(w: Weights, maxDepth: number, budgetMs: number): AIConfig {
  return { maxDepth, budgetMs, nodeBudget: 0, chanceCutoff: 0, useTT: false, weights: w, dynamicDepth: false };
}

describe("expectimax matches functional reference", () => {
  it("search values agree for depth 1..3 on random boards", () => {
    const rng = mulberry32(20240817);
    const engine = new Expectimax();
    const w = DEFAULT_WEIGHTS;
    for (let trial = 0; trial < 25; trial++) {
      const b = randomBoard(rng);
      for (const depth of [1, 2, 3]) {
        const cfg = makeCfg(w, depth, 60_000);
        const fast = engine.chooseMove(b, cfg, 0);
        const refVals = refTopLevel(b, depth, 0, w);
        for (let d = 0; d < 4; d++) {
          const fastVal = fast.evals.find((e) => e.move === d)?.value ?? -Infinity;
          const refVal = refVals[d];
          if (refVal === -Infinity) {
            expect(fastVal).toBe(-Infinity);
          } else {
            expect(Math.abs(fastVal - refVal)).toBeLessThan(1e-6 * Math.max(1, Math.abs(refVal)));
          }
        }
      }
    }
  });

  it("maxTile of board matches cellValue", () => {
    const b = newBoard();
    setCell(b, 0, 0, 10);
    expect(cellValue(getCell(b, 0, 0))).toBe(1024);
  });
});
