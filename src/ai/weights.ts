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
 */
export const DEFAULT_WEIGHTS: Weights = {
  empty: 27,
  mono: 47,
  smooth: 47,
  merge: 8,
  corner: 60,
  snake: 8,
  maxTile: 4,
  score: 0.5,
};

/** Weights biased toward reaching a large target tile (MAX_TILE objective). */
export const MAX_TILE_WEIGHTS: Weights = {
  empty: 20,
  mono: 8,
  smooth: 6,
  merge: 6,
  corner: 60,
  snake: 4,
  maxTile: 6,
  score: 0.3,
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
