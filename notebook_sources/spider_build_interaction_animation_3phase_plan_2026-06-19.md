# Spider Web 构建 + 交互 + 动画 三阶段落地表

Date: 2026-06-19  
Project: `spider_web`

---

## 目标

- 在不牺牲当前玩法反馈的前提下，降低主循环开销并提升蛛网交互动画的稳定性与可读性。
- 覆盖三条链路：**构建（拓扑）**、**交互（受力/粘附/断裂）**、**程序动画（视觉反馈）**。

---

## 上线门槛（先于 Phase A）

### M0. 基线与验收阈值
- 先记录基线：`avg/p95 frame time`、`checkWebIntegrity` 耗时、`collectPathHitCandidates` 耗时、danger 更新耗时。
- 明确阈值：每阶段“必须不退化”的红线（例如 p95 不上升、NaN 计数保持 0）。

### M1. 观测与兜底开关
- 为 A/B/C 提供 feature flags（可单独开关）。
- 增加轻量计数器：缓存命中率、扫描预算超限、事件队列深度、降级触发次数。
- 保留 kill-switch：线上回退到旧路径。

---

## 三阶段实施总览

| 阶段 | 核心目标 | 主要文件 | 预期收益 | 风险 |
|---|---|---|---|---|
| Phase A（构建层） | 把“每帧重建”改成“拓扑变更时重建” | `src/render/webRenderer.js`, `src/systems/webIntegrity.js`, `src/main.js` | CPU 基线下降，帧时间波动减小 | 缓存失效处理不全 |
| Phase B（交互层） | 把受击/粘附/断裂计算改事件驱动 + 局部更新 | `src/systems/stickSystem.js`, `src/render/webRenderer.js`, `src/main.js`, `src/entities/ThrownObj.js` | 断裂高峰期不卡顿，交互反馈更连贯 | 局部更新边界遗漏 |
| Phase C（动画层） | 分离静态结构层和动态响应层，统一时间基 | `src/render/webRenderer.js`, `src/main.js`, `src/render/spiderRenderer.js` | 动画更稳定、风格一致、移动端更稳 | 多层绘制状态管理复杂 |

---

## Phase A：构建层（拓扑缓存与扫描降频）

### A1. 缓存粒子-约束邻接（Topology Cache）
- **问题**：`webRenderer.drawConstraints` 每帧重建 `pToCI`。
- **改法**：
  - 在 `spiderweb` 上维护 `topologyVersion` 与 `adjCache`。
  - 仅在约束 add/remove 时重建邻接。
- **触发点**：
  - `ThrownObj.release()` 删除约束。
  - 其他新增/恢复约束路径。
- **验收**：常态帧中不再执行全量邻接重建。

### A2. 网完整度扫描改“预算扫描”
- **问题**：`scanWebCells` 为 `cells * constraints` 全量扫描。
- **改法**：
  - 维护扫描游标，每帧只扫描固定预算（如 5%~10% grid）。
  - 断裂事件时短时提高预算，恢复后降回常态。
- **验收**：在中高密度网下，`checkWebIntegrity` p95 显著下降。

### A3. 数值稳定性护栏（同批落地）
- **文件**：`src/engine/Vec2.js`, `src/engine/constraints.js`
- **改法**：
  - `normal()` 增加零长度 epsilon 保护。
  - `DistanceConstraint.relax()` 在 `m < eps` 时跳过/钳制。
- **验收**：压力场景下无 NaN 位置扩散。

---

## Phase B：交互层（事件驱动 + 局部化）

### B1. danger 传播从“每帧重算”改为“事件增量”
- **问题**：当前在绘制中同步做 dangerRaw + BFS。
- **改法**：
  - 建立 `dangerState`：source set、dirty constraints、衰减计时。
  - 仅在粘附进入危险态、freeing、断裂时增量更新。
- **验收**：静态场景下 danger 计算近似 0 成本。

### B1.1 事件顺序与背压策略（必须定义）
- 固定顺序：`input -> interaction update -> danger update -> render`。
- 背压策略：同一约束多次事件合并，防止队列膨胀导致陈旧状态。
- **验收**：高频断裂时无 danger 卡帧/滞后错位。

### B2. 断裂闪烁（flash）从全约束遍历改局部映射
- **问题**：`constraints × flashes` 嵌套循环。
- **改法**：
  - 断裂时记录受影响约束 id / 局部邻域。
  - 渲染期仅遍历活跃 flash 及其关联集合。
- **验收**：连续断网事件下帧时间峰值显著下降。

### B3. 粘附路径采样自适应
- **文件**：`src/systems/stickSystem.js`
- **改法**：
  - 按路径长度/速度调采样密度（短路径低采样，长路径高采样）。
  - 命中后提前剪枝，避免无效后续采样。
- **验收**：高速度穿网场景 CPU 下降且命中稳定。

---

## Phase C：动画层（分层绘制 + 统一时间基）

### C1. 静态结构层 / 动态响应层分离
- **思路**：
  - 静态层：普通蛛丝（拓扑不变时无需重绘）。
  - 动态层：danger 高亮、断裂闪烁、受力波纹。
- **收益**：减少重复路径绘制，提升视觉层次。

### C2. 动画时间基统一
- **问题**：部分效果使用 `Date.now()`，部分依赖 frame 计数。
- **改法**：统一使用 loop 提供的逻辑时间（delta 累积）。
- **收益**：不同刷新率设备下节奏一致，不“忽快忽慢”。

### C3. 足部动画与网响应解耦
- **思路**：
  - 足部步态按 gait phase 驱动。
  - 网响应按事件和衰减驱动。
  - 通过轻量桥接参数（impact strength / local tension）联动，不互相阻塞。
- **收益**：动作自然，断裂/受力反馈更可信。

### C4. 预算超限时的可降级策略
- 降级顺序建议：
  1) 降低视觉特效采样密度
  2) 降低 flash 细节/持续时长
  3) 降低动态层刷新频率
- 不降级项：数值稳定护栏与核心交互正确性。
- **验收**：超预算设备优先保正确性与输入响应。

---

## 文件级任务清单（可直接排期）

1. `src/render/webRenderer.js`
   - 引入 adjacency cache 与 topologyVersion。
   - 拆分静态线层/动态效果层。
   - danger 与 flash 渲染改增量数据读取。

2. `src/systems/webIntegrity.js`
   - 增加预算扫描 API（游标 + 每帧配额）。
   - 提供事件触发的短时加速扫描接口。

3. `src/systems/stickSystem.js`
   - 改造 `collectPathHitCandidates` 为自适应采样。
   - 增加剪枝条件与统计计数器。

4. `src/main.js`
   - 主循环接入统一逻辑时间。
   - 接入扫描预算调度与事件驱动 danger 更新。

5. `src/engine/Vec2.js` + `src/engine/constraints.js`
   - 数值稳定性护栏（epsilon guard）。

---

## 验证指标（每阶段必须打点）

- 性能：`avg/p95 frame time`、CPU 分段耗时（integrity/stick/render-danger）。
- 稳定：NaN 计数（粒子位置/约束距离）。
- 视觉：断裂后高亮衰减连续性、无闪烁抖动。
- 交互：粘附命中一致性、足部落点无跳变。

---

## 建议实施顺序（最小风险）

1) 先 A3（数值护栏）  
2) 再 A1/A2（基线成本）  
3) 再 B1/B2（交互高峰稳定）  
4) 最后 C1/C2/C3（动画表现增强）
