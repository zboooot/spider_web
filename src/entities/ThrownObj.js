import { Vec2 } from '../engine/Vec2.js';
import { Particle } from '../engine/Particle.js';
import { DistanceConstraint } from '../engine/constraints.js';
import { Composite } from '../engine/Composite.js';
import { audioEngine } from '../audio/audioEngine.js';
import { findNearestWebSegment } from '../systems/stickSystem.js';
import { getNextPid } from '../systems/footSystem.js';

/**
 * 判断一条 DistanceConstraint 是否存活。
 * bitmap 模式下，边不从数组删除而是用 spatialIndex.isAlive 标记死亡，
 * 需要用此函数过滤已死的边。
 */
function _isEdgeAlive(c, spatialIndex) {
  if (!spatialIndex) return true; /* legacy 模式：边被删即不在数组中 */
  if (!c.__webId) return true;    /* 无 webId 的边（stubAnchor 等）始终存活 */
  return spatialIndex.isAliveId(c.__webId);
}

/**
 * 找到离指定位置最近的、仍有存活连接的粒子作为锚点。
 * 优先选择真正网线连接数 >= 2 的网格节点（避免把 stub 锚定到链中间节点上）。
 * 如果附近没有 >=2 连接的节点，退化到 >=1。
 */
function findAnchorNear(cx, cy, candidates, spiderweb, excludeStubs, spatialIndex) {
  var anchorPt = null, bestD2 = Infinity;
  var fallbackPt = null, fallbackD2 = Infinity;
  for (var i = 0; i < candidates.length; i++) {
    var pt = candidates[i];
    if (excludeStubs && excludeStubs.indexOf(pt) !== -1) continue;
    if (pt.__isStub) continue; /* stub 节点不能作为锚点 */
    /* 统计该候选节点的存活真正网线连接数（排除 stubAnchor 边和已死边） */
    var realEdgeCount = 0;
    for (var k = 0; k < spiderweb.constraints.length; k++) {
      var cc = spiderweb.constraints[k];
      if (!(cc instanceof DistanceConstraint)) continue;
      if (cc.__isStubAnchor) continue;
      if (!_isEdgeAlive(cc, spatialIndex)) continue;
      if (cc.a === pt || cc.b === pt) realEdgeCount++;
    }
    if (realEdgeCount === 0) continue;
    var dx = pt.pos.x - cx, dy = pt.pos.y - cy;
    var d2 = dx * dx + dy * dy;
    if (realEdgeCount >= 2) {
      /* 优先：网格交叉节点（>=2 条存活真正网线） */
      if (d2 < bestD2) { bestD2 = d2; anchorPt = pt; }
    } else {
      /* 退化：链中间或尾巴节点（1 条存活真正网线） */
      if (d2 < fallbackD2) { fallbackD2 = d2; fallbackPt = pt; }
    }
  }
  return anchorPt || fallbackPt;
}

/**
 * 在指定位置创建一个断线头粒子，锚定到指定节点。
 */
function createOneStub(cx, cy, anchorPt, spiderweb) {
  var stub = new Particle(new Vec2(cx, cy));
  stub.lastPos = new Vec2(cx, cy);
  stub.__pid = getNextPid();
  stub.__isStub = true; /* 标记为断线头 stub */

  var dx = anchorPt.pos.x - cx, dy = anchorPt.pos.y - cy;
  var anchorDist = Math.sqrt(dx * dx + dy * dy) || 1;
  var anchorConstraint = new DistanceConstraint(anchorPt, stub, 0.6, anchorDist);
  anchorConstraint.__isStubAnchor = true;

  spiderweb.particles.push(stub);
  spiderweb.constraints.push(anchorConstraint);
  return stub;
}

/**
 * 根据被破坏的边生成断线头。
 * 每条边 50% 概率产生一个线头，最少 1 个，最多 3 个。
 * 线头生成在对应断裂边的中点附近。
 *
 * @param {Array} edges - 被破坏的边数组 [{a: Particle, b: Particle, distance: number}, ...]
 * @param {Composite} spiderweb - 蜘蛛网
 */
var _noStubStreak = 0; /* 连续未出线头的破坏次数 */

function createBreakStubs(edges, spiderweb, spatialIndex) {
  if (!edges || edges.length === 0) return;

  /* 收集所有涉及的端点作为锚点候选 */
  var allPts = [];
  for (var i = 0; i < edges.length; i++) {
    if (allPts.indexOf(edges[i].a) === -1) allPts.push(edges[i].a);
    if (allPts.indexOf(edges[i].b) === -1) allPts.push(edges[i].b);
  }

  /* 1-2条边→10%出1个线头，3-4条→50%出1个，5条以上→必出1个 */
  var n = edges.length;
  var count = 0;
  if (n <= 2) { if (Math.random() < 0.1) count = 1; }
  else if (n <= 4) { if (Math.random() < 0.5) count = 1; }
  else { count = 1; }

  /* 每2次破坏保底1个线头 */
  if (count === 0) {
    _noStubStreak++;
    if (_noStubStreak >= 2) { count = 1; _noStubStreak = 0; }
  } else {
    _noStubStreak = 0;
  }

  /* 把边打乱，取前 count 条，在它们的中点处各生成一个线头 */
  var shuffled = edges.slice();
  for (var si = shuffled.length - 1; si > 0; si--) {
    var ri = Math.floor(Math.random() * (si + 1));
    var tmp = shuffled[si]; shuffled[si] = shuffled[ri]; shuffled[ri] = tmp;
  }

  var createdStubs = [];
  for (var k = 0; k < count; k++) {
    var e = shuffled[k % shuffled.length];
    var cx = (e.a.pos.x + e.b.pos.x) * 0.5;
    var cy = (e.a.pos.y + e.b.pos.y) * 0.5;
    var anchor = findAnchorNear(cx, cy, allPts, spiderweb, createdStubs, spatialIndex);
    if (!anchor) continue;
    var stub = createOneStub(cx, cy, anchor, spiderweb);
    createdStubs.push(stub);
  }

  /* 清理每个 stub 的悬挂链：A—B—C—D—E' 变成 A—E' */
  for (var si2 = 0; si2 < createdStubs.length; si2++) {
    collapseChain(createdStubs[si2], spiderweb, spatialIndex);
  }
}

/**
 * 清理 stub 的悬挂链。
 * 从 stub 的锚点出发，沿真正网线逐步走（排除 __isStubAnchor 边），
 * 用每个节点的真正网线总连接数判断：
 *   stub 无边 → 直接删 stub
 *   节点真正网线 >= 3 → 正常网格节点，停止，删中间链节点，stub 直连此节点
 *   节点真正网线 == 2 → 链中间点，记录，继续走
 *   节点真正网线 <= 1 → 死端/脱网，删除整条链 + stub
 */
export function collapseChain(stub, spiderweb, spatialIndex) {
  /* 找 pt 的所有存活 DistanceConstraint 边 */
  function getEdges(pt) {
    var edges = [];
    for (var i = 0; i < spiderweb.constraints.length; i++) {
      var c = spiderweb.constraints[i];
      if (!(c instanceof DistanceConstraint)) continue;
      if (!_isEdgeAlive(c, spatialIndex)) continue;
      if (c.a === pt || c.b === pt) edges.push(c);
    }
    return edges;
  }

  /* 删除一个粒子 */
  function removePt(pt) {
    var idx = spiderweb.particles.indexOf(pt);
    if (idx !== -1) spiderweb.particles.splice(idx, 1);
  }

  /* 删除一条边 */
  function removeEdge(edge) {
    var idx = spiderweb.constraints.indexOf(edge);
    if (idx !== -1) spiderweb.constraints.splice(idx, 1);
  }

  /* step 1: stub 有几条边？ */
  var stubEdges = getEdges(stub);
  if (stubEdges.length === 0) {
    removePt(stub);
    return;
  }
  /* stub 应该只有 1 条边（锚定边） */
  var stubEdge = stubEdges[0];
  var prev = stub;
  var current = (stubEdge.a === stub) ? stubEdge.b : stubEdge.a;

  /* step 2: 沿链走 */
  var chainNodes = []; /* 要删的中间节点 */
  var chainEdges = []; /* 要删的中间边 */

  while (true) {
    /*
     * 统计 current 除了 prev 方向外，还有几条"真正网线"出路。
     * 注意：stubAnchor 边既不算 outgoing 也不参与 prev 排除。
     * 第一步 prev=stub 时，stub 只通过 stubAnchor 边连到 current，
     * 所以 prev 排除不会命中真正网线——等价于看 current 的全部真正网线数。
     * 这是正确的：锚点的全部真正网线都是"出去的方向"。
     *
     * outgoing >= 2 → 正常网节点（有多条出路），停止
     * outgoing == 1 → 链上中间点（只有一条出路），继续走
     * outgoing == 0 → 死端，链脱网
     */
    var edges = getEdges(current);
    var outgoing = 0;
    for (var oi = 0; oi < edges.length; oi++) {
      if (edges[oi].__isStubAnchor) continue;
      var otherEnd = (edges[oi].a === current) ? edges[oi].b : edges[oi].a;
      if (otherEnd !== prev) outgoing++;
    }

    if (outgoing >= 2) {
      /* 正常网节点，结束 */
      /* 删中间节点和边 */
      for (var di = 0; di < chainEdges.length; di++) removeEdge(chainEdges[di]);
      for (var pi = 0; pi < chainNodes.length; pi++) removePt(chainNodes[pi]);
      /* stub 直连到这个节点 */
      if (stubEdge.a === stub) stubEdge.b = current;
      else stubEdge.a = current;
      var dx = stub.pos.x - current.pos.x, dy = stub.pos.y - current.pos.y;
      stubEdge.distance = Math.sqrt(dx * dx + dy * dy) || 1;
      return;
    }

    if (outgoing === 1) {
      /* 链上中间点，记录，继续走（只沿真正网线走，跳过 stubAnchor 边） */
      var nextEdge = null, nextPt = null;
      for (var ei = 0; ei < edges.length; ei++) {
        if (edges[ei].__isStubAnchor) continue;
        var other = (edges[ei].a === current) ? edges[ei].b : edges[ei].a;
        if (other !== prev) { nextEdge = edges[ei]; nextPt = other; break; }
      }
      if (!nextEdge) break;
      chainNodes.push(current);
      chainEdges.push(nextEdge);
      prev = current;
      current = nextPt;
      continue;
    }

    /* outgoing === 0: 链脱离网，删除整条链 + stub */
    for (var di2 = 0; di2 < chainEdges.length; di2++) removeEdge(chainEdges[di2]);
    for (var pi2 = 0; pi2 < chainNodes.length; pi2++) removePt(chainNodes[pi2]);
    /* 删 current 和它的边 */
    var curEdges = getEdges(current);
    for (var ce = 0; ce < curEdges.length; ce++) removeEdge(curEdges[ce]);
    removePt(current);
    /* 删 stub 和锚定边 */
    removeEdge(stubEdge);
    removePt(stub);
    return;
  }
}

/**
 * 清理网上所有"尾巴"：连接数==1 的非 stub 节点开始的单链。
 * 沿单链走到连接数>=2 的节点，删掉中间所有节点和边。
 */
function cleanDanglingTails(spiderweb, spatialIndex) {
  var changed = true;
  while (changed) {
    changed = false;
    /* 建连接数映射（排除锚定边和已死边） */
    var connMap = {};
    var ptByPid = {};
    for (var i = 0; i < spiderweb.constraints.length; i++) {
      var c = spiderweb.constraints[i];
      if (!(c instanceof DistanceConstraint)) continue;
      if (c.__isStubAnchor) continue;
      if (!_isEdgeAlive(c, spatialIndex)) continue;
      var pidA = c.a.__pid, pidB = c.b.__pid;
      if (pidA) { connMap[pidA] = (connMap[pidA] || 0) + 1; ptByPid[pidA] = c.a; }
      if (pidB) { connMap[pidB] = (connMap[pidB] || 0) + 1; ptByPid[pidB] = c.b; }
    }

    /* 找所有连接数==1 的非 stub 节点 */
    var tails = [];
    for (var pid in connMap) {
      if (connMap[pid] !== 1) continue;
      var pt = ptByPid[pid];
      if (pt && !pt.__isStub) tails.push(pt);
    }

    /* 对每个尾巴节点，沿单链删除 */
    for (var ti = 0; ti < tails.length; ti++) {
      var current = tails[ti];
      while (true) {
        var curPid = current.__pid;
        if (!curPid) break;
        var curConn = connMap[curPid] || 0;
        if (curConn !== 1) break;
        if (current.__isStub) break;

        /* 找到这条唯一的存活边 */
        var edgeIdx = -1, next = null;
        for (var ei = 0; ei < spiderweb.constraints.length; ei++) {
          var ec = spiderweb.constraints[ei];
          if (!(ec instanceof DistanceConstraint)) continue;
          if (ec.__isStubAnchor) continue;
          if (!_isEdgeAlive(ec, spatialIndex)) continue;
          if (ec.a === current) { edgeIdx = ei; next = ec.b; break; }
          if (ec.b === current) { edgeIdx = ei; next = ec.a; break; }
        }
        if (edgeIdx === -1) break;

        /* 删边（bitmap 模式下标记死亡） */
        var edgeToRemove = spiderweb.constraints[edgeIdx];
        if (spatialIndex && edgeToRemove.__webId) {
          spatialIndex.removeConstraint(edgeToRemove.__webId);
        } else {
          spiderweb.constraints.splice(edgeIdx, 1);
        }
        /* 删粒子 */
        var pidx = spiderweb.particles.indexOf(current);
        if (pidx !== -1) spiderweb.particles.splice(pidx, 1);
        /* 更新 next 的连接数 */
        if (next && next.__pid) connMap[next.__pid] = (connMap[next.__pid] || 1) - 1;
        changed = true;
        current = next;
      }
    }
  }
}

/**
 * 获取物体定义参数
 */
export function getObjectDef(kind, P, gameState, getWaveCfgFn, currentLevelIndex, currentWaveIndex) {
  var waveCfg = (gameState === 'LEVEL_ACTIVE' || gameState === 'LEVEL_INTRO')
    ? getWaveCfgFn(currentLevelIndex, currentWaveIndex) : null;
  if (kind === 'boulder') return {
    r: 7, collectRadius: 7, weight: P.caterpillarWeight,
    stayFrames: Math.round((waveCfg ? waveCfg.catR : P.caterpillarReleaseSec) * 60),
    gravity: P.caterpillarGravity, wrapDur: 120
  };
  if (kind === 'bug') return {
    r: 9, collectRadius: 5, weight: P.flyWeight,
    stayFrames: Math.round((waveCfg ? waveCfg.flyR : P.flyReleaseSec) * 60),
    gravity: 0, wrapDur: 80
  };
  if (kind === 'poop') return {
    r: 20, collectRadius: 17, weight: P.caterpillarWeight,
    stayFrames: Infinity,
    gravity: P.caterpillarGravity, wrapDur: 120,
    peelThreshold: 68,
    peelHoldFrames: 60,
    peelDrag: 0.985,
    dragResistance: 0.88,
    dragFollow: 1.0
  };
  return {
    r: 14, collectRadius: 12, weight: P.leafWeight,
    stayFrames: Math.round(P.leafReleaseSec * 60),
    gravity: Math.min(P.leafGravityMin, P.leafGravityMax) + Math.random() * Math.max(0, Math.abs(P.leafGravityMax - P.leafGravityMin)),
    maxSpeed: P.leafMaxSpeed,
    wrapDur: 50
  };
}

/**
 * 投掷物体构造函数
 */
export function ThrownObj(kind, W, H, sim, P, gameState, getWaveCfgFn, currentLevelIndex, currentWaveIndex) {
  var def = getObjectDef(kind, P, gameState, getWaveCfgFn, currentLevelIndex, currentWaveIndex);
  this.kind = kind; this.def = def;
  this.state = 'falling';
  this.alpha = 1;
  this.stayTimer = 0;
  this.stayFrames = def.stayFrames;
  this.animT = 0;
  this.wobbleAmp = 0;
  this.stickT = 0;
  this.stickyFromA = 0; this.stickyFromB = 0;
  this.stickyToA = 0; this.stickyToB = 0;
  this.cA = null; this.cB = null;
  this.stuckOnConstraint = null;
  this.freeTimer = 0;
  this.angle = 0;
  this.wingT = 0;
  this.segT = 0;
  this.grav = 0.3;
  this.initAngle = 0;
  this.angleVel = 0;
  this.prevX = 0; this.prevY = 0;
  this.stuckAngle = 0;
  this.enteredWebZone = false;
  this.penetrationDist = 0;
  this.stickDelay = 0;
  this.hitHistory = [];
  this._hitHistoryCount = 0;
  this._stickPrevX = 0;
  this._stickPrevY = 0;
  this.released = false;
  this.collectT = 0;
  this.collectDur = 24;
  this.collectPause = 0;
  this.collectFlash = 0;
  this.travelT = 0;
  this.collectFromX = 0; this.collectFromY = 0;
  this.collectToX = 0; this.collectToY = 0;
  this.collectEl = null;
  this.collectCanvas = null;
  this.wrapT = 0;
  this.wrapDur = 0;
  this._silkLines = null;
  this._silkSpiral = null;
  this._popT = 0;
  this._popDur = 18;
  this._pickupTension = 0;
  this._pickupCharge = 0;
  this._pickupPullAngle = 0;
  this._pluckT = 0;
  this._pluckVx = 0;
  this._pluckVy = 0;
  this.playerDragging = false;
  this.dragTargetX = 0;
  this.dragTargetY = 0;
  this.dragStrain = 0;
  this.peelVx = 0;
  this.peelVy = 0;

  var sx, sy, svx = 0, svy = 0;

  if (kind === 'boulder' || kind === 'poop') {
    sx = W * 0.15 + Math.random() * W * 0.7; sy = -2;
    this.grav = def.gravity;
    this.initAngle = Math.random() * Math.PI * 2; /* 随机初始角度 */
  } else if (kind === 'bug') {
    var edge = Math.floor(Math.random() * 4);
    if (edge === 0) { sx = -20; sy = H * 0.05 + Math.random() * H * 0.9; svx = 2.2 + Math.random() * 1.2; svy = (Math.random() - 0.5) * 2; }
    else if (edge === 1) { sx = W + 20; sy = H * 0.05 + Math.random() * H * 0.9; svx = -2.2 - Math.random() * 1.2; svy = (Math.random() - 0.5) * 2; }
    else if (edge === 2) { sx = W * 0.05 + Math.random() * W * 0.9; sy = -20; svx = (Math.random() - 0.5) * 2; svy = 2.2 + Math.random() * 1.2; }
    else { sx = W * 0.05 + Math.random() * W * 0.9; sy = H + 20; svx = (Math.random() - 0.5) * 2; svy = -2.2 - Math.random() * 1.2; }
    this.grav = def.gravity;
    this.svx = svx; this.svy = svy;
    this.buzzFreqX = 0.06 + Math.random() * 0.06;
    this.buzzFreqY = 0.05 + Math.random() * 0.05;
    this.buzzAmp = 14 + Math.random() * 10;
    this.buzzPhaseX = Math.random() * Math.PI * 2;
    this.buzzPhaseY = Math.random() * Math.PI * 2;
    var tcx = W * 0.3 + Math.random() * W * 0.4;
    var tcy = H * 0.3 + Math.random() * H * 0.4;
    var dx0 = tcx - sx, dy0 = tcy - sy;
    var dd0 = Math.sqrt(dx0 * dx0 + dy0 * dy0) || 1;
    this.baseVx = dx0 / dd0 * 2.5;
    this.baseVy = dy0 / dd0 * 2.5;
  } else {
    sx = W * 0.15 + Math.random() * W * 0.7; sy = -5;
    this.grav = def.gravity;
    this.vx = 0; this.vy = 0;
    this.drag = 0.92;
    this.angle = Math.random() * Math.PI * 2;
    this.angleVel = (Math.random() * 2 - 1) * (Math.PI / 6) / 60;
    this.angleDrag = 0.97;
    this.angleTurb = 0.003;
    this.glideForce = 0.055;
    this.swayPhase = Math.random() * Math.PI * 2;
    this.swaySpeed = 0.045 + Math.random() * 0.025;
    this.swayAmp = 0.020 + Math.random() * 0.025;
  }

  this.prevX = sx; this.prevY = sy;
  this.particle = new Particle(new Vec2(sx, sy));
  this.particle.lastPos.mutableSet(new Vec2(sx - svx, sy - svy));
  this.particle._ownerObj = this;
  this.particle._noSimDrag = false;
  if (kind === 'bug') this.particle.__isBug = true;
  if (kind === 'bug') this.particle.__isBug = true;
  this.comp = new Composite();
  this.comp.particles.push(this.particle);
  this.comp.drawParticles = function () { };
  this.comp.drawConstraints = function () { };
  sim.composites.push(this.comp);
}

export function clearObjectConstraints(obj) {
  if (obj.cA) {
    var i = obj.comp.constraints.indexOf(obj.cA);
    if (i !== -1) obj.comp.constraints.splice(i, 1);
    obj.cA = null;
  }
  if (obj.cB) {
    var j = obj.comp.constraints.indexOf(obj.cB);
    if (j !== -1) obj.comp.constraints.splice(j, 1);
    obj.cB = null;
  }
}

ThrownObj.prototype.stickToPoint = function (pt, spiderweb, aliveCheck) {
  if (!pt) return false;
  if (aliveCheck && typeof aliveCheck.isAliveId === 'function') {
    var sid = pt.constraintId != null ? pt.constraintId : (pt.c && pt.c.__webId);
    if (!sid || !aliveCheck.isAliveId(sid)) return false;
    if (!pt.c) pt.c = aliveCheck.getConstraint(sid);
    if (!pt.c) return false;
  } else if (spiderweb.constraints.indexOf(pt.c) === -1) return false;
  var p = this.particle;
  p.pos.mutableSet(new Vec2(pt.x, pt.y));
  p.lastPos.mutableSet(new Vec2(pt.x, pt.y));
  var dA = p.pos.dist(pt.c.a.pos);
  var dB = p.pos.dist(pt.c.b.pos);
  this.stickyFromA = dA;
  this.stickyFromB = dB;
  this.stickyToA = Math.max(this.def.r * 0.4, dA * 0.35);
  this.stickyToB = Math.max(this.def.r * 0.4, dB * 0.35);
  this.cA = new DistanceConstraint(p, pt.c.a, 0.95, dA);
  this.cB = new DistanceConstraint(p, pt.c.b, 0.95, dB);
  this.comp.constraints.push(this.cA);
  this.comp.constraints.push(this.cB);
  this.stuckOnConstraint = pt.c;
  if (this.kind === 'drop') this.angleVel = 0;
  this._stickIsRadial = !!pt.c.isRadial;
  if (this.kind === 'drop') this.angleVel = 0;
  var radial = Math.min(1, pt.radial || 0);
  this.stayFrames = Math.max(30, Math.round(this.def.stayFrames * (1 - radial / 3)));
  this.stuckAngle = this.initAngle; /* 粘住后保持下落时的初始角度 */
  this.state = 'sticking'; this.stickT = 0;

  /* 粘网冲击 */
  var ivx = p.pos.x - p.lastPos.x;
  var ivy = p.pos.y - p.lastPos.y;
  var impactScale = this.def.weight * 1.8;
  var idx = ivx * impactScale, idy = ivy * impactScale;
  pt.c.a.pos.x += idx; pt.c.a.pos.y += idy;
  pt.c.b.pos.x += idx; pt.c.b.pos.y += idy;
  var bounceFactor = this.def.weight * 1.2;
  pt.c.a.lastPos.x += ivx * bounceFactor;
  pt.c.b.lastPos.x += ivx * bounceFactor;

  return true;
};

ThrownObj.prototype.release = function (spiderweb, webBreakFlashes, _breakFrame, onBreakSegment, spatialOpts) {
  var p = this.particle;
  var currentVx = p.pos.x - p.lastPos.x;
  var currentVy = p.pos.y - p.lastPos.y;
  clearObjectConstraints(this);
  audioEngine.playSfxEscape();
  var useBitmap = spatialOpts && spatialOpts.index;

  if (this.stuckOnConstraint) {
    var bc = this.stuckOnConstraint;
    if (this.kind === 'bug') {
      var nearBc = findNearestWebSegment(p.pos.x, p.pos.y, spiderweb, spatialOpts, bc);
      if (nearBc) bc = nearBc;
    }
    if (this.kind !== 'drop') {
      webBreakFlashes.push({
        ax: bc.a.pos.x, ay: bc.a.pos.y,
        bx: bc.b.pos.x, by: bc.b.pos.y,
        t: _breakFrame
      });
    }
    if (onBreakSegment) onBreakSegment(bc, useBitmap ? { skipDirty: false } : null);
    if (useBitmap) {
      if (bc.__webId) spatialOpts.index.removeConstraint(bc.__webId);
    } else {
      var wi = spiderweb.constraints.indexOf(bc);
      if (wi !== -1) spiderweb.constraints.splice(wi, 1);
    }

    /* 记录断裂边信息，创建断线头 */
    createBreakStubs([{ a: bc.a, b: bc.b, distance: bc.distance }], spiderweb, useBitmap ? spatialOpts.index : null);
    this.stuckOnConstraint = null;
  }

  /* 毛毛虫额外破坏 */
  if (this.kind === 'boulder') {
    var bpx = p.pos.x, bpy = p.pos.y, breakR = 32, breakR2 = breakR * breakR;
    var boulderBroken = []; /* 收集所有被破坏的边信息 */
    if (useBitmap) {
      var idx = spatialOpts.index;
      var cs = spiderweb.constraints;
      for (var bi = 0; bi < cs.length; bi++) {
        var c = cs[bi];
        if (!(c instanceof DistanceConstraint)) continue;
        if (c.__webGlobal) continue;
        if (!c.__webId || !idx.isAliveId(c.__webId)) continue;
        var ax = c.a.pos.x - bpx, ay = c.a.pos.y - bpy;
        var bx2 = c.b.pos.x - bpx, by2 = c.b.pos.y - bpy;
        var keep = (ax * ax + ay * ay > breakR2) || (bx2 * bx2 + by2 * by2 > breakR2);
        if (keep) continue;
        boulderBroken.push({ a: c.a, b: c.b, distance: c.distance });
        idx.removeConstraint(c.__webId);
        if (onBreakSegment) onBreakSegment(c, { skipDirty: true });
        webBreakFlashes.push({
          ax: c.a.pos.x, ay: c.a.pos.y,
          bx: c.b.pos.x, by: c.b.pos.y,
          t: _breakFrame
        });
      }
      if (spatialOpts.markDirtyAABB) {
        spatialOpts.markDirtyAABB(bpx - breakR, bpy - breakR, bpx + breakR, bpy + breakR);
      }
    } else {
      spiderweb.constraints = spiderweb.constraints.filter(function (c) {
        if (!(c instanceof DistanceConstraint)) return true;
        var ax = c.a.pos.x - bpx, ay = c.a.pos.y - bpy;
        var bx2 = c.b.pos.x - bpx, by2 = c.b.pos.y - bpy;
        var keep = (ax * ax + ay * ay > breakR2) || (bx2 * bx2 + by2 * by2 > breakR2);
        if (!keep) boulderBroken.push({ a: c.a, b: c.b, distance: c.distance });
        return keep;
      });
      for (var ri = 0; ri < boulderBroken.length; ri++) {
        if (onBreakSegment) onBreakSegment(boulderBroken[ri]);
        webBreakFlashes.push({
          ax: boulderBroken[ri].a.pos.x, ay: boulderBroken[ri].a.pos.y,
          bx: boulderBroken[ri].b.pos.x, by: boulderBroken[ri].b.pos.y,
          t: _breakFrame
        });
      }
    }
    /* 根据破坏边数量生成线头 */
    if (boulderBroken.length > 0) {
      createBreakStubs(boulderBroken, spiderweb, useBitmap ? spatialOpts.index : null);
    }
  }

  /* 对所有 stub 执行链折叠，再清理尾巴 */
  /* 先收集再处理，避免遍历中 splice 导致跳过 */
  var _si = useBitmap ? spatialOpts.index : null;
  var stubList = [];
  for (var sci = 0; sci < spiderweb.particles.length; sci++) {
    if (spiderweb.particles[sci].__isStub) stubList.push(spiderweb.particles[sci]);
  }
  for (var sci2 = 0; sci2 < stubList.length; sci2++) {
    collapseChain(stubList[sci2], spiderweb, _si);
  }
  cleanDanglingTails(spiderweb, _si);

  var W = this._W, H = this._H; // set by main when creating

  if (this.kind === 'bug') {
    this.state = 'falling';
    this.grav = 0;
    this.enteredWebZone = false;
    this.hitHistory = [];
    this._hitHistoryCount = 0;
    this.penetrationDist = 0;
    this.released = true;
    this._releaseFrame = this.animT;
    this._escapeCount = (this._escapeCount || 0) + 1; /* 挣脱次数累计 */
    this._reStickDelay = 160 + Math.floor(Math.random() * 120); /* 乱飞多少帧后重新找网 */
    this._reStickTimer = 0;
    var escapeAngle = Math.atan2(p.pos.y - H / 2, p.pos.x - W / 2) + (Math.random() - 0.5) * 1.2;
    var escapeSpeed = 4 + Math.random() * 2.5;
    this.baseVx = Math.cos(escapeAngle) * escapeSpeed;
    this.baseVy = Math.sin(escapeAngle) * escapeSpeed;
    this.buzzFreqX = 0.08 + Math.random() * 0.06;
    this.buzzFreqY = 0.07 + Math.random() * 0.05;
    this.buzzAmp = 10 + Math.random() * 8;
    this.buzzPhaseX = Math.random() * Math.PI * 2;
    this.buzzPhaseY = Math.random() * Math.PI * 2;
    p.lastPos.x = p.pos.x - this.baseVx;
    p.lastPos.y = p.pos.y - this.baseVy;
  } else {
    this.state = 'falling2';
    p.lastPos.x = p.pos.x - currentVx;
    var releaseKick = this.kind === 'boulder'
      ? this.def.weight * 0.405
      : this.def.weight * 0.45;
    p.lastPos.y = p.pos.y - (currentVy + releaseKick);
  }
};

ThrownObj.prototype.peelOff = function (dragDx, dragDy) {
  var p = this.particle;
  clearObjectConstraints(this);
  this.stuckOnConstraint = null;
  this.playerDragging = false;
  this.dragStrain = 0;
  this.state = 'falling2';
  this.alpha = 1;
  var len = Math.sqrt(dragDx * dragDx + dragDy * dragDy) || 1;
  var speed = 6.8;
  this.peelVx = (dragDx / len) * speed;
  this.peelVy = (dragDy / len) * speed;
  this.vx = this.peelVx;
  this.vy = this.peelVy;
  p.lastPos.x = p.pos.x - this.peelVx;
  p.lastPos.y = p.pos.y - this.peelVy;
};

ThrownObj.prototype.destroy = function (sim) {
  var i = sim.composites.indexOf(this.comp);
  if (i !== -1) sim.composites.splice(i, 1);
};
