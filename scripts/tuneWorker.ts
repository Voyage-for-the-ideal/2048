/** Worker thread for one weight evaluation (spawned by tune.ts). */
import { parentPort, workerData } from "node:worker_threads";
import { AI } from "../src/ai/ai";
import { runBenchmark } from "../src/benchmark/runner";

const { games, maxDepth, budgetMs, cutoff, weights } = workerData as {
  games: number;
  maxDepth: number;
  budgetMs: number;
  cutoff: number;
  weights: Record<string, number>;
};

const ai = new AI({
  maxDepth,
  budgetMs,
  chanceCutoff: cutoff,
  useTT: true,
  weights: weights as never,
  persistentTT: true,
});
const { summary } = runBenchmark({ games, seedStart: 0, ai, keepMoves: false });
const fit = summary.meanScore / 1000 + 40 * summary.rates[11] + 150 * summary.rates[12] + 500 * summary.rates[13];
parentPort?.postMessage(fit);
