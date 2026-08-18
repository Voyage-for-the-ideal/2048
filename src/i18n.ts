/**
 * Lightweight client-side i18n for the page UI.
 * Static labels live in index.html with data-i18n attributes; dynamic
 * strings go through t(). Language is persisted to localStorage.
 */

export type Lang = "en" | "zh";

const STORAGE_KEY = "lang";

const dict: Record<Lang, Record<string, string>> = {
  en: {
    title: "2048 AI — Expectimax Auto-Player",
    score: "SCORE",
    best: "BEST",
    maxTile: "MAX TILE",
    newGame: "New Game",
    autoPlay: "Auto Play",
    pause: "Pause",
    step: "Step",
    turbo: "Turbo",
    speed: "Speed",
    movesPerSec: "moves/s",
    depth: "Depth",
    budget: "Budget",
    ms: "ms",
    cutoff: "Cutoff",
    exact: "exact",
    cells: "cells",
    aiDebug: "AI Debug",
    move: "move",
    depthStat: "depth",
    nodes: "nodes",
    time: "time",
    ttHit: "TT hit",
    up: "UP",
    down: "DOWN",
    left: "LEFT",
    right: "RIGHT",
    illegal: "illegal",
    gameOver: "Game Over",
    budget20: "20 ms",
    budget40: "40 ms",
    budget100: "100 ms",
    budget200: "200 ms",
    cutoff8: "8 cells",
    cutoff6: "6 cells",
    cutoff4: "4 cells",
    benchmark: "Benchmark",
    games: "Games",
    seedStart: "Seed start",
    runBenchmark: "Run Benchmark",
    cancel: "Cancel",
    replayBest: "Replay Best",
    exportJson: "Export JSON",
    running: "running",
    cancelled: "cancelled",
    done: "done",
    cancelling: "cancelling...",
    bestGame: "best game",
    benchmarkResult: "benchmark result",
    summaryGames: "games",
    summaryMean: "mean",
    summaryMedian: "median",
    summaryP90: "p90",
    summaryP99: "p99",
    summaryBest: "best",
    summaryMeanMoves: "meanMoves",
    summaryMeanMaxTile: "meanMaxTile",
    summarySpeed: "speed",
    summaryNodesPerMove: "nodes/move",
    summaryMsPerMove: "ms/move",
    langLabel: "Language",
    themeClassic: "Classic",
    themeDark: "Dark",
    themeOcean: "Ocean",
    themeSunset: "Sunset",
    themeForest: "Forest",
    themeCustom: "Custom…",
    customColors: "Custom colors",
    colorBg: "Background",
    colorBoard: "Board",
    colorEmpty: "Empty cell",
    tileBig: "big",
    colorT2Text: "Dark text",
    colorT8Text: "Light text",
    colorAccent: "Accent",
  },
  zh: {
    title: "2048 AI —— 期望最大化自动玩家",
    score: "得分",
    best: "最佳",
    maxTile: "最大方块",
    newGame: "新游戏",
    autoPlay: "自动播放",
    pause: "暂停",
    step: "单步",
    turbo: "极速",
    speed: "速度",
    movesPerSec: "步/秒",
    depth: "深度",
    budget: "预算",
    ms: "毫秒",
    cutoff: "裁剪",
    exact: "精确",
    cells: "格子",
    aiDebug: "AI 调试",
    move: "方向",
    depthStat: "深度",
    nodes: "节点",
    time: "耗时",
    ttHit: "置换表命中",
    up: "上",
    down: "下",
    left: "左",
    right: "右",
    illegal: "非法",
    gameOver: "游戏结束",
    budget20: "20 毫秒",
    budget40: "40 毫秒",
    budget100: "100 毫秒",
    budget200: "200 毫秒",
    cutoff8: "8 格",
    cutoff6: "6 格",
    cutoff4: "4 格",
    benchmark: "基准测试",
    games: "局数",
    seedStart: "起始种子",
    runBenchmark: "运行基准测试",
    cancel: "取消",
    replayBest: "重放最佳",
    exportJson: "导出 JSON",
    running: "运行中",
    cancelled: "已取消",
    done: "完成",
    cancelling: "正在取消...",
    bestGame: "最佳对局",
    benchmarkResult: "基准测试结果",
    summaryGames: "局数",
    summaryMean: "平均",
    summaryMedian: "中位数",
    summaryP90: "P90",
    summaryP99: "P99",
    summaryBest: "最佳",
    summaryMeanMoves: "平均步数",
    summaryMeanMaxTile: "平均最大方块",
    summarySpeed: "速度",
    summaryNodesPerMove: "节点/步",
    summaryMsPerMove: "毫秒/步",
    langLabel: "语言",
    themeClassic: "经典",
    themeDark: "暗夜",
    themeOcean: "海洋",
    themeSunset: "日落",
    themeForest: "森林",
    themeCustom: "自定义…",
    customColors: "自定义颜色",
    colorBg: "背景",
    colorBoard: "棋盘",
    colorEmpty: "空格",
    tileBig: "大块",
    colorT2Text: "深色文字",
    colorT8Text: "浅色文字",
    colorAccent: "强调色",
  },
};

let currentLang: Lang = detectLang();

function detectLang(): Lang {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "zh") return stored;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function getLang(): Lang {
  return currentLang;
}

export function setLang(lang: Lang): void {
  currentLang = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // localStorage may be unavailable (e.g. private mode); ignore.
  }
  document.documentElement.lang = lang;
  document.title = t("title");
  applyStatic();
}

export function t(key: string): string {
  return dict[currentLang][key] ?? dict.en[key] ?? key;
}

/** Localized names for the four move directions (matches DIR_NAMES order). */
export function dirName(index: number): string {
  return t(["up", "down", "left", "right"][index]);
}

/** Apply translations to every element carrying a data-i18n attribute. */
export function applyStatic(): void {
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = el.dataset.i18n!;
    el.textContent = t(key);
  }
}

export function initI18n(): void {
  const langSelect = document.getElementById("lang") as HTMLSelectElement | null;
  if (langSelect) {
    langSelect.value = currentLang;
    langSelect.addEventListener("change", () => setLang(langSelect.value as Lang));
  }
  setLang(currentLang);
}
