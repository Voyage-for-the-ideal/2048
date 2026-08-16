/** Debug: compare leaf eval and shallow search values of UP-after vs LEFT-after. */
import { newBoard, setCell, boardToString, cellValue } from "../src/game/board";
import { applyMove } from "../src/game/engine";
import { evaluate, evalFeatures } from "../src/ai/evaluator";
import { Expectimax } from "../src/ai/expectimax";
import { DEFAULT_WEIGHTS } from "../src/ai/weights";

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

const upAfter = new Uint16Array(4);
const leftAfter = new Uint16Array(4);
applyMove(b, 0, upAfter);
applyMove(b, 2, leftAfter);

console.log("=== UP after ===");
console.log(boardToString(upAfter));
console.log("leaf eval =", evaluate(upAfter, DEFAULT_WEIGHTS));
console.log("\n=== LEFT after ===");
console.log(boardToString(leftAfter));
console.log("leaf eval =", evaluate(leftAfter, DEFAULT_WEIGHTS));

// Eval breakdown per feature to see where the gap comes from.
function breakdown(brd: Uint16Array): void {
  const w = DEFAULT_WEIGHTS as unknown as Record<string, number>;
  const feats = evalFeatures(brd) as unknown as Record<string, number>;
  const lines = Object.entries(feats)
    .filter(([k]) => k in w)
    .map(([k, v]) => `  ${k.padEnd(8)} ${v.toFixed(1)} * ${w[k].toFixed(1)} = ${(v * w[k]).toFixed(1)}`);
  console.log(lines.join("\n"));
}

console.log("\n--- UP breakdown ---");
breakdown(upAfter);
console.log("--- LEFT breakdown ---");
breakdown(leftAfter);

// Shallow search: d1 (chance after one more ply), d2, d3.
for (const d of [1, 2, 3]) {
  const engine = new Expectimax();
  const upVal = engine.chooseMove(upAfter, { maxDepth: d, budgetMs: 60_000, nodeBudget: 0, chanceCutoff: 8, useTT: false, weights: DEFAULT_WEIGHTS, dynamicDepth: false }, 1052);
  const engine2 = new Expectimax();
  const leftVal = engine2.chooseMove(leftAfter, { maxDepth: d, budgetMs: 60_000, nodeBudget: 0, chanceCutoff: 8, useTT: false, weights: DEFAULT_WEIGHTS, dynamicDepth: false }, 24);
  console.log(`\ndepth-${d} continuation value: UP-after=${upVal.evals.reduce((m, e) => Math.max(m, e.value), -Infinity).toFixed(1)} LEFT-after=${leftVal.evals.reduce((m, e) => Math.max(m, e.value), -Infinity).toFixed(1)}`);
  void cellValue; // silence unused import lint
}
