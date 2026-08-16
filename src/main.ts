/**
 * Main thread: rendering, controls, animation, statistics.
 * The AI search itself runs in a Web Worker.
 */
import { newBoard, setCell, cellValue, boardToString, maxTileLog } from "./game/board";
import { DIR_NAMES } from "./ai/expectimax";
import { applyMove, addRandomTile, newGameBoard, legalMask } from "./game/engine";
import { mulberry32 } from "./game/rng";
import type { AIOptions } from "./ai/ai";
import type { Summary } from "./benchmark/stats";
import { summaryTable } from "./benchmark/stats";
import type { WorkerRequest } from "./worker";

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });

// --- DOM refs ---
const $ = (id: string) => document.getElementById(id)!;
const elScore = $("score"), elBest = $("best"), elMaxTile = $("max-tile");
const elBoard = $("board"), elOverlay = $("game-over");
const elAiMove = $("ai-move"), elAiDepth = $("ai-depth"), elAiNodes = $("ai-nodes"),
  elAiTime = $("ai-time"), elAiTT = $("ai-tt");
const bars = [0, 1, 2, 3].map((i) => ({
  el: $(`bar-${i}`),
  fill: document.createElement("div"),
  val: $(`bar-${i}`).querySelector("b")!,
}));
for (const b of bars) {
  b.el.querySelector("span")!.insertAdjacentElement("afterend", (() => {
    const track = document.createElement("div");
    track.className = "track";
    track.appendChild(b.fill);
    b.fill.className = "fill";
    return track;
  })());
}
const elBenchProgress = $("bench-progress"), elBenchOutput = $("bench-output");

// --- game state ---
let board: Uint16Array = newGameBoard(mulberry32(Date.now() >>> 0));
let score = 0;
let best = parseInt(localStorage.getItem("best") ?? "0", 10) || 0;
let moves = 0;
let autoPlaying = false;
let turbo = false;
let requestId = 0;
let pendingMove: number | null = null;
let gameSeed = Date.now() >>> 0;
let gameRng = mulberry32(gameSeed);
let moveSeq: number[] = [];
let bestGame: { seed: number; score: number; maxTile: number; moves: number; moveSeq: number[] } | null = null;
let replaying = false;
let benchRunning = false;

const cells: HTMLElement[] = [];
for (let i = 0; i < 16; i++) {
  const c = document.createElement("div");
  c.className = "cell";
  elBoard.appendChild(c);
  cells.push(c);
}

function render(animate = false): void {
  for (let i = 0; i < 16; i++) {
    const v = cellValue((board[i >> 2] >>> ((i & 3) * 4)) & 15);
    const c = cells[i];
    c.textContent = v > 0 ? String(v) : "";
    c.className = "cell" + (v === 0 ? "" : ` t-${v >= 4096 ? "big" : v}`);
    if (animate && v > 0) c.style.transform = "scale(1.06)";
  }
  if (animate) {
    setTimeout(() => cells.forEach((c) => (c.style.transform = "")), 90);
  }
  elScore.textContent = String(score);
  elMaxTile.textContent = String(Math.pow(2, maxTileLog(board)));
  elBest.textContent = String(best);
  const over = legalMask(board) === 0;
  elOverlay.classList.toggle("hidden", !over);
  if (over) {
    if (score > best) {
      best = score;
      localStorage.setItem("best", String(best));
      elBest.textContent = String(best);
    }
    if (autoPlaying) stopAuto();
  }
}

function readConfig(): Partial<AIOptions> {
  return {
    maxDepth: parseInt(($("depth") as HTMLSelectElement).value, 10),
    budgetMs: parseInt(($("budget") as HTMLSelectElement).value, 10),
    chanceCutoff: parseInt(($("cutoff") as HTMLSelectElement).value, 10),
    useTT: true,
    objective: ($("objective") as HTMLSelectElement).value as AIOptions["objective"],
    persistentTT: true,
  };
}

function aiKey(): string {
  return JSON.stringify(readConfig());
}

function requestMove(): void {
  if (replaying) return;
  const config = readConfig();
  const rows = [board[0], board[1], board[2], board[3]];
  const req: WorkerRequest = { type: "choose", requestId: ++requestId, board: rows, score, config };
  worker.postMessage(req);
}

function applyDecision(move: number): void {
  if (move < 0) return;
  const after = new Uint16Array(4);
  const gain = applyMove(board, move, after);
  board.set(after);
  score += gain;
  moves++;
  moveSeq.push(move);
  addRandomTile(board, gameRng);
  render(!turbo);
}

function stepOnce(): void {
  if (legalMask(board) === 0) return;
  requestMove();
}

function startAuto(): void {
  if (replaying) return;
  autoPlaying = true;
  turbo = false;
  ($("btn-auto") as HTMLButtonElement).disabled = true;
  ($("btn-pause") as HTMLButtonElement).disabled = false;
  tick();
}

function tick(): void {
  if (!autoPlaying) return;
  const speed = parseInt(($("speed") as HTMLInputElement).value, 10);
  if (legalMask(board) === 0) {
    stopAuto();
    return;
  }
  requestMove();
  setTimeout(tick, 1000 / Math.max(1, speed));
}

function stopAuto(): void {
  autoPlaying = false;
  ($("btn-auto") as HTMLButtonElement).disabled = false;
  ($("btn-pause") as HTMLButtonElement).disabled = true;
}

function startTurbo(): void {
  if (replaying) return;
  turbo = true;
  autoPlaying = true;
  ($("btn-auto") as HTMLButtonElement).disabled = true;
  ($("btn-pause") as HTMLButtonElement).disabled = false;
  turboLoop();
}

function turboLoop(): void {
  if (!autoPlaying || !turbo) return;
  if (legalMask(board) === 0) {
    stopAuto();
    render();
    return;
  }
  const config = readConfig();
  const rows = [board[0], board[1], board[2], board[3]];
  const req: WorkerRequest = { type: "choose", requestId: ++requestId, board: rows, score, config };
  // Turbo: post and continue; decisions arrive via onmessage and we apply
  // them immediately without animation.
  pendingMove = req.requestId;
  worker.postMessage(req);
}

// --- worker responses ---
worker.onmessage = (e: MessageEvent) => {
  const msg = e.data;
  if (msg.type === "decision") {
    const move = msg.move as number;
    const evals = msg.evals as Array<{ move: number; value: number; gain: number }>;
    const stats = msg.stats as { nodes: number; ttHits: number; ttMisses: number; timeMs: number; depth: number };
    elAiMove.textContent = DIR_NAMES[move];
    elAiDepth.textContent = String(stats.depth);
    elAiNodes.textContent = String(stats.nodes);
    elAiTime.textContent = stats.timeMs.toFixed(1);
    const hits = stats.ttHits + stats.ttMisses;
    elAiTT.textContent = hits > 0 ? `${((stats.ttHits / hits) * 100).toFixed(1)}%` : "-";
    renderBars(evals, move);
    applyDecision(move);
    if (turbo && autoPlaying) turboLoop();
  } else if (msg.type === "benchmarkProgress") {
    elBenchProgress.textContent = `running: ${msg.done}/${msg.total} games (best ${msg.bestScore})`;
  } else if (msg.type === "benchmarkDone") {
    benchRunning = false;
    ($("btn-bench") as HTMLButtonElement).disabled = false;
    ($("btn-bench-cancel") as HTMLButtonElement).disabled = true;
    const summary = msg.summary as Summary;
    if (msg.bestGame) {
      bestGame = msg.bestGame;
      ($("btn-replay") as HTMLButtonElement).disabled = false;
    }
    ($("btn-export") as HTMLButtonElement).disabled = false;
    elBenchProgress.textContent = msg.cancelled ? "cancelled" : "done";
    elBenchOutput.textContent = summaryTable(summary, "benchmark result") + (msg.bestGame ? `\nbest game: seed=${msg.bestGame.seed} score=${msg.bestGame.score} maxTile=${msg.bestGame.maxTile} moves=${msg.bestGame.moves}` : "");
    (window as unknown as Record<string, unknown>).__benchSummary = summary;
    (window as unknown as Record<string, unknown>).__benchBest = bestGame;
  }
};

function renderBars(evals: Array<{ move: number; value: number }>, selected: number): void {
  const vals = [-Infinity, -Infinity, -Infinity, -Infinity];
  for (const e of evals) vals[e.move] = e.value;
  const finite = vals.filter((v) => v !== -Infinity);
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = Math.max(1e-6, max - min);
  for (let d = 0; d < 4; d++) {
    const v = vals[d];
    const pct = v === -Infinity ? 0 : ((v - min) / span) * 100;
    bars[d].fill.style.width = `${pct}%`;
    bars[d].val.textContent = v === -Infinity ? "illegal" : v.toFixed(1);
    bars[d].el.classList.toggle("selected", d === selected);
  }
}

// --- controls ---
($("btn-new-game") as HTMLButtonElement).onclick = () => newGame();
($("btn-new-game-2") as HTMLButtonElement).onclick = () => newGame();
($("btn-auto") as HTMLButtonElement).onclick = () => startAuto();
($("btn-pause") as HTMLButtonElement).onclick = () => {
  autoPlaying = false;
  stopAuto();
};
($("btn-step") as HTMLButtonElement).onclick = () => stepOnce();
($("btn-turbo") as HTMLButtonElement).onclick = () => {
  if (autoPlaying && turbo) {
    stopAuto();
    return;
  }
  startTurbo();
};
($("btn-bench") as HTMLButtonElement).onclick = () => runBenchmark();
($("btn-bench-cancel") as HTMLButtonElement).onclick = () => {
  worker.postMessage({ type: "cancel" } as WorkerRequest);
  elBenchProgress.textContent = "cancelling...";
};
($("btn-replay") as HTMLButtonElement).onclick = () => {
  if (bestGame) replayGame(bestGame);
};
($("btn-export") as HTMLButtonElement).onclick = () => exportResults();

function newGame(): void {
  autoPlaying = false;
  turbo = false;
  replaying = false;
  gameSeed = Date.now() >>> 0;
  gameRng = mulberry32(gameSeed);
  board = newGameBoard(gameRng);
  score = 0;
  moves = 0;
  moveSeq = [];
  render();
  ($("btn-auto") as HTMLButtonElement).disabled = false;
  ($("btn-pause") as HTMLButtonElement).disabled = true;
}

function runBenchmark(): void {
  if (benchRunning) return;
  benchRunning = true;
  ($("btn-bench") as HTMLButtonElement).disabled = true;
  ($("btn-bench-cancel") as HTMLButtonElement).disabled = false;
  const games = Math.max(1, parseInt(($("bench-games") as HTMLInputElement).value, 10) || 100);
  const seedStart = parseInt(($("bench-seed") as HTMLInputElement).value, 10) || 0;
  elBenchOutput.textContent = "";
  const req: WorkerRequest = { type: "benchmark", games, seedStart, config: readConfig() };
  worker.postMessage(req);
}

function exportResults(): void {
  const summary = (window as unknown as Record<string, unknown>).__benchSummary as Summary | undefined;
  const best = (window as unknown as Record<string, unknown>).__benchBest as typeof bestGame;
  const payload = JSON.stringify({ summary, bestGame: best, config: readConfig() }, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "benchmark-result.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

// --- replay ---
function replayGame(game: { seed: number; score: number; maxTile: number; moves: number; moveSeq: number[] }): void {
  if (autoPlaying) stopAuto();
  replaying = true;
  const rng = mulberry32(game.seed);
  board = newGameBoard(rng);
  score = 0;
  moves = 0;
  render();
  let i = 0;
  const speed = parseInt(($("speed") as HTMLInputElement).value, 10);
  const timer = setInterval(() => {
    if (i >= game.moveSeq.length) {
      clearInterval(timer);
      replaying = false;
      return;
    }
    const d = game.moveSeq[i++];
    const after = new Uint16Array(4);
    score += applyMove(board, d, after);
    board.set(after);
    addRandomTile(board, rng);
    render(true);
    elScore.textContent = String(score);
  }, 1000 / Math.max(1, speed));
}

// --- keyboard (manual play) ---
document.addEventListener("keydown", (e) => {
  if (replaying || autoPlaying) return;
  const map: Record<string, number> = {
    ArrowUp: 0, ArrowDown: 1, ArrowLeft: 2, ArrowRight: 3,
  };
  const d = map[e.key];
  if (d === undefined) return;
  e.preventDefault();
  const after = new Uint16Array(4);
  const gain = applyMove(board, d, after);
  if (gain === 0 && after.every((v, i) => v === board[i])) return;
  board.set(after);
  score += gain;
  moves++;
  moveSeq.push(d);
  addRandomTile(board, gameRng);
  render(true);
});

// --- init ---
render();
