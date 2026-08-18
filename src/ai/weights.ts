/**
 * Evaluator weights. The linear evaluation is:
 *   V(board) = wEmpty * empty
 *            + wMono  * monotonicity
 *            + wSmooth* smoothness
 *            + wMerge * mergePotential
 *            + wCorner* cornerScore
 *            + wSnake * snakeScore
 *            + wMax   * maxTileLog
 *            + wScore * log(1 + score)   (applied at move selection)
 *
 * Weights are tuned by scripts/tune.ts against seeded benchmarks.
 */

export interface Weights {
  empty: number;
  mono: number;
  smooth: number;
  merge: number;
  corner: number;
  snake: number;
  maxTile: number;
  score: number;
}

export const WEIGHT_NAMES: (keyof Weights)[] = [
  "empty",
  "mono",
  "smooth",
  "merge",
  "corner",
  "snake",
  "maxTile",
  "score",
];

/**
 * Starting point modeled on the classic nneonneo weights (empty/mono/smooth),
 * with the extra features (merge/corner/snake/maxTile) kept modest so the
 * tuned search can grow them. Refined by scripts/tune.ts.
 *
 * 2026-08-17: snake 8->2, maxTile 4->15, score 0.5->2 (candidate A).
 * The snake feature structurally rewards NOT merging (512+512 adjacent scores
 * 9*16+9*15=279 vs merged 1024 at 10*16=160), and its huge raw magnitude
 * dominated every other feature, so the AI refused to merge big tiles and
 * 2048 rate was 0%. With snake cut and maxTile/score raised, the 50-game
 * benchmark goes from 2048=0% to 2048=50% (mean 3291 -> 24763).
 *
 * 2026-08-18: snake 2->0 after a 4-arm ablation (15 games/arm, seeds 200-214,
 * d4 b100 c8): snake=0 beats the baseline on mean (39663 vs 24299), 2048 rate
 * (66.7% vs 53.3%) and 4096 rate (26.7% vs 6.7%); score=0 was neutral-ish
 * (2048 66.7%, mean 27657); mono=0 is clearly harmful (2048 33.3%), so it
 * stays.
 *
 */
export const DEFAULT_WEIGHTS: Weights = {
  empty: 27,
  mono: 47,
  smooth: 47,
  merge: 8,
  corner: 60,
  snake: 0,
  maxTile: 15,
  score: 2,
};

export function weightsToArray(w: Weights): number[] {
  return WEIGHT_NAMES.map((k) => w[k]);
}

export function weightsFromArray(a: number[]): Weights {
  const w = { ...DEFAULT_WEIGHTS } as Weights;
  WEIGHT_NAMES.forEach((k, i) => {
    (w as unknown as Record<string, number>)[k] = a[i] ?? DEFAULT_WEIGHTS[k];
  });
  return w;
}

export function serializeWeights(w: Weights): string {
  return JSON.stringify(w);
}

export function parseWeights(s: string): Weights {
  const parsed = JSON.parse(s) as Partial<Record<keyof Weights, number>>;
  const w = { ...DEFAULT_WEIGHTS } as Weights;
  for (const k of WEIGHT_NAMES) {
    if (typeof parsed[k] === "number") (w as unknown as Record<string, number>)[k] = parsed[k]!;
  }
  return w;
}
