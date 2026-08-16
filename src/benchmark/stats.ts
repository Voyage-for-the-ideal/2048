/** Benchmark statistics helpers. */

export interface GameOutcome {
  score: number;
  maxTileLog: number;
  moves: number;
}

export interface Summary {
  games: number;
  meanScore: number;
  medianScore: number;
  p90Score: number;
  p99Score: number;
  bestScore: number;
  meanMoves: number;
  meanMaxTile: number;
  rates: Record<number, number>; // tileLog -> fraction of games reaching it
  gamesPerSec: number;
  movesPerSec: number;
  nodesPerSec: number;
  avgTimeMs: number;
  avgNodes: number;
  totalNodes: number;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

export function summarize(
  outcomes: GameOutcome[],
  timing: { elapsedMs: number; totalNodes: number },
): Summary {
  const scores = outcomes.map((o) => o.score).sort((a, b) => a - b);
  const games = outcomes.length;
  const meanScore = scores.reduce((a, b) => a + b, 0) / games;
  const meanMoves = outcomes.reduce((a, o) => a + o.moves, 0) / games;
  const meanMaxTile = outcomes.reduce((a, o) => a + Math.pow(2, o.maxTileLog), 0) / games;
  const totalMoves = outcomes.reduce((a, o) => a + o.moves, 0);
  const elapsedSec = timing.elapsedMs / 1000;

  // Tile reach rates for the canonical ladder 2^11..2^16 (2048..65536).
  const rates: Record<number, number> = {};
  for (const tileLog of [11, 12, 13, 14, 15, 16]) {
    rates[tileLog] = outcomes.filter((o) => o.maxTileLog >= tileLog).length / games;
  }

  return {
    games,
    meanScore,
    medianScore: percentile(scores, 0.5),
    p90Score: percentile(scores, 0.9),
    p99Score: percentile(scores, 0.99),
    bestScore: scores[scores.length - 1] ?? 0,
    meanMoves,
    meanMaxTile,
    rates,
    gamesPerSec: elapsedSec > 0 ? games / elapsedSec : 0,
    movesPerSec: elapsedSec > 0 ? totalMoves / elapsedSec : 0,
    nodesPerSec: elapsedSec > 0 ? timing.totalNodes / elapsedSec : 0,
    avgTimeMs: timing.elapsedMs / totalMoves,
    avgNodes: timing.totalNodes / totalMoves,
    totalNodes: timing.totalNodes,
  };
}

/** One-line text table for terminal output. */
export function summaryTable(s: Summary, title: string): string {
  const lines: string[] = [];
  lines.push(`== ${title} ==`);
  lines.push(`games=${s.games}  mean=${s.meanScore.toFixed(0)}  median=${s.medianScore.toFixed(0)}  p90=${s.p90Score.toFixed(0)}  p99=${s.p99Score.toFixed(0)}  best=${s.bestScore.toFixed(0)}`);
  lines.push(`meanMoves=${s.meanMoves.toFixed(0)}  meanMaxTile=${s.meanMaxTile.toFixed(0)}`);
  lines.push(
    `2048=${(s.rates[11] * 100).toFixed(1)}%  4096=${(s.rates[12] * 100).toFixed(1)}%  ` +
      `8192=${(s.rates[13] * 100).toFixed(1)}%  16384=${(s.rates[14] * 100).toFixed(1)}%  ` +
      `32768=${(s.rates[15] * 100).toFixed(1)}%  65536=${(s.rates[16] * 100).toFixed(1)}%`,
  );
  lines.push(
    `speed: ${s.gamesPerSec.toFixed(2)} games/s, ${s.movesPerSec.toFixed(0)} moves/s, ` +
      `${s.nodesPerSec.toFixed(0)} nodes/s (avg ${s.avgNodes.toFixed(0)} nodes/move, ${s.avgTimeMs.toFixed(2)} ms/move)`,
  );
  return lines.join("\n");
}
