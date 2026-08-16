/**
 * Seeded game runner used by both the headless benchmark and the in-browser
 * Benchmark panel. All AI comparisons use the same seed set for fairness.
 */
import type { Board } from "../game/board";
import { applyMove, legalMask, addRandomTile, newGameBoard, emptyCount } from "../game/engine";
import { maxTileLog } from "../game/board";
import { mulberry32, type RNG } from "../game/rng";
import type { AI } from "../ai/ai";
import { summarize, type GameOutcome, type Summary } from "./stats";

export interface GameResult extends GameOutcome {
  seed: number;
  moveSeq: number[];
}

export interface BenchmarkConfig {
  games: number;
  seedStart: number;
  ai: AI;
  /** Record move sequences for the best game (used by replay). */
  keepMoves: boolean;
  onProgress?: (done: number, total: number, current: GameResult) => void;
}

/** Play one full game with the AI. Deterministic given (seed, ai config). */
export function playGame(seed: number, ai: AI, keepMoves = false): GameResult {
  const rng: RNG = mulberry32(seed);
  const board: Board = newGameBoard(rng);
  const moveSeq: number[] = [];
  let score = 0;
  let moves = 0;

  for (;;) {
    const mask = legalMask(board);
    if (mask === 0) break;
    const decision = ai.chooseMove(board, score);
    if (decision.move < 0 || (mask & (1 << decision.move)) === 0) {
      // Fallback: pick any legal move if the AI returns an illegal one.
      let fallback = 0;
      while ((mask & (1 << fallback)) === 0) fallback++;
      decision.move = fallback;
    }
    const after = new Uint16Array(4);
    const gain = applyMove(board, decision.move, after);
    board.set(after);
    score += gain;
    moves++;
    if (keepMoves) moveSeq.push(decision.move);
    addRandomTile(board, rng);
  }

  return {
    seed,
    score,
    maxTileLog: maxTileLog(board),
    moves,
    moveSeq: keepMoves ? moveSeq : [],
  };
}

/** Run a seeded benchmark and summarize. */
export function runBenchmark(cfg: BenchmarkConfig): { summary: Summary; results: GameResult[] } {
  const start = performance.now();
  const results: GameResult[] = [];
  let best: GameResult | null = null;
  let totalNodes = 0;

  for (let i = 0; i < cfg.games; i++) {
    const seed = cfg.seedStart + i;
    const { game, nodes } = playGameWithStats(seed, cfg.ai);
    results.push(game);
    totalNodes += nodes;
    if (!best || game.score > best.score) best = game;
    cfg.onProgress?.(i + 1, cfg.games, game);
  }

  const summary = summarize(
    results.map((r) => ({ score: r.score, maxTileLog: r.maxTileLog, moves: r.moves })),
    { elapsedMs: performance.now() - start, totalNodes },
  );
  return { summary, results };
}

/** Play one game, tracking per-move AI stats for accurate node totals. */
export function playGameWithStats(seed: number, ai: AI): { game: GameResult; nodes: number } {
  const rng: RNG = mulberry32(seed);
  const board: Board = newGameBoard(rng);
  const moveSeq: number[] = [];
  let score = 0;
  let moves = 0;
  let nodes = 0;

  for (;;) {
    const mask = legalMask(board);
    if (mask === 0) break;
    const decision = ai.chooseMove(board, score);
    nodes += decision.stats.nodes;
    if (decision.move < 0 || (mask & (1 << decision.move)) === 0) {
      let fallback = 0;
      while ((mask & (1 << fallback)) === 0) fallback++;
      decision.move = fallback;
    }
    const after = new Uint16Array(4);
    const gain = applyMove(board, decision.move, after);
    board.set(after);
    score += gain;
    moves++;
    moveSeq.push(decision.move);
    addRandomTile(board, rng);
  }

  return {
    game: { seed, score, maxTileLog: maxTileLog(board), moves, moveSeq },
    nodes,
  };
}
