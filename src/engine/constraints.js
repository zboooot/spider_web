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

var _dcScratch = new Vec2();

DistanceConstraint.prototype.relax = function (sc) {
  _dcScratch.x = this.a.pos.x - this.b.pos.x;
  _dcScratch.y = this.a.pos.y - this.b.pos.y;
  var m = _dcScratch.x * _dcScratch.x + _dcScratch.y * _dcScratch.y;
  if (m < 1e-12) return;
  var s = ((this.distance * this.distance - m) / m) * this.stiffness * sc;
  _dcScratch.x *= s;
  _dcScratch.y *= s;
  this.a.pos.x += _dcScratch.x;
  this.a.pos.y += _dcScratch.y;
  this.b.pos.x -= _dcScratch.x;
  this.b.pos.y -= _dcScratch.y;
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
  this.angle = Vec2.angleAt(
    this.b.pos.x, this.b.pos.y,
    this.a.pos.x, this.a.pos.y,
    this.c.pos.x, this.c.pos.y
  );
  this.stiffness = stiffness;
}

AngleConstraint.prototype.relax = function (sc) {
  var angle = Vec2.angleAt(
    this.b.pos.x, this.b.pos.y,
    this.a.pos.x, this.a.pos.y,
    this.c.pos.x, this.c.pos.y
  );
  var diff = angle - this.angle;
  if (diff <= -Math.PI) diff += 2 * Math.PI;
  else if (diff >= Math.PI) diff -= 2 * Math.PI;
  diff *= sc * this.stiffness;
  this.a.pos.mutableRotate(this.b.pos, diff);
  this.c.pos.mutableRotate(this.b.pos, -diff);
  this.b.pos.mutableRotate(this.a.pos, diff);
  this.b.pos.mutableRotate(this.c.pos, -diff);
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
