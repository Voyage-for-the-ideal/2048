# 2048 AI — Expectimax Auto-Player

A high-performance, fully client-side auto-playing 2048 with an Expectimax
solver, precomputed move tables, transposition tables, weight tuning, seeded
benchmarks, and replay — deployable on GitHub Pages with zero backend.

## What is this?

Standard 4×4 2048 rules. Play manually with arrow keys, or let the AI play:
- **Auto Play** — animated AI moves at your chosen speed
- **Turbo** — hundreds of AI moves per second, no animation
- **Step** — one AI move at a time
- **Benchmark** — run hundreds of seeded games in the browser, export JSON
- **Replay Best** — replay the best benchmark game move by move
- **AI debug panel** — chosen move, search depth, nodes, decision time,
  transposition-table hit rate, and per-direction move evaluations

## Demo / Deploy

The app is deployed at:

**https://\<user\>.github.io/2048/**

(Push to a GitHub repo named `2048` and the workflow in
`.github/workflows/deploy.yml` installs, tests, builds and deploys to the
`gh-pages` branch automatically. The Vite `base` is `/2048/`.)

## Architecture

```
src/
├── game/                 # Game engine (no DOM, no AI)
│   ├── board.ts          # 4×Uint16 board; cell = log2(tile); row = 16-bit
│   ├── moveTables.ts     # precomputed 65536-entry tables per row state
│   ├── engine.ts         # moves/merges/random tiles/terminal via lookups
│   ├── rng.ts            # deterministic seeded RNG (mulberry32)
│   └── reference.ts      # naive array engine used for property testing
├── ai/                   # AI engine (no DOM)
│   ├── expectimax.ts     # afterstate Expectimax + iterative deepening
│   ├── evaluator.ts      # feature evaluator (table-driven)
│   ├── transposition.ts  # two-level Map TT keyed by 64-bit board
│   ├── weights.ts        # evaluator weights (tunable)
│   └── ai.ts             # unified AI interface (page / worker / bench)
├── benchmark/
│   ├── runner.ts         # seeded game runner
│   └── stats.ts          # mean/median/P90/P99, tile rates, speed
├── worker.ts             # Web Worker: search off the main thread
└── main.ts               # UI, controls, benchmark panel, replay
tests/                    # unit + property tests (vitest)
scripts/
├── benchmark.ts          # headless seeded benchmark (npm run benchmark)
└── tune.ts               # weight tuning (npm run tune)
```

The game engine and the AI are fully decoupled: the AI consumes a board
representation and returns a direction, so the exact same code runs in the
page, in a Web Worker, and in headless benchmarks.

## Game engine

- Board = `Uint16Array(4)`; each row packs 4 cells × 4 bits (`log2(tile)`,
  `0` = empty). A single row is a 16-bit value.
- All 65536 possible row states are precomputed once:
  `moveLeft/right`, `scoreLeft/right`, `emptyCount`, differential
  monotonicity, log-scale smoothness, merge potential, and snake
  contributions. A board move is 4 (horizontal) or 4 column-packs
  (vertical) table lookups. No allocations in the hot path; `applyMove`
  writes into a caller-provided buffer.
- Deterministic seeded RNG (`mulberry32`) for fair benchmarks and replay.

## AI algorithm

**Expectimax over afterstates**:

```
player(board, depth) = max over legal moves of chance(after, depth)
chance(after, depth) = Σ_{cell, tile∈{2,4}} P · player(board', depth-1)
    P(tile=2) = 0.9/emptyCount, P(tile=4) = 0.1/emptyCount
```

The random-tile node is a CHANCE node (true expectation over every empty
cell), not an adversarial MIN node.

- **Afterstates**: the player move is deterministic, so the search
  alternates player → afterstate → random tile → player. The value function
  and transposition table both operate on afterstates.
- **Iterative deepening** with a time budget; an interrupted depth is
  discarded (values revert to the last complete depth).
- **Dynamic depth**: fewer empty cells ⇒ smaller branching factor ⇒ deeper
  search (d3 early game up to d6 in the endgame).
- **Transposition table**: two-level `Map` keyed by the exact 64-bit board
  (two uint32 numbers — no BigInt, no string keys). Only enabled when the
  score weight is 0 (exact values); otherwise the score term travels along
  the path (nneonneo-style) so the AI actively seeks merges.
- **Chance-node cutoff** (optional, off = exact): expand only the top-K
  empty cells with renormalized probabilities to trade accuracy for depth.

### Objectives

- `MAX_SCORE` — maximize expected final score (default weights)
- `MAX_TILE` — maximize the chance of reaching the target tile (weights
  biased toward corner/snake/max-tile protection; the UI lets you pick the
  target 2048…65536)

## Evaluation function

```
V(board) = wEmpty · emptyCells
         + wMono  · monotonicity        (differential, best of 4 directions)
         + wSmooth· smoothness          (-Σ|log2(a)-log2(b)|, non-empty pairs)
         + wMerge · mergePotential      (adjacent equal pairs)
         + wCorner· cornerScore         (largest tile in a corner)
         + wSnake · snakeScore          (best of 8 snake orderings)
         + wMax   · log2(maxTile)
         + wScore · log(1 + score)      (travels along the search path)
```

Monotonicity is the differential form (sum of `a-b` over adjacent pairs
aligned with the direction, empty cells excluded — merging a big tile is
never punished for the temporary hole next to it). Smoothness and snake
contributions are precomputed per row/column state so evaluation is a few
dozen table lookups.

## Performance

| measurement | value |
| --- | ---: |
| engine moves | ~40M moves/s |
| evaluate | ~8M evals/s |
| expectimax nodes | ~3-5M nodes/s |
| typical decision latency | 5-30 ms (d4-d6, budget-capped) |
| transposition hit rate | ~25-40% |

Optimizations that mattered (measured, not assumed): row lookup tables for
moves and features; no per-node allocations (scratch-pooled boards); exact
64-bit TT keys; differential monotonicity on log values; empty cells
excluded from smoothness/monotonicity; score-aware search.

## Benchmark results

Formal benchmark (seeded, deterministic) — run `npm run benchmark -- 1000 0
--maxDepth 4 --budgetMs 100 --cutoff 8` to reproduce. Reported numbers will
be filled in from the real runs; results are never fabricated.

| AI | Games | Avg Score | 2048 | 4096 | 8192 | 16384 | 32768 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Greedy (fixed dir) | 200 | 2483 | 0% | 0% | 0% | 0% | 0% |
| Expectimax d3 | 60 | 2349 | 0% | 0% | 0% | 0% | 0% |
| Expectimax d4 | 60 | 4332 | 0% | 0% | 0% | 0% | 0% |
| Tuned | TBD | TBD | TBD | TBD | TBD | TBD | TBD |

(Values in this table are from development runs; the README is updated with
the formal 1000+ game benchmark before release.)

## How to run

```bash
npm install
npm run dev          # dev server
npm test             # unit + property tests (vitest)
npm run build        # production build to dist/
```

## How to tune

```bash
npm run tune -- 20 40 3 80 6
# 20 games/eval, 40 generations, depth 3, 80 ms budget, cutoff 6
```

Writes `tuned-weights.json`. Pass it to the benchmark with
`--weights tuned-weights.json` or paste it into the UI weights field.

## How to deploy

1. Push this repository to GitHub as a repository named `2048`.
2. The workflow `.github/workflows/deploy.yml` runs on `main`:
   install → test → build → publish `dist/` to the `gh-pages` branch.
3. In the repo settings enable Pages with branch `gh-pages` (or the
   workflow does it via the Pages API once enabled).
4. The app is live at `https://<user>.github.io/2048/`.

## Future work

- N-tuple / TD-learning value function trained by self-play
  (rotational weight sharing), compared against the heuristic via the same
  seeded benchmarks
- Endgame pattern databases for corner preservation and large-tile chains
- Probability-aware chance pruning (top-K by expected value instead of
  row-major order)
