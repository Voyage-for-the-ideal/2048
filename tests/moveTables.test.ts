import { describe, it, expect } from "vitest";
import { MOVE_LEFT, MOVE_RIGHT, SCORE_LEFT, SCORE_RIGHT, EMPTY_ROW } from "../src/game/moveTables";
import { cellValue } from "../src/game/board";

function rowFromTiles(tiles: number[]): number {
  let row = 0;
  for (let c = 0; c < 4; c++) {
    const v = tiles[c];
    const n = v === 0 ? 0 : Math.log2(v);
    row |= n << (c * 4);
  }
  return row;
}

function tilesOf(row: number): number[] {
  const out: number[] = [];
  for (let c = 0; c < 4; c++) out.push(cellValue((row >>> (c * 4)) & 15));
  return out;
}

describe("move tables", () => {
  it("2 2 2 2 -> 4 4 0 0 (not 8 0 0 0)", () => {
    const row = rowFromTiles([2, 2, 2, 2]);
    expect(tilesOf(MOVE_LEFT[row])).toEqual([4, 4, 0, 0]);
  });

  it("4 4 8 8 -> 8 16 0 0", () => {
    const row = rowFromTiles([4, 4, 8, 8]);
    expect(tilesOf(MOVE_LEFT[row])).toEqual([8, 16, 0, 0]);
  });

  it("2 2 4 -> 4 4 0 0", () => {
    const row = rowFromTiles([2, 2, 4, 0]);
    expect(tilesOf(MOVE_LEFT[row])).toEqual([4, 4, 0, 0]);
  });

  it("2 4 2 4 -> 2 4 2 4 (no merge)", () => {
    const row = rowFromTiles([2, 4, 2, 4]);
    expect(tilesOf(MOVE_LEFT[row])).toEqual([2, 4, 2, 4]);
  });

  it("2 2 2 -> 4 2 0 0", () => {
    const row = rowFromTiles([2, 2, 2, 0]);
    expect(tilesOf(MOVE_LEFT[row])).toEqual([4, 2, 0, 0]);
  });

  it("4 4 4 -> 8 4 0 0", () => {
    const row = rowFromTiles([4, 4, 4, 0]);
    expect(tilesOf(MOVE_LEFT[row])).toEqual([8, 4, 0, 0]);
  });

  it("0 0 0 0 -> 0 0 0 0 (no-op)", () => {
    const row = rowFromTiles([0, 0, 0, 0]);
    expect(MOVE_LEFT[row]).toBe(0);
    expect(MOVE_RIGHT[row]).toBe(0);
  });

  it("left score: 2 2 2 2 -> +8", () => {
    const row = rowFromTiles([2, 2, 2, 2]);
    expect(SCORE_LEFT[row]).toBe(8);
  });

  it("left score: 2 4 4 8 -> +8", () => {
    const row = rowFromTiles([2, 4, 4, 8]);
    expect(SCORE_LEFT[row]).toBe(8);
  });

  it("move right mirrors move left", () => {
    const row = rowFromTiles([2, 2, 0, 4]);
    expect(tilesOf(MOVE_RIGHT[row])).toEqual([0, 0, 4, 4]);
    const row2 = rowFromTiles([2, 4, 4, 8]);
    expect(tilesOf(MOVE_RIGHT[row2])).toEqual([0, 2, 8, 8]);
  });

  it("right score equals left score", () => {
    for (let row = 0; row < 65536; row++) {
      expect(SCORE_RIGHT[row]).toBe(SCORE_LEFT[row]);
    }
  });

  it("empty count table is correct", () => {
    const row = rowFromTiles([2, 0, 0, 8]);
    expect(EMPTY_ROW[row]).toBe(2);
    expect(EMPTY_ROW[0]).toBe(4);
  });
});
