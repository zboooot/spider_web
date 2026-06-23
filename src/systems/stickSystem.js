import { DistanceConstraint } from '../engine/constraints.js';
import { ptSegDistSq, segmentSegmentClosest } from '../physics/CollisionMath.js';
import { isWebConstraintAlive } from '../physics/SpatialIndexService.js';

/**
 * 粘网系统 — C方案
 * 物体进入网区后记录真实经过的候选交点，延迟后从历史中挑一个粘住。
 */

/** 每帧窄相候选槽（零 GC） */
export var stickHitScratch = new Array(64);

/**
 * 获取网外圈半径
 */
export function getWebOuterR(W, H, webRadius) {
  return Math.round(Math.min(W, H) / 2 * webRadius);
}

/**
 * 判断是否在网区范围内
 */
export function inWebZone(x, y, W, H, webRadius) {
  var r = getWebOuterR(W, H, webRadius);
  var dx = x - W / 2, dy = y - H / 2;
  return dx * dx + dy * dy <= r * r;
}

/**
 * 计算到网中心的径向比（0=中心, 1=边缘）
 */
export function radialRatioAt(x, y, W, H, webRadius) {
  var r = getWebOuterR(W, H, webRadius) || 1;
  var dx = x - W / 2, dy = y - H / 2;
  return Math.sqrt(dx * dx + dy * dy) / r;
}

function _ensureHitSlot(outHits, idx) {
  var slot = outHits[idx];
  if (!slot) outHits[idx] = slot = {};
  return slot;
}

/**
 * 收集当前帧路径经过的候选交点
 */
export function collectPathHitCandidates(px0, py0, px1, py1, catchR, spiderweb, radialRatioFn) {
  var hits = [];
  var motDx = px1 - px0, motDy = py1 - py0;
  var motLen = Math.sqrt(motDx * motDx + motDy * motDy) || 0.001;
  var samples = motLen < 4 ? 2 : motLen < 12 ? 4 : 8;
  var catchR2 = catchR * catchR;
  var minPx = Math.min(px0, px1) - catchR, maxPx = Math.max(px0, px1) + catchR;
  var minPy = Math.min(py0, py1) - catchR, maxPy = Math.max(py0, py1) + catchR;
  var motLenSq = motLen * motLen;
  var constraints = spiderweb.constraints;
  for (var j = 0; j < constraints.length; j++) {
    var c = constraints[j];
    if (!(c instanceof DistanceConstraint)) continue;
    var ax = c.a.pos.x, ay = c.a.pos.y, bx = c.b.pos.x, by = c.b.pos.y;
    if (Math.max(ax, bx) < minPx || Math.min(ax, bx) > maxPx) continue;
    if (Math.max(ay, by) < minPy || Math.min(ay, by) > maxPy) continue;
    for (var si = 0; si <= samples; si++) {
      var t = si / samples;
      var wx = ax + (bx - ax) * t;
      var wy = ay + (by - ay) * t;
      var proj = ((wx - px0) * motDx + (wy - py0) * motDy) / motLenSq;
      proj = proj < 0 ? 0 : proj > 1 ? 1 : proj;
      var footX = px0 + proj * motDx, footY = py0 + proj * motDy;
      var ddx = wx - footX, ddy = wy - footY;
      var d2 = ddx * ddx + ddy * ddy;
      if (d2 > catchR2) continue;
      hits.push({
        c: c, t: t, x: wx, y: wy,
        radial: radialRatioFn(wx, wy),
        dist: Math.sqrt(d2)
      });
    }
  }
  return hits;
}

/**
 * Spatial Hash + Swept 线段-线段窄相（Phase B/C，零分配写入 outHits）
 * @returns {number} 命中数
 */
export function collectPathHitCandidatesSpatial(
  px0, py0, px1, py1, catchR, spatialIndex, queryBuf, outHits, radialRatioFn
) {
  var r = catchR;
  var minX = px0 < px1 ? px0 : px1;
  var maxX = px0 > px1 ? px0 : px1;
  var minY = py0 < py1 ? py0 : py1;
  var maxY = py0 > py1 ? py0 : py1;
  minX -= r; maxX += r; minY -= r; maxY += r;
  var r2 = r * r;
  var count = spatialIndex.queryAABB(minX, maxX, minY, maxY, queryBuf);
  var out = 0;
  for (var i = 0; i < count; i++) {
    var id = queryBuf[i];
    var c = spatialIndex.getConstraint(id);
    if (!c) continue;
    var closest = segmentSegmentClosest(
      px0, py0, px1, py1,
      c.a.pos.x, c.a.pos.y, c.b.pos.x, c.b.pos.y
    );
    if (closest.distSq > r2) continue;
    var t = closest.tB;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    var slot = _ensureHitSlot(outHits, out);
    slot.constraintId = id;
    slot.c = c;
    slot.t = t;
    slot.x = closest.qx;
    slot.y = closest.qy;
    slot.radial = radialRatioFn(closest.qx, closest.qy);
    slot.dist = Math.sqrt(closest.distSq);
    out++;
  }
  return out;
}

/**
 * 将本帧候选合并进历史（原位压缩，无 push/splice）
 */
export function mergeStickHits(history, historyCount, newHits, newCount, penetration, maxHistory) {
  var cnt = historyCount;
  for (var hi = 0; hi < newCount; hi++) {
    var nh = newHits[hi];
    if (cnt > 0) {
      var last = history[cnt - 1];
      var dxh = last.x - nh.x, dyh = last.y - nh.y;
      if (dxh * dxh + dyh * dyh < 16) continue;
    }
    var slot = _ensureHitSlot(history, cnt);
    slot.constraintId = nh.constraintId;
    slot.c = nh.c;
    slot.t = nh.t;
    slot.x = nh.x;
    slot.y = nh.y;
    slot.radial = nh.radial;
    slot.dist = nh.dist;
    slot.penetration = penetration;
    cnt++;
  }
  if (cnt > maxHistory) {
    var drop = cnt - maxHistory;
    for (var i = 0; i < maxHistory; i++) history[i] = history[i + drop];
    cnt = maxHistory;
  }
  return cnt;
}

/**
 * 查找离 (px,py) 最近的存活网段（断丝时用当前位置，避免抖离后断到远处）
 */
export function findNearestWebSegment(px, py, spiderweb, spatialOpts, fallback) {
  var best = null;
  var bestD2 = Infinity;

  function consider(c) {
    if (!c || !(c instanceof DistanceConstraint) || c.__webGlobal) return;
    if (spatialOpts && spatialOpts.index) {
      if (!isWebConstraintAlive(c, spatialOpts.index)) return;
    } else if (spiderweb.constraints.indexOf(c) === -1) return;
    var d2 = ptSegDistSq(px, py, c.a.pos.x, c.a.pos.y, c.b.pos.x, c.b.pos.y);
    if (d2 < bestD2) { bestD2 = d2; best = c; }
  }

  if (spatialOpts && spatialOpts.index && spatialOpts.queryBuf) {
    var pad = 80;
    var count = spatialOpts.index.queryAABB(px - pad, px + pad, py - pad, py + pad, spatialOpts.queryBuf);
    for (var qi = 0; qi < count; qi++) consider(spatialOpts.index.getConstraint(spatialOpts.queryBuf[qi]));
  }
  if (!best) {
    var cs = spiderweb.constraints;
    for (var ci = 0; ci < cs.length; ci++) consider(cs[ci]);
  }
  return best || fallback || null;
}

/**
 * 从历史候选点中选一个粘住（双指针原位压缩）
 * preferX/preferY 有值时（虫子）优先选离当前位置最近的候选
 * 兼容两种调用方式：
 *   1) legacy: chooseStickCandidate(history, spiderweb, stickMidBias, occupiedPoints, minSep) -> candidate|null
 *   2) current: chooseStickCandidate(history, historyCount, aliveCheck, stickMidBias, preferX, preferY) -> { candidate, count }
 */
export function chooseStickCandidate(history, historyCountOrSpiderweb, aliveCheckOrStickMidBias, stickMidBiasOrOccupiedPoints, preferXOrMinSep, preferY) {
  if (typeof historyCountOrSpiderweb !== 'number') {
    var spiderweb = historyCountOrSpiderweb;
    var stickMidBias = aliveCheckOrStickMidBias;
    var occupiedPoints = stickMidBiasOrOccupiedPoints;
    var minSep = preferXOrMinSep;
    if (!history.length) return null;
    var alive = history.filter(function (h) {
      return spiderweb.constraints.indexOf(h.c) !== -1;
    });
    if (!alive.length) return null;
    if (occupiedPoints && occupiedPoints.length) {
      var minSepSq = (minSep || 0) * (minSep || 0);
      var spaced = alive.filter(function (h) {
        for (var oi = 0; oi < occupiedPoints.length; oi++) {
          var op = occupiedPoints[oi];
          var dx = h.x - op.x, dy = h.y - op.y;
          var req = (minSep || 0) + (op.r || 0);
          if (dx * dx + dy * dy < Math.max(minSepSq, req * req)) return false;
        }
        return true;
      });
      if (spaced.length) alive = spaced;
    }
    var totalLegacy = 0;
    for (var li = 0; li < alive.length; li++) {
      var lh = alive[li];
      var depthWeight = 0.4 + 0.6 * ((li + 1) / alive.length);
      var midness = 1 - Math.min(1, Math.abs(lh.radial - 0.5) / 0.5);
      lh._w = depthWeight * (1 + stickMidBias * midness);
      totalLegacy += lh._w;
    }
    var legacyRnd = Math.random() * totalLegacy;
    var legacyAcc = 0;
    for (var lj = 0; lj < alive.length; lj++) {
      legacyAcc += alive[lj]._w;
      if (legacyRnd <= legacyAcc) return alive[lj];
    }
    return alive[alive.length - 1];
  }

  var historyCount = historyCountOrSpiderweb;
  var aliveCheck = aliveCheckOrStickMidBias;
  var stickMidBias = stickMidBiasOrOccupiedPoints;
  var preferX = preferXOrMinSep;
  if (!historyCount) return { candidate: null, count: 0 };
  var write = 0;
  if (aliveCheck && typeof aliveCheck.isAliveId === 'function') {
    for (var ai = 0; ai < historyCount; ai++) {
      var h = history[ai];
      var hid = h.constraintId != null ? h.constraintId : (h.c && h.c.__webId);
      if (!hid || !aliveCheck.isAliveId(hid)) continue;
      if (!h.c) h.c = aliveCheck.getConstraint(hid);
      if (!h.c) continue;
      history[write++] = h;
    }
  } else {
    var spiderweb = aliveCheck;
    for (var li = 0; li < historyCount; li++) {
      var lh = history[li];
      if (spiderweb && spiderweb.constraints.indexOf(lh.c) !== -1) {
        history[write++] = lh;
      }
    }
  }
  if (!write) return { candidate: null, count: 0 };
  if (preferX != null && preferY != null) {
    var nearest = null;
    var nearestD2 = Infinity;
    for (var ni = 0; ni < write; ni++) {
      var nh = history[ni];
      var dx = nh.x - preferX;
      var dy = nh.y - preferY;
      var nd2 = dx * dx + dy * dy;
      if (nd2 < nearestD2) { nearestD2 = nd2; nearest = nh; }
    }
    if (nearest) return { candidate: nearest, count: write };
  }
  var total = 0;
  for (var i = 0; i < write; i++) {
    var hit = history[i];
    var depthWeight = 0.4 + 0.6 * ((i + 1) / write);
    var midness = 1 - Math.min(1, Math.abs(hit.radial - 0.5) / 0.5);
    hit._w = depthWeight * (1 + stickMidBias * midness);
    total += hit._w;
  }
  var rnd = Math.random() * total, acc = 0;
  for (var j = 0; j < write; j++) {
    acc += history[j]._w;
    if (rnd <= acc) return { candidate: history[j], count: write };
  }
  return { candidate: history[write - 1], count: write };
}
