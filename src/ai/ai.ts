/**
 * Unified AI interface. The AI is decoupled from the DOM: it consumes a
 * Board and returns a move, so it runs identically in the page, a Web
 * Worker, or a headless benchmark.
 */
import type { Board } from "../game/board";
import { Expectimax, type AIConfig, type MoveEval, type SearchStats } from "./expectimax";
import { DEFAULT_WEIGHTS, parseWeights, type Weights } from "./weights";
import { TranspositionTable } from "./transposition";

export interface AIOptions {
  maxDepth: number;
  budgetMs: number;
  nodeBudget: number;
  chanceCutoff: number;
  useTT: boolean;
  weights?: Weights | string; // Weights object or JSON string
  /** Keep the transposition table across moves within a game. */
  persistentTT: boolean;
}

export interface AIDecision {
  move: number;
  evals: MoveEval[];
  stats: SearchStats;
}

export class AI {
  readonly options: AIOptions;
  private engine = new Expectimax();
  private tt: TranspositionTable | null = null;
  private ttAge = 0;

  constructor(options: Partial<AIOptions> = {}) {
    const weights: Weights =
      typeof options.weights === "string"
        ? parseWeights(options.weights)
        : options.weights ?? DEFAULT_WEIGHTS;
    this.options = {
      maxDepth: options.maxDepth ?? 4,
      budgetMs: options.budgetMs ?? 40,
      nodeBudget: options.nodeBudget ?? 200_000,
      chanceCutoff: options.chanceCutoff ?? 8,
      useTT: options.useTT ?? true,
      weights,
      persistentTT: options.persistentTT ?? true,
    };
    if (this.options.persistentTT) {
      this.tt = new TranspositionTable();
      this.ttAge = 0;
    }
  }

  chooseMove(board: Board, currentScore: number): AIDecision {
    // Refresh the shared TT every so often so it doesn't grow unboundedly.
    if (this.tt) {
      this.ttAge++;
      if (this.ttAge > 128 && this.tt.size > 1_000_000) {
        this.tt = new TranspositionTable();
        this.ttAge = 0;
      }
    }
    const cfg: AIConfig = {
      maxDepth: this.options.maxDepth,
      budgetMs: this.options.budgetMs,
      nodeBudget: this.options.nodeBudget,
      chanceCutoff: this.options.chanceCutoff,
      useTT: this.options.useTT,
      weights: this.options.weights as Weights,
      tt: this.options.persistentTT ? this.tt! : undefined,
    };
    return this.engine.chooseMove(board, cfg, currentScore);
  }
}

/** Re-exported for convenience. */
export { DEFAULT_WEIGHTS, type Weights };
