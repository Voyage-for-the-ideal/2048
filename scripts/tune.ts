/**
 * Weight tuning: random mutation + tournament selection, evaluations run in
 * parallel worker threads for speed.
 *
 *   fitness = meanScore/1000 + 40*P(2048) + 150*P(4096) + 500*P(8192)
 *
 * Usage:
 *   npm run tune -- [games] [generations] [--maxDepth N] [--budgetMs N] [--cutoff K] [--workers W]
 */
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DEFAULT_WEIGHTS, WEIGHT_NAMES, type Weights } from "../src/ai/weights";
import { mulberry32, type RNG } from "../src/game/rng";
import { writeFileSync, existsSync } from "node:fs";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const games = parseInt(arg("--games") ?? process.argv[2] ?? "15", 10);
const generations = parseInt(arg("--generations") ?? process.argv[3] ?? "24", 10);
const maxDepth = parseInt(arg("--maxDepth") ?? "3", 10);
const budgetMs = parseInt(arg("--budgetMs") ?? "60", 10);
const cutoff = parseInt(arg("--cutoff") ?? "6", 10);
const workers = parseInt(arg("--workers") ?? "4", 10);

const POP_SIZE = workers * 2;
const KEEP = 2;
const rng: RNG = mulberry32(777);

// Per-feature mutation scales (relative to typical feature magnitudes).
const SCALE: Record<string, number> = {
  empty: 4,
  mono: 15,
  smooth: 15,
  merge: 4,
  corner: 25,
  snake: 5,
  maxTile: 3,
  score: 2,
};

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Evaluate one weights vector in a worker thread. */
function evaluateWeights(w: Weights): Promise<number> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(join(__dirname, "tuneWorker.ts"), {
      workerData: { games, maxDepth, budgetMs, cutoff, weights: w },
    });
    worker.once("message", (fit: number) => {
      resolve(fit);
      void worker.terminate();
    });
    worker.once("error", (err) => {
      reject(err);
      void worker.terminate();
    });
  });
}

function mutate(w: Weights, strength: number): Weights {
  const out = { ...w } as Weights;
  for (const k of WEIGHT_NAMES) {
    if (rng() < 0.5) {
      const rec = out as unknown as Record<string, number>;
      rec[k] = Math.max(0, rec[k] + (rng() - 0.5) * 2 * strength * SCALE[k]);
    }
  }
  return out;
}

function perturb(w: Weights, strength: number): Weights {
  const out = { ...w } as Weights;
  for (const k of WEIGHT_NAMES) {
    const rec = out as unknown as Record<string, number>;
    rec[k] = Math.max(0, rec[k] + (rng() - 0.5) * 2 * strength * SCALE[k]);
  }
  return out;
}

async function evalPool(pop: Array<{ w: Weights; fit: number }>): Promise<Array<{ w: Weights; fit: number }>> {
  const results = await Promise.all(pop.map(async (e) => ({ ...e, fit: await evaluateWeights(e.w) })));
  results.sort((a, b) => b.fit - a.fit);
  return results;
}

console.log(`tune: games=${games} generations=${generations} d${maxDepth} b${budgetMs} c${cutoff} workers=${workers}`);

let population: Array<{ w: Weights; fit: number }> = [{ w: { ...DEFAULT_WEIGHTS }, fit: -Infinity }];
for (let i = 1; i < POP_SIZE; i++) population.push({ w: perturb({ ...DEFAULT_WEIGHTS }, 1), fit: -Infinity });

let best: { w: Weights; fit: number } = { w: DEFAULT_WEIGHTS, fit: -Infinity };

for (let gen = 0; gen < generations; gen++) {
  const t0 = Date.now();
  population = await evalPool(population);
  if (population[0].fit > best.fit) best = population[0];
  console.log(
    `gen ${gen + 1}/${generations} (${((Date.now() - t0) / 1000).toFixed(0)}s): ` +
      `best fit=${best.fit.toFixed(2)} w=${JSON.stringify(best.w)}`,
  );
  const next = population.slice(0, KEEP);
  while (next.length < POP_SIZE) {
    const parent = population[Math.floor(rng() * KEEP)];
    next.push({ w: mutate(parent.w, 0.5 + rng() * 0.7), fit: -Infinity });
  }
  population = next;
}

population = await evalPool(population);
if (population[0].fit > best.fit) best = population[0];
console.log("=== final best weights ===");
console.log(JSON.stringify(best.w, null, 2));
writeFileSync("tuned-weights.json", JSON.stringify(best.w, null, 2));
console.log("wrote tuned-weights.json");
