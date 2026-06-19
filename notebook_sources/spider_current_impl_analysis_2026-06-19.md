# Spider Web 项目现状分析（生成 / 动画 / 交互）

> 项目：`/Users/jialin000/Documents/GitHub/spider_web`
> 
> 目标：总结当前实现逻辑，评估优点与缺陷，并给出可执行优化路径（偏 iOS 移动端性能与稳定性）。

---

## 1. 当前实现总览（架构与数据流）

### 1.1 蛛网生成（Generation）

- 入口：`src/entities/spiderweb.js#createSpiderweb`
- 核心机制：
  - 按 `segments × depth` 生成粒子环网。
  - 约束为两类：
    - 邻接约束（沿索引 i→i+1）
    - 跨圈约束（i→i+segments）
  - 每 `pinStep` 做 pin 固定，形成外圈锚点。
  - `tensor` 缩放约束目标长度，形成“松弛网感”。

### 1.2 动画与物理（Animation / Physics）

- 物理内核：`src/engine/VerletJS.js`
  - Verlet 积分 + 约束松弛（`sim.frame(16)` 固定迭代）。
  - 约束：`DistanceConstraint` / `AngleConstraint` / `PinConstraint`。
- Spider 身体：`src/entities/spider.js` + `src/systems/footSystem.js`
  - 四条腿落脚目标搜索（节点 + 线段采样点候选）
  - 抬脚 / 落脚通过动态增删约束完成
- 投掷物状态机：`src/main.js#updateThrownObjects`
  - `falling -> sticking -> stuck -> freeing -> falling2`
  - 可进入 `wrapping -> collecting`

### 1.3 交互（Interaction）

- 输入：`main.js` 中 click/tap 目标驱动
- 粘网：`src/systems/stickSystem.js`
  - 对每条约束做离散采样（每段 9 点）
  - 与物体路径做最近点距离判定
  - 历史命中池加权抽样选择粘附点
- 网完整度：`src/systems/webIntegrity.js`
  - 网格覆盖扫描估算损伤百分比
  - 达阈值触发失败

### 1.4 渲染（Rendering）

- 蛛网渲染：`src/render/webRenderer.js`
  - 根据“危险度”做颜色 / 线宽 / 闪烁
  - 邻接扩散（BFS 2 层）实现局部损伤视觉传导
- 背景渲染：`src/render/sylvanBackground.js`
  - 移动端降频（每 3 帧渲一次）

---

## 2. 现有实现优点（Strengths）

1. **物理表达直观且可调**
   - Verlet + 约束系统易调参，适合玩法试验。

2. **结构化模块清晰**
   - 生成、落脚、粘网、完整度、渲染职责分离，维护成本可控。

3. **交互链条完整**
   - 从命中检测、粘附、挣脱、断裂到收集动画，玩法反馈闭环已打通。

4. **可视化反馈强**
   - 危险度扩散 + 红闪，有助于玩家理解“网正在被破坏”。

5. **已有移动端意识**
   - 背景降频渲染、触摸输入、参数面板化，具备优化基础。

---

## 3. 现有缺陷与风险（Defects / Risks）

### 3.1 算法复杂度瓶颈

1. **粘网命中检测偏重 O(objects × constraints × samples)**
   - `collectPathHitCandidates` 对全部约束逐条采样，移动端对象多时成本陡升。

2. **网完整度扫描偏重 O(cells × constraints)**
   - 网格每次扫描全约束，损伤检测成本在高密网时明显。

3. **约束迭代固定，不随负载自适应**
   - `sim.frame(16)` 固定迭代数，性能与稳定性的平衡不可动态优化。

### 3.2 数值与可解释性风险

4. **参数强经验化**
   - 多处阈值和权重硬编码（粘附、步态、危险扩散），缺少数据回标。

5. **网生成拓扑与物理一致性可进一步增强**
   - 当前是“几何+约束”快速生成，缺少预张力一致化步骤。

### 3.3 iOS 端体验风险

6. **音频恢复场景可能脆弱**
   - 前后台切换、系统打断后 WebAudio 恢复链路仍需专项验证。

7. **触摸/手势边界问题未系统化验证**
   - Edge gesture、安全区、不同 iPhone 型号交互一致性未形成测试矩阵。

---

## 4. 优化方向（How to Optimize）

### P0（先做，收益最高）

1. **粘网检测引入空间索引（Grid / Spatial Hash）**
   - 先按约束包围盒入桶，仅检测物体路径附近桶。
   - 目标：显著降低 `collectPathHitCandidates` 开销。

2. **完整度扫描做增量化**
   - 只在断裂邻域重算覆盖，而非全域扫描。
   - 目标：削减 `scanWebCells` 峰值耗时。

3. **约束迭代自适应**
   - 高负载降低迭代数，低负载恢复。
   - 目标：稳帧优先，减少长尾掉帧。

### P1（稳定性与质量提升）

4. **建立参数基线与回归测试场景**
   - 固定三类压测：高密网、高速穿网、多物体并发。
   - 记录 FPS、触控延迟、内存峰值、网破坏误差。

5. **输入与音频状态机显式化**
   - 把前后台/打断恢复状态纳入统一恢复流程。

6. **分层质量档（High/Mid/Low）**
   - 根据设备性能动态调整：背景频率、迭代数、特效粒度。

### P2（中长期）

7. **约束求解升级（XPBD 方向）**
   - 在不牺牲工程可控性的前提下提升 dt 稳定性。

8. **统一“结构-物理”导出格式**
   - 为后续 Houdini/Blender 资产流程和运行时一致性铺路。

---

## 5. 建议的性能监控指标（iOS）

- 帧率：P50 / P95 FPS
- 帧时间：Physics / Interaction / Render 分项耗时
- 输入：touch→响应延迟（P95）
- 内存：峰值 + 30 分钟漂移
- 音频：打断后恢复成功率

---

## 6. 一句话结论

当前项目已经具备“可玩且可扩展”的蛛网生成/动画/交互完整链路；下一阶段应从“玩法完成度”转向“移动端稳态性能工程化”，核心抓手是：**空间索引 + 增量扫描 + 自适应迭代 + iOS 状态恢复矩阵**。
