/**
 * Main thread: rendering, controls, animation, statistics.
 * The AI search itself runs in a Web Worker.
 *
 * Board rendering uses a tile layer: 16 absolutely-positioned `.tile`
 * elements slide between grid coordinates via CSS transform transitions.
 * Each move is animated in two phases — tiles are first placed at their
 * OLD positions (transitions off), then moved to their NEW positions
 * (transitions on); merged tiles pop, the swallowed partner fades out,
 * and the random tile spawns with a birth animation once the slide ends.
 */
import { cellValue, maxTileLog } from "./game/board";
import { applyMove, addRandomTile, newGameBoard, legalMask } from "./game/engine";
import { mulberry32 } from "./game/rng";
import { t, dirName, initI18n } from "./i18n";
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

// --- theme handling ---
const THEME_STORAGE = "theme";
/** CSS variable names (minus `--`) managed by themes, in panel order. */
const THEME_KEYS = [
  "bg", "board-bg", "cell-empty", "t2", "t4", "t8", "t16", "t32", "t64",
  "t128", "t256", "t512", "t1024", "t2048", "tbig", "t2-text", "t8-text", "accent",
];
const THEME_DEFAULTS: Record<string, string> = {
  "bg": "#faf8ef", "board-bg": "#bbada0", "cell-empty": "#cdc1b4",
  "t2": "#eee4da", "t4": "#ede0c8", "t8": "#f2b179", "t16": "#f59563", "t32": "#f67c5f",
  "t64": "#f65e3b", "t128": "#edcf72", "t256": "#edcc61", "t512": "#edc850",
  "t1024": "#edc53f", "t2048": "#edc22e", "tbig": "#3c3a32",
  "t2-text": "#776e65", "t8-text": "#f9f6f2", "accent": "#f2b179",
};
/** [cssVarName, i18nKey] pairs for the custom-color panel. */
const CUSTOM_ITEMS: Array<[string, string]> = [
  ["bg", "colorBg"], ["board-bg", "colorBoard"], ["cell-empty", "colorEmpty"],
  ["t2", "tile2"], ["t4", "tile4"], ["t8", "tile8"], ["t16", "tile16"], ["t32", "tile32"],
  ["t64", "tile64"], ["t128", "tile128"], ["t256", "tile256"], ["t512", "tile512"],
  ["t1024", "tile1024"], ["t2048", "tile2048"], ["tbig", "tileBig"],
  ["t2-text", "colorT2Text"], ["t8-text", "colorT8Text"], ["accent", "colorAccent"],
];

interface ThemePref { name: string; custom?: Record<string, string>; }

function loadThemePref(): ThemePref {
  try {
    const raw = localStorage.getItem(THEME_STORAGE);
    if (raw) {
      const p = JSON.parse(raw) as ThemePref;
      if (p && typeof p.name === "string") return p;
    }
  } catch {
    // localStorage may be unavailable; ignore.
  }
  return { name: "classic" };
}

function saveThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(THEME_STORAGE, JSON.stringify(pref));
  } catch {
    // localStorage may be unavailable (e.g. private mode); ignore.
  }
}

/** Apply a theme: preset via data-theme, custom via inline CSS variables. */
function applyTheme(pref: ThemePref): void {
  const root = document.documentElement;
  root.dataset.theme = pref.name === "custom" ? "classic" : pref.name;
  for (const key of THEME_KEYS) root.style.removeProperty(`--${key}`);
  if (pref.name === "custom" && pref.custom) {
    for (const key of THEME_KEYS) {
      const v = pref.custom[key];
      if (v) root.style.setProperty(`--${key}`, v);
    }
  }
}

function buildCustomPanel(): void {
  const grid = $("color-grid");
  for (const [key, labelKey] of CUSTOM_ITEMS) {
    const label = document.createElement("label");
    const text = document.createElement("span");
    text.dataset.i18n = labelKey;
    const input = document.createElement("input");
    input.type = "color";
    input.dataset.key = key;
    input.addEventListener("input", () => {
      const pref = loadThemePref();
      if (pref.name !== "custom") {
        pref.name = "custom";
        ($("theme") as HTMLSelectElement).value = "custom";
        ($("custom-colors") as HTMLDetailsElement).open = true;
      }
      pref.custom = { ...(pref.custom ?? THEME_DEFAULTS), [key]: input.value };
      saveThemePref(pref);
      applyTheme(pref);
    });
    label.append(text, input);
    grid.appendChild(label);
  }
}

function syncCustomPanel(pref: ThemePref): void {
  const base = pref.custom ?? THEME_DEFAULTS;
  for (const input of document.querySelectorAll<HTMLInputElement>("#color-grid input")) {
    const key = input.dataset.key!;
    input.value = base[key] ?? THEME_DEFAULTS[key];
  }
}

// --- board rendering (tile layer) ---
// Background grid cells first (they also give the grid its tracks); the
// absolutely-positioned tile layer floats above them.
for (let i = 0; i < 16; i++) {
  const c = document.createElement("div");
  c.className = "cell";
  elBoard.appendChild(c);
}
const tileLayer = document.createElement("div");
tileLayer.className = "tile-layer";
elBoard.appendChild(tileLayer);
const tiles: HTMLElement[] = [];
for (let i = 0; i < 16; i++) {
  const t = document.createElement("div");
  t.className = "tile no-anim inactive";
  const s = document.createElement("span");
  t.appendChild(s);
  tileLayer.appendChild(t);
  tiles.push(t);
}

function cellLogAt(b: Uint16Array, idx: number): number {
  return (b[idx >> 2] >>> ((idx & 3) * 4)) & 15;
}

function placeTile(t: HTMLElement, idx: number): void {
  t.style.setProperty("--col", String(idx & 3));
  t.style.setProperty("--row", String(idx >> 2));
}

function tileClasses(v: number): string {
  return v === 0 ? "" : ` t-${v >= 4096 ? "big" : v}`;
}

/** Static full render of the tile layer (no sliding). */
function renderBoard(b: Uint16Array, bornIdx = -1): void {
  let k = 0;
  for (let i = 0; i < 16; i++) {
    const v = cellValue(cellLogAt(b, i));
    if (v === 0) continue;
    const t = tiles[k++];
    t.style.opacity = "";
    placeTile(t, i);
    t.querySelector("span")!.textContent = String(v);
    // no-anim: positions snap instantly; the birth animation lives on the
    // inner span (scale), not on this tile's transform.
    t.className = "tile no-anim" + tileClasses(v) + (i === bornIdx ? " born" : "");
  }
  for (; k < 16; k++) {
    tiles[k].style.opacity = "";
    tiles[k].querySelector("span")!.textContent = "";
    tiles[k].className = "tile no-anim inactive";
  }
}

/**
 * Which old cell does each new cell slide from, under the engine's move
 * semantics (tiles in each row/column slide toward the movement direction)?
 * A merged tile keeps the source closest to the movement direction; the
 * swallowed partner disappears (fade-out is handled by the caller).
 * dir: 0=up, 1=down, 2=left, 3=right.
 */
function computeSlideMap(oldB: Uint16Array, newB: Uint16Array, dir: number): { map: Map<number, number>; merged: Set<number> } {
  const map = new Map<number, number>();
  const merged = new Set<number>();
  for (let line = 0; line < 4; line++) {
    const oldCells: Array<[number, number]> = [];
    const newCells: Array<[number, number]> = [];
    for (let step = 0; step < 4; step++) {
      let idx: number;
      if (dir === 0) idx = step * 4 + line;            // up: rows top-down
      else if (dir === 1) idx = (3 - step) * 4 + line; // down: rows bottom-up
      else if (dir === 2) idx = line * 4 + step;       // left: cols left-right
      else idx = line * 4 + (3 - step);                // right: cols right-left
      const ov = cellLogAt(oldB, idx);
      if (ov > 0) oldCells.push([idx, ov]);
      const nv = cellLogAt(newB, idx);
      if (nv > 0) newCells.push([idx, nv]);
    }
    let i = 0;
    for (const [nIdx, nVal] of newCells) {
      if (i < oldCells.length) {
        const [oIdx, oVal] = oldCells[i];
        if (oVal === nVal) { map.set(nIdx, oIdx); i++; continue; }
        if (oVal === nVal - 1) { map.set(nIdx, oIdx); merged.add(nIdx); i += 2; continue; }
      }
      map.set(nIdx, nIdx); // unreachable under engine semantics; stay in place
    }
  }
  return { map, merged };
}

let animTimer: number | null = null;

/**
 * Animate the board sliding from `oldB` to `afterB` (the caller must have
 * assigned `afterB` to `board` already), then run `settle` once the slide
 * finishes. `animMs` is the slide duration; shorten at high play speeds.
 */
function slideAndSettle(oldB: Uint16Array, afterB: Uint16Array, dir: number, animMs: number, settle: () => void): void {
  if (animTimer !== null) {
    clearTimeout(animTimer);
    animTimer = null;
  }
  // Match the CSS transform transition duration to this slide, so the
  // settle (and its snap render) happens exactly when the slide ends.
  tileLayer.style.setProperty("--anim-ms", `${animMs}ms`);
  const { map, merged } = computeSlideMap(oldB, afterB, dir);

  // Phase 1: all tiles at their OLD positions, transitions disabled.
  let k = 0;
  const byOld = new Map<number, HTMLElement>();
  for (let i = 0; i < 16; i++) {
    const v = cellValue(cellLogAt(oldB, i));
    if (v === 0) continue;
    const t = tiles[k++];
    t.style.opacity = "";
    placeTile(t, i);
    t.querySelector("span")!.textContent = String(v);
    t.className = "tile no-anim" + tileClasses(v);
    byOld.set(i, t);
  }
  for (; k < 16; k++) {
    tiles[k].style.opacity = "";
    tiles[k].querySelector("span")!.textContent = "";
    tiles[k].className = "tile no-anim inactive";
  }
  void tileLayer.offsetWidth; // force reflow so the new positions animate

  // Phase 2: slide to the NEW positions (transitions now active).
  const used = new Set<HTMLElement>();
  for (let i = 0; i < 16; i++) {
    const v = cellValue(cellLogAt(afterB, i));
    if (v === 0) continue;
    const src = map.get(i);
    const el = src !== undefined ? byOld.get(src) : undefined;
    if (el === undefined) continue; // random tile spawns in `settle`, not here
    el.classList.remove("no-anim");
    placeTile(el, i);
    el.querySelector("span")!.textContent = String(v);
    el.className = "tile" + tileClasses(v) + (merged.has(i) ? " pop" : "");
    used.add(el);
  }
  // Tiles swallowed by a merge fade out.
  for (const [, t] of byOld) {
    if (!used.has(t)) {
      t.classList.add("fade");
      t.style.opacity = "0";
    }
  }

  animTimer = window.setTimeout(() => {
    animTimer = null;
    settle();
  }, animMs);
}

/** Slide duration for a given play speed (moves/s). */
function animMsFor(speed: number): number {
  return Math.max(30, Math.min(120, Math.round((1000 / Math.max(1, speed)) * 0.8)));
}

// --- HUD ---
function updateHud(): void {
  elScore.textContent = String(score);
  elMaxTile.textContent = String(Math.pow(2, maxTileLog(board)));
  elBest.textContent = String(best);
  const over = legalMask(board) === 0;
  elOverlay.classList.toggle("hidden", !over);
  if (over) {
    if (score > best) {
      best = score;
      try {
        localStorage.setItem("best", String(best));
      } catch {
        // ignore
      }
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
  if (replaying || pendingMove !== null) return; // one decision in flight
  const config = readConfig();
  const rows = [board[0], board[1], board[2], board[3]];
  const req: WorkerRequest = { type: "choose", requestId: ++requestId, board: rows, score, config };
  pendingMove = req.requestId;
  worker.postMessage(req);
}

function applyDecision(move: number): void {
  if (move < 0) return;
  const old = board.slice();
  const after = new Uint16Array(4);
  const gain = applyMove(board, move, after);
  const unchanged = gain === 0 && after.every((v, i) => v === old[i]);
  board.set(after);
  if (unchanged) return; // stale decision against a changed board: nothing moved
  score += gain;
  moves++;
  moveSeq.push(move);
  // The random tile spawns SYNCHRONOUSLY: game state must be complete before
  // any animation starts, because a new move may cancel this slide's settle
  // callback. A discarded settle must never lose (or duplicate) a tile.
  const born = addRandomTile(board, gameRng);
  if (turbo) {
    if (animTimer !== null) {
      // Drop a pending settle from a previous animated move; it only renders,
      // the state it was scheduled to settle is already fully applied.
      clearTimeout(animTimer);
      animTimer = null;
    }
    renderBoard(board);
    updateHud();
    return;
  }
  const speed = parseInt(($("speed") as HTMLInputElement).value, 10);
  const animMs = animMsFor(speed);
  slideAndSettle(old, after, move, animMs, () => {
    renderBoard(board, born);
    updateHud();
    // Chain the next auto-play request only after this move settled, so the
    // random tile is rendered before the next decision is made.
    if (autoPlaying && !turbo) {
      const stepMs = 1000 / Math.max(1, speed);
      setTimeout(tick, Math.max(10, Math.round(stepMs - animMs)));
    }
  });
}

function stepOnce(): void {
  if (legalMask(board) === 0 || animTimer !== null) return;
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
  if (legalMask(board) === 0) {
    stopAuto();
    return;
  }
  requestMove();
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
  if (!autoPlaying || !turbo || pendingMove !== null) return;
  if (legalMask(board) === 0) {
    stopAuto();
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
    // Drop stale decisions (e.g. one requested before New Game): the board
    // they were computed for is gone, applying them would corrupt the game.
    if (msg.requestId !== pendingMove) return;
    pendingMove = null;
    const move = msg.move as number;
    const evals = msg.evals as Array<{ move: number; value: number; gain: number }>;
    const stats = msg.stats as { nodes: number; ttHits: number; ttMisses: number; timeMs: number; depth: number };
    elAiMove.textContent = dirName(move);
    elAiDepth.textContent = String(stats.depth);
    elAiNodes.textContent = String(stats.nodes);
    elAiTime.textContent = stats.timeMs.toFixed(1);
    const hits = stats.ttHits + stats.ttMisses;
    elAiTT.textContent = hits > 0 ? `${((stats.ttHits / hits) * 100).toFixed(1)}%` : "-";
    renderBars(evals, move);
    applyDecision(move);
    if (turbo && autoPlaying) turboLoop();
  } else if (msg.type === "benchmarkProgress") {
    elBenchProgress.textContent = `${t("running")}: ${msg.done}/${msg.total} ${t("games")} (${t("summaryBest")} ${msg.bestScore})`;
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
    elBenchProgress.textContent = msg.cancelled ? t("cancelled") : t("done");
    elBenchOutput.textContent =
      summaryTable(summary, t("benchmarkResult"), summaryLabels()) +
      (msg.bestGame
        ? `\n${t("bestGame")}: seed=${msg.bestGame.seed} score=${msg.bestGame.score} maxTile=${msg.bestGame.maxTile} moves=${msg.bestGame.moves}`
        : "");
    (window as unknown as Record<string, unknown>).__benchSummary = summary;
    (window as unknown as Record<string, unknown>).__benchBest = bestGame;
  }
};

function summaryLabels(): Record<string, string> {
  return {
    games: t("summaryGames"),
    mean: t("summaryMean"),
    median: t("summaryMedian"),
    best: t("summaryBest"),
    meanMoves: t("summaryMeanMoves"),
    meanMaxTile: t("summaryMeanMaxTile"),
    speed: t("summarySpeed"),
    nodesPerMove: t("summaryNodesPerMove"),
    msPerMove: t("summaryMsPerMove"),
  };
}

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
    bars[d].val.textContent = v === -Infinity ? t("illegal") : v.toFixed(1);
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
  elBenchProgress.textContent = t("cancelling");
};
($("btn-replay") as HTMLButtonElement).onclick = () => {
  if (bestGame) replayGame(bestGame);
};
($("btn-export") as HTMLButtonElement).onclick = () => exportResults();

function newGame(): void {
  autoPlaying = false;
  turbo = false;
  replaying = false;
  pendingMove = null; // any in-flight decision is now stale
  if (animTimer !== null) {
    clearTimeout(animTimer);
    animTimer = null;
  }
  gameSeed = Date.now() >>> 0;
  gameRng = mulberry32(gameSeed);
  board = newGameBoard(gameRng);
  score = 0;
  moves = 0;
  moveSeq = [];
  renderBoard(board);
  updateHud();
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
  if (animTimer !== null) {
    clearTimeout(animTimer);
    animTimer = null;
  }
  replaying = true;
  const rng = mulberry32(game.seed);
  board = newGameBoard(rng);
  score = 0;
  moves = 0;
  renderBoard(board);
  updateHud();
  let i = 0;
  const speed = parseInt(($("speed") as HTMLInputElement).value, 10);
  const stepMs = 1000 / Math.max(1, speed);
  const animMs = animMsFor(speed);
  const next = (): void => {
    if (i >= game.moveSeq.length) {
      replaying = false;
      renderBoard(board);
      updateHud();
      return;
    }
    const d = game.moveSeq[i++];
    const old = board.slice();
    const after = new Uint16Array(4);
    const gain = applyMove(board, d, after);
    board.set(after);
    score += gain;
    const born = addRandomTile(board, rng);
    slideAndSettle(old, after, d, animMs, () => {
      renderBoard(board, born);
      updateHud();
      setTimeout(next, Math.max(10, Math.round(stepMs - animMs)));
    });
  };
  next();
}

// --- keyboard (manual play) ---
document.addEventListener("keydown", (e) => {
  if (replaying || autoPlaying || animTimer !== null) return;
  const map: Record<string, number> = {
    ArrowUp: 0, ArrowDown: 1, ArrowLeft: 2, ArrowRight: 3,
  };
  const d = map[e.key];
  if (d === undefined) return;
  e.preventDefault();
  const old = board.slice();
  const after = new Uint16Array(4);
  const gain = applyMove(board, d, after);
  if (gain === 0 && after.every((v, i) => v === board[i])) return;
  board.set(after);
  score += gain;
  moves++;
  moveSeq.push(d);
  const born = addRandomTile(board, gameRng);
  slideAndSettle(old, after, d, 120, () => {
    renderBoard(board, born);
    updateHud();
  });
});

// --- speed label (dynamic: value + localized unit) ---
function updateSpeedLabel(): void {
  const speed = parseInt(($("speed") as HTMLInputElement).value, 10);
  ($("speed-label") as HTMLElement).textContent = `${speed} ${t("movesPerSec")}`;
}

($("speed") as HTMLInputElement).addEventListener("input", updateSpeedLabel);

// --- theme controls ---
const themeSelect = $("theme") as HTMLSelectElement;
buildCustomPanel();
const themePref = loadThemePref();
themeSelect.value = themePref.name;
applyTheme(themePref);
syncCustomPanel(themePref);
themeSelect.addEventListener("change", () => {
  const pref: ThemePref = { name: themeSelect.value };
  if (pref.name === "custom") pref.custom = loadThemePref().custom;
  saveThemePref(pref);
  applyTheme(pref);
  syncCustomPanel(pref);
  ($("custom-colors") as HTMLDetailsElement).open = pref.name === "custom";
});

// --- init ---
initI18n();
document.getElementById("lang")!.addEventListener("change", updateSpeedLabel);
updateSpeedLabel();
renderBoard(board);
updateHud();
