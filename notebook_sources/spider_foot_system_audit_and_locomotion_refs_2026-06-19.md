# 小蜘蛛落脚系统审计 + 移动动画计算资料补充

> 项目：`spider_web`
> 
> 关注点：`src/systems/footSystem.js` 与 `main.js` 中脚步触发/插值/落脚约束逻辑是否合理，以及用于后续优化的技术资料。

---

## 1) 当前落脚计算是否合理？（结论）

**结论：合理，可用，但属于“启发式稳定版”，在真实感与规模性能上仍有明显提升空间。**

### 1.1 合理点

1. **候选点来源合理**：节点 + 线段采样点双通道（`getWebSamplePoints` + `findStepTarget`），避免只踩节点造成动作跳变。
2. **破网约束过滤正确**：通过“alive particles”过滤，减少踩空已断裂区域概率。
3. **占位避让机制有效**：最小腿间距 + 软惩罚避免四足重叠。
4. **相位限制有基本保障**：partner stepping 检查降低同时迈步导致的体态崩塌。
5. **动作插值平滑**：二次 ease-in-out 对小蜘蛛步态观感友好。

### 1.2 不足点（关键）

1. **计算复杂度偏高**：`findStepTarget` 每次触发会扫描大量候选（与约束规模线性增长）。
2. **评分函数偏单一**：主要看与理想点距离 + 占位惩罚，缺少“方向一致性、历史连续性、受力稳定性”等项。
3. **落脚目标缺少落地时再验证**：步进过程中网结构变化可能导致目标失效。
4. **参数硬编码较多**：`stepR/minR/idealDist/MIN_LEG_SEP` 等缺乏机型与场景自适应。
5. **步态机制偏刚性**：目前是配对互斥，缺少更连续的 gait 相位控制（phase offset / duty factor）。

---

## 2) 直接可落地优化（按优先级）

### P0（先做）

1. **落脚时二次验证**
   - 在 `landFoot()` 前再次确认候选约束仍存活。
2. **引入候选空间索引**（grid/hash）
   - 把候选检索从“全量扫”转为“邻域桶查询”。
3. **评分函数加方向项**
   - 增加 `dot(candidateDir, moveDir)` 奖励，减少“逆向踩点”。

### P1（体验增强）

4. **增加时间连续项**
   - 惩罚与上一步目标差异过大，抑制抖腿。
5. **相位参数化**
   - 以 `phase[i]` + `dutyFactor` 控制迈步窗口，替代简单 partner 互斥。

### P2（中长期）

6. **步态库（gait presets）**
   - creeping / chasing / wrapping 三种 gait 参数集。
7. **物理一致性升级（XPBD方向）**
   - 提升在低帧率和高负载下的稳定性。

---

## 3) 小蜘蛛移动动画计算：高价值参考资料（可用于公式与实现）

> 备注：以下条目用于“算法设计与公式提炼”，覆盖论文、实现仓库、GDC/工程实践。

### 3.1 论文与学术资料

1. Abdul Karim et al. — Procedural Locomotion of Multi-Legged Characters in Dynamic Environments  
   URL: https://www.ahmadabdulkarim.com/wp-content/uploads/2014/02/AAK-ProceduralLocomotion.pdf  
   用途：Footprints Planner 结构化思路，适合重构当前 candidate+score 流程。

2. Rune Skovbo Johansen — Interactive Synthesis of Locomotion Cycles（博士论文）  
   URL: https://runevision.com/thesis/rune_skovbo_johansen_thesis.pdf  
   用途：foot-skate 抑制、足底约束、姿态连续性。

3. Suzuki et al. (2025) — Foot Trajectory as a Key Factor for Diverse Gait Patterns  
   URL: https://www.nature.com/articles/s41598-024-84060-5  
   用途：相位驱动足端轨迹（可直接映射到 swing 曲线建模）。

4. LIRIS 文献（多足角色程序行走相关）  
   URL: https://liris.cnrs.fr/Documents/Liris-5511.pdf  
   用途：多足步态求解与 IK 结合的研究视角。

### 3.2 工程实现（GitHub / 生产可参考）

5. Unity-Procedural-IK-Wall-Walking-Spider  
   URL: https://github.com/PhilS94/Unity-Procedural-IK-Wall-Walking-Spider  
   用途：蜘蛛足部锚点 + 地形探测 + CCD/FABRIK 思路。

6. Procedural-Spider-Animation (Lightningale)  
   URL: https://github.com/Lightningale/Procedural-Spider-Animation  
   用途：蜘蛛多腿程序动画样例，适配落脚逻辑改造。

7. Chunk-of-Procedural-Animation  
   URL: https://github.com/HangyBoi/Chunk-of-Procedural-Animation  
   用途：多足角色步态组织与身体跟随。

8. IK-Walker / inverse-kin-arachnids / ProjectArakne（多实现对照）  
   URLs:  
   - https://github.com/Woreira/IK-Walker  
   - https://github.com/Sparkfir3/inverse-kin-arachnids  
   - https://github.com/frabulous/ProjectArakne  
   用途：不同 IK 方案和步态控制策略对照。

### 3.3 会议与高质量讲解

9. GDC 2014 — Animation Bootcamp: An Indie Approach to Procedural Animation  
   URL: https://www.youtube.com/watch?v=LNidsMesxSE  
   用途：程序动画核心哲学（小团队极高性价比）。

10. GDC 2016 — IK Rig: Procedural Pose Animation  
    URL: https://www.youtube.com/watch?v=KLjTU0yKS00  
    用途：IK Rig 管线化思维，利于模块化重构。

11. GDC Vault — Fitting the World: A Biomechanical Approach to Foot IK  
    URL: https://www.gdcvault.com/play/1023316/Fitting-the-World-A-Biomechanical  
    用途：足部 IK 与地形适配的工程方法。

---

## 4) 可直接迁移到当前项目的“计算项”

1. **落脚评分扩展**：
   - `Score = w1*distance + w2*separation + w3*direction + w4*continuity + w5*stability`
2. **迈步窗口控制**（phase gait）：
   - 每条腿维护 `phase`，仅在 swing window 触发候选选择。
3. **足端轨迹函数**：
   - 继续使用 ease 曲线，但把高度与速度解耦：`height = h0 + hv * speed`。
4. **候选检索加速**：
   - 对 segment sample points 建 grid/hash，近邻查询代替全扫。
5. **落地再校验**：
   - `landFoot` 前若候选失效，回退到次优候选。

---

## 5) 推荐下一步（最小改动）

1. 在不改骨架结构前提下，先做：
   - 落地再校验
   - 方向项评分
   - 候选检索缓存
2. 再推进：
   - phase gait（让步态更“像活体”）
   - 候选空间索引（保证 iOS 稳帧）

---

**一句话：当前落脚计算“可玩且稳定”，但还不是“高保真+高效率”的移动端版本。**
