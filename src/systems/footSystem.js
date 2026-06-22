import { Vec2 } from '../engine/Vec2.js';
import { DistanceConstraint } from '../engine/constraints.js';
import { audioEngine } from '../audio/audioEngine.js';

/**
 * 落脚点搜索的全局粒子 ID 计数器
 */
var _pid = 0;
export function getNextPid() { return ++_pid; }
export function getPidCounter() { return _pid; }

/**
 * 工具函数：洗牌
 */
export function shuffle(o) {
  for (var j, x, i = o.length; i; j = parseInt(Math.random() * i), x = o[--i], o[i] = o[j], o[j] = x);
  return o;
}

/**
 * 获取网约束上的采样点
 */
export function getWebSamplePoints(webComposite, N) {
  var pts = [];
  for (var i in webComposite.constraints) {
    var c = webComposite.constraints[i];
    if (!(c instanceof DistanceConstraint)) continue;
    for (var s = 1; s < N; s++) {
      var t = s / N;
      pts.push({ type: 'segment', pa: c.a, pb: c.b, t: t, x: 0, y: 0 });
    }
  }
  return pts;
}

/**
 * 更新采样点坐标
 */
export function updateSamplePoints(pts) {
  for (var i = 0; i < pts.length; i++) {
    var p = pts[i];
    p.x = p.pa.pos.x + (p.pb.pos.x - p.pa.pos.x) * p.t;
    p.y = p.pa.pos.y + (p.pb.pos.y - p.pa.pos.y) * p.t;
  }
}

var _footCandPool = new Array(128);
var _footCandCount = 0;

function _ensureFootCand(idx) {
  var slot = _footCandPool[idx];
  if (!slot) _footCandPool[idx] = slot = { type: '', x: 0, y: 0, t: 0 };
  return slot;
}

/** 候选池槽会被下一帧覆盖，落脚后必须持久化副本 */
function _persistStepPoint(sp) {
  if (!sp) return null;
  if (sp.type === 'node') {
    return { type: 'node', particle: sp.particle, x: sp.x, y: sp.y };
  }
  return { type: 'segment', pa: sp.pa, pb: sp.pb, t: sp.t, x: sp.x, y: sp.y };
}

function _appendStepCandidate(cands, candCount, thorax, minR2, stepR2, x, y, type, particle, pa, pb, t) {
  var ddx = x - thorax.x, ddy = y - thorax.y, d2 = ddx * ddx + ddy * ddy;
  if (d2 < minR2 || d2 > stepR2) return candCount;
  var slot = _ensureFootCand(candCount);
  slot.type = type;
  slot.x = x;
  slot.y = y;
  slot.t = t || 0;
  slot.particle = particle || null;
  slot.pa = pa || null;
  slot.pb = pb || null;
  return candCount + 1;
}

function _scoreStepCandidate(cx, cy, ix, iy, occupiedPositions, MIN_LEG_SEP) {
  var dx = cx - ix, dy = cy - iy;
  var base = dx * dx + dy * dy;
  if (!occupiedPositions) return base;
  var penalty = 0;
  for (var oi = 0; oi < occupiedPositions.length; oi++) {
    var ox = occupiedPositions[oi].x, oy = occupiedPositions[oi].y;
    var dox = cx - ox, doy = cy - oy;
    var dsq = dox * dox + doy * doy;
    if (dsq < MIN_LEG_SEP * MIN_LEG_SEP * 4) {
      penalty += MIN_LEG_SEP * MIN_LEG_SEP * 4 / (dsq + 1) * 2000;
    }
  }
  return base + penalty;
}

/**
 * Spatial Hash 局部落脚搜索（Phase B）
 */
export function findStepTargetSpatial(webComp, legIndex, spiderComp, moveDir, spatialIndex, queryBuf, occupiedPositions) {
  var stepR = 53, minR = 10, idealDist = 23;
  var MIN_LEG_SEP = 14;
  var minR2 = minR * minR, stepR2 = stepR * stepR;
  var thorax = spiderComp.particles[0].pos;
  var head = spiderComp.particles[1].pos;
  var theta = Vec2.angleAt(thorax.x, thorax.y, thorax.x + 1, thorax.y, head.x, head.y);
  var legAngles = [-0.22, Math.PI + 0.22, 0.28, Math.PI - 0.28];
  var la = theta + legAngles[legIndex];
  var ix = thorax.x + Math.cos(la) * idealDist, iy = thorax.y + Math.sin(la) * idealDist;
  if (moveDir) { ix += moveDir.x * 20; iy += moveDir.y * 20; }

  var candCount = 0;
  var count = spatialIndex.queryAABB(
    thorax.x - stepR, thorax.x + stepR, thorax.y - stepR, thorax.y + stepR, queryBuf
  );

  for (var qi = 0; qi < count; qi++) {
    var id = queryBuf[qi];
    if (!spatialIndex.isAliveId(id)) continue;
    var c = spatialIndex.getConstraint(id);
    if (!c) continue;
    candCount = _appendStepCandidate(
      _footCandPool, candCount, thorax, minR2, stepR2,
      c.a.pos.x, c.a.pos.y, 'node', c.a, null, null, 0
    );
    candCount = _appendStepCandidate(
      _footCandPool, candCount, thorax, minR2, stepR2,
      c.b.pos.x, c.b.pos.y, 'node', c.b, null, null, 0
    );
    for (var s = 1; s <= 2; s++) {
      var t = s / 3;
      var sx = c.a.pos.x + (c.b.pos.x - c.a.pos.x) * t;
      var sy = c.a.pos.y + (c.b.pos.y - c.a.pos.y) * t;
      candCount = _appendStepCandidate(
        _footCandPool, candCount, thorax, minR2, stepR2,
        sx, sy, 'segment', null, c.a, c.b, t
      );
    }
  }

  if (!candCount) return null;

  function tooCloseToOccupied(cx, cy) {
    if (!occupiedPositions) return false;
    for (var oi = 0; oi < occupiedPositions.length; oi++) {
      var ox = occupiedPositions[oi].x, oy = occupiedPositions[oi].y;
      var dx = cx - ox, dy = cy - oy;
      if (dx * dx + dy * dy < MIN_LEG_SEP * MIN_LEG_SEP) return true;
    }
    return false;
  }

  var best = null, bs = Infinity;
  var hasFree = false;
  for (var ci = 0; ci < candCount; ci++) {
    var cand = _footCandPool[ci];
    var free = !tooCloseToOccupied(cand.x, cand.y);
    if (free) hasFree = true;
  }
  for (var ci2 = 0; ci2 < candCount; ci2++) {
    var c2 = _footCandPool[ci2];
    var use = hasFree ? !tooCloseToOccupied(c2.x, c2.y) : true;
    if (!use) continue;
    var sc = _scoreStepCandidate(c2.x, c2.y, ix, iy, occupiedPositions, MIN_LEG_SEP);
    if (sc < bs) { best = c2; bs = sc; }
  }
  return best;
}

/**
 * 寻找最佳落脚目标（legacy 全量采样）
 */
export function findStepTarget(webComp, legIndex, spiderComp, moveDir, samplePoints, occupiedPositions) {
  var stepR = 53, minR = 10, idealDist = 23;
  var MIN_LEG_SEP = 14;
  var thorax = spiderComp.particles[0].pos;
  var head = spiderComp.particles[1].pos;
  var theta = Vec2.angleAt(thorax.x, thorax.y, thorax.x + 1, thorax.y, head.x, head.y);
  // upper-right, upper-left, lower-right, lower-left
  var legAngles = [-0.22, Math.PI + 0.22, 0.28, Math.PI - 0.28];
  var la = theta + legAngles[legIndex];
  var ix = thorax.x + Math.cos(la) * idealDist, iy = thorax.y + Math.sin(la) * idealDist;
  if (moveDir) { ix += moveDir.x * 20; iy += moveDir.y * 20; }

  /* 构建存活约束中出现的粒子集合 */
  var aliveParticles = {};
  for (var ai = 0; ai < webComp.constraints.length; ai++) {
    var ac = webComp.constraints[ai];
    if (!(ac instanceof DistanceConstraint)) continue;
    aliveParticles[ac.a.__pid || (ac.a.__pid = getNextPid())] = true;
    aliveParticles[ac.b.__pid || (ac.b.__pid = getNextPid())] = true;
  }

  var cands = [];
  for (var i in webComp.particles) {
    var wp = webComp.particles[i], d2 = wp.pos.dist2(thorax);
    if (d2 >= minR * minR && d2 <= stepR * stepR) {
      if (!wp.__pid || !aliveParticles[wp.__pid]) continue;
      cands.push({ type: 'node', particle: wp, x: wp.pos.x, y: wp.pos.y });
    }
  }
  for (var si = 0; si < samplePoints.length; si++) {
    var sp = samplePoints[si], ddx = sp.x - thorax.x, ddy = sp.y - thorax.y, d2 = ddx * ddx + ddy * ddy;
    if (d2 >= minR * minR && d2 <= stepR * stepR) {
      var paOk = sp.pa.__pid && aliveParticles[sp.pa.__pid];
      var pbOk = sp.pb.__pid && aliveParticles[sp.pb.__pid];
      if (!paOk || !pbOk) continue;
      cands.push(sp);
    }
  }
  if (!cands.length) return null;

  function tooCloseToOccupied(cx, cy) {
    if (!occupiedPositions) return false;
    for (var oi = 0; oi < occupiedPositions.length; oi++) {
      var ox = occupiedPositions[oi].x, oy = occupiedPositions[oi].y;
      var dx = cx - ox, dy = cy - oy;
      if (dx * dx + dy * dy < MIN_LEG_SEP * MIN_LEG_SEP) return true;
    }
    return false;
  }

  var freeCands = cands.filter(function (c) { return !tooCloseToOccupied(c.x, c.y); });
  var pool = freeCands.length ? freeCands : cands;

  var best = pool[0], bs = _scoreStepCandidate(best.x, best.y, ix, iy, occupiedPositions, MIN_LEG_SEP);
  for (var ci = 1; ci < pool.length; ci++) {
    var s = _scoreStepCandidate(pool[ci].x, pool[ci].y, ix, iy, occupiedPositions, MIN_LEG_SEP);
    if (s < bs) { best = pool[ci]; bs = s; }
  }
  return best;
}

/**
 * 抬脚：解除约束
 */
export function liftFoot(fs, spider) {
  [fs.constraintA, fs.constraintB].forEach(function (c) {
    if (!c) return;
    var i = spider.constraints.indexOf(c);
    if (i !== -1) spider.constraints.splice(i, 1);
  });
  fs.constraintA = null;
  fs.constraintB = null;
  fs.landedNode = null;
  fs.landedSeg = null;
}

/**
 * 落脚：建立约束
 */
export function landFoot(fs, spider) {
  audioEngine.playSfxFootstep();
  liftFoot(fs, spider);
  var sp = fs.targetStepPoint;
  if (!sp) return;
  if (sp.type === 'node') {
    var d = fs.particle.pos.dist(sp.particle.pos);
    var c = new DistanceConstraint(fs.particle, sp.particle, 1, d);
    spider.constraints.push(c);
    fs.constraintA = c;
    fs.landedNode = sp.particle;
  } else {
    var dA = fs.particle.pos.dist(sp.pa.pos), dB = fs.particle.pos.dist(sp.pb.pos);
    var cA = new DistanceConstraint(fs.particle, sp.pa, 1, dA);
    var cB = new DistanceConstraint(fs.particle, sp.pb, 1, dB);
    spider.constraints.push(cA);
    spider.constraints.push(cB);
    fs.constraintA = cA;
    fs.constraintB = cB;
    fs.landedSeg = _persistStepPoint(sp);
  }
  fs.targetStepPoint = null;
}

/**
 * 触发迈步
 */
export function triggerStep(i, md, footState, spiderweb, spider, samplePoints, moveDir, STEP_COOLDOWN, spatialOpts) {
  var fs = footState[i];
  if (!fs || fs.stepping || fs.cooldown > 0) return;

  var occupied = [];
  for (var oi = 0; oi < footState.length; oi++) {
    if (oi === i) continue;
    var other = footState[oi];
    occupied.push({ x: other.current.x, y: other.current.y });
  }

  var sp;
  if (spatialOpts && spatialOpts.index) {
    sp = findStepTargetSpatial(
      spiderweb, i, spider, md || null, spatialOpts.index, spatialOpts.queryBuf, occupied
    );
  } else {
    sp = findStepTarget(spiderweb, i, spider, md || null, samplePoints, occupied);
  }
  if (!sp) return;
  var dx = sp.x - fs.current.x, dy = sp.y - fs.current.y;
  if (dx * dx + dy * dy < 25) return;

  liftFoot(fs, spider);
  fs.from = new Vec2(fs.current.x, fs.current.y);
  fs.targetPos = new Vec2(sp.x, sp.y);
  fs.targetStepPoint = _persistStepPoint(sp);
  fs.stepping = true;
  fs.t = 0;
  fs.cooldown = STEP_COOLDOWN;
}
