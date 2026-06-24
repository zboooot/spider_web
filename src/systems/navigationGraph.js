import { DistanceConstraint } from '../engine/constraints.js';
import { ptSegDistSq } from '../physics/CollisionMath.js';
import { buildAnchoredWebContext, isParticleAnchored } from './wrappedSupport.js';

var DEFAULT_END_SNAP_MAX = 32;
var STRING_PULL_MAX_PERP = 22;
var _cache = { version: -1, spiderweb: null, ctx: null, adj: null };

function _dist2(ax, ay, bx, by) {
  var dx = bx - ax, dy = by - ay;
  return dx * dx + dy * dy;
}

function _particleDist2(a, b) {
  if (!a || !b || !a.pos || !b.pos) return Infinity;
  return _dist2(a.pos.x, a.pos.y, b.pos.x, b.pos.y);
}

function _ensurePid(particle, counter) {
  if (!particle.__pid) particle.__pid = ++counter.value;
  return particle.__pid;
}

function _buildAdjacency(ctx, pidCounter) {
  var adj = {};
  var constraints = ctx.aliveConstraints;
  for (var i = 0; i < constraints.length; i++) {
    var c = constraints[i];
    if (!isParticleAnchored(c.a, ctx.anchoredSet) || !isParticleAnchored(c.b, ctx.anchoredSet)) continue;
    var idA = _ensurePid(c.a, pidCounter);
    var idB = _ensurePid(c.b, pidCounter);
    var w = Math.sqrt(_particleDist2(c.a, c.b));
    if (!adj[idA]) adj[idA] = [];
    if (!adj[idB]) adj[idB] = [];
    adj[idA].push({ pid: idB, particle: c.b, weight: w });
    adj[idB].push({ pid: idA, particle: c.a, weight: w });
  }
  return adj;
}

/**
 * 获取（缓存）导航图上下文：锚定粒子集合 + 加权邻接表
 */
export function getNavContext(spiderweb, spatialOpts) {
  if (!spiderweb) return { aliveConstraints: [], anchoredParticles: [], anchoredSet: {}, adj: {} };
  var ver = spiderweb._topologyVersion || 0;
  if (_cache.version === ver && _cache.spiderweb === spiderweb && _cache.ctx) {
    return { ctx: _cache.ctx, adj: _cache.adj };
  }
  var ctx = buildAnchoredWebContext(spiderweb, spatialOpts);
  var pidCounter = { value: 0 };
  var adj = _buildAdjacency(ctx, pidCounter);
  _cache.version = ver;
  _cache.spiderweb = spiderweb;
  _cache.ctx = ctx;
  _cache.adj = adj;
  return { ctx: ctx, adj: adj };
}

export function invalidateNavCache() {
  _cache.version = -1;
  _cache.spiderweb = null;
  _cache.ctx = null;
  _cache.adj = null;
}

function _nearestAnchoredParticle(px, py, ctx) {
  var best = null;
  var bestD2 = Infinity;
  for (var i = 0; i < ctx.anchoredParticles.length; i++) {
    var p = ctx.anchoredParticles[i];
    if (!p || !p.pos) continue;
    var d2 = _dist2(px, py, p.pos.x, p.pos.y);
    if (d2 < bestD2) {
      bestD2 = d2;
      best = p;
    }
  }
  return best;
}

/**
 * 吸附到锚定子网上最近的点（节点或线段投影）
 */
export function findNearestNavPoint(px, py, spiderweb, spatialOpts) {
  var nav = getNavContext(spiderweb, spatialOpts);
  var ctx = nav.ctx;
  if (!ctx.anchoredParticles.length) return null;

  var best = null;
  var bestD2 = Infinity;

  for (var i = 0; i < ctx.aliveConstraints.length; i++) {
    var c = ctx.aliveConstraints[i];
    if (!isParticleAnchored(c.a, ctx.anchoredSet) || !isParticleAnchored(c.b, ctx.anchoredSet)) continue;
    var ax = c.a.pos.x;
    var ay = c.a.pos.y;
    var bx = c.b.pos.x;
    var by = c.b.pos.y;
    var d2 = ptSegDistSq(px, py, ax, ay, bx, by);
    if (d2 < bestD2) {
      bestD2 = d2;
      var dx = bx - ax;
      var dy = by - ay;
      var lenSq = dx * dx + dy * dy;
      var t = 0;
      if (lenSq > 1e-12) {
        t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
      }
      best = { x: ax + dx * t, y: ay + dy * t, particle: t <= 0.05 ? c.a : (t >= 0.95 ? c.b : null) };
    }
  }

  var nearParticle = _nearestAnchoredParticle(px, py, ctx);
  if (nearParticle) {
    var pd2 = _dist2(px, py, nearParticle.pos.x, nearParticle.pos.y);
    if (!best || pd2 < bestD2) {
      best = { x: nearParticle.pos.x, y: nearParticle.pos.y, particle: nearParticle };
    }
  }

  return best;
}

/**
 * Dijkstra 最短路径（按网线几何距离加权，非跳数）
 */
function _dijkstraPath(startParticle, endParticle, adj, pidCounter) {
  if (!startParticle || !endParticle) return null;
  if (startParticle === endParticle) return [startParticle];

  var startPid = _ensurePid(startParticle, pidCounter);
  var endPid = _ensurePid(endParticle, pidCounter);
  if (!adj[startPid]) return null;

  var dist = {};
  var prev = {};
  var visited = {};
  var heap = [{ pid: startPid, particle: startParticle, d: 0 }];
  dist[startPid] = 0;

  while (heap.length) {
    heap.sort(function (a, b) { return a.d - b.d; });
    var cur = heap.shift();
    if (visited[cur.pid]) continue;
    visited[cur.pid] = true;
    if (cur.pid === endPid) break;

    var neighbors = adj[cur.pid] || [];
    for (var ni = 0; ni < neighbors.length; ni++) {
      var nb = neighbors[ni];
      if (visited[nb.pid]) continue;
      var nd = cur.d + (nb.weight || 1);
      if (dist[nb.pid] == null || nd < dist[nb.pid]) {
        dist[nb.pid] = nd;
        prev[nb.pid] = { pid: cur.pid, particle: cur.particle };
        heap.push({ pid: nb.pid, particle: nb.particle, d: nd });
      }
    }
  }

  if (dist[endPid] == null) return null;

  var path = [endParticle];
  var trace = endPid;
  while (prev[trace]) {
    path.push(prev[trace].particle);
    trace = prev[trace].pid;
  }
  path.reverse();
  return path;
}

/** 走廊拉直：中间点若贴近直线则跳过 */
function _stringPullParticles(particles) {
  if (!particles || particles.length <= 2) return particles || [];

  var result = [particles[0]];
  var i = 0;
  while (i < particles.length - 1) {
    var bestJ = i + 1;
    for (var j = particles.length - 1; j > i + 1; j--) {
      if (_corridorClear(particles[i], particles[j], particles, i, j)) {
        bestJ = j;
        break;
      }
    }
    i = bestJ;
    result.push(particles[i]);
  }
  return result;
}

function _corridorClear(a, b, path, i, j) {
  if (!a || !b || !a.pos || !b.pos) return false;
  var ax = a.pos.x, ay = a.pos.y;
  var bx = b.pos.x, by = b.pos.y;
  var maxPerp2 = STRING_PULL_MAX_PERP * STRING_PULL_MAX_PERP;
  for (var k = i + 1; k < j; k++) {
    var p = path[k];
    if (!p || !p.pos) return false;
    if (ptSegDistSq(p.pos.x, p.pos.y, ax, ay, bx, by) > maxPerp2) return false;
  }
  return true;
}

/** 去掉几乎共线的拐点 */
function _removeCollinearWaypoints(waypoints) {
  if (!waypoints || waypoints.length <= 2) return waypoints || [];

  var out = [waypoints[0]];
  for (var i = 1; i < waypoints.length - 1; i++) {
    var prev = out[out.length - 1];
    var cur = waypoints[i];
    var next = waypoints[i + 1];
    var ax = cur.x - prev.x, ay = cur.y - prev.y;
    var bx = next.x - prev.x, by = next.y - prev.y;
    var al = Math.sqrt(ax * ax + ay * ay) || 1;
    var bl = Math.sqrt(bx * bx + by * by) || 1;
    var dot = (ax / al) * (bx / bl);
    if (dot > 0.94) continue;
    out.push(cur);
  }
  out.push(waypoints[waypoints.length - 1]);
  return out;
}

function _particlesToWaypoints(particles) {
  var waypoints = [];
  for (var i = 0; i < particles.length; i++) {
    var p = particles[i];
    if (!p || !p.pos) continue;
    waypoints.push({ x: p.pos.x, y: p.pos.y });
  }
  return waypoints;
}

function _maybePrependPoint(waypoints, x, y, minDist) {
  minDist = minDist != null ? minDist : 10;
  if (!waypoints.length) return [{ x: x, y: y }];
  var dx = waypoints[0].x - x, dy = waypoints[0].y - y;
  if (dx * dx + dy * dy > minDist * minDist) {
    waypoints.unshift({ x: x, y: y });
  }
  return waypoints;
}

function _maybeAppendPoint(waypoints, x, y, minDist) {
  minDist = minDist != null ? minDist : 10;
  if (!waypoints.length) return [{ x: x, y: y }];
  var last = waypoints[waypoints.length - 1];
  var dx = last.x - x, dy = last.y - y;
  if (dx * dx + dy * dy > minDist * minDist) {
    waypoints.push({ x: x, y: y });
  } else {
    waypoints[waypoints.length - 1] = { x: x, y: y };
  }
  return waypoints;
}

function _buildOptimizedWaypoints(particlePath, fromX, fromY, toX, toY) {
  var pulled = _stringPullParticles(particlePath);
  var waypoints = _particlesToWaypoints(pulled);
  waypoints = _removeCollinearWaypoints(waypoints);
  waypoints = _maybePrependPoint(waypoints, fromX, fromY, 12);
  waypoints = _maybeAppendPoint(waypoints, toX, toY, 8);
  if (waypoints.length === 1) return waypoints;
  return waypoints;
}

function _isEndSnapAcceptable(endParticle, toX, toY, maxEndSnapDist) {
  if (!endParticle || !endParticle.pos) return false;
  return _dist2(endParticle.pos.x, endParticle.pos.y, toX, toY) <= maxEndSnapDist * maxEndSnapDist;
}

export function findNavPath(fromX, fromY, toX, toY, spiderweb, spatialOpts, maxEndSnapDist) {
  maxEndSnapDist = maxEndSnapDist != null ? maxEndSnapDist : DEFAULT_END_SNAP_MAX;
  var nav = getNavContext(spiderweb, spatialOpts);
  var ctx = nav.ctx;
  var adj = nav.adj;
  if (!ctx.anchoredParticles.length) return null;

  var start = _nearestAnchoredParticle(fromX, fromY, ctx);
  var end = _nearestAnchoredParticle(toX, toY, ctx);
  if (!start || !end) return null;
  if (!_isEndSnapAcceptable(end, toX, toY, maxEndSnapDist)) return null;

  var pidCounter = { value: 0 };
  var particlePath = _dijkstraPath(start, end, adj, pidCounter);
  if (!particlePath || !particlePath.length) return null;
  return _buildOptimizedWaypoints(particlePath, fromX, fromY, toX, toY);
}

/**
 * 从 from 出发可达、且离 (toX,toY) 最近的导航点
 */
export function findNearestReachablePoint(fromX, fromY, toX, toY, spiderweb, spatialOpts) {
  var nav = getNavContext(spiderweb, spatialOpts);
  var ctx = nav.ctx;
  var adj = nav.adj;
  if (!ctx.anchoredParticles.length) return null;

  var start = _nearestAnchoredParticle(fromX, fromY, ctx);
  if (!start) return null;

  var pidCounter = { value: 0 };
  var startPid = _ensurePid(start, pidCounter);
  if (!adj[startPid]) return null;

  var dist = {};
  var visited = {};
  var heap = [{ pid: startPid, particle: start, d: 0 }];
  dist[startPid] = 0;

  var best = null;
  var bestD2 = Infinity;

  while (heap.length) {
    heap.sort(function (a, b) { return a.d - b.d; });
    var cur = heap.shift();
    if (visited[cur.pid]) continue;
    visited[cur.pid] = true;

    var p = cur.particle;
    if (p && p.pos) {
      var d2 = _dist2(p.pos.x, p.pos.y, toX, toY);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = { x: p.pos.x, y: p.pos.y, particle: p };
      }
    }

    var neighbors = adj[cur.pid] || [];
    for (var ni = 0; ni < neighbors.length; ni++) {
      var nb = neighbors[ni];
      if (visited[nb.pid]) continue;
      var nd = cur.d + (nb.weight || 1);
      if (dist[nb.pid] == null || nd < dist[nb.pid]) {
        dist[nb.pid] = nd;
        heap.push({ pid: nb.pid, particle: nb.particle, d: nd });
      }
    }
  }
  return best;
}

export function isNavReachable(fromX, fromY, toX, toY, spiderweb, spatialOpts, maxEndSnapDist) {
  return !!(findNavPath(fromX, fromY, toX, toY, spiderweb, spatialOpts, maxEndSnapDist));
}

/**
 * 解析导航意图：优先直达，不可达则吸附到最近可达点
 */
export function resolveNavigation(fromX, fromY, toX, toY, spiderweb, spatialOpts) {
  var snap = findNearestNavPoint(toX, toY, spiderweb, spatialOpts);
  var destX = snap ? snap.x : toX;
  var destY = snap ? snap.y : toY;

  var path = findNavPath(fromX, fromY, destX, destY, spiderweb, spatialOpts);
  var origDx = destX - toX;
  var origDy = destY - toY;
  var snapped = origDx * origDx + origDy * origDy > 24 * 24;

  if (!path || !path.length) {
    var reachable = findNearestReachablePoint(fromX, fromY, destX, destY, spiderweb, spatialOpts);
    if (!reachable) return null;
    destX = reachable.x;
    destY = reachable.y;
    path = findNavPath(fromX, fromY, destX, destY, spiderweb, spatialOpts, DEFAULT_END_SNAP_MAX * 2);
    snapped = true;
    if (!path || !path.length) return null;
  }

  return {
    path: path,
    destX: destX,
    destY: destY,
    snapped: snapped
  };
}

/**
 * 运行时选路：跳过已走过的点，并前瞻到最远可直达拐点
 */
export function resolveActiveWaypointIndex(path, waypointIdx, spiderX, spiderY, arriveR) {
  if (!path || !path.length) return 0;
  arriveR = arriveR != null ? arriveR : 20;
  var idx = waypointIdx || 0;
  if (idx >= path.length) idx = path.length - 1;

  while (idx < path.length - 1) {
    var wp = path[idx];
    if (_dist2(spiderX, spiderY, wp.x, wp.y) <= arriveR * arriveR) {
      idx++;
      continue;
    }
    if (idx < path.length - 1) {
      var next = path[idx + 1];
      var segDx = next.x - wp.x, segDy = next.y - wp.y;
      var segLen2 = segDx * segDx + segDy * segDy;
      if (segLen2 > 1) {
        var toSpiderX = spiderX - wp.x, toSpiderY = spiderY - wp.y;
        var t = (toSpiderX * segDx + toSpiderY * segDy) / segLen2;
        if (t > 1.08) {
          idx++;
          continue;
        }
      }
    }
    break;
  }

  var bestIdx = idx;
  var arriveR2 = arriveR * arriveR;
  for (var j = path.length - 1; j > idx; j--) {
    var far = path[j];
    var farD2 = _dist2(spiderX, spiderY, far.x, far.y);
    if (farD2 <= arriveR2) {
      bestIdx = j;
      break;
    }
    if (j === idx + 1) break;
    if (_corridorClearPoints(spiderX, spiderY, far.x, far.y, path, idx, j)) {
      bestIdx = j;
      break;
    }
  }

  return Math.min(bestIdx, path.length - 1);
}

function _corridorClearPoints(ax, ay, bx, by, path, i, j) {
  var maxPerp2 = (STRING_PULL_MAX_PERP + 8) * (STRING_PULL_MAX_PERP + 8);
  for (var k = i; k <= j; k++) {
    var p = path[k];
    if (!p) return false;
    if (ptSegDistSq(p.x, p.y, ax, ay, bx, by) > maxPerp2) return false;
  }
  return true;
}

/**
 * 落脚候选是否位于锚定连通子网
 */
export function isCandidateOnAnchoredWeb(cand, spiderweb, spatialOpts) {
  if (!cand) return false;
  var ctx = getNavContext(spiderweb, spatialOpts).ctx;
  if (cand.type === 'node') {
    return isParticleAnchored(cand.particle, ctx.anchoredSet);
  }
  if (cand.type === 'segment') {
    if (!isParticleAnchored(cand.pa, ctx.anchoredSet) || !isParticleAnchored(cand.pb, ctx.anchoredSet)) {
      return false;
    }
    for (var i = 0; i < ctx.aliveConstraints.length; i++) {
      var c = ctx.aliveConstraints[i];
      if ((c.a === cand.pa && c.b === cand.pb) || (c.a === cand.pb && c.b === cand.pa)) return true;
    }
    return false;
  }
  return false;
}

/**
 * 从锚定粒子中选取距蜘蛛 1~N 跳可达的随机节点（闲逛 AI 用）
 */
export function pickReachableNavNode(fromX, fromY, spiderweb, spatialOpts, maxHops) {
  maxHops = maxHops != null ? maxHops : 3;
  var nav = getNavContext(spiderweb, spatialOpts);
  var ctx = nav.ctx;
  var adj = nav.adj;
  var start = _nearestAnchoredParticle(fromX, fromY, ctx);
  if (!start) return null;

  var pidCounter = { value: 0 };
  var startPid = _ensurePid(start, pidCounter);
  if (!adj[startPid]) return null;

  var visited = {};
  var queue = [{ pid: startPid, particle: start, hop: 0 }];
  visited[startPid] = true;
  var pool = [];

  while (queue.length) {
    var cur = queue.shift();
    if (cur.hop > 0 && cur.hop <= maxHops && cur.particle && !cur.particle.pinned) {
      pool.push(cur.particle);
    }
    if (cur.hop >= maxHops) continue;
    var neighbors = adj[cur.pid] || [];
    for (var ni = 0; ni < neighbors.length; ni++) {
      var nb = neighbors[ni];
      if (visited[nb.pid]) continue;
      visited[nb.pid] = true;
      queue.push({ pid: nb.pid, particle: nb.particle, hop: cur.hop + 1 });
    }
  }

  if (!pool.length) return null;
  var pick = pool[Math.floor(Math.random() * pool.length)];
  return { x: pick.pos.x, y: pick.pos.y };
}

export function getFootSearchRadiusForTier(tier) {
  if (tier >= 3) return 88;
  if (tier >= 2) return 72;
  if (tier >= 1) return 56;
  return 42;
}

/**
 * 从简化路径中提取下一个「拐点」提示，供躯干轻微转向（头仍朝最终目标）。
 */
export function getNavSteerHint(spiderX, spiderY, goalX, goalY, path) {
  if (!path || path.length < 2) return null;

  var anchorIdx = 0;
  var anchorD2 = Infinity;
  for (var i = 0; i < path.length; i++) {
    var d2 = _dist2(spiderX, spiderY, path[i].x, path[i].y);
    if (d2 < anchorD2) {
      anchorD2 = d2;
      anchorIdx = i;
    }
  }

  while (anchorIdx < path.length - 2) {
    var wp = path[anchorIdx];
    var next = path[anchorIdx + 1];
    var sx = next.x - wp.x;
    var sy = next.y - wp.y;
    var sl2 = sx * sx + sy * sy;
    if (sl2 < 1) {
      anchorIdx++;
      continue;
    }
    var t = ((spiderX - wp.x) * sx + (spiderY - wp.y) * sy) / sl2;
    if (t > 1.02) anchorIdx++;
    else break;
  }

  for (var j = Math.max(anchorIdx + 1, 1); j < path.length; j++) {
    if (j >= path.length - 1) return { x: goalX, y: goalY };
    var prev = path[j - 1];
    var cur = path[j];
    var nxt = path[j + 1];
    var a1x = cur.x - prev.x;
    var a1y = cur.y - prev.y;
    var a2x = nxt.x - cur.x;
    var a2y = nxt.y - cur.y;
    var l1 = Math.sqrt(a1x * a1x + a1y * a1y) || 1;
    var l2 = Math.sqrt(a2x * a2x + a2y * a2y) || 1;
    var dot = (a1x / l1) * (a2x / l2) + (a1y / l1) * (a2y / l2);
    if (dot < 0.9) return { x: cur.x, y: cur.y };
  }

  return { x: goalX, y: goalY };
}

/**
 * 是否已到达导航目标（躯干距目标 + 当前位置在网线上贴近目标）
 */
export function hasReachedNavGoal(spiderX, spiderY, goalX, goalY, spiderweb, spatialOpts, arriveR) {
  arriveR = arriveR != null ? arriveR : 16;
  if (_dist2(spiderX, spiderY, goalX, goalY) <= arriveR * arriveR) return true;
  var onWeb = findNearestNavPoint(spiderX, spiderY, spiderweb, spatialOpts);
  if (!onWeb) return false;
  var goalNearWeb = _dist2(onWeb.x, onWeb.y, goalX, goalY);
  var spiderNearWeb = _dist2(spiderX, spiderY, onWeb.x, onWeb.y);
  var tol = arriveR + 5;
  return goalNearWeb <= tol * tol && spiderNearWeb <= tol * tol;
}