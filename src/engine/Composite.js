import { PinConstraint } from './constraints.js';

/**
 * 复合体：粒子 + 约束的集合
 */
export function Composite() {
  this.particles = [];
  this.constraints = [];
  this.drawParticles = null;
  this.drawConstraints = null;
}

Composite.prototype.pin = function (index, pos) {
  var p = this.particles[index];
  pos = pos || p.pos;
  p.pinned = true;
  p.pos.mutableSet(pos);
  p.lastPos.mutableSet(pos);
  var pc = new PinConstraint(p, pos);
  this.constraints.push(pc);
  return pc;
};
