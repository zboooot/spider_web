import { DistanceConstraint } from '../engine/constraints.js';

/**
 * 粘网系统 — C方案
 * 物体进入网区后记录真实经过的候选交点，延迟后从历史中挑一个粘住。
 */

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
 * 从历史候选点中选一个粘住
 */
export function chooseStickCandidate(history, spiderweb, stickMidBias) {
  if (!history.length) return null;
  /* 过滤掉已断掉的约束 */
  var alive = history.filter(function (h) {
    return spiderweb.constraints.indexOf(h.c) !== -1;
  });
  if (!alive.length) return null;
  var total = 0;
  for (var i = 0; i < alive.length; i++) {
    var h = alive[i];
    var depthWeight = 0.4 + 0.6 * ((i + 1) / alive.length);
    var midness = 1 - Math.min(1, Math.abs(h.radial - 0.5) / 0.5);
    h._w = depthWeight * (1 + stickMidBias * midness);
    total += h._w;
  }
  history = alive;
  var rnd = Math.random() * total, acc = 0;
  for (var i = 0; i < history.length; i++) {
    acc += history[i]._w;
    if (rnd <= acc) return history[i];
  }
  return history[history.length - 1];
}
