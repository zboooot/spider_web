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
  return new Vec2(this.x / m, this.y / m);
};

Vec2.prototype.dot = function (v) {
  return this.x * v.x + this.y * v.y;
};

Vec2.prototype.angle = function (v) {
  return Math.atan2(this.x * v.y - this.y * v.x, this.x * v.x + this.y * v.y);
};

Vec2.prototype.angle2 = function (vL, vR) {
  return Vec2.angleAt(this.x, this.y, vL.x, vL.y, vR.x, vR.y);
};

/** 顶点 b 处，从 ba 到 bc 的夹角（无分配） */
Vec2.angleAt = function (bx, by, ax, ay, cx, cy) {
  var lx = ax - bx, ly = ay - by;
  var rx = cx - bx, ry = cy - by;
  return Math.atan2(lx * ry - ly * rx, lx * rx + ly * ry);
};

Vec2.prototype.rotate = function (o, t) {
  var x = this.x - o.x, y = this.y - o.y;
  return new Vec2(
    x * Math.cos(t) - y * Math.sin(t) + o.x,
    x * Math.sin(t) + y * Math.cos(t) + o.y
  );
};

/** 绕原点 o 旋转 t 弧度，原地修改 */
Vec2.prototype.mutableRotate = function (o, t) {
  var x = this.x - o.x, y = this.y - o.y;
  var cos = Math.cos(t), sin = Math.sin(t);
  this.x = x * cos - y * sin + o.x;
  this.y = x * sin + y * cos + o.y;
  return this;
};
