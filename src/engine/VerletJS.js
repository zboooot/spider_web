import { Vec2 } from './Vec2.js';
import { Composite } from './Composite.js';
import { PinConstraint } from './constraints.js';

/**
 * Verlet 物理引擎主类
 */
export function VerletJS(width, height, canvas) {
  this.width = width;
  this.height = height;
  this.canvas = canvas;
  this.ctx = canvas.getContext("2d");
  this.mouse = new Vec2(0, 0);
  this.mouseDown = false;
  this.draggedEntity = null;
  this.selectionRadius = 20;
  this.highlightColor = "#4f545c";

  var _this = this;

  this.bounds = function (p) {
    if (p.pos.y > this.height - 1) p.pos.y = this.height - 1;
    if (p.pos.x < 0) p.pos.x = 0;
    if (p.pos.x > this.width - 1) p.pos.x = this.width - 1;
  };

  this.canvas.oncontextmenu = function (e) { e.preventDefault(); };

  this.canvas.onmousedown = function () {
    _this.mouseDown = true;
    var n = _this.nearestEntity();
    if (n) _this.draggedEntity = n;
  };

  this.canvas.onmouseup = function () {
    _this.mouseDown = false;
    _this.draggedEntity = null;
  };

  this.canvas.onmousemove = function (e) {
    var r = _this.canvas.getBoundingClientRect();
    _this.mouse.x = (e.clientX - r.left) * (_this.width / r.width);
    _this.mouse.y = (e.clientY - r.top) * (_this.height / r.height);
  };

  this.canvas.addEventListener('touchstart', function (e) {
    e.preventDefault();
    _this.mouseDown = true;
    var r = _this.canvas.getBoundingClientRect(), t = e.touches[0];
    _this.mouse.x = (t.clientX - r.left) * (_this.width / r.width);
    _this.mouse.y = (t.clientY - r.top) * (_this.height / r.height);
    var n = _this.nearestEntity();
    if (n) _this.draggedEntity = n;
  }, { passive: false });

  this.canvas.addEventListener('touchend', function (e) {
    e.preventDefault();
    _this.mouseDown = false;
    _this.draggedEntity = null;
  }, { passive: false });

  this.canvas.addEventListener('touchmove', function (e) {
    e.preventDefault();
    var r = _this.canvas.getBoundingClientRect(), t = e.touches[0];
    _this.mouse.x = (t.clientX - r.left) * (_this.width / r.width);
    _this.mouse.y = (t.clientY - r.top) * (_this.height / r.height);
  }, { passive: false });

  this.gravity = new Vec2(0, 0.2);
  this.friction = 0.99;
  this.groundFriction = 0.8;
  this.composites = [];
}

VerletJS.prototype.Composite = Composite;

VerletJS.prototype.frame = function (step) {
  var i, j, c;
  for (c in this.composites) {
    for (i in this.composites[c].particles) {
      var pts = this.composites[c].particles;
      var vel = pts[i].pos.sub(pts[i].lastPos).scale(this.friction);
      if (pts[i].pos.y >= this.height - 1 && vel.length2() > 0.000001) {
        var m = vel.length();
        vel.x /= m; vel.y /= m;
        vel.mutableScale(m * this.groundFriction);
      }
      pts[i].lastPos.mutableSet(pts[i].pos);
      pts[i].pos.mutableAdd(this.gravity);
      pts[i].pos.mutableAdd(vel);
    }
  }
  if (this.draggedEntity) this.draggedEntity.pos.mutableSet(this.mouse);
  var sc = 1 / step;
  for (c in this.composites) {
    var cs = this.composites[c].constraints;
    for (i = 0; i < step; ++i)
      for (j in cs) cs[j].relax(sc);
  }
  for (c in this.composites) {
    var ps = this.composites[c].particles;
    for (i in ps) this.bounds(ps[i]);
  }
};

VerletJS.prototype.draw = function () {
  var i, c;
  /* 透明画布 — 让底层 sylvan 背景层透出 */
  this.ctx.clearRect(0, 0, this.width, this.height);
  for (c in this.composites) {
    if (this.composites[c].drawConstraints)
      this.composites[c].drawConstraints(this.ctx, this.composites[c]);
    else {
      var cs = this.composites[c].constraints;
      for (i in cs) cs[i].draw(this.ctx);
    }
    if (this.composites[c].drawParticles)
      this.composites[c].drawParticles(this.ctx, this.composites[c]);
    else {
      var ps = this.composites[c].particles;
      for (i in ps) ps[i].draw(this.ctx);
    }
  }
  var nearest = this.draggedEntity || this.nearestEntity();
  if (nearest) {
    this.ctx.beginPath();
    this.ctx.arc(nearest.pos.x, nearest.pos.y, 8, 0, 2 * Math.PI);
    this.ctx.strokeStyle = this.highlightColor;
    this.ctx.stroke();
  }
};

VerletJS.prototype.nearestEntity = function () {
  var c, i, d2N = 0, entity = null, csN = null;
  for (c in this.composites) {
    var ps = this.composites[c].particles;
    for (i in ps) {
      var d2 = ps[i].pos.dist2(this.mouse);
      if (d2 <= this.selectionRadius * this.selectionRadius && (entity == null || d2 < d2N)) {
        entity = ps[i];
        csN = this.composites[c].constraints;
        d2N = d2;
      }
    }
  }
  for (i in csN) {
    if (csN[i] instanceof PinConstraint && csN[i].a == entity) {
      return null;
    }
  }
  return entity;
};
