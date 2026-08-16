/**
 * AI Web Worker: runs the search off the main thread. Handles single-move
 * decisions and whole benchmark runs.
 */
import { AI, type AIOptions } from "./ai/ai";
import type { MoveEval, SearchStats } from "./ai/expectimax";
import { parseWeights } from "./ai/weights";
import { summarize } from "./benchmark/stats";
import type { Summary } from "./benchmark/stats";
import { mulberry32 } from "./game/rng";
import { newGameBoard, applyMove, addRandomTile, legalMask } from "./game/engine";
import { maxTileLog } from "./game/board";

export interface ChooseRequest {
  type: "choose";
  requestId: number;
  board: number[]; // 4 row values
  score: number;
  config: Partial<AIOptions>;
}

export interface BenchmarkRequest {
  type: "benchmark";
  games: number;
  seedStart: number;
  config: Partial<AIOptions>;
}

export type WorkerRequest = ChooseRequest | BenchmarkRequest | { type: "cancel" };

let ai: AI | null = null;
let aiConfigKey = "";
let cancelBenchmark = false;

function ensureAI(config: Partial<AIOptions>): AI {
  const key = JSON.stringify(config);
  if (ai === null || key !== aiConfigKey) {
    ai = new AI(config);
    aiConfigKey = key;
  }
  return ai;
}

function parseConfig(config: Partial<AIOptions>): Partial<AIOptions> {
  const out = { ...config };
  if (typeof out.weights === "string") out.weights = parseWeights(out.weights as string);
  return out;
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === "cancel") {
    cancelBenchmark = true;
    return;
  }
  if (msg.type === "choose") {
    const cfg = parseConfig(msg.config);
    const board = Uint16Array.from(msg.board);
    const engine = ensureAI(cfg);
    const decision = engine.chooseMove(board, msg.score);
    (self as unknown as Worker).postMessage({
      type: "decision",
      requestId: msg.requestId,
      move: decision.move,
      evals: decision.evals as MoveEval[],
      stats: decision.stats as SearchStats,
    });
    return;
  }
  if (msg.type === "benchmark") {
    cancelBenchmark = false;
    const cfg = parseConfig(msg.config);
    const engine = ensureAI(cfg);
    let bestGame: { seed: number; score: number; maxTile: number; moves: number; moveSeq: number[] } | null = null;
    const start = performance.now();
    let done = 0;
    let totalNodes = 0;
    const results: Array<{ score: number; maxTileLog: number; moves: number }> = [];
    for (let i = 0; i < msg.games; i++) {
      if (cancelBenchmark) break;
      const { game, nodes } = playGameWithStatsCapture(msg.seedStart + i, engine);
      results.push({ score: game.score, maxTileLog: game.maxTileLog, moves: game.moves });
      totalNodes += nodes;
      if (!bestGame || game.score > bestGame.score) {
        bestGame = {
          seed: game.seed,
          score: game.score,
          maxTile: Math.pow(2, game.maxTileLog),
          moves: game.moves,
          moveSeq: game.moveSeq,
        };
      }
      done++;
      (self as unknown as Worker).postMessage({
        type: "benchmarkProgress",
        done,
        total: msg.games,
        bestScore: bestGame.score,
      });
    }
    const summary = summarize(results, { elapsedMs: performance.now() - start, totalNodes });
    (self as unknown as Worker).postMessage({
      type: "benchmarkDone",
      summary,
      bestGame,
      cancelled: cancelBenchmark,
    });
  }
};

/** Play one game capturing the move sequence (for replay) and node stats. */
function playGameWithStatsCapture(seed: number, engine: AI): { game: { seed: number; score: number; maxTileLog: number; moves: number; moveSeq: number[] }; nodes: number } {
  const rng = mulberry32(seed);
  const board = newGameBoard(rng);
  const moveSeq: number[] = [];
  let score = 0;
  let moves = 0;
  let nodes = 0;
  for (;;) {
    const mask = legalMask(board);
    if (mask === 0) break;
    const decision = engine.chooseMove(board, score);
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
  return { game: { seed, score, maxTileLog: maxTileLog(board), moves, moveSeq }, nodes };
}

export type { Summary };
