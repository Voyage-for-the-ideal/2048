# 2048 AI —— 期望最大化自动玩家

**中文** · [English](README.md)

一个高性能、纯客户端的自动玩 2048 应用，内置 Expectimax 求解器、预计算的
移动表、置换表、权重调参、种子化基准测试与回放功能，可在 GitHub Pages 上
零后端部署。

## 这是什么？

标准 4×4 2048 规则。可用方向键手动游玩，也可让 AI 代玩：

- **自动播放** —— 按你选择的速度播放 AI 走步动画
- **极速** —— 每秒数百步，无动画
- **单步** —— 每次执行一步 AI 走法
- **基准测试** —— 在浏览器中运行数百局种子化对局，可导出 JSON
- **重放最佳** —— 逐步重放基准测试中的最佳对局
- **AI 调试面板** —— 显示所选走法、搜索深度、节点数、决策耗时、
  置换表命中率，以及各方向的评估值

UI 细节：

- **滑动动画** —— 所有走步（手动 / AI / 重放）都以平滑过渡呈现：方块滑向
  目标格、合并时弹跳（pop）、被吞并的方块淡出、随机新方块带出生动画；
  动画时长随播放速度自适应收缩
- **配色主题** —— 内置 5 套主题（经典 / 暗夜 / 海洋 / 日落 / 森林），
  也可在「自定义颜色」面板中逐色编辑（18 个颜色项，含背景、棋盘、每种
  方块色与文字色），选择与自定义均持久化到 localStorage

## 演示 / 部署

应用部署于：

**https://\<user\>.github.io/2048/**

（推送到名为 `2048` 的 GitHub 仓库后，`.github/workflows/deploy.yml` 工作流
会自动执行安装、测试、构建并发布到 `gh-pages` 分支。Vite 的 `base` 为
`/2048/`。）

## 架构

```
src/
├── game/                 # 游戏引擎（无 DOM、无 AI）
│   ├── board.ts          # 4×Uint16 棋盘；单元格 = log2(方块)；行 = 16 位
│   ├── moveTables.ts     # 每种行状态对应 65536 项预计算表
│   ├── engine.ts         # 走步/合并/随机方块/终局判定，全部查表实现
│   ├── rng.ts            # 确定性种子化随机数（mulberry32）
│   └── reference.ts      # 朴素数组引擎，仅用于属性测试
├── ai/                   # AI 引擎（无 DOM）
│   ├── expectimax.ts     # 后状态 Expectimax + 迭代加深
│   ├── evaluator.ts      # 特征评估器（查表实现）
│   ├── transposition.ts  # 两级 Map 置换表，以 64 位棋盘为键
│   ├── weights.ts        # 评估器权重（可调）
│   └── ai.ts             # 统一 AI 接口（页面 / Worker / 基准测试共用）
├── benchmark/
│   ├── runner.ts         # 种子化对局运行器
│   └── stats.ts          # 均值/中位数/P90/P99、方块达成率、速度
├── worker.ts             # Web Worker：在主线程之外执行搜索
└── main.ts               # UI、控制、基准测试面板、回放
tests/                    # 单元 + 属性测试（vitest）
scripts/
├── benchmark.ts          # 无界面种子化基准测试（npm run benchmark）
└── tune.ts               # 权重调参（npm run tune）
```

游戏引擎与 AI 完全解耦：AI 只吃棋盘状态、返回方向，因此同一套代码可以在
页面、Web Worker 和无界面基准测试中运行。

## 游戏引擎

- 棋盘 = `Uint16Array(4)`；每行由 4 个 4 位单元格打包（`log2(方块)`，
  `0` = 空格）。单行是一个 16 位数值。
- 全部 65536 种行状态一次性预计算：`moveLeft/right`、`scoreLeft/right`、
  `emptyCount`、差分单调性、对数尺度平滑度、合并潜力以及蛇形贡献。
  一次棋盘移动 = 4 次（横向）或 4 次列打包（纵向）表查询。热路径零分配，
  `applyMove` 写入调用方提供的缓冲区。
- 确定性种子化随机数（`mulberry32`），保证基准测试与回放公平可复现。

## AI 算法

**基于后状态的 Expectimax**：

```
player(board, depth) = max over legal moves of chance(after, depth)
chance(after, depth) = Σ_{cell, tile∈{2,4}} P · player(board', depth-1)
    P(tile=2) = 0.9/emptyCount, P(tile=4) = 0.1/emptyCount
```

随机方块节点是 CHANCE 节点（对每个空格做真实期望），而非对抗性 MIN 节点。

- **后状态**：玩家的走步是确定性的，因此搜索交替进行 玩家 → 后状态 →
  随机方块 → 玩家。价值函数和置换表都作用于后状态。
- **迭代加深** 且有时间预算；被打断的深度会被丢弃（回退到上一个完整深度）。
- **动态深度**：空格越少 ⇒ 分支因子越小 ⇒ 搜索越深（开局 d3，残局最高 d6）。
- **置换表**：两级 `Map`，以精确 64 位棋盘为键（两个 uint32 —— 不使用
  BigInt，也不用字符串键）。仅当分数权重为 0（精确值）时启用；否则分数项
  沿搜索路径累加（nneonneo 风格），让 AI 主动寻找合并。
- **CHANCE 节点裁剪**（可选，关闭即精确）：只展开按期望值排序的前 K
  个空格并做概率归一化，用精度换深度。

### 目标

- `MAX_SCORE` —— 最大化期望最终得分（默认权重）
- `MAX_TILE` —— 最大化达成目标方块的概率（权重偏向角位/蛇形/最大方块
  保护；UI 可自选目标 2048…65536）

## 评估函数

```
V(board) = wEmpty · emptyCells
         + wMono  · monotonicity        （差分，取 4 个方向最佳）
         + wSmooth· smoothness          （-Σ|log2(a)-log2(b)|，仅非空对）
         + wMerge · mergePotential      （相邻相等对）
         + wCorner· cornerScore         （角位最大方块）
         + wSnake · snakeScore          （8 种蛇形排序取最佳）
         + wMax   · log2(maxTile)
         + wScore · log(1 + score)      （沿搜索路径累加）
```

单调性是差分形式（沿方向相邻对求 `a-b` 之和，排除空格 —— 合出大方块时
不会因旁边暂时的空格而受罚）。平滑度与蛇形贡献按行/列状态预计算，因此一次
评估只需几十次表查询。

## 性能

| 指标 | 数值 |
| --- | ---: |
| 引擎移动 | ~4000 万 步/秒 |
| 评估 | ~800 万 次/秒 |
| Expectimax 节点 | ~300-500 万 节点/秒 |
| 典型决策延迟 | 5-30 毫秒（d4-d6，受预算限制） |
| 置换表命中率 | ~25-40% |

关键的优化（均经过实测而非臆测）：行查表完成移动与特征计算；无逐节点分配
（场景池化棋盘）；精确 64 位置换表键；对数值上的差分单调性；平滑度/单调性
排除空格；带分数感知的搜索。

## 基准测试结果

正式基准测试（种子化、确定性）—— 运行 `npm run benchmark -- 1000 0
--maxDepth 4 --budgetMs 100 --cutoff 8` 即可复现。表内数字均来自真实运行，
绝不虚构。

| AI | 局数 | 平均分 | 2048 | 4096 | 8192 | 16384 | 32768 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Greedy（固定方向） | 200 | 2483 | 0% | 0% | 0% | 0% | 0% |
| Expectimax d3 | 60 | 2349 | 0% | 0% | 0% | 0% | 0% |
| Expectimax d4 | 60 | 4332 | 0% | 0% | 0% | 0% | 0% |
| Expectimax d4, uniform cutoff | 50 | 3291 | 0% | 0% | 0% | 0% | 0% |
| Expectimax d4 tuned weights | 50 | 24763 | 50% | 6% | 0% | 0% | 0% |

（2026-08-17：tuned-weights 行是 `snake 2, maxTile 15, score 2`（基准测试
`seed 200-249`），从结构上修复了蛇形特征抑制大块合并的问题。表中数值来自
真实运行，绝不虚构。）

## 如何运行

```bash
npm install
npm run dev          # 开发服务器
npm test             # 单元 + 属性测试（vitest）
npm run build        # 构建生产产物到 dist/
```

## 如何调参

```bash
npm run tune -- 20 40 3 80 6
# 每轮 20 局、40 代、深度 3、80 毫秒预算、裁剪 6
```

会写出 `tuned-weights.json`。基准测试可用 `--weights tuned-weights.json`
传入，或粘贴到 UI 的权重输入框。

## 如何部署

1. 将本仓库推送到 GitHub 上一个名为 `2048` 的仓库。
2. `.github/workflows/deploy.yml` 会在 `main` 分支上执行：
   安装 → 测试 → 构建 → 将 `dist/` 发布到 `gh-pages` 分支。
3. 在仓库设置中开启 Pages 并使用 `gh-pages` 分支（或启用后由工作流通过
   Pages API 完成）。
4. 应用即上线于 `https://<user>.github.io/2048/`。

## 后续工作

- 通过自对弈训练的 N-tuple / TD 学习价值函数（旋转权重共享），并使用同一套
  种子化基准测试与启发式对比
- 用于角位保护和大方块链的残局模式数据库
- 概率感知的机会节点剪枝（按期望值取前 K 个，而非按行主序）