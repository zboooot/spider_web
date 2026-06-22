import { Vec2 } from './Vec2.js';
import { Composite } from './Composite.js';
import { PinConstraint, DistanceConstraint } from './constraints.js';
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
  this.snapTarget = null;       /* 当前吸附的存活节点 */
  this.snapRadius = 28;         /* 吸附触发距离（由 P.stubSnapRadius 覆盖） */
  this.stubReachRadius = 200;   /* stub 拖拽最大范围（由 P.stubReachRadius 覆盖） */
  this.onRepairDrop = null;     /* 回调：function(stub, snapTarget) */
  this.selectionRadius = 20;
  this.highlightColor = "#4f545c";

  var _this = this;

  this.bounds = function (p) {
    if (p.__isBug) return; /* 苍蝇不受边界约束，由环绕逻辑处理 */
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
    if (_this.draggedEntity && _this.draggedEntity.__isWebParticle && _this.snapTarget && _this.onRepairDrop) {
      _this.onRepairDrop(_this.draggedEntity, _this.snapTarget);
    }
    _this.draggedEntity = null;
    _this.snapTarget = null;
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
    if (_this.draggedEntity && _this.draggedEntity.__isWebParticle && _this.snapTarget && _this.onRepairDrop) {
      _this.onRepairDrop(_this.draggedEntity, _this.snapTarget);
    }
    _this.draggedEntity = null;
    _this.snapTarget = null;
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
    var comp = this.composites[c];
    /* 仅蛛网受重力；蜘蛛等其余复合体仍做 Verlet 积分以保留关节惯性 */
    var gx = (!gravComp || comp === gravComp) ? gX : 0;
    var gy = (!gravComp || comp === gravComp) ? gY : 0;
    var pts = comp.particles;
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
      p.pos.x += gx + velX;
      p.pos.y += gy + velY;
    }
  }
  if (this.draggedEntity) {
    var _dp = this.draggedEntity.pos;
    _dp.x += (this.mouse.x - _dp.x) * 0.08;
    _dp.y += (this.mouse.y - _dp.y) * 0.08;
    this.snapTarget = null;
    /* 断线头拖拽时：检测附近存活网节点，吸附 */
    if (this.draggedEntity.__isWebParticle && this.draggedEntity.__isStub) {
      var c, i;
      /* 找到 stub 的锚点，吸附时排除它 */
      var stubAnchorPt = null;
      for (c in this.composites) {
        if (!this.composites[c].__isWeb) continue;
        var acs = this.composites[c].constraints;
        for (i = 0; i < acs.length; i++) {
          if (!acs[i].__isStubAnchor) continue;
          if (acs[i].a === this.draggedEntity) { stubAnchorPt = acs[i].b; break; }
          if (acs[i].b === this.draggedEntity) { stubAnchorPt = acs[i].a; break; }
        }
        if (stubAnchorPt) break;
      }
      /* 限制拖拽范围：以锚点为圆心 */
      var reachR = this.stubReachRadius;
      var reachR2 = reachR * reachR;
      if (stubAnchorPt) {
        var adx = this.draggedEntity.pos.x - stubAnchorPt.pos.x;
        var ady = this.draggedEntity.pos.y - stubAnchorPt.pos.y;
        var ad2 = adx * adx + ady * ady;
        if (ad2 > reachR2) {
          var ad = Math.sqrt(ad2);
          this.draggedEntity.pos.x = stubAnchorPt.pos.x + (adx / ad) * reachR;
          this.draggedEntity.pos.y = stubAnchorPt.pos.y + (ady / ad) * reachR;
        }
      }

      var snap = null, snapD2 = this.snapRadius * this.snapRadius;
      for (c in this.composites) {
        if (!this.composites[c].__isWeb) continue;
        var wps = this.composites[c].particles;
        var wcs = this.composites[c].constraints;
        for (i = 0; i < wps.length; i++) {
          var wp = wps[i];
          if (wp === this.draggedEntity) continue;
          if (wp === stubAnchorPt) continue;
          if (stubAnchorPt && wp.pos.dist2(stubAnchorPt.pos) > reachR2) continue;
          var wConn = 0;
          for (var wi = 0; wi < wcs.length; wi++) {
            if (!(wcs[wi] instanceof DistanceConstraint)) continue;
            if (wcs[wi].__isStubAnchor) continue;
            if (wcs[wi].a === wp || wcs[wi].b === wp) wConn++;
          }
          if (wConn < 2) continue;
          var wd2 = wp.pos.dist2(this.draggedEntity.pos);
          if (wd2 < snapD2) { snapD2 = wd2; snap = wp; }
        }
      }
      this.snapTarget = snap;
      if (snap) this.draggedEntity.pos.mutableSet(snap.pos);
    }
  }
};

VerletJS.prototype._relaxConstraints = function (iters, aliveCheck, sc) {
  var i, j, c;
  if (sc == null) sc = 1 / iters;
  var _dragging = this.draggedEntity;
  for (c in this.composites) {
    var cs = this.composites[c].constraints;
    for (i = 0; i < iters; ++i) {
      for (j in cs) {
        var con = cs[j];
        /* 拖拽 stub 时跳过它的锚定边，避免被拉回去 */
        if (_dragging && con.__isStubAnchor && (con.a === _dragging || con.b === _dragging)) continue;
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
  var c, i, d2N = 0, entity = null, csN = null, entityComp = null;
  for (c in this.composites) {
    var ps = this.composites[c].particles;
    for (i in ps) {
      if (ps[i]._noSimDrag) continue;
      var d2 = ps[i].pos.dist2(this.mouse);
      if (d2 <= this.selectionRadius * this.selectionRadius && (entity == null || d2 < d2N)) {
        entity = ps[i];
        csN = this.composites[c].constraints;
        entityComp = this.composites[c];
        d2N = d2;
      }
    }
  }
  if (!entity) return null;
  /* 锚点不可拖 */
  for (i in csN) {
    if (csN[i] instanceof PinConstraint && csN[i].a == entity) return null;
  }
  /* 网线粒子：只有断线头（连接数==1）可拖，完整节点（>=2）不可拖 */
  if (entityComp && entityComp.__isWeb) {
    var connCount = 0;
    for (i in csN) {
      if (csN[i] instanceof PinConstraint) continue;
      if (csN[i].a === entity || csN[i].b === entity) connCount++;
    }
    if (connCount >= 2) return null;
    if (!entity.__isStub) return null; /* 只有 stub 可拖拽 */
    entity.__isWebParticle = true; /* 标记断线头粒子，供子弹时间检测 */
  } else {
    entity.__isWebParticle = false;
    return null; /* 玩家不允许拖拽蜘蛛或其他非网实体 */
  }
  return entity;
};
