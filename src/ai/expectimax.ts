/**
 * Expectimax solver over afterstates.
 *
 *   player(board, depth) = max over legal moves of chance(after, depth)
 *   chance(after, depth) = E over (cell, tile) of player(board', depth-1)
 *                          with P(tile=2)=0.9, P(tile=4)=0.1, uniform cells
 *
 * The random-tile node is a CHANCE node, not an adversarial MIN node:
 * expectation is computed over all empty cells with the true probabilities.
 *
 * The search value is heuristic-only (no score term), so the transposition
 * table stays exact. The score term (wScore * log(1 + score)) is applied at
 * move selection on the top level.
 *
 * Supported: iterative deepening, time budget, dynamic depth by empty-cell
 * count, transposition table, optional chance-node pruning.
 */
import type { Board } from "../game/board";
import { applyMove, legalMask, emptyCells } from "../game/engine";
import { EMPTY_ROW } from "../game/moveTables";
import { evaluate } from "./evaluator";
import type { Weights } from "./weights";
import { TranspositionTable, PLAYER_NODE, CHANCE_NODE } from "./transposition";

export interface AIConfig {
  /** Hard cap on search depth (player plies). */
  maxDepth: number;
  /** Time budget per decision in ms (soft; nodeBudget is the hard stop). */
  budgetMs: number;
  /** Node budget per decision; search stops when exceeded (endgame depth). */
  nodeBudget: number;
  /** If > 0, expand only the top-K empty cells by a cheap heuristic (approximation). */
  chanceCutoff: number;
  useTT: boolean;
  weights: Weights;
  /** Optional shared transposition table passed in for continuity. */
  tt?: TranspositionTable;
  /** Set false to disable dynamic depth adjustment (tests). */
  dynamicDepth?: boolean;
}

export interface MoveEval {
  move: number;
  value: number;
  gain: number;
}

export interface SearchStats {
  nodes: number;
  ttHits: number;
  ttMisses: number;
  timeMs: number;
  depth: number;
}

const BUDGET_EXCEEDED = Symbol("budget exceeded");

/** Stack-allocated scratch boards: each recursive frame marks and releases. */
class ScratchPool {
  private pool: Board[] = [];
  private cursor = 0;

  mark(): number {
    return this.cursor;
  }

  get(): Board {
    if (this.cursor < this.pool.length) return this.pool[this.cursor++];
    const b = new Uint16Array(4);
    this.pool.push(b);
    this.cursor++;
    return b;
  }

  releaseTo(mark: number): void {
    this.cursor = mark;
  }
}

const EMPTY_CELLS: number[] = [];

function dynamicMaxDepth(cfg: AIConfig, board: Board): number {
  let d = cfg.maxDepth;
  // Fewer empty cells => smaller branching factor => deeper search.
  // Early game (many empty cells) stays shallow: the branching blowup is
  // controlled by the chance-node cutoff, not by shallow search; the
  // midgame goes +1 and the endgame +2.
  const empties = EMPTY_ROW[board[0]] + EMPTY_ROW[board[1]] + EMPTY_ROW[board[2]] + EMPTY_ROW[board[3]];
  if (empties >= 10) d = Math.max(2, d - 1);
  else if (empties >= 8) d = Math.max(3, d);
  else if (empties >= 5) d = Math.min(7, d + 1);
  else d = Math.min(7, d + 2);
  return d;
}

export class Expectimax {
  private pool = new ScratchPool();
  private tt: TranspositionTable | null = null;
  private cfg!: AIConfig;
  private nodes = 0;
  private budgetStart = 0;
  private budgetMs = 0;
  private nodeLimit = Infinity;

  /** Check the budget once per ~4096 nodes (time) / every node (node cap). */
  private checkBudget(): void {
    if ((this.nodes & 0xfff) === 0 && performance.now() - this.budgetStart > this.budgetMs) {
      throw BUDGET_EXCEEDED;
    }
    if (this.nodes > this.nodeLimit) throw BUDGET_EXCEEDED;
  }

  /** Leaf value: heuristic + score term. */
  private leaf(board: Board, pathScore: number): number {
    return evaluate(board, this.cfg.weights) + this.cfg.weights.score * Math.log(1 + pathScore);
  }

  /** Player node (MAX). Value includes the score term along the path. */
  private searchPlayer(board: Board, depth: number, pathScore: number): number {
    this.nodes++;
    if (depth <= 0) return this.leaf(board, pathScore);
    this.checkBudget();
    const mask = legalMask(board);
    if (mask === 0) return this.leaf(board, pathScore);
    const mark = this.pool.mark();
    const scratch = this.pool.get();
    let best = -Infinity;
    for (let d = 0; d < 4; d++) {
      if ((mask & (1 << d)) === 0) continue;
      const gain = applyMove(board, d, scratch);
      const v = this.searchChance(scratch, depth - 1, pathScore + gain);
      if (v > best) best = v;
    }
    this.pool.releaseTo(mark);
    return best;
  }

  /** Chance node (afterstate). Expected value over (cell, tile) outcomes. */
  private searchChance(after: Board, depth: number, pathScore: number): number {
    this.nodes++;
    if (depth <= 0) return this.leaf(after, pathScore);
    this.checkBudget();
    const k = emptyCells(after, EMPTY_CELLS);
    if (k === 0) return this.leaf(after, pathScore);
    // Copy the empty-cell list: recursive calls reuse the shared EMPTY_CELLS.
    const cutoff = this.cfg.chanceCutoff;
    const keep = cutoff > 0 && k > cutoff ? cutoff : k;
    let empties: number[];
    if (keep < k) {
      // Uniformly sample the empty cells instead of taking the first K in
      // row-major order (which would systematically ignore the lower half
      // of the board).
      empties = new Array<number>(keep);
      const step = k / keep;
      for (let j = 0; j < keep; j++) empties[j] = EMPTY_CELLS[Math.min(k - 1, Math.floor(j * step))];
    } else {
      empties = EMPTY_CELLS.slice(0, keep);
    }
    const inv2 = 0.9 / keep;
    const inv4 = 0.1 / keep;
    const mark = this.pool.mark();
    const child2 = this.pool.get();
    const child4 = this.pool.get();
    let sum = 0;
    for (let i = 0; i < keep; i++) {
      const idx = empties[i];
      const r = idx >> 2;
      const c = idx & 3;
      // place a 2 (P = 0.9 / keep, renormalized when cutoff is active)
      child2.set(after);
      child2[r] = (child2[r] & ~(15 << (c * 4))) | (1 << (c * 4));
      sum += inv2 * this.searchPlayer(child2, depth - 1, pathScore);
      // place a 4 (P = 0.1 / keep)
      child4.set(after);
      child4[r] = (child4[r] & ~(15 << (c * 4))) | (2 << (c * 4));
      sum += inv4 * this.searchPlayer(child4, depth - 1, pathScore);
    }
    this.pool.releaseTo(mark);
    return sum;
  }

  /**
   * Choose the best move for the current board.
   */
  chooseMove(
    board: Board,
    cfg: AIConfig,
    currentScore: number,
  ): { move: number; evals: MoveEval[]; stats: SearchStats } {
    this.cfg = cfg;
    // The TT stores exact values only for heuristic-only search; with a nonzero
    // score weight the value depends on the path score, so the TT is disabled.
    const ttUsable = cfg.useTT && cfg.weights.score === 0;
    this.tt = ttUsable ? cfg.tt ?? new TranspositionTable() : null;
    this.budgetStart = performance.now();
    this.budgetMs = cfg.budgetMs;
    this.nodeLimit = cfg.nodeBudget > 0 ? cfg.nodeBudget : Infinity;
    const w = cfg.weights;
    const start = performance.now();
    const ttHits0 = this.tt?.hits ?? 0;
    const ttMisses0 = this.tt?.misses ?? 0;

    const mask = legalMask(board);
    const results: MoveEval[] = [];
    const scratch = new Uint16Array(4);
    for (let d = 0; d < 4; d++) {
      if ((mask & (1 << d)) === 0) {
        results.push({ move: d, value: -Infinity, gain: 0 });
        continue;
      }
      const gain = applyMove(board, d, scratch);
      results.push({ move: d, value: 0, gain });
    }
    const legalMoves = results.filter((r) => r.value !== -Infinity);

    let completedDepth = 0;
    let totalNodes = 0;
    const maxDepth = cfg.dynamicDepth === false ? cfg.maxDepth : dynamicMaxDepth(cfg, board);
    for (let d = 1; d <= maxDepth; d++) {
      this.nodes = 0;
      const snapshot = legalMoves.map((r) => r.value);
      try {
        for (const r of legalMoves) {
          applyMove(board, r.move, scratch);
          r.value = this.searchChance(scratch, d, currentScore + r.gain);
        }
      } catch (e) {
        if (e === BUDGET_EXCEEDED) {
          // The depth was interrupted mid-way: restore the previous complete
          // depth's values rather than mixing depths.
          legalMoves.forEach((r, i) => (r.value = snapshot[i]));
          break;
        }
        throw e;
      }
      completedDepth = d;
      totalNodes += this.nodes;
      if (performance.now() - start > cfg.budgetMs) break;
      // Move ordering for deeper iterations: best first (also warms the TT).
      legalMoves.sort((a, b) => b.value - a.value);
    }

    let best = legalMoves[0];
    for (const r of legalMoves) if (r.value > best.value) best = r;

    return {
      move: best.move,
      evals: results,
      stats: {
        nodes: totalNodes,
        ttHits: (this.tt?.hits ?? 0) - ttHits0,
        ttMisses: (this.tt?.misses ?? 0) - ttMisses0,
        timeMs: performance.now() - start,
        depth: completedDepth,
      },
    };
  }
}

/** One-shot wrapper with its own config. */
export function chooseMove(
  board: Board,
  cfg: AIConfig,
  currentScore = 0,
): { move: number; evals: MoveEval[]; stats: SearchStats } {
  return new Expectimax().chooseMove(board, cfg, currentScore);
}

export const DIR_NAMES = ["UP", "DOWN", "LEFT", "RIGHT"] as const;
