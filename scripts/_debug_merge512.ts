/** Debug: what does the AI choose with two adjacent 512s, and why? */
import { newBoard, setCell, maxTileLog, boardToString } from "../src/game/board";
import { applyMove } from "../src/game/engine";
import { Expectimax } from "../src/ai/expectimax";
import { DEFAULT_WEIGHTS, type Weights } from "../src/ai/weights";

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
console.log(boardToString(b));

const variants: Array<{ label: string; w: Weights }> = [
  { label: "baseline", w: { ...DEFAULT_WEIGHTS } },
  { label: "snake=4", w: { ...DEFAULT_WEIGHTS, snake: 4 } },
  { label: "snake=2", w: { ...DEFAULT_WEIGHTS, snake: 2 } },
  { label: "snake=0", w: { ...DEFAULT_WEIGHTS, snake: 0 } },
  { label: "snake=2 maxTile=15", w: { ...DEFAULT_WEIGHTS, snake: 2, maxTile: 15 } },
  { label: "snake=2 maxTile=15 score=2", w: { ...DEFAULT_WEIGHTS, snake: 2, maxTile: 15, score: 2 } },
  { label: "snake=4 maxTile=15", w: { ...DEFAULT_WEIGHTS, snake: 4, maxTile: 15 } },
  { label: "snake=2 score=2", w: { ...DEFAULT_WEIGHTS, snake: 2, score: 2 } },
];

for (const { label, w } of variants) {
  const engine = new Expectimax();
  const res = engine.chooseMove(b, { maxDepth: 4, budgetMs: 60_000, nodeBudget: 0, chanceCutoff: 8, useTT: false, weights: w }, 0);
  const after = new Uint16Array(4);
  applyMove(b, res.move, after);
  const up = res.evals.find((e) => e.move === 0)!.value;
  const left = res.evals.find((e) => e.move === 2)!.value;
  console.log(
    `[${label.padEnd(24)}] move=${["UP", "DOWN", "LEFT", "RIGHT"][res.move]} (UP=${up.toFixed(1)} LEFT=${left.toFixed(1)})` +
      ` depth=${res.stats.depth} maxTile=${2 ** maxTileLog(after)}`,
  );
}
