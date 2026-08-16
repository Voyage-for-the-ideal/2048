# 2048 AI — 后续计划

> 2026-08-16 更新。当前实现：bitboard 引擎 + afterstate Expectimax（迭代加深、
> 时间/节点双预算、动态深度、TT、cutoff 均匀采样）+ nneonneo 式差分 eval +
> score-aware 搜索。31 个测试通过。浏览器 UI/Worker/Benchmark 已验证。

## 现状（最新 benchmark 数据）

| 配置 | mean | moves | maxTile 均值 | 2048 rate |
| --- | ---: | ---: | ---: | ---: |
| d3 b40 | 2349 | 218 | 166 | 0% |
| d4 b200 c0 | 4332 | 349 | 278 | 0% |
| d4 b100 c8（均匀采样版）| 中断未完成 | - | - | - |

## 下一步（按优先级）

### 1. 重跑基础验证（30 分钟）
- [x] `npx vitest run` —— 31 个测试全过（含 cutoff 均匀采样改动）
- [x] `npx tsx scripts/benchmark.ts 50 0 --maxDepth 4 --budgetMs 100 --cutoff 8`
      均匀 cutoff 采样：mean=3291 median=3132 p90=5632 best=9964，
      moves=283 maxTile=219，2048 rate=0%，74.8ms/move
- [x] 记录 Before/After，决定 Keep / Revert → **Keep**（用户指示直接采用；
      row-major 无对照数据但会系统性忽略棋盘下半部，均匀采样逻辑更正确）

### 2. 权重调参（60 分钟，后台）
- [x] 重跑 `npx tsx scripts/tune.ts 12 24 --maxDepth 3 --budgetMs 60 --cutoff 6 --workers 4`
      已停：新权重（候选 A）下游戏变长（1345 moves/局 vs 旧 283），
      12 局 d3 b60 ≈ 16 min/评估，24 代 ≈ 13 小时不可行。
      后续如需 tune：games 需降到 4-6，或训练用 d2 b40
- [x] 用 tuned-weights.json 在 d4 b100 c8 上复验 → 候选 A 手动调权已 50 局
      验证 50% 2048 rate（见 §3），正式替代 tune 结果
- [x] 若 2048 rate 仍为 0%，进入攻坚（见 §4）→ 已由 §3 解决

### 3. 后期深度 / 终局能力（核心攻坚，60 分钟）→ **重大突破 2026-08-17**
- [x] 空位 ≤5 时强制 d6+：已生效（depthProfile/tactics 测试确认终局 completedDepth=6）
- [x] 战术测试 tests/tactics.test.ts：两个 512 相邻 **不合并** → 定位根因
- [x] **根因**：snake 特征结构性偏好不合并（512+512 相邻 = 9×16+9×15=279 分 >
      合并 1024 = 10×16=160 分），且 wSnake=8 × 数值域几百 主宰决策
- [x] **修复**：snake 8→2，maxTile 4→15，score 0.5→2（候选 A，已写入
      DEFAULT_WEIGHTS）
      15 局：mean 3291→29349，**2048 rate 0%→60%**，4096 rate 13.3%
- [x] **50 局确认**（seed 200-249，bench-wA-50.json）：mean=24763，
      **2048 rate=50%**，4096 rate=6%，moves=1345，maxTile=1597
- [x] tests/tactics.test.ts 4 项全过（不拆散相邻 512 / 角落 1024 保持 /
      整合实战 ≥1024 / 终局 depth 6）；全套 35 测试过
- [ ] §2 tune 从新 DEFAULT 出发跑 12x24（进行中）

### 4. 若启发式 expectimax 卡死（备选路线）
- [ ] n-tuple / TD learning：afterstate value function，旋转/翻转 weight
      sharing，self-play 训练；与 heuristic 用同一 seed 集合对比
- [ ] 只做部分 tuple 集（如 6 组 8-tuple），评估训练时间成本

### 5. 正式 benchmark（90 分钟）
- [ ] 1000 局：`npm run benchmark -- 1000 0 --maxDepth 4 --budgetMs 100 --cutoff 8 --keepBest --json bench-1000.json`
- [ ] 至少再跑一组 ablation：
  - [ ] 无 TT / 无 cutoff / 无 score-aware / 无 tuned weights / final
  - [ ] 记录每项 Before/After/Improvement/Keep-Revert

### 6. 收尾（60 分钟）
- [ ] README 填真实 benchmark 表 + ablation 数据（禁止编造）
- [ ] best-game.json 记录（seed/score/maxTile/moves）+ 浏览器 Replay 验证
- [ ] `npm run build` 产物验证 + 浏览器全流程回归（New Game / Auto / Turbo /
      Step / Benchmark / Replay / Export）
- [ ] GitHub Pages：用户创建 repo 并 push 后验证 workflow 部署
      （本地已验证 base `/2048/` 构建正确）

## 已知风险
- tune 评估偏慢（~30s/评估），并行 4 worker 仍 20+ 分钟；必要时降
  games=8、generations=16
- 浏览器端 1000 局 benchmark 可能较慢（d4 b100 ≈ 5-8s/局），UI 需显示进度
- moveTables 的 Int16 SMOOTH_ROW 值域：log 差最大 45×8 行，安全

## 完成标准
- 2048 rate 明显 > 0%（目标 ≥30% 后继续冲 4096/8192）
- 正式 1000 局 benchmark 完成，README 数据真实
- GitHub Pages 可访问
