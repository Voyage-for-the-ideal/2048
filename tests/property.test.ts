/**
 * Property testing: the optimized bitboard engine must agree with the
 * reference engine on random boards for every direction, including score,
 * moved flag, legal moves, empty counts, and game-over detection.
 */
import { describe, it, expect } from "vitest";
import { newBoard, setCell, getCell, cellValue } from "../src/game/board";
import { applyMove, moved, legalMoves, isGameOver, emptyCount, addRandomTile, newGameBoard } from "../src/game/engine";
import * as ref from "../src/game/reference";
import { mulberry32, type RNG } from "../src/game/rng";

function refBoardFrom(b: Uint16Array): ref.RefBoard {
  const out = ref.refNewBoard();
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) out[r][c] = cellValue(getCell(b, r, c));
  }
  return out;
}

function fastFromRef(rb: ref.RefBoard): Uint16Array {
  const b = newBoard();
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const v = rb[r][c];
      setCell(b, r, c, v === 0 ? 0 : Math.log2(v));
    }
  }
  return b;
}

function randomBoard(rng: RNG): Uint16Array {
  const b = newBoard();
  const nTiles = Math.floor(rng() * 9); // 0..8 tiles
  for (let i = 0; i < nTiles; i++) {
    const r = Math.floor(rng() * 4);
    const c = Math.floor(rng() * 4);
    const n = 1 + Math.floor(rng() * 11); // 2..2048
    setCell(b, r, c, n);
  }
  return b;
}

describe("property: optimized engine === reference engine", () => {
  it("moves agree on random boards (scores, resulting boards, moved flags)", () => {
    const rng = mulberry32(20240816);
    for (let i = 0; i < 5000; i++) {
      const b = randomBoard(rng);
      const rb = refBoardFrom(b);
      for (let d = 0; d < 4; d++) {
        const out = newBoard();
        const gain = applyMove(b, d, out);
        const res = ref.refMove(rb, d);
        expect(refBoardFrom(out)).toEqual(res.board);
        expect(gain).toBe(res.score);
        expect(moved(b, d)).toBe(res.moved);
      }
    }
  });

  it("legal moves agree", () => {
    const rng = mulberry32(777);
    for (let i = 0; i < 2000; i++) {
      const b = randomBoard(rng);
      const rb = refBoardFrom(b);
      const fast = legalMoves(b).sort();
      const slow = [0, 1, 2, 3].filter((d) => ref.refMove(rb, d).moved).sort();
      expect(fast).toEqual(slow);
      expect(isGameOver(b)).toBe(ref.refIsGameOver(rb));
    }
  });

  it("empty counts agree", () => {
    const rng = mulberry32(888);
    for (let i = 0; i < 2000; i++) {
      const b = randomBoard(rng);
      expect(emptyCount(b)).toBe(ref.refEmptyCount(refBoardFrom(b)));
    }
  });

  it("random tile placement agrees", () => {
    const rng = mulberry32(999);
    for (let i = 0; i < 2000; i++) {
      const b = randomBoard(rng);
      const rb = refBoardFrom(b);
      // Both engines consume the same draw sequence (position draw, then value draw).
      const seed = rng() * 0xffffffff;
      addRandomTile(b, mulberry32(seed));
      ref.refAddRandomTile(rb, mulberry32(seed));
      expect(refBoardFrom(b)).toEqual(rb);
    }
  });

  it("full random games stay consistent with reference", () => {
    const rng = mulberry32(31337);
    for (let game = 0; game < 300; game++) {
      const b = newGameBoard(rng);
      const rb = refBoardFrom(b);
      while (true) {
        const moves = legalMoves(b);
        if (moves.length === 0) break;
        const d = moves[Math.floor(rng() * moves.length)];
        const out = newBoard();
        applyMove(b, d, out);
        const res = ref.refMove(rb, d);
        b.set(out);
        rb.splice(0, 4, ...res.board.map((row) => [...row]));
        // Same draw sequence for both engines.
        const seed = rng() * 0xffffffff;
        addRandomTile(b, mulberry32(seed));
        ref.refAddRandomTile(rb, mulberry32(seed));
        expect(refBoardFrom(b)).toEqual(rb);
      }
      expect(refBoardFrom(b)).toEqual(rb);
    }
  });
});
