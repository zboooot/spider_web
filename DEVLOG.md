# Verlet Spider — 开发日志与注意事项

## 项目概述

基于 Verlet 物理引擎的蜘蛛网游戏，使用纯 JavaScript + Canvas 2D 开发，Vite 构建，支持打包成单个 HTML 文件独立运行。

---

## 项目结构

```
src/
  engine/          Verlet 物理引擎核心（Vec2、Particle、Composite、VerletJS、constraints）
  entities/        游戏实体（spiderweb、spider、ThrownObj）
  systems/         游戏系统（footSystem、stickSystem、webIntegrity、levelSystem）
  render/          所有渲染器（webRenderer、spiderRenderer、objectRenderer、inventoryArt、sylvanBackground）
  audio/           Web Audio API 程序化音效引擎
  ui/              UI 逻辑（overlay、panel）
  assets/          图片资源（popo、fly、worm、leaf 序列帧）
  main.js          游戏主循环与状态机
  style.css        全局样式

index.html         HTML 入口（含左右参数面板，打包时隐藏）
vite.config.js     Vite 配置（含 vite-plugin-singlefile 打包插件）
```

---

## 开发过程总结

### 1. 基础框架
- 基于 Verlet 物理模拟构建蜘蛛网和蜘蛛物理
- 蜘蛛网：螺旋形粒子系统 + 弹簧约束 + 固定锚点
- 蜘蛛：4 条腿的骨架链，关节弹性约束驱动
- 投掷物（毛毛虫/苍蝇/树叶）：各有独立物理行为和粘网逻辑

### 2. 背景系统（sylvanBackground.js）
- 移植自 `spider_bg` 项目，5 套自然时相主题（晨曦碧翠、金秋枫影、幽谷蓝楹、春樱盛绽、暗夜蓝杉）
- 4 层 Canvas 景深系统（背景光晕、深景树木、中景梢枝+丁达尔光束、前景孢子粒子）
- 所有渲染参数可调：模糊、风速、光束、变暗、纯度、上移、孢子密度
- 丁达尔光束使用 `multiply` 混合模式以产生更纯的光效
- 背景 Canvas 宽高需要按 `devicePixelRatio` 缩放，否则 Retina 屏会模糊

### 3. 程序化 BGM（audioEngine.js）
- 完全使用 Web Audio API 合成，零外部音频文件
- 5 套主题各有独特音色（G 大调/D 大调/藏式铜磬/竖琴/宇宙电音）
- 关卡切换时自动 crossfade（1.5s 淡出 + 0.9s 延迟淡入）
- 浏览器安全策略要求首次用户交互后才能播放音频，代码里有 unlock 逻辑

### 4. 蜘蛛头替换
- 使用 `src/assets/popo.png` 替换原来程序化绘制的蜘蛛头
- 三状态切换：`popo`（正常）→ `popo_blink`（眨眼）→ `popo_pack`（打包猎物）
- 打包状态由 `wrappingTarget !== null` 判断
- 眨眼由现有 `blinkState` 驱动，在 `blinkState.t ∈ [0.35, 1.35]` 区间显示眨眼帧

### 5. 序列帧动画
- **苍蝇**：`fly01 → fly02` 循环，在 `falling`/`freeing` 状态下播放（每 6 帧切换）
- **虫子**：`worm00 → worm01 → worm02 → worm01` 循环
  - 默认状态：慢速扭动（每 18 帧切换，约 3fps）
  - 挣脱状态：快速播放（每 5 帧切换）
- **树叶**：替换为 `leaf.png` 真实图片

### 6. 蜘蛛腿重构
- 原架构改为显式骨架链（`legChains`），每条腿 5 节
- 渲染改为平滑贝塞尔曲线，取代生硬折线
- 打包动作改为"最近两条腿快速倒腾"：每帧计算脚点到目标的距离排序，选最近两条
- 腿根锚点固定在身体侧边四个点，不再从身体中心发出

### 7. 打包与发布
- 使用 `vite-plugin-singlefile` 将所有 JS/CSS/图片 base64 内联为单个 HTML
- 打包时隐藏左右参数面板，游戏画面居中全屏显示
- 全屏适配：CSS `transform: scale()` 等比缩放，保持 9:16 比例，不修改 JS 坐标系
- **背景参数需要手动烧入 DEFAULTS**，因为打包版是新的独立 origin，localStorage 隔离

### 8. 自动寻路 / 优先目标 / 子弹时间
- 默认开启 `Auto Play`：蜘蛛会自动锁定最近的 `stuck` 掉落物并前往打包
- 玩家点击掉落物或网面有效区域，可设置一个“优先目标”；蜘蛛会先完成当前 `wrapping`，再优先前往该目标
- 玩家优先目标存在时，自动打包被限制：
  - 点位目标：路上不会自动打包任何掉落物
  - 物体目标：只允许目标物体本身被打包，其他路过物体会被绕开
- 掉落物目标如果脱网、未落网、进入 `collecting` 或从场景中移除，会自动失效；失效后蜘蛛会原地停顿 `0.5s` 再重新锁定新目标
- 断线头拖拽会触发子弹时间：背景明显变暗并加暗角，非网物理/生成/动画冻结，蛛网约束仍继续运行

### 9. 顶部 HUD 重构
- 收集物 HUD 已恢复到顶部中间居中布局，仍显示三类掉落物的收集数量
- 右上角 HUD 现在显示：
  - 网完整度百分比（使用 `src/assets/web.png` 作为背板）
  - 蚕茧图标 + 网丝资源数字
- 网丝资源复用现有收集权重：`boulder=5`、`bug=4`、`drop=1`
- 网完整度数字会滚动过渡，并在数值变化时短暂闪红
- 被玩家点选为优先目标的掉落物，会整张贴图发白闪烁；不会再出现额外的外圈高亮

### 10. 大便惩罚物
- 新增 `poop` 掉落物：大体量、重下落、长期挂网，不进入顶部收集栏，网丝数量为 `0`
- 大便被网捕获后会慢闪黑色，不会像虫子/毛毛虫一样自动挣脱
- 蜘蛛完成对大便的处理后，会触发黑色烟雾爆炸和独立音效，并原地硬直 `3s`
- 玩家可以手动拖拽大便清除：
  - 轻点仍按普通优先目标处理
  - 拖拽时会出现很强的粘性和明显的黏丝拉扯感
  - 拉到极限后需要继续保持约 `1s` 才会真正剥离
  - 剥离不会扯断蜘蛛网线，只会让大便沿拖拽方向飞出并掉出屏幕

---

## 注意事项

### 打包相关

1. **每次修改完代码，都要重新打包才能更新 `dist/index.html`**
   ```bash
   npm run build
   ```

2. **背景参数与开发版保持一致**：
   - 在开发版浏览器控制台执行 `localStorage.getItem('spiderPanelParams')` 获取当前参数
   - 把 bg 相关参数（`bgBlur`、`bgRay`、`bgDarken`、`bgPurity`、`bgYOffset` 等）更新到 `src/main.js` 的 `DEFAULTS` 中
   - 同步更新 `index.html` 里对应 slider 的 `value` 属性

3. **打包时面板隐藏逻辑在 `vite.config.js` 里**，通过 `transformIndexHtml` 钩子注入 CSS，开发版不受影响

4. **打包版全屏缩放**通过注入的 `<script>` 里的 `applyScale()` 函数实现，监听 `resize` 和 `load` 事件

### 背景系统

5. **背景参数默认值**（当前烧入值）：
   - blur: 25%、ray: 100%、darken: 15%、purity: 140%、yOffset: 13%、particles: 48、volume: 50%

6. **背景 canvas 绘制坐标系**是 `_W × _H`（450×800），但实际 canvas 像素是乘以 DPR 的，背景网格的渐变坐标基于像素宽高，DPR 变化会影响外观

7. **丁达尔光束使用 `multiply` 混合，渲染顺序很重要**：必须先画树枝，再画光束，否则乘法在透明底上不生效

### 物理与游戏逻辑

8. **固定点不可拖动**：`VerletJS.nearestEntity()` 命中 `PinConstraint` 时返回 `null`

9. **WEB 显示逻辑**：UI 显示的是"网的完整度"，从 100% 到 0%，但实际触发 Game Over 的阈值是内部 `webLossPct >= 50`（即物理意义上破坏了 50%）
   - 公式：`displayPct = max(0, round(100 - webLossPct × 2))`

10. **网整体缩放**由 `WEB_SCALE = 1.2` 控制，修改这个值会同步影响蛛网半径和粘网判定范围

11. **蜘蛛腿的拉伸范围**由 `footSystem.js` 中 `stepR`（53）和 `idealDist`（23）控制，太大会导致腿步伐过于夸张

12. **玩家拖拽限制**：当前只允许拖拽“断线头”（连接数为 1 的网线粒子）；蜘蛛和普通网节点都不可拖拽

13. **点位目标有效性**：玩家点击网外区域或破损后形成的空洞，不会生成目标点，也不会显示任何标记 UI

### Git 分支

14. **当前工作分支**：`main`
    - 近期改动直接提交在 `main`，包括 HUD 重构、自动模式、优先目标和子弹时间

15. **git pull 注意事项**：
    - 拉取前仍建议先确认本地改动已提交或 stash，避免覆盖当前本地实验

### 资源文件

16. **所有图片资源在 `src/assets/`**，通过 ES module `import` 引入，Vite 会自动内联为 base64

17. **文件名拼写要严格一致**，之前有过 `wrom02.png`（错误）vs `worm02.png`（正确）导致的 bug

18. **`web.png` 目前用于右上角网完整度背板**，只承担 HUD 装饰作用，不参与物理或碰撞逻辑

19. **库存图标 canvas 尺寸**固定为 `48×48`（`index.html` 里 `width="48" height="48"`），如需修改图标大小，两处都要改

---

## 常用命令

```bash
# 启动开发服务器
npm run dev

# 打包为单 HTML 文件（输出到 dist/index.html）
npm run build

# 提交并推送当前分支
git add <files>
git commit -m "..."
git push

# 查看当前分支
git branch --show-current

# 读取当前保存的参数（在浏览器控制台执行）
localStorage.getItem('spiderPanelParams')
```

---

## 待优化方向

- [ ] 蜘蛛腿骨架的枝叶生成逻辑与原版 spider_bg 仍有差距，可继续对齐
- [ ] 背景效果的移植精度（粒子尺寸、光束宽度、树木位置）仍可进一步微调
- [ ] 打包版的蜘蛛移动平滑度问题（固定步长 `sim.frame(16)` vs requestAnimationFrame 实际帧时间）
- [ ] 将背景参数控制面板从"始终存在于 DOM 但打包时隐藏"改为"运行时动态注入"，更干净

---

*最后更新：2026-06-21*
