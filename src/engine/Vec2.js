/**
 * 2D 向量类
 */
export function Vec2(x, y) {
  this.x = x || 0;
  this.y = y || 0;
}

Vec2.prototype.add = function (v) {
  return new Vec2(this.x + v.x, this.y + v.y);
};

Vec2.prototype.sub = function (v) {
  return new Vec2(this.x - v.x, this.y - v.y);
};

Vec2.prototype.scale = function (c) {
  return new Vec2(this.x * c, this.y * c);
};

Vec2.prototype.mutableSet = function (v) {
  this.x = v.x;
  this.y = v.y;
  return this;
};

Vec2.prototype.mutableAdd = function (v) {
  this.x += v.x;
  this.y += v.y;
  return this;
};

Vec2.prototype.mutableSub = function (v) {
  this.x -= v.x;
  this.y -= v.y;
  return this;
};

Vec2.prototype.mutableScale = function (c) {
  this.x *= c;
  this.y *= c;
  return this;
};

Vec2.prototype.length = function () {
  return Math.sqrt(this.x * this.x + this.y * this.y);
};

Vec2.prototype.length2 = function () {
  return this.x * this.x + this.y * this.y;
};

Vec2.prototype.dist = function (v) {
  return Math.sqrt(this.dist2(v));
};

Vec2.prototype.dist2 = function (v) {
  var x = v.x - this.x, y = v.y - this.y;
  return x * x + y * y;
};

Vec2.prototype.normal = function () {
  var m = Math.sqrt(this.x * this.x + this.y * this.y);
  if (m < 1e-9) return new Vec2(0, 0);
  return new Vec2(this.x / m, this.y / m);
};

Vec2.prototype.dot = function (v) {
  return this.x * v.x + this.y * v.y;
};

Vec2.prototype.angle = function (v) {
  return Math.atan2(this.x * v.y - this.y * v.x, this.x * v.x + this.y * v.y);
};

Vec2.prototype.angle2 = function (vL, vR) {
  return vL.sub(this).angle(vR.sub(this));
};

Vec2.prototype.rotate = function (o, t) {
  var x = this.x - o.x, y = this.y - o.y;
  return new Vec2(
    x * Math.cos(t) - y * Math.sin(t) + o.x,
    x * Math.sin(t) + y * Math.cos(t) + o.y
  );
};
