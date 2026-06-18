import { Vec2 } from '../engine/Vec2.js';
import { Particle } from '../engine/Particle.js';
import { DistanceConstraint, AngleConstraint } from '../engine/constraints.js';
import { Composite } from '../engine/Composite.js';

/**
 * 生成蜘蛛复合体（4腿）
 * @param {VerletJS} sim - 物理引擎实例
 * @param {Vec2} origin - 初始位置
 * @param {Object} P - 参数 {legStiff, jointStiff}
 * @returns {Composite}
 */
export function createSpider(sim, origin, P) {
  P = P || {};
  var ls = P.legStiff != null ? P.legStiff : 0.3;
  var js = P.jointStiff != null ? P.jointStiff : 0.35;

  var comp = new Composite();
  comp.legs = [];
  comp.legChains = [];

  comp.thorax = new Particle(origin);
  comp.head = new Particle(origin.add(new Vec2(0, -6)));
  comp.abdomen = new Particle(origin.add(new Vec2(0, 12)));

  comp.particles.push(comp.thorax);
  comp.particles.push(comp.head);
  comp.particles.push(comp.abdomen);

  comp.constraints.push(new DistanceConstraint(comp.head, comp.thorax, 1));
  comp.constraints.push(new DistanceConstraint(comp.abdomen, comp.thorax, 1));
  comp.constraints.push(new AngleConstraint(comp.abdomen, comp.thorax, comp.head, 0.4));

  function addLeg(points, lc) {
    var p1 = new Particle(comp.thorax.pos.add(new Vec2(points[0][0] * lc, points[0][1] * lc)));
    var p2 = new Particle(comp.thorax.pos.add(new Vec2(points[1][0] * lc, points[1][1] * lc)));
    var p3 = new Particle(comp.thorax.pos.add(new Vec2(points[2][0] * lc, points[2][1] * lc)));
    var p4 = new Particle(comp.thorax.pos.add(new Vec2(points[3][0] * lc, points[3][1] * lc)));
    var foot = new Particle(comp.thorax.pos.add(new Vec2(points[4][0] * lc, points[4][1] * lc)));

    comp.particles.push(p1, p2, p3, p4, foot);
    comp.legs.push(foot);
    comp.legChains.push([p1, p2, p3, p4, foot]);

    comp.constraints.push(new DistanceConstraint(comp.thorax, p1, ls));
    comp.constraints.push(new DistanceConstraint(p1, p2, ls));
    comp.constraints.push(new DistanceConstraint(p2, p3, ls));
    comp.constraints.push(new DistanceConstraint(p3, p4, ls));
    comp.constraints.push(new DistanceConstraint(p4, foot, ls));

    var jBase = js * 1.2;
    var jMid = js * 0.95;
    var jTip = js * 0.8;
    comp.constraints.push(new AngleConstraint(comp.thorax, p1, p2, jBase));
    comp.constraints.push(new AngleConstraint(p1, p2, p3, jMid));
    comp.constraints.push(new AngleConstraint(p2, p3, p4, jMid));
    comp.constraints.push(new AngleConstraint(p3, p4, foot, jTip));
    comp.constraints.push(new AngleConstraint(comp.head, comp.thorax, p1, 1));
  }

  var legShapes = [
    [[6, 1], [10, -6], [15, -9], [18, -6], [16, -1]],
    [[-6, 1], [-10, -6], [-15, -9], [-18, -6], [-16, -1]],
    [[7, 6], [11, 10], [15, 11], [17, 9], [15, 4]],
    [[-7, 6], [-11, 10], [-15, 11], [-17, 9], [-15, 4]]
  ];
  for (var i = 0; i < legShapes.length; i++) {
    addLeg(legShapes[i], i < 2 ? 0.95 : 1.0);
  }

  sim.composites.push(comp);
  return comp;
}
