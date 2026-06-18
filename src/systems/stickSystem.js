import { DistanceConstraint } from '../engine/constraints.js';
import { segmentSegmentClosest } from '../physics/CollisionMath.js';

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
  var constraints = spiderweb.constraints;
  for (var j = 0; j < constraints.length; j++) {
    var c = constraints[j];
    if (!(c instanceof DistanceConstraint)) continue;
    for (var si = 0; si <= 8; si++) {
      var t = si / 8;
      var wx = c.a.pos.x + (c.b.pos.x - c.a.pos.x) * t;
      var wy = c.a.pos.y + (c.b.pos.y - c.a.pos.y) * t;
      var proj = ((wx - px0) * motDx + (wy - py0) * motDy) / (motLen * motLen);
      proj = Math.max(0, Math.min(1, proj));
      var footX = px0 + proj * motDx, footY = py0 + proj * motDy;
      var d = Math.sqrt((wx - footX) * (wx - footX) + (wy - footY) * (wy - footY));
      if (d > catchR) continue;
      hits.push({
        c: c, t: t, x: wx, y: wy,
        radial: radialRatioFn(wx, wy),
        dist: d
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
 * 从历史候选点中选一个粘住（双指针原位压缩）
 * @returns {{ candidate: object|null, count: number }}
 */
export function chooseStickCandidate(history, historyCount, aliveCheck, stickMidBias) {
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