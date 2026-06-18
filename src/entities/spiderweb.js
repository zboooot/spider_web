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
  var tensor = 0.3,
    stride = (2 * Math.PI) / segments,
    n = segments * depth,
    rStride = radius / n,
    i, c;

  var comp = new Composite();

  for (i = 0; i < n; ++i) {
    var theta = i * stride + Math.cos(i * 0.4) * 0.05 + Math.cos(i * 0.05) * 0.2;
    var sr = radius - rStride * i + Math.cos(i * 0.1) * 20;
    var offy = Math.cos(theta * 2.1) * (radius / depth) * 0.2;
    comp.particles.push(new Particle(new Vec2(
      origin.x + Math.cos(theta) * sr,
      origin.y + Math.sin(theta) * sr + offy
    )));
  }

  for (i = 0; i < segments; i += pinStep) comp.pin(i);

  for (i = 0; i < n - 1; ++i) {
    comp.constraints.push(new DistanceConstraint(comp.particles[i], comp.particles[i + 1], stiffness));
    var off = i + segments;
    comp.constraints.push(new DistanceConstraint(
      comp.particles[i],
      off < n - 1 ? comp.particles[off] : comp.particles[n - 1],
      stiffness
    ));
  }

  comp.constraints.push(new DistanceConstraint(comp.particles[0], comp.particles[segments - 1], stiffness));

  for (c in comp.constraints) comp.constraints[c].distance *= tensor;

  sim.composites.push(comp);
  return comp;
}
