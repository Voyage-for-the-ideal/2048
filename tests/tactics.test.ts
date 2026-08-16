/**
 * Tactical behaviors (TODO §3): verify the AI handles endgame/tactical
 * positions sensibly — merging adjacent big tiles, keeping the corner
 * tile in place, and actually completing the deeper endgame search.
 */
import { describe, it, expect } from "vitest";
import { newBoard, setCell, maxTileLog, getCell } from "../src/game/board";
import { applyMove, legalMask, newGameBoard, addRandomTile } from "../src/game/engine";
import { Expectimax, type AIConfig } from "../src/ai/expectimax";
import { DEFAULT_WEIGHTS } from "../src/ai/weights";
import { AI } from "../src/ai/ai";
import { mulberry32 } from "../src/game/rng";

function makeCfg(maxDepth: number, budgetMs: number, nodeBudget = 0): AIConfig {
  return {
    maxDepth,
    budgetMs,
    nodeBudget,
    chanceCutoff: 8, // production config; full chance expansion is too slow for tests
    useTT: false,
    weights: DEFAULT_WEIGHTS,
  };
}

describe("tactics", () => {
  it("never splits two adjacent 512s (merges now or keeps them adjacent)", () => {
    // 512 (log 9) stacked in column 0; small tiles elsewhere so that the only
    // big-tile merge is UP/DOWN. LEFT/RIGHT keep the 512s adjacent (safe to
    // merge later) — only a move that separates them is bad.
    const b = newBoard();
    setCell(b, 0, 0, 9);
    setCell(b, 1, 0, 9);
    for (const [r, c] of [
      [0, 1], [0, 2], [0, 3],
      [1, 1], [1, 2], [1, 3],
      [2, 0], [2, 1], [2, 2], [2, 3],
      [3, 0], [3, 1], [3, 2], [3, 3],
    ]) {
      setCell(b, r, c, 1);
    }
    const engine = new Expectimax();
    const { move } = engine.chooseMove(b, makeCfg(4, 60_000), 0);
    const after = new Uint16Array(4);
    applyMove(b, move, after);
    const merged = maxTileLog(after) >= 10;
    const stillAdjacent =
      (getCell(after, 0, 0) === 9 && getCell(after, 1, 0) === 9) ||
      (getCell(after, 0, 3) === 9 && getCell(after, 1, 3) === 9);
    expect(merged || stillAdjacent).toBe(true);
  }, 120_000);

  it("keeps a 1024 in the corner (no move that dislodges it first)", () => {
    // Corner tile at (0,0) = 1024 (log 10). UP/LEFT leave it in place;
    // DOWN/RIGHT move it out of the corner.
    const b = newBoard();
    setCell(b, 0, 0, 10);
    for (const [r, c] of [
      [0, 1], [0, 2], [0, 3],
      [1, 0], [1, 1], [1, 2], [1, 3],
      [2, 0], [2, 1], [2, 2], [2, 3],
      [3, 0], [3, 1], [3, 2], [3, 3],
    ]) {
      setCell(b, r, c, 1);
    }
    const engine = new Expectimax();
    const { move, evals } = engine.chooseMove(b, makeCfg(4, 60_000), 0);
    const mask = legalMask(b);
    expect(mask & (1 << move)).toBeTruthy();
    if (move === 1 || move === 3) {
      // Dislodging is tolerated only if the move's eval is strictly better
      // than both corner-preserving moves.
      const dislodge = evals.find((e) => e.move === move)!.value;
      const bestKeep = Math.max(
        ...evals.filter((e) => e.move === 0 || e.move === 2).map((e) => e.value),
      );
      expect(dislodge).toBeLessThanOrEqual(bestKeep);
    }
  }, 120_000);

  it("reaches at least 1024 in real play (integration)", () => {
    // The whole point of the tuned weights: the AI must actually merge big
    // tiles during a game. Two quick full games with a shallow search.
    const ai = new AI({ maxDepth: 3, budgetMs: 60, chanceCutoff: 8, nodeBudget: 200_000, useTT: true, persistentTT: true });
    let best = 0;
    for (const seed of [500, 501]) {
      const rng = mulberry32(seed);
      const b = newGameBoard(rng);
      let score = 0;
      for (;;) {
        const mask = legalMask(b);
        if (mask === 0) break;
        const d = ai.chooseMove(b, score);
        const after = new Uint16Array(4);
        score += applyMove(b, d.move, after);
        b.set(after);
        addRandomTile(b, rng);
      }
      best = Math.max(best, maxTileLog(b));
    }
    expect(best).toBeGreaterThanOrEqual(10); // 1024
  }, 300_000);

  it("completes depth 6 in a two-empty-cell endgame (dynamic depth)", () => {
    // empties < 5 => dynamicMaxDepth gives maxDepth + 2 = 6.
    const b = newBoard();
    // A nearly full endgame board: two empties at (3,1) and (3,3).
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        if (r === 3 && (c === 1 || c === 3)) continue;
        setCell(b, r, c, 1 + ((r * 4 + c) % 9));
      }
    }
    const engine = new Expectimax();
    const { stats } = engine.chooseMove(b, makeCfg(4, 60_000), 0);
    expect(stats.depth).toBeGreaterThanOrEqual(6);
  });
});
