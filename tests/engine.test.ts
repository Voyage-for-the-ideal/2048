import { describe, it, expect } from "vitest";
import { newBoard, setCell, getCell, cellValue, maxTileLog, UP, DOWN, LEFT, RIGHT } from "../src/game/board";
import { applyMove, moved, legalMoves, isGameOver, emptyCount, addRandomTile, newGameBoard } from "../src/game/engine";
import { mulberry32 } from "../src/game/rng";

function boardFrom(tiles: number[][]): Uint16Array {
  const b = newBoard();
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const v = tiles[r][c];
      setCell(b, r, c, v === 0 ? 0 : Math.log2(v));
    }
  }
  return b;
}

function tilesOf(b: Uint16Array): number[][] {
  const out: number[][] = [];
  for (let r = 0; r < 4; r++) {
    const row: number[] = [];
    for (let c = 0; c < 4; c++) row.push(cellValue(getCell(b, r, c)));
    out.push(row);
  }
  return out;
}

describe("engine moves", () => {
  it("move left: 2 2 2 2 row -> 4 4", () => {
    const b = boardFrom([
      [2, 2, 2, 2],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    const out = newBoard();
    const gain = applyMove(b, LEFT, out);
    expect(tilesOf(out)[0]).toEqual([4, 4, 0, 0]);
    expect(gain).toBe(8);
  });

  it("move right: 2 2 2 2 -> 0 0 4 4", () => {
    const b = boardFrom([
      [2, 2, 2, 2],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    const out = newBoard();
    applyMove(b, RIGHT, out);
    expect(tilesOf(out)[0]).toEqual([0, 0, 4, 4]);
  });

  it("move up and down are column-wise", () => {
    const b = boardFrom([
      [2, 0, 0, 0],
      [2, 0, 0, 0],
      [4, 0, 0, 0],
      [4, 0, 0, 0],
    ]);
    const outUp = newBoard();
    applyMove(b, UP, outUp);
    expect(tilesOf(outUp)[0]).toEqual([4, 0, 0, 0]);
    expect(tilesOf(outUp)[1]).toEqual([8, 0, 0, 0]);

    const outDown = newBoard();
    applyMove(b, DOWN, outDown);
    expect(tilesOf(outDown)[2]).toEqual([4, 0, 0, 0]);
    expect(tilesOf(outDown)[3]).toEqual([8, 0, 0, 0]);
  });

  it("no-op move produces identical board and moved=false", () => {
    // DOWN is a no-op: every column is already packed at the bottom.
    const b = boardFrom([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [2, 2, 0, 0],
      [4, 4, 8, 16],
    ]);
    const out = newBoard();
    const gain = applyMove(b, DOWN, out);
    expect(gain).toBe(0);
    expect(tilesOf(out)).toEqual(tilesOf(b));
    expect(moved(b, DOWN)).toBe(false);
    expect(moved(b, LEFT)).toBe(true);
    expect(moved(b, UP)).toBe(true);
  });

  it("applyMove works in place (out === b)", () => {
    const b = boardFrom([
      [2, 2, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    const orig = tilesOf(b);
    applyMove(b, LEFT, b);
    expect(tilesOf(b)).not.toEqual(orig);
    expect(tilesOf(b)[0][0]).toBe(4);
  });

  it("legal moves / game over", () => {
    const b = boardFrom([
      [2, 2, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    expect(legalMoves(b).sort()).toEqual([DOWN, LEFT, RIGHT]);
    expect(isGameOver(b)).toBe(false);

    const over = boardFrom([
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 4, 2],
    ]);
    expect(legalMoves(over)).toEqual([]);
    expect(isGameOver(over)).toBe(true);
  });

  it("empty count", () => {
    const b = boardFrom([
      [2, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    expect(emptyCount(b)).toBe(15);
  });

  it("max tile", () => {
    const b = boardFrom([
      [2, 0, 0, 0],
      [0, 16, 0, 0],
      [0, 0, 1024, 0],
      [0, 0, 0, 0],
    ]);
    expect(maxTileLog(b)).toBe(10);
  });
});

describe("random tile generation", () => {
  it("adds exactly one tile to a random empty cell", () => {
    const rng = mulberry32(42);
    const b = boardFrom([
      [2, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    addRandomTile(b, rng);
    expect(emptyCount(b)).toBe(14);
  });

  it("90% of spawned tiles are 2 over a large sample", () => {
    const rng = mulberry32(1234);
    let twos = 0;
    const trials = 10000;
    for (let i = 0; i < trials; i++) {
      const b = newGameBoard(rng);
      // newGameBoard uses rng twice per tile; reconstruct from a fresh board:
      // easier: count via addRandomTile on empty board
      const bb = newBoard();
      addRandomTile(bb, rng);
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          if (getCell(bb, r, c) === 1) twos++;
          if (getCell(bb, r, c) === 2) {
            // 4s only expected from fresh 4 spawns; fine
          }
        }
      }
    }
    const fours = trials - twos;
    expect(twos / trials).toBeGreaterThan(0.87);
    expect(twos / trials).toBeLessThan(0.93);
    expect(fours / trials).toBeGreaterThan(0.07);
  });

  it("seed reproducibility: same seed -> same sequence", () => {
    const r1 = mulberry32(7);
    const r2 = mulberry32(7);
    for (let i = 0; i < 100; i++) expect(r1()).toBe(r2());
    const b1 = newGameBoard(mulberry32(99));
    const b2 = newGameBoard(mulberry32(99));
    expect(tilesOf(b1)).toEqual(tilesOf(b2));
  });

  it("different seeds -> different boards (very likely)", () => {
    const b1 = newGameBoard(mulberry32(1));
    const b2 = newGameBoard(mulberry32(2));
    expect(tilesOf(b1)).not.toEqual(tilesOf(b2));
  });
});
