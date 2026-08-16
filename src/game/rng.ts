/**
 * Deterministic seeded RNG (mulberry32). Fast, good-enough distribution,
 * fully reproducible across runs and environments.
 */
export type RNG = () => number; // returns float in [0, 1)

export function mulberry32(seed: number): RNG {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random integer in [0, n). */
export function randInt(rng: RNG, n: number): number {
  return Math.floor(rng() * n);
}

/** Pick a uniformly random element from an array of indices (e.g. empty cells). */
export function pickUniform(rng: RNG, n: number): number {
  return randInt(rng, n);
}
