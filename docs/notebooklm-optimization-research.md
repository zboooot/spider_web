# Spider Web 性能优化 — NotebookLM 研究资料包

> **用途**：将本文档 + 下方「推荐外链源」一并导入 [Google NotebookLM](https://notebooklm.google.com)，用文末 Prompt 生成可执行的优化参考。
>
> **问题标签**：`2D dynamic line segment spatial query` · `Verlet/PBD constraint solver` · `browser main-thread game loop` · `mobile JavaScript GC`

---

## 0. 本项目问题陈述（给 NotebookLM 的上下文）

我们在浏览器 Canvas 游戏中模拟 **动态蜘蛛网（~660 条距离约束线段）**，每帧存在三类 **对同一数据集的无索引暴力几何查询**：

| 子系统 | 查询 | 复杂度 |
|--------|------|--------|
| 粘网 `stickSystem` | 运动点路径 vs 全部网段最近点 | O(猎物 × 约束 × 采样) |
| 落脚 `footSystem` | 半径内最优锚点 vs 粒子+~1980采样点 | O(约束+采样点) / 帧 |
| 完整度 `webIntegrity` | 网格格点 vs 全部网段覆盖 | O(~430格 × 约束)，周期性全量 |

叠加 **固定 16 次** Verlet 约束松弛（~700+ 约束/迭代），以及 `AngleConstraint` 每步 `new Vec2` 的 GC 压力。iPhone 上帧率随猎物数量与挣脱频率恶化，FPS 面板显示 Draw Call 不是主因。

**标准抽象**：Uncoordinated repeated spatial queries on shared dynamic segment network + fixed-iteration PBD hot path + allocation-heavy constraint solver.

---

## 1. 推荐导入 NotebookLM 的外链源（按优先级）

### Tier A — 与问题结构几乎 1:1 对应（必加）

| # | 标题 | URL | 对应我们的问题 |
|---|------|-----|----------------|
| A1 | Ten Minute Physics #11 — Spatial Hashing | https://matthias-research.github.io/pages/tenMinutePhysics/11-hashing.html | 共享空间哈希 broad phase |
| A1b | 同上 PDF 笔记 | https://matthias-research.github.io/pages/tenMinutePhysics/11-hashing.pdf | 实现细节 |
| A2 | Ten Minute Physics #04 — Pinball (segment collision) | https://matthias-research.github.io/pages/tenMinutePhysics/04-pinball.html | 点/球 vs 线段碰撞 |
| A3 | Ten Minute Physics #06 — Pendulum / distance constraints | https://matthias-research.github.io/pages/tenMinutePhysics/06-pendulumShort.html | PBD 距离约束、迭代次数 |
| A4 | Ten Minute Physics #09 — XPBD 入门 | https://matthias-research.github.io/pages/tenMinutePhysics/09-xpbd.pdf | 约束求解框架、迭代与刚度 |
| A5 | Ten Minute Physics #14 — Cloth (手机 30fps JS) | https://matthias-research.github.io/pages/tenMinutePhysics/14-cloth.html | 浏览器 JS 软体性能标杆 |
| A6 | Toqoz — Verlet Rope in Games | https://toqoz.fyi/game-rope.html | 绳/网碰撞、快照、迭代权衡、CCD |
| A7 | GameDev.net — Spatial Hashing | https://www.gamedev.net/articles/programming/general-and-gameplay-programming/spatial-hashing-r2697/ | 均匀网格哈希经典教程 |

### Tier B — Broad/Narrow Phase 与架构共识

| # | 标题 | URL |
|---|------|-----|
| B1 | Build New Games — Broad Phase Collision Detection | http://buildnewgames.com/broad-phase-collision-detection/ |
| B2 | Ten Minute Physics #23 — Sweep and Prune | https://matthias-research.github.io/pages/tenMinutePhysics/23-SAP.html |
| B3 | Ten Minute Physics #24 — BVH (Morton) | https://matthias-research.github.io/pages/tenMinutePhysics/24-morton.html |
| B4 | GameDev.SE — Quadtree vs Spatial Hashing | https://gamedev.stackexchange.com/questions/69776/when-is-a-quadtree-preferable-over-spatial-hashing |
| B5 | GameDev.SE — How to optimize collisions | https://gamedev.stackexchange.com/questions/161814/how-to-optimize-collisions |
| B6 | 0fps — Collision Detection articles | https://0fps.net/category/programming/collision-detection/ |

### Tier C — 物理求解器与移动端 JS

| # | 标题 | URL |
|---|------|-----|
| C1 | XPBD paper (Müller et al.) | https://matthias-research.github.io/pages/publications/XPBD.pdf |
| C2 | Müller — Small steps in XPBD (blog) | https://blog.mmacklin.com/2016/09/15/xpbd/ |
| C3 | GameDev.SE — PhysicsJS on mobile | https://gamedev.stackexchange.com/questions/110416/physicsjs-on-mobile-devices-how-to-optimize-for-speed |
| C4 | web.dev — Static memory / Object Pools | https://web.dev/articles/speed-static-mem-pools |
| C5 | Build New Games — GC-friendly code | http://buildnewgames.com/garbage-collector-friendly-code/ |
| C6 | PlayCanvas forum — GC on iOS | https://forum.playcanvas.com/t/solved-garbage-collection-on-ios/10677 |

### Tier D — CCD / 覆盖检测 / 增量更新

| # | 标题 | URL |
|---|------|-----|
| D1 | Adam Heins — CCD visual explanation | https://adamheins.com/blog/ccd-visual |
| D2 | GameDev.net — 2D Verlet segment collision | https://www.gamedev.net/forums/topic/207478-2d-verlet-segment-particle-collision-response/ |
| D3 | Wikipedia — Dynamic connectivity（连通性增量） | https://en.wikipedia.org/wiki/Dynamic_connectivity |
| D4 | EA GDC — Cloth self-collision predictive contacts | https://media.contentapi.ea.com/content/dam/eacom/frostbite/files/gdc2018-chrislewin-clothselfcollisionwithpredictivecontacts.pdf |

### Tier E — 本地源（上传本文件即可）

- 本文档：`docs/notebooklm-optimization-research.md`
- 项目开发日志：`DEVLOG.md`（已知坑：物理步长、web % 显示、打包参数）

---

## 2. NotebookLM 创建步骤

1. 打开 https://notebooklm.google.com → **New notebook**
2. 命名建议：`SpiderWeb Spatial Query & Verlet Optimization`
3. **Add source**：
   - 上传本 markdown 文件 + `DEVLOG.md`
   - 用「Website URL」逐条添加 Tier A（至少 A1–A7）
   - 时间允许则加 Tier B + C
4. 等待索引完成后，在 Chat 中依次粘贴 **第 3 节 Prompt**
5. 将 NotebookLM 输出导出到 `docs/optimization-plan.md`（**已完成，2026-06-18**）

> **说明**：NotebookLM 无公开个人版 API；需手动建 notebook。Enterprise API 见 https://cloud.google.com/gemini/enterprise/notebooklm-enterprise/docs/api-notebooks

---

## 3. 建议 Prompt（复制到 NotebookLM Chat）

### Prompt 1 — 总览与方案排序
```
基于所有资料，针对「浏览器 2D 游戏中动态线段网 + 每帧粘附/落脚/覆盖检测 + Verlet 约束求解」的性能问题：

1. 列出社区公认的最优方案（按收益/实现成本排序）
2. 每种方案适用的前提条件与不适合的情况
3. 给出对我们项目（~660 线段、~430 网格、16 物理迭代、单线程 JS）的具体参数建议
4. 用表格对比：Uniform Grid vs Spatial Hash vs Quadtree vs SAP vs BVH
```

### Prompt 2 — 踩坑清单
```
专门总结此类项目的常见坑与反模式，分类为：
- 空间索引（重建频率、线段跨格、动态删除）
- 物理求解（迭代次数、变步长、刚度与稳定性）
- 粘附/CCD（tunneling、采样不足、历史候选失效）
- 完整度/覆盖（全量扫描、网格分辨率、增量更新）
- 移动端 JS（GC、对象池、TypedArray）
每条坑请给出：现象 → 原因 → 推荐修法 → 引用来源
```

### Prompt 3 — 分阶段落地计划
```
为我们的 spider_web 项目写三阶段优化计划（Phase A 止血 / Phase B 架构 / Phase C 抛光），
每阶段：改哪些模块、预期帧率收益、回归风险、如何验证。不要写具体代码，写决策与验收标准。
```

### Prompt 4 — 案例对标
```
从资料中找出最接近「蜘蛛网/绳网/布料 Verlet」的开源或教程案例，
说明它们如何处理：碰撞 broad phase、约束迭代次数、移动端性能。列出可复用的代码模式。
```

---

## 4. 研究综合摘要（基于联网检索的预总结）

> 以下为对 Tier A–D 资料的归纳，供尚未跑 NotebookLM 时直接参考；导入源后用 Prompt 1–4 可得到更细版本。

### 4.1 社区共识：问题本质

1. **Broad phase 是刚需**：对 N 个运动查询体与 M 条静态/准静态线段，暴力 O(N×M) 在 M>500 时不可持续（共识来源：GameDev Spatial Hashing、Ten Minute Physics #11、Build New Games Broad Phase）。

2. **查询应统一**：绳/布/网仿真里，碰撞、拾取、覆盖检测应共享 **同一套 spatial index**，而非每子系统独立遍历（Toqoz Rope、Ten Minute Physics #14/#15 的 hash grid 复用）。

3. **物理迭代与查询迭代解耦**：约束投影迭代次数决定刚度/稳定性；不应为了「手感」在低帧率时仍满迭代而不做 broad phase 裁剪（XPBD、Toqoz「iterations vs nodes」）。

4. **浏览器 JS 上 GC ≈ 隐形物理成本**：热路径 `new Vec2()` / `sub()` 导致 sawtooth 内存图与周期性 30–50ms 尖刺（web.dev Object Pools、PlayCanvas iOS GC 讨论）。

### 4.2 最优方案排序（收益 × 成本，针对本项目）

| 优先级 | 方案 | 预期收益 | 实现成本 | 社区支持度 |
|--------|------|----------|----------|------------|
| **P0** | **Uniform Grid / Spatial Hash** 索引网线段（中点或 AABB 入格） | 粘网/完整度/落脚查询从 O(M) 降到 O(k)，k≪M | 中 | ★★★★★ |
| **P0** | **完整度扫描：分帧 + 局部增量**（只重算断丝影响格） | 消除 ~28万次/次的周期性尖刺 | 中 | ★★★★☆ |
| **P1** | **粘网：Swept point-segment + 窄相**（替代每帧全网 9 点采样） | 猎物多时线性降本 | 中低 | ★★★★☆ |
| **P1** | **落脚采样点：空间裁剪 + 断丝 prune** | 固定 1980/帧 → 与活动区域相关 | 低中 | ★★★☆☆ |
| **P1** | **约束求解热路径去分配**（mutable math / pool） | 减少 GC 尖刺，稳定帧时间 | 中 | ★★★★☆ |
| **P2** | **自适应迭代次数**（移动端 16→8–12，或按约束数缩放） | 10–30% 物理节省 | 低 | ★★★☆☆ |
| **P2** | **查询错峰**（staggered update：粘网每帧、完整度每 N 帧） | 削峰 | 低 | ★★★☆☆ |
| **P3** | SAP / BVH | 大规模或分布极不均匀时更优 | 高 | ★★☆☆☆（对本项目过重） |

**结构选择共识**（GameDev.SE #69776、Ten Minute Physics #11）：
- 物体/线段 **尺寸相近、分布均匀** → **Spatial Hash 首选**
- 物体 **尺寸差异极大** → Quadtree
- **大量静态几何** → BVH + 增量 refit
- 我们的蜘蛛网：线段长度相近、分布径向均匀 → **Uniform Grid 是最优起点**

### 4.3 Spatial Hash 实现要点（Ten Minute Physics #11 + GameDev.net）

```
cellSize ≈ max(查询半径, 平均线段长度) × 1–2
线段入格：用中点 cell，或两端点所在 cell 均登记（跨格线段）
查询：猎物位置 → 3×3 或 5×5 邻域 cell → 仅对候选线段做 narrow phase
动态删除：断丝时从 cell 链表移除；勿每帧全量 rebuild
```

**cellSize 对本项目的起始建议**（需在 NotebookLM 或实测微调）：
- 粘网 `stickCatchRadius ≈ 18` → cellSize **24–36**
- 完整度 `coverD ≈ 22`，`gridStep ≈ 35` → 可与完整度网格 **共用 35px 格**或略小

### 4.4 物理求解器共识（XPBD / Toqoz / Ten Minute Physics）

| 主题 | 共识 | 对本项目 |
|------|------|----------|
| 迭代次数 | 更多迭代 = 更硬；与节点/约束数成正比 | 16 对 660 约束偏高；可试 8–12 + 视觉补偿 |
| 时间步 | **固定 dt** 优于可变 dt（Toqoz 明确反对变步长） | 保持固定 `sim.frame(k)`，但可用 substepping |
| 额外约束 | 首尾距离约束可减少迭代（绳总长） | 蛛网径向/环向可考虑类似「全局」约束 |
| 碰撞/粘附 | **每物理子步检测**会爆炸；应 **broad phase 快照**（Toqoz SnapshotCollisions） | 粘网检测不必放在 16× 内层；每 **逻辑帧 1 次** + CCD 足够 |
| XPBD | 子步 + compliance 可替代部分迭代 | 长期可考虑；短期改迭代更便宜 |

### 4.5 粘网 / CCD 共识

- **Tunneling**：高速小物体 vs 细线段 → 必须 **swept test**（点-线段距离沿路径），不是单点检测（Adam Heins CCD、Toqoz tunneling FAQ）。
- 我们已有 `prevX,prevY → pos` 路径，但 narrow phase 仍扫 **全部** 约束；应用 hash 后保留路径逻辑即可。
- **采样 9 点/线段**：是 narrow phase 精度手段；有了 broad phase 后可降到 3 点或解析最近点。
- **历史候选 `indexOf` 验活**：断丝后 O(n) 查找是已知反模式 → 改为 **constraint id + 存活位图/Set**。

### 4.6 完整度 / 覆盖检测共识

- 全量 grid×segment 覆盖在 **破坏事件** 时可行，**每帧/高频** 不可行。
- 推荐：
  1. **事件驱动**：仅在 `release` / AoE break 后标记 dirty region
  2. **分帧扫描**：每帧最多处理 B 个格子（我们已有 `batchSize=50` 建网，可复用到运行时）
  3. **降低分辨率**：粗网格算「游戏结束」，细网格仅用于 HUD（若需要）
- Dynamic connectivity（并查集）可维护「网是否断裂」，但 **覆盖率 HUD** 不必每帧精确到 1%。

### 4.7 移动端 JavaScript 专项坑

| 坑 | 现象 | 修法 |
|----|------|------|
| 热路径分配 | 周期性卡顿、FPS 不稳 | Object pool、mutable Vec2、`Float32Array` 物理状态 |
| `AngleConstraint` 替换 `pos` 引用 | 隐式 GC + 引用混乱 | 原地 rotate，不 `this.a.pos = new Vec2` |
| 物理满负荷 + 低帧率 | 越卡越算不动 | 自适应迭代 / 查询降频，而非只调 `timeScale` 移动 |
| iOS Safari GC | 比 Chrome 更敏感的 sawtooth | 减少临时数组（`filter`、`map`、每次 `newHits`） |
| 重复 `getBoundingClientRect` | 布局抖动 | 缓存 HUD 锚点，仅在 resize 更新 |

### 4.8 容易踩的坑（反模式清单）

1. **每帧 rebuild 整个 spatial hash** — 应增量 add/remove
2. **线段只按中点入一格** — 长线段漏检；需 cover 跨格
3. **粘网放进 16× 物理内层** — 查询量 ×16（Toqoz 教训）
4. **完整度与粘网用不同网格** — 无法复用；应 **同一 SpatialQueryService**
5. **断丝后采样点不 prune** — footSystem 仍更新 1980 幽灵点
6. **减少迭代但不减查询** — 物理略快但主瓶颈仍在
7. **用 Quadtree/BVH 过早优化** — 对均匀线段网 overhead 可能大于收益
8. **对象池滥用** — 启动慢、内存常驻、归还时需清理状态（web.dev 警告）

### 4.9 推荐架构目标（社区模式 + 本项目映射）

```
GameLoop
  ├─ PhysicsSystem.simulate(fixedIters)     // VerletJS
  ├─ SpatialIndexService                    // 统一 hash grid
  │    ├─ querySegmentsNear(point, radius)  // 粘网、落脚
  │    └─ querySegmentsNearCell(gridX, gridY) // 完整度
  ├─ PreySystem.tick()                      // 用 index 查询
  ├─ FootSystem.tick()                      // 用 index + 局部采样点
  └─ IntegritySystem.tick()                 // 分帧 dirty 扫描
```

对标案例：
- **Ten Minute Physics #04 Pinball** — 球 vs 线段，浏览器 JS
- **Ten Minute Physics #14 Cloth** — hash + 自碰撞，手机 30fps
- **Toqoz Rope** — Verlet 绳 + 碰撞快照 + 性能剖析方法论

### 4.10 验收指标（优化后应对照 FPS 面板）

| 指标 | 优化前参考 | 目标 |
|------|------------|------|
| 波5、Prey=8 时 FPS | 用户反馈卡顿 | ≥30 fps（iPhone 中档机） |
| Draw Calls | 非主因 | 可不变 |
| 帧时间尖刺 | 挣脱时明显 | p95 frame ms < 25ms |
| Phys 迭代 | 16 固定 | 自适应或 10–12 无肉眼物理劣化 |
| 完整度扫描 | ~28万次瞬时 | 分帧 ≤5000 次/帧 |

---

## 5. 检索关键词速查（后续自行搜案例）

**英文**
- `spatial hash line segments 2D game`
- `broad phase narrow phase segment collision`
- `point segment distance swept collision detection`
- `verlet rope constraint iterations performance`
- `XPBD substep compliance mobile`
- `incremental grid coverage line segments`
- `dynamic connectivity edge deletion`
- `javascript object pool game loop GC`
- `temporal coherence collision staggered update`

**中文**
- `二维线段 空间哈希 碰撞检测`
- `Verlet 约束 迭代次数 优化`
- `点线段 连续碰撞检测 扫掠`
- `可破坏 网格 覆盖 增量更新`
- `JavaScript 对象池 游戏 垃圾回收`

---

## 6. 变更记录

- 2026-06-18：初版，基于 spider_web 项目分析与联网检索整理