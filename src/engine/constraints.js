import { Vec2 } from './Vec2.js';

/**
 * 距离约束
 */
export function DistanceConstraint(a, b, stiffness, distance) {
  this.a = a;
  this.b = b;
  this.distance = typeof distance != "undefined" ? distance : a.pos.sub(b.pos).length();
  this.stiffness = stiffness;
}

DistanceConstraint.prototype.relax = function (sc) {
  var n = this.a.pos.sub(this.b.pos), m = n.length2();
  n.mutableScale(((this.distance * this.distance - m) / m) * this.stiffness * sc);
  this.a.pos.mutableAdd(n);
  this.b.pos.mutableSub(n);
};

DistanceConstraint.prototype.draw = function (ctx) {
  ctx.beginPath();
  ctx.moveTo(this.a.pos.x, this.a.pos.y);
  ctx.lineTo(this.b.pos.x, this.b.pos.y);
  ctx.strokeStyle = "#d8dde2";
  ctx.stroke();
};

/**
 * 钉住约束（固定点）
 */
export function PinConstraint(a, pos) {
  this.a = a;
  this.pos = (new Vec2()).mutableSet(pos);
}

PinConstraint.prototype.relax = function () {
  this.a.pos.mutableSet(this.pos);
};

PinConstraint.prototype.draw = function (ctx) {
  ctx.beginPath();
  ctx.arc(this.pos.x, this.pos.y, 6, 0, 2 * Math.PI);
  ctx.fillStyle = "rgba(0,153,255,0.1)";
  ctx.fill();
};

/**
 * 角度约束
 */
export function AngleConstraint(a, b, c, stiffness) {
  this.a = a;
  this.b = b;
  this.c = c;
  this.angle = this.b.pos.angle2(this.a.pos, this.c.pos);
  this.stiffness = stiffness;
}

AngleConstraint.prototype.relax = function (sc) {
  var angle = this.b.pos.angle2(this.a.pos, this.c.pos);
  var diff = angle - this.angle;
  if (diff <= -Math.PI) diff += 2 * Math.PI;
  else if (diff >= Math.PI) diff -= 2 * Math.PI;
  diff *= sc * this.stiffness;
  this.a.pos = this.a.pos.rotate(this.b.pos, diff);
  this.c.pos = this.c.pos.rotate(this.b.pos, -diff);
  this.b.pos = this.b.pos.rotate(this.a.pos, diff);
  this.b.pos = this.b.pos.rotate(this.c.pos, -diff);
};

AngleConstraint.prototype.draw = function (ctx) {
  ctx.beginPath();
  ctx.moveTo(this.a.pos.x, this.a.pos.y);
  ctx.lineTo(this.b.pos.x, this.b.pos.y);
  ctx.lineTo(this.c.pos.x, this.c.pos.y);
  var t = ctx.lineWidth;
  ctx.lineWidth = 5;
  ctx.strokeStyle = "rgba(255,255,0,0.2)";
  ctx.stroke();
  ctx.lineWidth = t;
};
