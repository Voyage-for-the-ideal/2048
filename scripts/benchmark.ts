/**
 * Headless seeded benchmark CLI.
 *
 * Usage:
 *   npm run benchmark -- [games] [seedStart] [--maxDepth N] [--budgetMs N]
 *     [--cutoff K] [--noTT] [--objective MAX_SCORE|MAX_TILE]
 *     [--weights <json-file-or-inline>] [--json out.json] [--keepBest]
 *
 * Example:
 *   npm run benchmark -- 200 0 --maxDepth 3 --budgetMs 30
 */
import { AI } from "../src/ai/ai";
import { parseWeights, DEFAULT_WEIGHTS } from "../src/ai/weights";
import { runBenchmark, type GameResult } from "../src/benchmark/runner";
import { summaryTable, type Summary } from "../src/benchmark/stats";
import { readFileSync, existsSync, writeFileSync } from "node:fs";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(name);
}

function parseWeightsArg(s: string | undefined) {
  if (!s) return undefined;
  if (existsSync(s)) return parseWeights(readFileSync(s, "utf8"));
  return parseWeights(s);
}

const games = parseInt(arg("--games") ?? process.argv[2] ?? "100", 10);
const seedStart = parseInt(arg("--seedStart") ?? process.argv[3] ?? "0", 10);
const maxDepth = parseInt(arg("--maxDepth") ?? "3", 10);
const budgetMs = parseInt(arg("--budgetMs") ?? "40", 10);
const cutoff = parseInt(arg("--cutoff") ?? "0", 10);
const objective = (arg("--objective") ?? "MAX_SCORE") as "MAX_SCORE" | "MAX_TILE";
const weights = parseWeightsArg(arg("--weights"));
const jsonOut = arg("--json");
const keepBest = flag("--keepBest");
const label = arg("--label") ?? `expectimax d${maxDepth} b${budgetMs}${cutoff ? ` c${cutoff}` : ""}`;

const ai = new AI({
  objective,
  maxDepth,
  budgetMs,
  chanceCutoff: cutoff,
  useTT: !flag("--noTT"),
  weights: weights ?? (objective === "MAX_TILE" ? undefined : DEFAULT_WEIGHTS),
  persistentTT: true,
});

console.log(
  `benchmark: games=${games} seeds=${seedStart}..${seedStart + games - 1} ${label}` +
    (weights ? "" : " (default weights)"),
);
const { summary, results } = runBenchmark({
  games,
  seedStart,
  ai,
  keepMoves: keepBest,
  onProgress: (done, total) => {
    if (done % Math.max(1, Math.floor(total / 10)) === 0) {
      console.log(`  ${done}/${total} games...`);
    }
  },
});
console.log(summaryTable(summary, label));

if (keepBest) {
  const best = results.reduce<GameResult | null>((b, r) => (b === null || r.score > b.score ? r : b), null);
  if (best) {
    console.log(`best game: seed=${best.seed} score=${best.score} maxTile=${Math.pow(2, best.maxTileLog)} moves=${best.moves}`);
    writeFileSync("best-game.json", JSON.stringify({ seed: best.seed, score: best.score, maxTile: Math.pow(2, best.maxTileLog), moves: best.moves, moveSeq: best.moveSeq }, null, 2));
    console.log("wrote best-game.json");
  }
}

if (jsonOut) {
  const out: { label: string; config: unknown; summary: Summary; results: GameResult[] } = {
    label,
    config: { games, seedStart, maxDepth, budgetMs, cutoff, objective, weights: weights ?? null },
    summary,
    results,
  };
  writeFileSync(jsonOut, JSON.stringify(out, null, 2));
  console.log(`wrote ${jsonOut}`);
}
