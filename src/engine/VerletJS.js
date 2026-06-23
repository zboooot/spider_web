import { Vec2 } from './Vec2.js';
import { Composite } from './Composite.js';
import { PinConstraint, DistanceConstraint } from './constraints.js';
import { statsDc } from '../debug/renderStats.js';

export function pickNearestSnapCandidate(candidates) {
  if (!candidates || !candidates.length) return null;
  var best = null;
  var bestScore = Infinity;
  for (var i = 0; i < candidates.length; i++) {
    var entry = candidates[i];
    if (!entry || !entry.pt || !entry.pt.pos) continue;
    if (entry.d2 < bestScore) {
      bestScore = entry.d2;
      best = entry;
    }
  }
  return best;
}

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
  this.snapCandidates = [];     /* 当前可连线候选节点 */
  this.snapRadius = 28;         /* 吸附触发距离（由 P.stubSnapRadius 覆盖） */
  this.stubReachRadius = 200;   /* stub 拖拽最大范围（由 P.stubReachRadius 覆盖） */
  this.onRepairDrop = null;     /* 回调：function(stub, snapTarget) */
  this.selectionRadius = 20;
  this.stubSelectionRadius = 44; /* stub 专用选中半径，适配移动端手指 */
  this.webTugRadius = 52;        /* 完整网线拖拽的选中线段半径 */
  this.webTugStrength = 0.36;    /* 主节点拖拽跟随强度 */
  this.webTugNeighborHops = 2;   /* 连带拉扯的跳数 */
  this.webTugNeighborFalloff = 0.54; /* 每跳力度衰减 */
  this.webTugSpreadRadius = 110;  /* 以指针为中心的影响半径 */
  this.suppressClick = false;    /* stub 拖拽后抑制本次 click/tap */
  this.highlightColor = "#4f545c";
  this._dragPressX = 0;
  this._dragPressY = 0;
  this._didPointerDrag = false;
  this._dragThreshold = 10;

  var _this = this;

  function _notePointerDrag(x, y) {
    if (!_this.mouseDown || _this._didPointerDrag) return;
    var dx = x - _this._dragPressX;
    var dy = y - _this._dragPressY;
    if (dx * dx + dy * dy >= _this._dragThreshold * _this._dragThreshold) {
      _this._didPointerDrag = true;
    }
  }

  this.bounds = function (p) {
    if (p.__isBug || p.__ignoreBounds) return; /* 特殊对象不受边界约束 */
    if (p.pos.y < 0) p.pos.y = 0;
    if (p.pos.y > this.height - 1) p.pos.y = this.height - 1;
    if (p.pos.x < 0) p.pos.x = 0;
    if (p.pos.x > this.width - 1) p.pos.x = this.width - 1;
  };

  this.canvas.oncontextmenu = function (e) { e.preventDefault(); };

  this.canvas.onmousedown = function (e) {
    var r = _this.canvas.getBoundingClientRect();
    _this.mouse.x = (e.clientX - r.left) * (_this.width / r.width);
    _this.mouse.y = (e.clientY - r.top) * (_this.height / r.height);
    _this.mouseDown = true;
    _this._dragPressX = _this.mouse.x;
    _this._dragPressY = _this.mouse.y;
    _this._didPointerDrag = false;
    var n = _this.nearestEntity();
    if (n) {
      _this.draggedEntity = n;
      if (_this.onDragStart) _this.onDragStart(n);
    }
  };

  this.canvas.onmouseup = function () {
    _this.mouseDown = false;
    if (_this.draggedEntity && _this.draggedEntity.__isStub) {
      if (_this._didPointerDrag) {
        _this.suppressClick = true; /* 拖拽 stub 后抑制本次 click */
        if (_this.draggedEntity.__isWebParticle && _this.snapTarget && _this.onRepairDrop) {
          _this.onRepairDrop(_this.draggedEntity, _this.snapTarget);
        }
      }
    } else if (_this.draggedEntity && _this.draggedEntity.__isWebTug) {
      if (_this._didPointerDrag) _this.suppressClick = true;
      _this.draggedEntity.__isWebTug = false;
    }
    _this.draggedEntity = null;
    _this.snapTarget = null;
    _this.snapCandidates.length = 0;
    _this._didPointerDrag = false;
  };

  this.canvas.onmousemove = function (e) {
    var r = _this.canvas.getBoundingClientRect();
    _this.mouse.x = (e.clientX - r.left) * (_this.width / r.width);
    _this.mouse.y = (e.clientY - r.top) * (_this.height / r.height);
    _notePointerDrag(_this.mouse.x, _this.mouse.y);
  };

  this.canvas.addEventListener('touchstart', function (e) {
    e.preventDefault();
    _this.mouseDown = true;
    var r = _this.canvas.getBoundingClientRect(), t = e.touches[0];
    _this.mouse.x = (t.clientX - r.left) * (_this.width / r.width);
    _this.mouse.y = (t.clientY - r.top) * (_this.height / r.height);
    _this._dragPressX = _this.mouse.x;
    _this._dragPressY = _this.mouse.y;
    _this._didPointerDrag = false;
    var n = _this.nearestEntity();
    if (n) {
      _this.draggedEntity = n;
      if (_this.onDragStart) _this.onDragStart(n);
    }
  }, { passive: false });

  this.canvas.addEventListener('touchend', function (e) {
    e.preventDefault();
    _this.mouseDown = false;
    if (_this.draggedEntity && _this.draggedEntity.__isStub) {
      if (_this._didPointerDrag) {
        _this.suppressClick = true; /* 拖拽 stub 后抑制本次 tap */
        if (_this.draggedEntity.__isWebParticle && _this.snapTarget && _this.onRepairDrop) {
          _this.onRepairDrop(_this.draggedEntity, _this.snapTarget);
        }
      }
    } else if (_this.draggedEntity && _this.draggedEntity.__isWebTug) {
      if (_this._didPointerDrag) _this.suppressClick = true;
      _this.draggedEntity.__isWebTug = false;
    }
    _this.draggedEntity = null;
    _this.snapTarget = null;
    _this.snapCandidates.length = 0;
    _this._didPointerDrag = false;
  }, { passive: false });

  this.canvas.addEventListener('touchmove', function (e) {
    e.preventDefault();
    var r = _this.canvas.getBoundingClientRect(), t = e.touches[0];
    _this.mouse.x = (t.clientX - r.left) * (_this.width / r.width);
    _this.mouse.y = (t.clientY - r.top) * (_this.height / r.height);
    _notePointerDrag(_this.mouse.x, _this.mouse.y);
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

function _nearestPointOnSeg(px, py, ax, ay, bx, by) {
  var dx = bx - ax;
  var dy = by - ay;
  var len2 = dx * dx + dy * dy;
  if (len2 < 1e-6) return { x: ax, y: ay, t: 0 };
  var t = ((px - ax) * dx + (py - ay) * dy) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return { x: ax + t * dx, y: ay + t * dy, t: t };
}

function _isParticlePinned(particle, constraints) {
  for (var i = 0; i < constraints.length; i++) {
    if (constraints[i] instanceof PinConstraint && constraints[i].a === particle) return true;
  }
  return false;
}

function _webNodeConnCount(particle, constraints) {
  var conn = 0;
  for (var i = 0; i < constraints.length; i++) {
    var c = constraints[i];
    if (!(c instanceof DistanceConstraint)) continue;
    if (c.__isStubAnchor) continue;
    if (c.a === particle || c.b === particle) conn++;
  }
  return conn;
}

function _findWebCompositeForParticle(sim, particle) {
  var c, i;
  for (c in sim.composites) {
    if (!sim.composites[c].__isWeb) continue;
    var pts = sim.composites[c].particles;
    for (i in pts) {
      if (pts[i] === particle) return sim.composites[c];
    }
  }
  return null;
}

function _applyWebTugPull(sim, primary, mx, my) {
  var tug = sim.webTugStrength || 0.36;
  var spreadR = sim.webTugSpreadRadius || 110;
  var maxHop = sim.webTugNeighborHops || 2;
  var hopFalloff = sim.webTugNeighborFalloff || 0.54;
  var webComp = _findWebCompositeForParticle(sim, primary);

  if (!webComp) {
    primary.pos.x += (mx - primary.pos.x) * tug;
    primary.pos.y += (my - primary.pos.y) * tug;
    return;
  }

  var wcs = webComp.constraints;
  var visited = [];
  var queue = [{ p: primary, hop: 0, weight: 1 }];
  var minWeight = 0.035;

  while (queue.length > 0) {
    var item = queue.shift();
    var pt = item.p;
    if (visited.indexOf(pt) !== -1) continue;
    visited.push(pt);
    if (pt.__isStub) continue;
    if (pt !== primary && _isParticlePinned(pt, wcs)) continue;

    var dx = mx - pt.pos.x;
    var dy = my - pt.pos.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var distW = dist < spreadR ? 1 - dist / spreadR : 0.2;
    var w = item.weight * distW;
    if (w < minWeight) continue;

    var s = tug * w;
    pt.pos.x += dx * s;
    pt.pos.y += dy * s;

    if (item.hop >= maxHop) continue;
    for (var wi = 0; wi < wcs.length; wi++) {
      var con = wcs[wi];
      if (!(con instanceof DistanceConstraint)) continue;
      if (con.__isStubAnchor) continue;
      var nb = null;
      if (con.a === pt) nb = con.b;
      else if (con.b === pt) nb = con.a;
      else continue;
      if (!nb || nb.__isStub || nb._noSimDrag) continue;
      if (visited.indexOf(nb) !== -1) continue;
      queue.push({ p: nb, hop: item.hop + 1, weight: item.weight * hopFalloff });
    }
  }
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
    if (this.draggedEntity.__isStub) {
      /* stub 直接跟手 */
      this.draggedEntity.pos.mutableSet(this.mouse);
    } else if (this.draggedEntity.__isWebTug) {
      _applyWebTugPull(this, this.draggedEntity, this.mouse.x, this.mouse.y);
    } else {
      /* 其他实体弹性跟随 */
      var _dp = this.draggedEntity.pos;
      _dp.x += (this.mouse.x - _dp.x) * 0.08;
      _dp.y += (this.mouse.y - _dp.y) * 0.08;
    }
    this.snapTarget = null;
    this.snapCandidates.length = 0;
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

      var snap = null, snapD2 = this.snapRadius * this.snapRadius;
      var candidates = [];
      for (c in this.composites) {
        if (!this.composites[c].__isWeb) continue;
        var wps = this.composites[c].particles;
        var wcs = this.composites[c].constraints;
        for (i = 0; i < wps.length; i++) {
          var wp = wps[i];
          if (wp === this.draggedEntity) continue;
          if (wp === stubAnchorPt) continue;
          var wConn = 0;
          for (var wi = 0; wi < wcs.length; wi++) {
            if (!(wcs[wi] instanceof DistanceConstraint)) continue;
            if (wcs[wi].__isStubAnchor) continue;
            if (wcs[wi].a === wp || wcs[wi].b === wp) wConn++;
          }
          if (wConn < 2) continue;
          var reachD2 = this.stubReachRadius * this.stubReachRadius;
          var wd2 = wp.pos.dist2(this.draggedEntity.pos);
          if (wd2 <= reachD2) candidates.push({ pt: wp, d2: wd2 });
          if (wd2 < snapD2) { snapD2 = wd2; snap = wp; }
        }
      }
      var nearestCandidate = pickNearestSnapCandidate(candidates);
      this.snapCandidates = nearestCandidate ? [nearestCandidate.pt] : [];
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
    var hlR = nearest.__isWebTug ? 13 : (nearest.__isStub ? 10 : 8);
    this.ctx.beginPath();
    this.ctx.arc(nearest.pos.x, nearest.pos.y, hlR, 0, 2 * Math.PI);
    this.ctx.strokeStyle = nearest.__isWebTug ? 'rgba(210,230,255,0.85)' : this.highlightColor;
    this.ctx.lineWidth = nearest.__isWebTug ? 2.2 : 1.6;
    this.ctx.stroke();
    statsDc('stroke');
  }
};

VerletJS.prototype.nearestEntity = function () {
  var c, i;
  var stubR2 = this.stubSelectionRadius * this.stubSelectionRadius;

  /* 第一优先级：找最近的 stub（选中半径更大，适配手指） */
  var bestStub = null, bestStubD2 = Infinity, bestStubCs = null, bestStubComp = null;
  for (c in this.composites) {
    var ps = this.composites[c].particles;
    for (i in ps) {
      if (!ps[i].__isStub) continue;
      var d2 = ps[i].pos.dist2(this.mouse);
      if (d2 <= stubR2 && d2 < bestStubD2) {
        bestStub = ps[i];
        bestStubD2 = d2;
        bestStubCs = this.composites[c].constraints;
        bestStubComp = this.composites[c];
      }
    }
  }
  if (bestStub) {
    /* 如果点击位置同时有 stuck 物体，物体优先，不拖 stub */
    if (this.hasObjectAt && this.hasObjectAt(this.mouse.x, this.mouse.y)) {
      /* 跳过 stub，走后续流程（最终 return null，让 click 处理物体） */
    } else {
      bestStub.__isWebParticle = true;
      bestStub.__isWebTug = false;
      return bestStub;
    }
  }

  /* 第二优先级：最近的存活网线段（轻微弹性拖拽；上层猎物由 shouldAllowWebTug 屏蔽） */
  if (this.shouldAllowWebTug && !this.shouldAllowWebTug(this.mouse.x, this.mouse.y)) {
    return null;
  }
  var tugR2 = this.webTugRadius * this.webTugRadius;
  var bestTug = null;
  var bestTugD2 = Infinity;
  for (c in this.composites) {
    if (!this.composites[c].__isWeb) continue;
    var wcs = this.composites[c].constraints;
    for (i = 0; i < wcs.length; i++) {
      var con = wcs[i];
      if (!(con instanceof DistanceConstraint)) continue;
      if (con.__isStubAnchor) continue;
      var ax = con.a.pos.x;
      var ay = con.a.pos.y;
      var bx = con.b.pos.x;
      var by = con.b.pos.y;
      var proj = _nearestPointOnSeg(this.mouse.x, this.mouse.y, ax, ay, bx, by);
      var sdx = this.mouse.x - proj.x;
      var sdy = this.mouse.y - proj.y;
      var sd2 = sdx * sdx + sdy * sdy;
      if (sd2 > tugR2 || sd2 >= bestTugD2) continue;
      var pick = proj.t <= 0.5 ? con.a : con.b;
      if (pick.__isStub || pick._noSimDrag) continue;
      if (_isParticlePinned(pick, wcs)) continue;
      if (_webNodeConnCount(pick, wcs) < 2) continue;
      bestTug = pick;
      bestTugD2 = sd2;
    }
  }
  if (bestTug) {
    bestTug.__isWebParticle = true;
    bestTug.__isWebTug = true;
    return bestTug;
  }

  return null;
};
