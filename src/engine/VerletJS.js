import { Vec2 } from './Vec2.js';
import { Composite } from './Composite.js';
import { PinConstraint } from './constraints.js';
import { statsDc } from '../debug/renderStats.js';

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
    if (p.pos.y < 0) p.pos.y = 0;
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
  /** 仅对该复合体施加重力积分（蜘蛛/猎物由脚本驱动） */
  this.gravityComposite = null;
}

VerletJS.prototype.Composite = Composite;

function _constraintAlive(con, aliveCheck) {
  if (!aliveCheck) return true;
  if (con.__webId && !aliveCheck(con)) return false;
  return true;
}

VerletJS.prototype._integrateParticles = function (gX, gY) {
  var i, c;
  var friction = this.friction, gndFric = this.groundFriction, h = this.height - 1;
  var gravComp = this.gravityComposite;
  for (c in this.composites) {
    if (gravComp && this.composites[c] !== gravComp) continue;
    var pts = this.composites[c].particles;
    for (i in pts) {
      var p = pts[i];
      var velX = (p.pos.x - p.lastPos.x) * friction;
      var velY = (p.pos.y - p.lastPos.y) * friction;
      if (p.pos.y >= h) {
        var m2 = velX * velX + velY * velY;
        if (m2 > 0.000001) {
          var m = Math.sqrt(m2);
          var scale = gndFric;
          velX = velX / m * scale;
          velY = velY / m * scale;
        }
      }
      p.lastPos.x = p.pos.x;
      p.lastPos.y = p.pos.y;
      p.pos.x += gX + velX;
      p.pos.y += gY + velY;
    }
  }
  if (this.draggedEntity) this.draggedEntity.pos.mutableSet(this.mouse);
};

VerletJS.prototype._relaxConstraints = function (iters, aliveCheck, sc) {
  var i, j, c;
  if (sc == null) sc = 1 / iters;
  for (c in this.composites) {
    var cs = this.composites[c].constraints;
    for (i = 0; i < iters; ++i) {
      for (j in cs) {
        var con = cs[j];
        if (!_constraintAlive(con, aliveCheck)) continue;
        con.relax(sc);
      }
    }
  }
};

VerletJS.prototype._applyBounds = function () {
  var i, c;
  for (c in this.composites) {
    var ps = this.composites[c].particles;
    for (i in ps) this.bounds(ps[i]);
  }
};

VerletJS.prototype.clampCompositeVelocity = function (comp, vMax) {
  if (!comp || !vMax) return;
  var v2max = vMax * vMax;
  var pts = comp.particles;
  for (var i in pts) {
    var p = pts[i];
    var vx = p.pos.x - p.lastPos.x;
    var vy = p.pos.y - p.lastPos.y;
    var v2 = vx * vx + vy * vy;
    if (v2 > v2max) {
      var s = vMax / Math.sqrt(v2);
      p.lastPos.x = p.pos.x - vx * s;
      p.lastPos.y = p.pos.y - vy * s;
    }
  }
};

VerletJS.prototype.frame = function (step, aliveCheck) {
  this._integrateParticles(this.gravity.x, this.gravity.y);
  this._relaxConstraints(step, aliveCheck);
  this._applyBounds();
};

/**
 * Phase C：多子步 × 少迭代，刚度优于单步多迭代
 */
VerletJS.prototype.frameSubsteps = function (substeps, itersPerSubstep, opts) {
  opts = opts || {};
  var aliveCheck = opts.aliveCheck;
  var gX = this.gravity.x / substeps;
  var gY = this.gravity.y / substeps;
  /* 总校正量 ≈ substeps×iters×sc ≈ 1，与单步 frame(step) 的 step×(1/step) 对齐 */
  var sc = 1 / (substeps * itersPerSubstep);
  for (var s = 0; s < substeps; s++) {
    this._integrateParticles(gX, gY);
    this._relaxConstraints(itersPerSubstep, aliveCheck, sc);
  }
  this._applyBounds();
  if (opts.clampComposite && opts.vMax) {
    this.clampCompositeVelocity(opts.clampComposite, opts.vMax);
  }
};

VerletJS.prototype.draw = function () {
  var i, c;
  /* 透明画布 — 让底层 sylvan 背景层透出 */
  this.ctx.clearRect(0, 0, this.width, this.height);
  statsDc('clear');
  for (c in this.composites) {
    if (this.composites[c].deferDraw) continue;
    if (this.composites[c].drawConstraints)
      this.composites[c].drawConstraints(this.ctx, this.composites[c]);
    else {
      var cs = this.composites[c].constraints;
      for (i in cs) {
        cs[i].draw(this.ctx);
        statsDc('line');
      }
    }
    if (this.composites[c].drawParticles)
      this.composites[c].drawParticles(this.ctx, this.composites[c]);
    else {
      var ps = this.composites[c].particles;
      for (i in ps) {
        ps[i].draw(this.ctx);
        statsDc('arc');
      }
    }
  }
  var nearest = this.draggedEntity || this.nearestEntity();
  if (nearest) {
    this.ctx.beginPath();
    this.ctx.arc(nearest.pos.x, nearest.pos.y, 8, 0, 2 * Math.PI);
    this.ctx.strokeStyle = this.highlightColor;
    this.ctx.stroke();
    statsDc('stroke');
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
