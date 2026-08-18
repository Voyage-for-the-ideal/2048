import { describe, expect, it } from "vitest";
import { AI } from "../src/ai/ai";
import { DEFAULT_WEIGHTS, MAX_TILE_WEIGHTS } from "../src/ai/weights";

describe("MAX_TILE defaults", () => {
  it("uses a merge-friendly profile that keeps the transposition table eligible", () => {
    const ai = new AI({ objective: "MAX_TILE" });

    expect(ai.options.weights).toEqual(MAX_TILE_WEIGHTS);
    expect(MAX_TILE_WEIGHTS.snake).toBe(0);
    expect(MAX_TILE_WEIGHTS.score).toBe(0);
    expect(MAX_TILE_WEIGHTS.maxTile).toBeGreaterThan(DEFAULT_WEIGHTS.maxTile);
    expect(MAX_TILE_WEIGHTS.mono).toBeGreaterThanOrEqual(DEFAULT_WEIGHTS.mono);
    expect(MAX_TILE_WEIGHTS.smooth).toBeGreaterThanOrEqual(DEFAULT_WEIGHTS.smooth);
  });
});
