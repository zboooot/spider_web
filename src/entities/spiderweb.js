import { Vec2 } from '../engine/Vec2.js';
import { Particle } from '../engine/Particle.js';
import { DistanceConstraint } from '../engine/constraints.js';
import { Composite } from '../engine/Composite.js';

/**
 * 生成蜘蛛网复合体
 * @param {VerletJS} sim - 物理引擎实例
 * @param {Vec2} origin - 网中心
 * @param {number} radius - 半径
 * @param {number} segments - 辐射节点数
 * @param {number} depth - 圈数
 * @param {number} stiffness - 基础刚度（径向承重丝用此为基准）
 * @param {number} pinStep - 固定点间隔
 * @param {object} [opts] - 可选扩展参数
 * @param {number} [opts.radialStiffnessMul=1.4]  - 径向承重丝刚度倍率
 * @param {number} [opts.spiralStiffnessMul=0.85] - 环向捕捉丝刚度倍率
 * @param {number} [opts.radialTensorMul=0.85]    - 径向承重丝 tensor 倍率（<1 更紧）
 * @param {number} [opts.spiralTensorMul=1.0]     - 环向捕捉丝 tensor 倍率
 * @param {number} [opts.centerTensionBoost=0.08] - 靠近中心时额外预张力增强（0=关闭）
 * @returns {Composite}
 */
export function createSpiderweb(sim, origin, radius, segments, depth, stiffness, pinStep, opts) {
  stiffness = stiffness || 0.6;
  pinStep = pinStep || 4;
  opts = opts || {};
  var radialStiffnessMul  = opts.radialStiffnessMul  != null ? opts.radialStiffnessMul  : 1.4;
  var spiralStiffnessMul  = opts.spiralStiffnessMul  != null ? opts.spiralStiffnessMul  : 0.85;
  var radialTensorMul     = opts.radialTensorMul     != null ? opts.radialTensorMul     : 0.85;
  var spiralTensorMul     = opts.spiralTensorMul     != null ? opts.spiralTensorMul     : 1.0;
  var centerTensionBoost  = opts.centerTensionBoost  != null ? opts.centerTensionBoost  : 0.08;
  var SKIP_INNER = 2; /* 最内2圈不生成粒子和螺旋线，径向线汇聚到hub */
  var effectiveDepth = Math.max(2, depth - SKIP_INNER);
  var tensor = 0.3,
    stride = (2 * Math.PI) / segments,
    n = segments * effectiveDepth,
    rStride = radius / (segments * depth), /* 保持原半径步长比例 */
    i, c;

  var comp = new Composite();

  /* ── 只生成有效圈的粒子（最内SKIP_INNER圈不生成） ── */
  for (i = 0; i < n; ++i) {
    var theta = i * stride + Math.cos(i * 0.4) * 0.05 + Math.cos(i * 0.05) * 0.2;
    var sr = radius - rStride * i + Math.cos(i * 0.1) * 20;
    var offy = Math.cos(theta * 2.1) * (radius / depth) * 0.2;
    comp.particles.push(new Particle(new Vec2(
      origin.x + Math.cos(theta) * sr,
      origin.y + Math.sin(theta) * sr + offy
    )));
  }

  /* ── 中心 hub（不固定，随物理振动） ── */
  var hub = new Particle(new Vec2(origin.x, origin.y));
  comp.particles.push(hub);

  /* ── 锚点：外圈每隔 pinStep 固定 ── */
  for (i = 0; i < segments; i += pinStep) comp.pin(i);

  /* ── 约束：螺旋线 + 径向线 ── */
  for (i = 0; i < n - 1; ++i) {
    /* ── 环向捕捉丝：粒子 i → i+1（同圈内相邻）──────────────────── */
    var sc = new DistanceConstraint(comp.particles[i], comp.particles[i + 1], stiffness * spiralStiffnessMul);
    sc.isRadial = false;
    comp.constraints.push(sc);

    /* ── 径向承重丝：粒子 i → i+segments（跨圈，沿辐射方向）──────── */
    var off = i + segments;
    var rc = new DistanceConstraint(
      comp.particles[i],
      off < n ? comp.particles[off] : hub,
      stiffness * radialStiffnessMul
    );
    rc.isRadial = true;
    /* 当前粒子所在圈层（0=最外圈，effectiveDepth-1=最内有效圈），归一化到 0~1 */
    rc._ringDepth = Math.floor(i / segments) / Math.max(1, effectiveDepth - 1);
    comp.constraints.push(rc);
  }
  /* 最内圈最后一个粒子的径向线补上 */
  var hubLink = new DistanceConstraint(comp.particles[n - 1], hub, stiffness * radialStiffnessMul);
  hubLink.isRadial = true;
  hubLink._ringDepth = 1;
  comp.constraints.push(hubLink);

  /* 闭合最外圈的环向丝 */
  var closure = new DistanceConstraint(comp.particles[0], comp.particles[segments - 1], stiffness * spiralStiffnessMul);
  closure.isRadial = false;
  comp.constraints.push(closure);

  /* ── 按角色应用 tensor（rest length 缩放） ──────────────────────── */
  for (c in comp.constraints) {
    var con = comp.constraints[c];
    if (con.isRadial) {
      /* 径向承重丝：更紧；靠近中心（_ringDepth 接近 1）额外略收紧 */
      var boost = centerTensionBoost * (con._ringDepth || 0);
      con.distance *= tensor * radialTensorMul * (1 - boost);
    } else {
      /* 环向捕捉丝：保持标准松弛 */
      con.distance *= tensor * spiralTensorMul;
    }
  }

  comp.__isWeb = true;
  sim.composites.push(comp);
  return comp;
}
