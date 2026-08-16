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
- [ ] `npx vitest run` —— 确认 31 个测试仍全过（含 cutoff 均匀采样改动）
- [ ] `npx tsx scripts/benchmark.ts 50 0 --maxDepth 4 --budgetMs 100 --cutoff 8`
      验证均匀 cutoff 采样（棋盘上下半部均衡）相对 row-major 的差异
- [ ] 记录 Before/After，决定 Keep / Revert

### 2. 权重调参（60 分钟，后台）
- [ ] 重跑 `npx tsx scripts/tune.ts 12 24 --maxDepth 3 --budgetMs 60 --cutoff 6 --workers 4`
      （上次被手动停止，未出结果）
- [ ] 用 tuned-weights.json 在 d4 b100 c8 上复验
- [ ] 若 2048 rate 仍为 0%，进入攻坚（见 §4）

### 3. 后期深度 / 终局能力（核心攻坚，60 分钟）
当前 2048 rate = 0%，moves 349 但 maxTile 卡 256-512。重点：
- [ ] 空位 ≤5 时强制 d6+（nodeBudget 已支持，需验证后期实际完成深度）
- [ ] 打印 completedDepth 分布与空位数关系，确认后期没被预算砍浅
- [ ] 验证"两个 512 相邻时 AI 是否合并"类战术局面（写进 tests/tactics）
- [ ] 若深度已够但 2048 仍 0%：试 maxTile 权重 / corner 权重加大，或
      MAX_TILE objective 权重文件

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
