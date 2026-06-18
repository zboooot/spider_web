# Spider Web 性能优化方案

> **来源**：Google NotebookLM 研究输出（2026-06-18）  
> **Notebook**：[SpiderWeb Spatial Query & Verlet Optimization](https://notebooklm.google.com) · ID `277be288-c86e-4d21-8b08-ad58ffcb34e6`  
> **输入资料**：`docs/notebooklm-optimization-research.md`、`docs/spider-web-game-requirements.md`、Ten Minute Physics / Toqoz / GameDev 等 32 篇社区资料  
> **性质**：决策与验收标准文档，不含具体代码实现

---

## 方案细度评估

**结论：够用来做架构决策和分阶段排期，但还不够直接开工写代码。**

| 维度 | 细度 | 说明 |
|------|------|------|
| 方向选型 | ✅ 足够 | Uniform Grid 首选、三阶段顺序、模块归属清晰 |
| 参数起点 | ✅ 足够 | `cellSize=35`、邻域 3×3 / 4×4~5×5、迭代 8–12、分帧 50 格 |
| 踩坑与反模式 | ✅ 足够 | 7 条坑，现象→原因→修法完整 |
| 案例对标 | ✅ 足够 | Toqoz / Cloth / XPBD 模式已映射到三个 system |
| API / 接口设计 | ✅ Phase B 已补 | 见 §3.1.1 `SpatialIndexService` 三方法 |
| 数据结构字段 | ✅ Phase B 已补 | `constraint_id` + `Uint8Array` 位图 + 预分配 `Int32Array` |
| 索引更新策略 | ✅ Phase B 已补 | **每帧 bulk rebuild**（660 条 O(N)），断丝仅标记位图 |
| 算法伪代码 | ✅ Phase B 已补 | AABB 入格步骤、Swept 窄相、dirty region 外扩 22px |
| 测试用例 | ✅ Phase B 已补 | §3.1.6 共 8 条回归场景 |
| 数值验证 | ✅ Phase B 已补 | stepR=53 → 精确 AABB 查 **3×3 或 4×4**，不需 5×5 |

**建议**：Phase A 可直接开工；**Phase B 可按 §3.1 开工**，实施时保留 `USE_LEGACY_COLLISION` feature flag。

---

## 0. 问题与约束摘要

- **规模**：~660 条可动态删除的 `DistanceConstraint` 线段，~430 完整度格点，16 次物理迭代，单线程浏览器 JS
- **瓶颈**：三类无索引暴力查询（粘网 / 落脚 / 完整度）+ 热路径 GC，Draw Call 非主因
- **硬性约束**：保留径向+环向网状拓扑；粘网路径 CCD；落脚局部半径搜索；完整度 HUD；断丝增量更新；查询至少覆盖周围网格单元

详见 `docs/spider-web-game-requirements.md`。

---

## 1. 方案排序与参数建议（NotebookLM P1）

### 1.1 按收益/实现成本排序

| 优先级 | 方案 | 要点 | 预期收益 |
|--------|------|------|----------|
| **P0** | 共享 Uniform Grid / Spatial Hash | 三大查询共用；断丝 O(1) 增量更新，禁止每帧全量 rebuild | O(N×M) → O(k) |
| **P0** | `webIntegrity` 分帧 + 事件驱动 | 断丝标记 dirty region；每帧最多扫 50 格 | 消除 ~28 万次/帧尖刺 |
| **P1** | `stickSystem` Swept point-segment CCD | 废除 9 点采样；hash 窄相 + 路径扫掠 | 猎物多时线性降本；防 tunneling |
| **P1** | 物理热路径去分配 | `AngleConstraint` 等禁止 `new Vec2()`；对象池 / Float32Array | 消除 iOS GC 30–50ms 尖刺 |
| **P2** | 自适应迭代 / Sub-stepping | 16 → 8–12 等效；多子步 × 少迭代 | 物理节省 10–30% |

### 1.2 前提条件与不适合情况

- **Spatial Hash**：适合线段尺寸相近、分布均匀（蜘蛛网契合）；不适合尺寸差异极大或极度稀疏场景
- **分帧/事件驱动**：适合 HUD 类延迟容忍逻辑；不适合当帧必须精确的穿透判定（靠 CCD 解决）
- **对象池**：适合短生命周期热路径对象；不适合贪婪预分配或归还时状态未清理

### 1.3 具体参数建议

| 参数 | 建议值 | 依据 |
|------|--------|------|
| `cellSize` | **35px** | 与 `gridStep=35` 对齐，完整度网格可复用 |
| 线段入格 | **AABB 覆盖所有穿越格** | 禁止仅中点入格 |
| 粘网 / 完整度邻域 | **3×3**（半径 18 / 22 < 35） | `stickCatchRadius=18`, `coverD=22` |
| 落脚邻域 | **4×4 或 5×5** | `stepR=53` 超出单格 1.5 倍 |
| 断丝存活 | `constraint_id` + Bitmask/Set | 禁止 `indexOf` 验活 |
| 物理迭代 | **8–12**（从 16 降） | 可加径向全局距离约束补偿刚度 |
| 完整度分帧 | 每帧 ≤ **50** 格 | 与建网 `batchSize` 一致 |

### 1.4 空间划分结构对比

| 结构 | 结论 |
|------|------|
| **Uniform Grid / Spatial Hash** | **P0 首选** — 均匀线段网、断丝 O(1)、三大查询共享 |
| Quadtree | 不建议 — 动态断丝维护成本高 |
| SAP | 不建议 — 网形变大时排序退化 |
| BVH | 极不建议 — 动态变形网过重 |

---

## 2. 踩坑清单（NotebookLM P2）

### 空间索引

| # | 现象 | 原因 | 修法 |
|---|------|------|------|
| 1 | 落脚/粘网漏检 | 线段仅中点入格 | AABB 覆盖，推入所有穿越 cell |
| 2 | 断丝瞬间卡顿 | `splice` / `indexOf` O(n) | ID + 存活位图，O(1) 标记死亡，延迟回收 |

### 物理求解

| # | 现象 | 原因 | 修法 |
|---|------|------|------|
| 3 | 16 迭代仍不够硬 / CPU 高 | 纯靠迭代换刚度 | Sub-stepping 或全局/长距离约束 |
| 4 | 低帧率时网爆炸 | 可变 dt 破坏 Verlet 速度 | 固定时间步，dt 不传入物理核 |

### 粘附 / CCD

| # | 现象 | 原因 | 修法 |
|---|------|------|------|
| 5 | 9 点采样仍 tunneling | 离散采样非真正 CCD | 扫掠区域 + hash 窄相 + 解析点-线段距离 |

### 完整度 / 覆盖

| # | 现象 | 原因 | 修法 |
|---|------|------|------|
| 6 | 每帧 28 万次比较 | HUD 需求被当成每帧全量 | 事件驱动 + 分帧 + dirty region |

### 移动端 JS

| # | 现象 | 原因 | 修法 |
|---|------|------|------|
| 7 | 周期性 30–50ms 尖刺 | 热路径 `new Vec2()` / 临时数组 | 原地数学 / 对象池 / TypedArray |

---

## 3. 三阶段落地计划（NotebookLM P3）

### Phase A：止血

**目标**：消除 GC 尖刺与非必要全量扫描。

| 项 | 内容 |
|----|------|
| **模块** | `webIntegrity`, `VerletJS` |
| **决策** | ① `AngleConstraint` 等热路径零分配 ② 完整度事件驱动 + 每帧 ≤50 格 ③ 迭代 16→10–12 |
| **收益** | 消除 iOS sawtooth GC；释放完整度 CPU |
| **风险** | HUD 断丝后延迟几帧；网略松 |
| **验收** | Performance 内存曲线变平；完整度 ≤5000 次比较/帧 |

### Phase B：架构

**目标**：统一 Spatial Hash，消灭 O(N×M) 查询。

| 项 | 内容 |
|----|------|
| **模块** | `main`, `stickSystem`, `footSystem`, `webIntegrity`；新增 `SpatialIndexService`, `CollisionMath` |
| **决策** | ① 每帧 bulk rebuild 索引 ② `cellSize=35` AABB 入格 ③ 粘网 Swept CCD ④ 落脚即时局部采样 ⑤ 完整度复用 hash + dirty region |
| **收益** | Prey=8 挣脱场景 ≥30 fps（iPhone 中档） |
| **风险** | 跨格漏检、位图不同步、平行线段 NaN |
| **验收** | 见下文 §3.1.6 回归清单 8 条 |

> **细化来源**：NotebookLM P5（2026-06-18）。完整内容见 §3.1。

#### 3.1 Phase B 细化方案（NotebookLM P5）

##### 3.1.1 SpatialIndexService 接口设计

**核心决策**：

| 决策点 | 选择 | 理由 |
|--------|------|------|
| cell 存储内容 | `constraint_id`（整数） | 不存对象引用，避免 GC 与悬挂引用 |
| cell 容器 | 一维数组模拟二维格，或 `Map<cellKey, number[]>` | 格数有限（网区圆形），数组足够 |
| 索引更新策略 | **每帧 bulk rebuild** | 660 线段 O(N) 重建极快；比跟踪跨格增量更安全 |
| 断丝处理 | `Uint8Array` 存活位图 `isAlive[id]=0` | 不从 cell 摘除；查询时过滤 |
| ID 分配 | 建网时为每条 constraint 分配自增 `id` | 与 `spiderweb.constraints` 下标可一致或独立映射 |

**TypeScript 风格接口**：

```typescript
interface SpatialIndexService {
  // 基于当前存活约束重建网格；内部重用上帧内存池
  build(constraints: DistanceConstraint[], cellSize: number): void;

  // O(1) 断丝：仅标记位图，不操作 cell 结构
  removeConstraint(id: number): void;

  // 范围查询：结果写入预分配 outArray，返回命中数（零 GC）
  queryAABB(
    minX: number, maxX: number, minY: number, maxY: number,
    outArray: Int32Array
  ): number;
}
```

**与 P1 的差异说明**：P1 建议断丝时增量 remove cell；P5 改为 **每帧 rebuild + 位图过滤**。实现时以 P5 为准——660 条规模下 rebuild 成本可忽略，逻辑更简单。

##### 3.1.2 线段入格算法

**AABB 扫格 vs Bresenham**：

| 用途 | 算法 | 理由 |
|------|------|------|
| 线段入格（build） | **AABB 扫格** | 短线段（≈cellSize）覆盖 1–2 格，简单便宜 |
| 猎物轨迹 broad phase | **AABB 扫掠盒** | 轨迹 AABB 扩展 `stickCatchRadius=18` 后 `queryAABB` |
| Bresenham | 不采用 | 对 660 条/帧全量建网是过度优化 |

**入格步骤（伪代码）**：

```
for each alive constraint c:
  minX, maxX, minY, maxY = segment AABB of c.a.pos, c.b.pos
  startCol = floor(minX / 35), endCol = floor(maxX / 35)
  startRow = floor(minY / 35), endRow = floor(maxY / 35)
  for row in startRow..endRow:
    for col in startCol..endCol:
      cells[row * cols + col].push(c.id)

// 断丝：isAlive[id] = 0，build 时跳过；或 rebuild 前已标记则不入格
```

**cellSize 与邻域推导**：

- `cellSize = 35` **确认**（线段长度与 `gridStep` 同量级，约为平均物体尺寸 2×）
- `stepR = 53`：查询跨度 `106px`，`106/35 ≈ 3.02` → 用 **精确 AABB 索引** 覆盖 **3×3 或 4×4**，不需要盲搜 5×5
- `stickCatchRadius = 18`、`coverD = 22`：均 < 35 → **3×3** 足够

##### 3.1.3 stickSystem 改造

| 步骤 | 内容 |
|------|------|
| Broad phase | 猎物 `[prevX,prevY]→[pos]` 的 AABB，外扩 18px → `queryAABB` |
| Narrow phase | 两线段最短距离解析算法；距离 ≤ 18 则命中；替代 9 点采样 |
| 历史候选 | 存 `constraint_id` 非对象引用；`isAlive[id]===1` 验活，废除 `indexOf` |
| 调用时机 | 每逻辑帧 **1 次**，在全部物理迭代（16×）**之后** |

##### 3.1.4 footSystem 改造

**迁移步骤**：

1. 删除全局 ~1980 固定采样点数组的初始化与每帧 `updateSamplePoints`
2. 每帧以蜘蛛 `[x,y]` 构造 AABB `[x±53, y±53]` → `queryAABB`
3. 对候选 `id` 查 `isAlive`；存活则 on-the-fly 3 等分插值采样点
4. 在临时点中找满足 `minR=10`、最接近 `idealDist=23` 的最优落脚
5. 插值用全局 `scratchVec`，禁止 `new Vec2()`

##### 3.1.5 webIntegrity 与 SpatialIndex 复用

| 阶段 | 行为 |
|------|------|
| 初始 | 全量计算 430 格覆盖状态（一次性） |
| 稳态 | 不每帧扫 660 线段 |
| 断丝 | 取断裂线段 AABB，外扩 `coverD=22` → 落入范围内的格点标 dirty（约 2–6 格） |
| 更新 | 仅对 dirty 格：以格点为中心 22px 半径 `queryAABB`，窄相判覆盖 |
| 与 Phase A | Phase A 分帧兜底仍可用；Phase B 后 dirty 格极少，通常当帧完成 |

##### 3.1.6 main.js 集成

**新增文件**：

- `src/physics/SpatialIndexService.js` — 索引单例
- `src/physics/CollisionMath.js` — 两线段最短距离等纯数学

**每帧 Tick 顺序**：

```
1. sim.frame(16)                    // 物理
2. SpatialIndexService.build()      // 索引重建
3. webIntegrity.tickDirty()         // dirty 格覆盖更新
4. stickSystem.tick()               // 粘网 CCD
5. footSystem.tick()                // 落脚局部查询
```

**回归测试清单（8 条）**：

1. 静止时完整度 HUD 初始 100%
2. 单根断丝：断裂周边 % 正确下降，无全局卡顿
3. 断丝后历史粘网候选跳过失效 `id`，不抛错
4. 高速投掷（>100px/帧）不穿透网（Swept CCD）
5. 蜘蛛在 cell 边界（x=35/70）落脚不漏长线段
6. 蜘蛛走过网洞，腿规避死线段
7. Performance 录制 10s：`stickSystem`/`footSystem` 无 `new Array` GC 尖刺
8. 5+ 猎物同时挣脱：build + query 耗时稳定

##### 3.1.7 风险与回滚

| 风险 | 原因 | 验证 |
|------|------|------|
| 跨格漏检 | `floor` 边界/off-by-one | Debug 绘制 queryAABB 候选线段 |
| 幽灵点 | 断丝与 rebuild 时序 | 断丝帧打印 `candidate_ids` + `isAlive` |
| 平行退化 NaN | 两线段平行除零 | 正交轴向直线撞击约束线段 |

**Feature Flag 回滚**：

```javascript
// config: USE_LEGACY_COLLISION = true
// URL: ?legacy=1 热切换
if (CONFIG.USE_LEGACY_COLLISION) {
  legacyStickQuery();   // 9 点采样 + 全量遍历
  legacyFootQuery();    // 1980 全局采样点
} else {
  spatialIndex.queryAABB(...);
  ccdStickQuery();
}
```

### Phase C：抛光

**目标**：纠正 Tick 顺序、彻底 O(1) 断丝、查询零分配、Sub-stepping 刚度。

| 项 | 内容 |
|----|------|
| **模块** | `main`, `VerletJS`, `stickSystem`, `footSystem`, `ThrownObj`, `spiderweb` |
| **子阶段** | C1 Tick+GC → C2 断丝位图 → C3 Sub-stepping |
| **收益** | 消灭残余 GC；AoE 无尖刺；网更硬且 CPU 更低 |
| **验收** | p95 < 25ms；查询零分配；AoE >50 断丝 FPS 跌幅 ≤5 |

> **细化来源**：NotebookLM P6（2026-06-18）。完整内容见 §3.2。  
> **与当前代码差距**：A/B 已落地，但主循环仍为 `build→query→physics`；`splice`/`push` 仍在；未做 Sub-stepping。

#### 3.2 Phase C 细化方案（NotebookLM P6）

##### 3.2.1 主循环 Tick 顺序纠正（P5 共识，当前未对齐）

**共识**（Macklin XPBD 主循环、Toqoz Snapshot）：必须先物理积分得到最新 `pos`，再 `build` 索引，再查询。

**目标每帧顺序**：

```
1. Capture prevX/prevY     // 猎物、蜘蛛（Swept CCD 用）
2. Physics (Sub-steps)     // Verlet 积分 + 约束（改网线 pos）
3. SpatialIndex.build()    // 基于最新 pos 重建 hash
4. Queries
   ├─ stickSystem          // 用 step1 轨迹 × step3 索引
   ├─ footSystem           // 蜘蛛最新位置
   └─ webIntegrity         // dirty region
5. Render / 其余逻辑
```

**当前实现（需修正）**：`build → 落脚/粘网/完整度 → physics(11)` — 查询用的是物理**前**的网形，与 P5 相悖。

| 迁移步 | 动作 | 风险 | 验收 |
|--------|------|------|------|
| C1-a | `physics` 移到 `build` 之前 | 渲染若在查询前，脚点视觉滞后 | 落脚与网段渲染严丝合缝 |
| C1-b | `capture prev` 移到物理步**之前** | capture 错乱 → CCD 向量为 0、漏粘 | 高速投掷当帧粘附，非下一帧 |
| C1-c | 查询全部移到 `build` 之后 | — | 逐帧步进：碰撞判定在接触当帧 |

**猎物/投掷物注意**：`updateThrownObjects` 中手动改 `pos` 的逻辑需与 capture/physics 顺序对齐；可能需拆为「积分外力」与「粘网查询」两阶段。

##### 3.2.2 Sub-stepping 与刚度补偿（Macklin + Toqoz）

**决策**：废除「1 大步 × 11 iter」→ **N=5~6 子步，每子步 1~2 iter**（总计算 5~12 iter 量级，但 \(\Delta t_s = \Delta t/N\)，刚度显著优于单步 11 iter）。

| 参数 | 建议 |
|------|------|
| 子步数 N | **5 或 6** |
| 每子步迭代 | **1~2** |
| 等价关系 | 误差随 \(\Delta t_s^2\) 缩小，手感硬度 > 当前 11 iter |

**径向全局距离约束**（Toqoz 模式）：
- 每条**辐射线**：最内侧节点 ↔ 最外侧锚点节点，加隐藏 `DistanceConstraint`（`idealDist` = 初始辐射总长）
- **环向不加** — 否则网无法自然形变
- 实现位置：`spiderweb.js` 建网时，按 `segments` 辐射索引成对添加

**分离速度 Clamping**：
- 子步 \(\Delta t_s\) 极小，穿透恢复易爆炸
- 建议 \(v_{max} \approx \texttt{stickCatchRadius} / \Delta t_s\)，约束求解或碰撞响应中钳制

##### 3.2.3 断丝 O(1) 彻底化

**决策**：禁止热路径 `splice` / `filter`；`constraints` 数组**尺寸不变**，仅靠 `isAlive[id]=0` 逻辑删除。

| 场景 | 做法 |
|------|------|
| 单根断丝 | `isAlive[id]=0`；**不** `splice`；`webIntegrity` dirty |
| Boulder AoE | 范围内批量 `isAlive=0`；合并破坏区 AABB → 单一 `dirtyRegion` |
| Verlet 求解 | `relax` 入口：`if (!isAlive[c.__webId]) continue` |
| 内存压缩 | **不做**（660 常驻可忽略）；若必须：swap-remove + 更新 id 映射（复杂，非首选） |

**协同检查清单**（每项必须查 `isAlive`）：
- `SpatialIndex.build`（已有）
- `stickSystem` 历史候选
- `footSystem` `landedSeg` / `landedNode`
- `ThrownObj.stickToPoint`（已有位图路径）
- `chooseStickCandidate` 双指针清理，非 `filter`

##### 3.2.4 查询零分配（Martin Wells GC 指南）

| 组件 | 现状 | Phase C 目标 |
|------|------|-------------|
| `queryAABB` | 已用 `Int32Array(512)` | 扩至 **1024**，文档化 `hitCount` |
| `stickSystem` hits | `push` 对象数组 | 预分配 **HitSlot[]** 或扁平 `Float32Array`（id,t,x,y,radial,dist）+ `hitCount` |
| `footSystem` cands | `push` + `filter` | 预分配候选槽 + 双指针剔除 occupied |
| `chooseStickCandidate` | `filter` | 双指针 `remove_if` 原位压缩 + cursor |

```typescript
// 全局池（示意）
const queryBuffer = new Int32Array(1024);
const stickHitPool = new Float32Array(1024 * 6); // 每 hit 6 字段
let stickHitCount = 0;

let hitCount = spatialIndex.queryAABB(minX, maxX, minY, maxY, queryBuffer);
for (let i = 0; i < hitCount; i++) {
  const cid = queryBuffer[i];
  if (!isAlive[cid]) continue;
  // 窄相写入 stickHitPool...
}
```

##### 3.2.5 Phase B 遗留 vs P5 对齐表

| # | P5 要求 | 当前 A/B 实现 | Phase C 修正 |
|---|---------|---------------|-------------|
| 1 | physics → build → query | build → query → physics | §3.2.1 C1 |
| 2 | 断丝仅位图 | `release` 仍 `splice`/`filter` | §3.2.3 C2 |
| 3 | 查询零 GC | stick/foot 仍 `push`/`filter` | §3.2.4 C1 |
| 4 | Sub-stepping + 全局约束 | 固定 11 iter | §3.2.2 C3 |

##### 3.2.6 分步实施（C1 / C2 / C3）

**C1：Tick 顺序 + GC 消除**  
- **模块**：`main`, `stickSystem`, `footSystem`  
- **决策**：重排主循环；`Int32Array(1024)` + 双指针；废除查询路径 `push`/`filter`  
- **收益**：消灭 iOS sawtooth GC；CCD 与网形同步  
- **风险**：`hitCount` 未清零读脏数据；capture 时机错误  
- **验收**：Memory 面板无锯齿；stick/foot 单帧分配 **0 Bytes**

**C2：断丝 O(1) + AoE 批处理**  
- **模块**：`VerletJS`, `ThrownObj`, `spiderweb`  
- **决策**：求解器跳过 `!isAlive`；`release` 只改位图 + dirty；Boulder 批量标记  
- **收益**：AoE >50 断丝无帧尖刺  
- **风险**：某子系统忘查 `isAlive` → 踩幽灵网  
- **验收**：Profile 无 Array.splice/filter；回归 C.1/C.2

**C3：Sub-stepping + 径向全局约束**  
- **模块**：`VerletJS`, `spiderweb.js`  
- **决策**：N=5~6 子步 × 1~2 iter；辐射首尾全局弹簧；\(v_{max}\) clamping  
- **收益**：更硬网 + 更低等效 CPU；重物压网形变 ↓30%  
- **风险**：N 过大 + 重叠 → 能量爆炸  
- **验收**：多 Max 质量猎物悬挂；网中心下坠较 11 iter 减 30%+；回归 C.3

##### 3.2.7 Phase C 验收与回归（P5 八条 + 新增）

**指标**：

| 指标 | 目标 |
|------|------|
| 查询路径单帧分配 | **0 Bytes** |
| p95 frame time | **< 25ms**（含 AoE 断丝） |
| Sub-step 刚度 | 多重物悬挂：网中心下坠 **↓30%+** vs 11 iter |
| Tick 连贯性 | 高速撞网：判定在**接触当帧** |

**新增回归场景**：

- **C.1**：巨石 AoE 中央 >50 线段同时断 — FPS 瞬间跌幅 ≤5 帧  
- **C.2**：蜘蛛移向刚断孤岛 — 无 NaN、无幽灵锚点  
- **C.3**：子步 + 高频挣脱 — 无网能量爆炸/鬼畜反弹  

**保留 P5 八条**（§3.1.6）全部仍适用。

### 目标架构（Phase C 完成后）

```
GameLoop
  ├─ capturePrevPositions()               // 猎物/蜘蛛 prev（CCD）
  ├─ PhysicsSystem.simulateSubsteps(N)    // VerletJS，跳过 !isAlive
  ├─ SpatialIndexService.build()          // 基于最新 pos
  ├─ PreySystem.tick()                    // stickSystem，零分配池
  ├─ FootSystem.tick()                    // 零分配池
  └─ IntegritySystem.tickDirty()          // dirty 格
```

---

## 4. 案例对标与模块映射（NotebookLM P4）

### 4.1 参考案例

| 案例 | 处理的问题 | 可复用模式 |
|------|-----------|-----------|
| **Toqoz Verlet Rope** | 绳碰撞、迭代、剪断 | Snapshot 快照；全局距离约束；cut 动量保持 |
| **Ten Minute Physics Cloth** | 布料自碰撞 | Spatial Hash broad phase |
| **GameDev.net Spatial Hashing** | 线段入格 | Bresenham 光栅化穿越格 |
| **Müller PBD** | 布料撕裂 | 超阈值分裂 / 约束断裂 |
| **Macklin Small Steps** | 迭代 vs 子步 | 多子步 × 1 迭代 > 单步 × 多迭代 |

### 4.2 映射到本项目

#### `stickSystem`

1. 猎物轨迹 `[prevX,prevY]→[pos]` 用 Bresenham 求穿越 cell
2. 从穿越 cell 取线段 ID 快照
3. 窄相：解析点-线段最短距离（替代 9 点采样）

#### `footSystem`

1. 断丝：`constraint_id` 位图标记，禁止 `splice`
2. 蜘蛛周围 5×5 cell 取存活线段，即时计算采样落脚点
3. 原地数学，不 `new Vec2`

#### `webIntegrity`

1. 与 Spatial Hash 共用 AABB 入格（`cellSize=35`）
2. 仅断丝事件触发 dirty cell 重算，不全帧扫描

#### `VerletJS`

1. Sub-stepping：N=4~8 子步，每子步 1 iteration
2. 径向全局距离约束（同轴端点）降低所需迭代总数

---

## 5. 验收指标

| 指标 | 优化前参考 | 目标 |
|------|------------|------|
| 波5、Prey=8 FPS | 卡顿 | ≥ 30 fps（iPhone 中档） |
| Draw Calls | 非主因 | 可不变 |
| 帧时间尖刺（挣脱） | 明显 | p95 < 25ms |
| Phys 迭代 | 16 固定 | 10–12 或自适应，无明显劣化 |
| 完整度扫描 | ~28 万次瞬时 | 分帧 ≤5000 次/帧 |

---

## 6. 实施前待补细节

### 已由 P5 解决（见 §3.1）

- `SpatialIndexService` 接口与生命周期
- 每帧 bulk rebuild + 位图断丝
- AABB 入格 vs Bresenham 选型
- stepR 邻域 3×3 / 4×4 推导
- dirty region：断丝 AABB 外扩 `coverD=22`
- 8 条回归测试 + feature flag 回滚

### Phase A/B 已完成；Phase C 待实施（见 §3.2）

1. **Tick 顺序**：当前 `build→query→physics` → 目标 `capture→physics→build→query`
2. **断丝**：`splice`/`filter` → 仅 `isAlive` 位图
3. **查询 GC**：`push`/`filter` → 预分配池 + 双指针
4. **物理**：11 iter 单步 → N=5~6 子步 + 径向全局约束 + \(v_{max}\) clamp

### 仍待 C 实施时微调

1. **CollisionMath** 平行退化 epsilon（回归 C.3 时定）
2. **queryBuffer** 512 → 1024 是否足够（密集区 benchmark）
3. **投掷物手动积分** 与 capture/physics 拆分方案（C1 关键路径）

---

## 7. 主要参考来源

| 来源 | URL |
|------|-----|
| Ten Minute Physics #11 Spatial Hashing | https://matthias-research.github.io/pages/tenMinutePhysics/11-hashing.html |
| Ten Minute Physics #04 Pinball | https://matthias-research.github.io/pages/tenMinutePhysics/04-pinball.html |
| Ten Minute Physics #14 Cloth | https://matthias-research.github.io/pages/tenMinutePhysics/14-cloth.html |
| Toqoz Verlet Rope | https://toqoz.fyi/game-rope.html |
| GameDev.net Spatial Hashing | https://www.gamedev.net/articles/programming/general-and-gameplay-programming/spatial-hashing-r2697/ |
| Build New Games Broad Phase | http://buildnewgames.com/broad-phase-collision-detection/ |
| Build New Games GC-friendly | http://buildnewgames.com/garbage-collector-friendly-code/ |
| web.dev Object Pools | https://web.dev/articles/speed-static-mem-pools |
| Adam Heins CCD | https://adamheins.com/blog/ccd-visual |
| Macklin Small Steps | https://mmacklin.com/smallsteps.html |
| GameDev.SE Quadtree vs Hash | https://gamedev.stackexchange.com/questions/69776/when-is-a-quadtree-preferable-over-spatial-hashing |

本地约束文档：`docs/spider-web-game-requirements.md`

---

## 变更记录

- 2026-06-18：从 NotebookLM P1–P4 笔记同步；附细度评估与待补清单
- 2026-06-18：NotebookLM P5 细化 Phase B，扩充 §3.1（接口、入格、三系统改造、集成、回滚）
- 2026-06-18：NotebookLM P6 细化 Phase C，扩充 §3.2；纠正 Tick 顺序与 A/B 遗留差距清单