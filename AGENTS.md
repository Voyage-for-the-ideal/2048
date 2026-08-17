# AGENTS.md

2048 Expectimax auto-player: client-side TypeScript + Vite app with no backend.
Deterministic, performance-focused; git-ignored artifacts and measured-benchmark
claims are easy to step on.

## Commands

- `npm run dev` — Vite dev server.
- `npm test` — `vitest run` (single run). **No lint is configured.**
- `npm run typecheck` — `tsc --noEmit`. `npm run build` is only `vite build`
  and does NOT catch type errors; run both after changes.
- `npm run build` — prod build to `dist/`. Uses `base: "/2048/"` for GitHub
  Pages, so `dist/` must be previewed with `npm run preview` (opening the
  files directly breaks asset paths).
- `npm run benchmark -- <games> <seedStart> [--maxDepth N] [--budgetMs N] [--cutoff K] [--noTT] [--objective MAX_SCORE|MAX_TILE] [--weights <file-or-inline-json>] [--json out.json] [--keepBest]`
  — seeded headless benchmark. Positional `<games> <seedStart>` also have named
  aliases `--games`/`--seedStart`.
- `npm run tune -- <games> <generations> [--maxDepth N] [--budgetMs N] [--cutoff K] [--workers W]`
  — weight tuning; spawns worker threads, writes `tuned-weights.json`.
- Scripts under `scripts/` run with `tsx`, not ts-node/tsc. `scripts/_debug_*`
  are ad-hoc scratch scripts (also run via `npx tsx`), not npm scripts.

## Architecture

- `src/game/` — pure engine (no DOM, no AI). Board is a 4×`Uint16Array`;
  each cell is `log2(tile)` (`0` = empty), each row a 16-bit value. All
  65536 row states are precomputed in `moveTables.ts`.
  `src/game/reference.ts` is a naive array engine used only for property
  tests — keep it in sync whenever engine semantics change.
- `src/ai/` — DOM-independent Expectimax (afterstate search, iterative
  deepening with time+node budgets, dynamic depth to d6 in the endgame),
  table-driven evaluator, transposition table keyed by exact 64-bit board
  (two uint32s — never BigInt/string keys). `src/ai/ai.ts` is the single
  interface used by page, Web Worker, and headless bench.
- `weights.ts` owns `DEFAULT_WEIGHTS` / `MAX_TILE_WEIGHTS`. Defaults changed
  2026-08-17 (snake 8→2, maxTile 4→15, score 0.5→2) and 2026-08-18
  (snake 2→0, from the ablation in README) — do not treat old tunes in the
  repo as current, and be aware CHANGING these changes every benchmark.

## Gotchas

- Performance is the point (~tens of millions of engine moves/s): hot paths
  must not allocate; `applyMove` writes into a caller-supplied buffer.
  Preserve the scratch-pooled / table-lookup patterns in `game/` and `ai/`.
- Benchmarks are seeded via `mulberry32` — reproducible by seed. Results in
  README/TODO are from real runs and must never be fabricated.
- Tuning is expensive: games=12 at d3/60ms took ~16 min per evaluation with
  `--workers 4` (a 24-generation run ≈ 13 h). Keep game/generation counts
  small; prefer a quick `npm run benchmark` for ordinary verification.
- Git hygiene: `dist/`, `bench-*.json`, `tune-log.txt` are git-ignored;
  `best-game.json` and `tuned-weights.json` are tracked. Don't commit bench
  output.
- CI (`deploy.yml`) uses Node 20 and runs `npm test` then `npm run build` on
  `main`. Keep Node 20 compatibility.
- `tests/` includes property tests cross-checking the bitboard engine against
  `reference.ts` and endgame tactics tests (big-tile merge preservation,
  d6 in the endgame) — run the full suite after any engine/evaluator change.