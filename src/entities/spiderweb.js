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
 * @param {number} stiffness - 刚度
 * @param {number} pinStep - 固定点间隔
 * @returns {Composite}
 */
export function createSpiderweb(sim, origin, radius, segments, depth, stiffness, pinStep) {
  stiffness = stiffness || 0.6;
  pinStep = pinStep || 4;
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
    /* 螺旋线 */
    comp.constraints.push(new DistanceConstraint(comp.particles[i], comp.particles[i + 1], stiffness));
    /* 径向线：最内有效圈连到 hub，其余连到下一圈 */
    var off = i + segments;
    if (off < n) {
      comp.constraints.push(new DistanceConstraint(comp.particles[i], comp.particles[off], stiffness));
    } else {
      comp.constraints.push(new DistanceConstraint(comp.particles[i], hub, stiffness));
    }
  }
  /* 最内圈最后一个粒子的径向线补上 */
  comp.constraints.push(new DistanceConstraint(comp.particles[n - 1], hub, stiffness));

  /* 闭合最外圈 */
  comp.constraints.push(new DistanceConstraint(comp.particles[0], comp.particles[segments - 1], stiffness));

  for (c in comp.constraints) comp.constraints[c].distance *= tensor;

  comp.__isWeb = true;
  sim.composites.push(comp);
  return comp;
}
