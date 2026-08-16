/**
 * Depth profile diagnostic: records completedDepth / nodes / time per move
 * vs. empty-cell count, to verify the endgame actually searches deep enough
 * (TODO §3). Also reports maxTile 512+ moments and the moves chosen there.
 *
 * Usage:
 *   npx tsx scripts/depthProfile.ts [games] [seedStart] [--maxDepth N] [--budgetMs N] [--cutoff K] [--nodeBudget N]
 */
import { AI } from "../src/ai/ai";
import { DEFAULT_WEIGHTS } from "../src/ai/weights";
import { mulberry32 } from "../src/game/rng";
import { newGameBoard, applyMove, legalMask, addRandomTile, emptyCount } from "../src/game/engine";
import { maxTileLog } from "../src/game/board";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const games = parseInt(process.argv[2] ?? "5", 10);
const seedStart = parseInt(process.argv[3] ?? "0", 10);
const maxDepth = parseInt(arg("--maxDepth") ?? "4", 10);
const budgetMs = parseInt(arg("--budgetMs") ?? "100", 10);
const cutoff = parseInt(arg("--cutoff") ?? "8", 10);
const nodeBudget = parseInt(arg("--nodeBudget") ?? "0", 10);

const ai = new AI({
  objective: "MAX_SCORE",
  maxDepth,
  budgetMs,
  chanceCutoff: cutoff,
  nodeBudget,
  useTT: true,
  weights: DEFAULT_WEIGHTS,
  persistentTT: true,
});

// Histogram: completedDepth vs emptyCount bucket.
const depthHist: Record<number, number[]> = {};
const lateHist: Record<number, number> = {}; // empties <= 5
let lateDecisions = 0;
let totalDecisions = 0;
const bigTileEvents: Array<{ seed: number; move: number; empty: number; depth: number; maxTile: number }> = [];

for (let g = 0; g < games; g++) {
  const seed = seedStart + g;
  const rng = mulberry32(seed);
  const board = newGameBoard(rng);
  let score = 0;
  let moves = 0;
  for (;;) {
    const mask = legalMask(board);
    if (mask === 0) break;
    const decision = ai.chooseMove(board, score);
    totalDecisions++;
    const empty = emptyCount(board);
    const mt = maxTileLog(board);
    if (empty <= 5) {
      lateDecisions++;
      lateHist[decision.stats.depth] = (lateHist[decision.stats.depth] ?? 0) + 1;
    }
    (depthHist[empty] ??= []).push(decision.stats.depth);
    if (mt >= 9) bigTileEvents.push({ seed, move: decision.move, empty, depth: decision.stats.depth, maxTile: mt });
    if (decision.move < 0 || (mask & (1 << decision.move)) === 0) break;
    const after = new Uint16Array(4);
    score += applyMove(board, decision.move, after);
    board.set(after);
    moves++;
    addRandomTile(board, rng);
  }
  console.log(`game ${seed}: moves=${moves} score=${score} maxTile=${2 ** maxTileLog(board)}`);
}

console.log("\n=== completedDepth vs emptyCount (avg depth per bucket, n) ===");
for (const [e, ds] of Object.entries(depthHist).sort((a, b) => Number(a[0]) - Number(b[0]))) {
  const avg = ds.reduce((s, x) => s + x, 0) / ds.length;
  console.log(`  empties=${e.padStart(2)}: avgDepth=${avg.toFixed(2)} n=${ds.length} dist={${Object.entries(ds.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {})).map(([d, n]) => `d${d}:${n}`).join(",")}}`);
}

console.log(`\n=== endgame (empties<=5): ${lateDecisions}/${totalDecisions} decisions ===");
for (const [d, n] of Object.entries(lateHist).sort((a, b) => Number(a[0]) - Number(b[0]))) {
  console.log(`  depth ${d}: ${n}`);
}

if (bigTileEvents.length) {
  console.log(`\n=== moves while maxTile>=512 (${bigTileEvents.length} decisions) ===`);
  for (const e of bigTileEvents.slice(-10)) {
    console.log(`  seed=${e.seed} maxTile=${2 ** e.maxTile} empties=${e.empty} depth=${e.depth}`);
  }
} else {
  console.log("\n=== no maxTile>=512 positions observed ===");
}
