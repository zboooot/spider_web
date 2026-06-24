import { Vec2 } from '../engine/Vec2.js';
import { DistanceConstraint } from '../engine/constraints.js';
import { audioEngine } from '../audio/audioEngine.js';
import { isCandidateOnAnchoredWeb } from './navigationGraph.js';

var DEFAULT_GAIT_TUNE = {
  minStepDistMove: 28,
  minStepDistIdle: 22,
  maxHipTargetDist: 60,
  segPenaltyMoving: 160,
  segPenaltyLowMove: 280,
  segPenaltyStable: 760,
  forwardMinProgressMove: 18,
  forwardMinProgressIdle: 10,
  forwardProgressPenalty: 18,
  holdNodeBase: 4,
  holdNodeScale: 0.04,
  holdNodeMin: 2,
  holdNodeMax: 5,
  holdSegBase: 5,
  holdSegScale: 0.05,
  holdSegMin: 2,
  holdSegMax: 6,
  rejectCooldownShort: 4,
  rejectCooldownLong: 8
};

function _getGaitTune() {
  if (typeof window !== 'undefined' && window._gaitTune) {
    return window._gaitTune;
  }
  return DEFAULT_GAIT_TUNE;
}

/**
 * 落脚点搜索的全局粒子 ID 计数器
 */
var _pid = 0;
export function getNextPid() { return ++_pid; }
export function getPidCounter() { return _pid; }

function _persistStepPoint(sp) {
  if (!sp) return null;
  if (sp.type === 'node') return { type: 'node', particle: sp.particle, x: sp.x, y: sp.y };
  return { type: 'segment', pa: sp.pa, pb: sp.pb, t: sp.t, x: sp.x, y: sp.y };
}

/**
 * 工具函数：洗牌
 */
export function shuffle(o) {
  for (var j, x, i = o.length; i; j = parseInt(Math.random() * i), x = o[--i], o[i] = o[j], o[j] = x);
  return o;
}

/* ─── Foothold 唯一身份 key ─────────────────────────────────────────── */

/**
 * 为网络节点生成唯一 key
 */
export function getNodeFootholdKey(particle) {
  if (!particle || !particle.__pid) return null;
  return 'node:' + particle.__pid;
}

/**
 * 为网络线段生成唯一 key（t 离散到 4 档，方向无关）
 */
export function getSegmentFootholdKey(pa, pb, t) {
  if (!pa || !pb || !pa.__pid || !pb.__pid) return null;
  var minPid = Math.min(pa.__pid, pb.__pid);
  var maxPid = Math.max(pa.__pid, pb.__pid);
  var bucket = Math.round(t * 4) / 4;
  return 'seg:' + minPid + '-' + maxPid + '@' + bucket;
}

/**
 * 从候选点对象生成 foothold key
 */
export function getCandidateFootholdKey(cand) {
  if (!cand) return null;
  if (cand.type === 'node') return getNodeFootholdKey(cand.particle);
  if (cand.type === 'segment') return getSegmentFootholdKey(cand.pa, cand.pb, cand.t);
  return null;
}

/* ─── Sample points ─────────────────────────────────────────────────── */

/**
 * 获取网约束上的采样点
 * t 离散到固定槽位 [0.25, 0.5, 0.75]，减少"几乎重合"的 foothold 候选
 */
export function getWebSamplePoints(webComposite, N) {
  var pts = [];
  var slots = [0.25, 0.5, 0.75];
  for (var i in webComposite.constraints) {
    var c = webComposite.constraints[i];
    if (!(c instanceof DistanceConstraint)) continue;
    for (var si = 0; si < slots.length; si++) {
      var t = slots[si];
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

/* ─── Candidate collection ───────────────────────────────────────────── */

/**
 * 从 spatial index 局部查询候选（性能路径）
 * 返回统一格式 candidates，供 findStepTarget 评分使用
 *
 * @param {object} webComp
 * @param {object} thorax        Vec2-like，蜘蛛胸部位置
 * @param {number} minR          最小搜索半径
 * @param {number} stepR         最大搜索半径
 * @param {object} spatialOpts   { index: SpatialIndexService, queryBuf: Int32Array }
 * @param {object} aliveParticles  已知存活粒子 pid→true（外部预建）
 * @param {object} aliveEdges      已知存活边 'pidA-pidB'→true（外部预建）
 * @returns {Array} candidates
 */
function collectCandidatesSpatial(webComp, thorax, minR, stepR, spatialOpts, aliveParticles, aliveEdges) {
  var cands = [];
  var minR2 = minR * minR, stepR2 = stepR * stepR;
  var index = spatialOpts.index;
  var queryBuf = spatialOpts.queryBuf;
  var count = index.queryAABB(
    thorax.x - stepR, thorax.x + stepR,
    thorax.y - stepR, thorax.y + stepR,
    queryBuf
  );
  var slots = [0.25, 0.5, 0.75];
  for (var qi = 0; qi < count; qi++) {
    var id = queryBuf[qi];
    if (!index.isAliveId(id)) continue;
    var c = index.getConstraint(id);
    if (!c) continue;

    /* node candidates from both endpoints */
    var pidA = c.a.__pid || (c.a.__pid = getNextPid());
    var pidB = c.b.__pid || (c.b.__pid = getNextPid());
    aliveParticles[pidA] = true;
    aliveParticles[pidB] = true;
    var eKey = pidA < pidB ? pidA + '-' + pidB : pidB + '-' + pidA;
    aliveEdges[eKey] = true;

    var d2A = c.a.pos.dist2(thorax);
    if (d2A >= minR2 && d2A <= stepR2) {
      cands.push({ type: 'node', particle: c.a, x: c.a.pos.x, y: c.a.pos.y });
    }
    var d2B = c.b.pos.dist2(thorax);
    if (d2B >= minR2 && d2B <= stepR2) {
      cands.push({ type: 'node', particle: c.b, x: c.b.pos.x, y: c.b.pos.y });
    }

    /* segment sample candidates */
    for (var si = 0; si < slots.length; si++) {
      var t = slots[si];
      var sx = c.a.pos.x + (c.b.pos.x - c.a.pos.x) * t;
      var sy = c.a.pos.y + (c.b.pos.y - c.a.pos.y) * t;
      var ddx = sx - thorax.x, ddy = sy - thorax.y;
      var d2 = ddx * ddx + ddy * ddy;
      if (d2 >= minR2 && d2 <= stepR2) {
        cands.push({ type: 'segment', pa: c.a, pb: c.b, t: t, x: sx, y: sy });
      }
    }
  }
  return cands;
}

/**
 * 全量扫描候选（fallback / legacy 路径）
 * 当 spatial index 不可用，或 spatial 结果为空时使用
 *
 * @param {object} webComp
 * @param {object} thorax
 * @param {Array}  samplePoints  预计算的 segment 采样点列表
 * @param {number} minR
 * @param {number} stepR
 * @param {object} aliveParticles  输出：收集到的存活粒子 pid 集合
 * @param {object} aliveEdges      输出：收集到的存活边 key 集合
 * @returns {Array} candidates
 */
function collectCandidatesFullScan(webComp, thorax, samplePoints, minR, stepR, aliveParticles, aliveEdges) {
  var minR2 = minR * minR, stepR2 = stepR * stepR;
  var cands = [];

  for (var ai = 0; ai < webComp.constraints.length; ai++) {
    var ac = webComp.constraints[ai];
    if (!(ac instanceof DistanceConstraint)) continue;
    var pidA = ac.a.__pid || (ac.a.__pid = getNextPid());
    var pidB = ac.b.__pid || (ac.b.__pid = getNextPid());
    aliveParticles[pidA] = true;
    aliveParticles[pidB] = true;
    var eKey = pidA < pidB ? pidA + '-' + pidB : pidB + '-' + pidA;
    aliveEdges[eKey] = true;
  }

  for (var i in webComp.particles) {
    var wp = webComp.particles[i];
    var d2 = wp.pos.dist2(thorax);
    if (d2 >= minR2 && d2 <= stepR2) {
      if (!wp.__pid || !aliveParticles[wp.__pid]) continue;
      cands.push({ type: 'node', particle: wp, x: wp.pos.x, y: wp.pos.y });
    }
  }
  for (var si = 0; si < samplePoints.length; si++) {
    var sp = samplePoints[si];
    var ddx = sp.x - thorax.x, ddy = sp.y - thorax.y;
    var d2s = ddx * ddx + ddy * ddy;
    if (d2s >= minR2 && d2s <= stepR2) {
      var paPid = sp.pa.__pid, pbPid = sp.pb.__pid;
      if (!paPid || !pbPid) continue;
      if (!aliveParticles[paPid] || !aliveParticles[pbPid]) continue;
      var spEdgeKey = paPid < pbPid ? paPid + '-' + pbPid : pbPid + '-' + paPid;
      if (!aliveEdges[spEdgeKey]) continue;
      cands.push(sp);
    }
  }
  return cands;
}

/* ─── findStepTarget ─────────────────────────────────────────────────── */

/**
 * 寻找最佳落脚目标
 *
 * @param {object}   webComp
 * @param {number}   legIndex
 * @param {object}   spiderComp
 * @param {object}   moveDir
 * @param {Array}    samplePoints        全量采样点（spatial 不可用时使用）
 * @param {Array}    occupiedPositions   其他腿当前位置（软间距）
 * @param {Array}    occupiedSegments    其他腿连线（交叉惩罚）
 * @param {number}   maxStepR            最大搜索半径覆盖
 * @param {boolean}  preferStable        偏向稳定落点（加大 segment 惩罚）
 * @param {object}   currentFootPos      当前脚位置（forward progress 参考）
 * @param {Set|null} occupiedFootholds   其他腿占用的 foothold key（硬排除）
 * @param {object}   spatialOpts         { index, queryBuf }，为 null 则全量扫描
 * @param {boolean}  filterAnchored      仅保留锚定连通子网上的落脚点（默认 true）
 * @param {number}   stuckTier           卡住分级：放宽搜索与评分（0=正常）
 */
export function findStepTarget(webComp, legIndex, spiderComp, moveDir, samplePoints, occupiedPositions, occupiedSegments, maxStepR, preferStable, currentFootPos, occupiedFootholds, spatialOpts, filterAnchored, stuckTier) {
  if (typeof window !== 'undefined' && window._spiderStats) window._spiderStats.findStepTargetCalls = (window._spiderStats.findStepTargetCalls || 0) + 1;
  var tune = _getGaitTune();
  stuckTier = stuckTier || 0;
  var stepR = maxStepR || 42;
  var minR = stuckTier >= 2 ? 10 : (stuckTier >= 1 ? 12 : 16);
  var MIN_LEG_SEP = stuckTier >= 2 ? 11 : 14;
  var MIN_STEP_PROGRESS = stuckTier >= 2 ? 12 : 20;
  var thorax = spiderComp.particles[0].pos;
  var head = spiderComp.particles[1].pos;
  var fx = head.x - thorax.x, fy = head.y - thorax.y;
  var fl = Math.sqrt(fx * fx + fy * fy) || 1;
  fx /= fl; fy /= fl;
  var rightX = fy, rightY = -fx;
  var isRightLeg = (legIndex === 0 || legIndex === 2);
  var sideMargin = Math.max(2, MIN_LEG_SEP * 0.2);
  var moveLen = moveDir ? Math.sqrt(moveDir.x * moveDir.x + moveDir.y * moveDir.y) : 0;
  var isFrontLeg = (legIndex === 0 || legIndex === 1);
  var legReachBias = isFrontLeg ? 6 : -4;
  var idealDist = 24 + legReachBias + (moveDir ? moveLen * 18 : 0);
  var theta = spiderComp.particles[0].pos.angle2(
    spiderComp.particles[0].pos.add(new Vec2(1, 0)), spiderComp.particles[1].pos);
  var legAngles = [-0.22, Math.PI + 0.22, 0.28, Math.PI - 0.28];
  var la = theta + legAngles[legIndex];
  var ix = thorax.x + Math.cos(la) * idealDist, iy = thorax.y + Math.sin(la) * idealDist;
  var moveFwdBias = isFrontLeg ? 30 : 18;
  if (moveDir) { ix += moveDir.x * moveFwdBias; iy += moveDir.y * moveFwdBias; }

  /* ── 候选收集：优先 spatial，fallback 全量扫描 ── */
  var aliveParticles = {};
  var aliveEdges = {};
  var cands;

  if (spatialOpts && spatialOpts.index) {
    /* spatial 路径：局部 AABB 查询，更快 */
    cands = collectCandidatesSpatial(webComp, thorax, minR, stepR, spatialOpts, aliveParticles, aliveEdges);
    /* 若 spatial 结果为空（冷启动/边界情况），fallback 到全量扫描 */
    if (!cands.length) {
      cands = collectCandidatesFullScan(webComp, thorax, samplePoints, minR, stepR, aliveParticles, aliveEdges);
      if (typeof window !== 'undefined' && window._spiderStats) window._spiderStats.spatialFallbacks = (window._spiderStats.spatialFallbacks || 0) + 1;
    }
  } else {
    /* legacy 全量扫描路径 */
    cands = collectCandidatesFullScan(webComp, thorax, samplePoints, minR, stepR, aliveParticles, aliveEdges);
  }

  if (!cands.length) return null;

  if (filterAnchored !== false) {
    cands = cands.filter(function (c) { return isCandidateOnAnchoredWeb(c, webComp, spatialOpts); });
    if (!cands.length) return null;
  }

  var candsBeforeFootholdFilter = cands;

  /* ── 硬排除：同 foothold key 已被其他腿占用 ── */
  if (occupiedFootholds && occupiedFootholds.size > 0) {
    cands = cands.filter(function (c) {
      var k = getCandidateFootholdKey(c);
      return !k || !occupiedFootholds.has(k);
    });
    if (!cands.length && stuckTier >= 2) cands = candsBeforeFootholdFilter;
    if (!cands.length) return null;
  }

  /* ── 评分辅助函数 ── */
  function sideOk(cand) {
    var side = (cand.x - thorax.x) * rightX + (cand.y - thorax.y) * rightY;
    return isRightLeg ? side >= sideMargin : side <= -sideMargin;
  }

  function ccw(ax, ay, bx, by, cx, cy) {
    return (cy - ay) * (bx - ax) > (by - ay) * (cx - ax);
  }

  function segIntersects(a1x, a1y, a2x, a2y, b1x, b1y, b2x, b2y) {
    return ccw(a1x, a1y, b1x, b1y, b2x, b2y) !== ccw(a2x, a2y, b1x, b1y, b2x, b2y)
      && ccw(a1x, a1y, a2x, a2y, b1x, b1y) !== ccw(a1x, a1y, a2x, a2y, b2x, b2y);
  }

  function crossesOccupied(cand) {
    if (!occupiedSegments || !occupiedSegments.length) return false;
    var hip = spiderComp.legChains && spiderComp.legChains[legIndex] && spiderComp.legChains[legIndex][0]
      ? spiderComp.legChains[legIndex][0].pos
      : thorax;
    for (var si2 = 0; si2 < occupiedSegments.length; si2++) {
      var os = occupiedSegments[si2];
      if (segIntersects(hip.x, hip.y, cand.x, cand.y, os.hx, os.hy, os.fx, os.fy)) return true;
    }
    return false;
  }

  function tooCloseToOccupied(cx, cy) {
    if (!occupiedPositions) return false;
    for (var oi = 0; oi < occupiedPositions.length; oi++) {
      var ox = occupiedPositions[oi].x, oy = occupiedPositions[oi].y;
      var dx = cx - ox, dy = cy - oy;
      if (dx * dx + dy * dy < MIN_LEG_SEP * MIN_LEG_SEP) return true;
    }
    return false;
  }

  var CROSS_PENALTY = 8000;
  var SIDE_PENALTY  = 3000;
  var SEG_PENALTY = preferStable ? tune.segPenaltyStable : (moveLen > 0.2 ? tune.segPenaltyMoving : tune.segPenaltyLowMove);
  var FORWARD_MIN_PROGRESS = moveLen > 0.2 ? tune.forwardMinProgressMove : tune.forwardMinProgressIdle;
  if (stuckTier >= 2) {
    SEG_PENALTY *= 0.35;
    FORWARD_MIN_PROGRESS *= 0.5;
  } else if (stuckTier >= 1) {
    SEG_PENALTY *= 0.6;
    FORWARD_MIN_PROGRESS *= 0.75;
  }

  /**
   * 候选评分 — 保留当前分支全部评分规则
   */
  function scoreCandidate(cand, mode) {
    mode = mode || {};
    var cx = cand.x, cy = cand.y;
    var dx = cx - ix, dy = cy - iy;
    var base = dx * dx + dy * dy;
    var penalty = 0;

    if (!mode.relaxSide && !sideOk(cand)) penalty += SIDE_PENALTY;
    if (!mode.relaxCross && crossesOccupied(cand)) penalty += CROSS_PENALTY;

    if (currentFootPos) {
      var rdx = cx - currentFootPos.x, rdy = cy - currentFootPos.y;
      var progressSq = rdx * rdx + rdy * rdy;
      if (!mode.relaxProgress && progressSq < MIN_STEP_PROGRESS * MIN_STEP_PROGRESS) {
        var deficit = MIN_STEP_PROGRESS * MIN_STEP_PROGRESS - progressSq;
        penalty += deficit * deficit / (MIN_STEP_PROGRESS * MIN_STEP_PROGRESS) * 8;
      }
      if (moveDir && moveLen > 0.01) {
        var prog = rdx * moveDir.x + rdy * moveDir.y;
        if (prog < 0) penalty += prog * prog * 3;
        if (!mode.relaxProgress && prog < FORWARD_MIN_PROGRESS) {
          var fDef = FORWARD_MIN_PROGRESS - prog;
          penalty += fDef * fDef * tune.forwardProgressPenalty;
        }
      }
    }

    if (occupiedPositions) {
      for (var oi = 0; oi < occupiedPositions.length; oi++) {
        var ox = occupiedPositions[oi].x, oy = occupiedPositions[oi].y;
        var dox = cx - ox, doy = cy - oy;
        var dsq = dox * dox + doy * doy;
        if (dsq < MIN_LEG_SEP * MIN_LEG_SEP * 4) {
          penalty += MIN_LEG_SEP * MIN_LEG_SEP * 4 / (dsq + 1) * 2000;
        }
      }
    }

    /* node 优先：segment 额外惩罚 */
    if (cand.type === 'segment') penalty += SEG_PENALTY;

    return base + penalty;
  }

  var hardFree = cands.filter(function (c) { return !tooCloseToOccupied(c.x, c.y); });
  var pool = hardFree.length ? hardFree : cands;

  /* tiered relax：先严格，再逐步放宽 */
  var tierModes = [
    { relaxCross: false, relaxSide: false, relaxProgress: false },
    { relaxCross: true,  relaxSide: false, relaxProgress: false },
    { relaxCross: true,  relaxSide: true,  relaxProgress: true }
  ];

  var best = null, bs = Number.POSITIVE_INFINITY;
  for (var tm = 0; tm < tierModes.length; tm++) {
    var mode = tierModes[tm];
    for (var ci = 0; ci < pool.length; ci++) {
      var s = scoreCandidate(pool[ci], mode);
      if (s < bs) { best = pool[ci]; bs = s; }
    }
    if (best) break;
  }

  return best || null;
}

/* ─── liftFoot ───────────────────────────────────────────────────────── */

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

/* ─── landFoot ───────────────────────────────────────────────────────── */

/**
 * 落脚：建立约束
 * @param {Array|null} footState  全部腿状态，用于二次冲突校验；可选
 */
export function landFoot(fs, spider, spiderweb, footState) {
  var tune = _getGaitTune();
  var sp = fs.targetStepPoint;
  var stepLen = fs && fs.from && fs.targetPos ? fs.from.dist(fs.targetPos) : 0;
  fs.targetStepPoint = null;
  var cdShort = tune.rejectCooldownShort || 4;
  var cdLong  = tune.rejectCooldownLong  || 8;
  if (!sp) { liftFoot(fs, spider); fs.cooldown = Math.max(fs.cooldown || 0, cdShort); if (typeof window !== 'undefined' && window._spiderStats) window._spiderStats.landFootRejects = (window._spiderStats.landFootRejects || 0) + 1; return; }

  /* ── 二次 foothold key 冲突检查（最终保险丝） ── */
  if (footState) {
    var myKey = getCandidateFootholdKey(sp);
    if (myKey) {
      for (var ci = 0; ci < footState.length; ci++) {
        var other = footState[ci];
        if (other === fs) continue;
        var otherKey = null;
        if (other.landedNode) otherKey = getNodeFootholdKey(other.landedNode);
        else if (other.landedSeg) otherKey = getSegmentFootholdKey(other.landedSeg.pa, other.landedSeg.pb, other.landedSeg.t);
        if (otherKey && otherKey === myKey) {
          liftFoot(fs, spider);
          fs.cooldown = Math.max(fs.cooldown || 0, cdLong);
          if (typeof window !== 'undefined' && window._spiderStats) window._spiderStats.landFootRejects = (window._spiderStats.landFootRejects || 0) + 1;
          return;
        }
        if (other.targetStepPoint) {
          var targetKey = getCandidateFootholdKey(other.targetStepPoint);
          if (targetKey && targetKey === myKey) {
            liftFoot(fs, spider);
            fs.cooldown = Math.max(fs.cooldown || 0, cdLong);
            if (typeof window !== 'undefined' && window._spiderStats) window._spiderStats.landFootRejects = (window._spiderStats.landFootRejects || 0) + 1;
            return;
          }
        }
      }
    }
  }

  if (sp.type === 'node') {
    if (!sp.particle || !sp.particle.__pid) { liftFoot(fs, spider); fs.cooldown = Math.max(fs.cooldown || 0, cdShort); return; }
    if (spiderweb) {
      var alive = false;
      var wcs = spiderweb.constraints;
      for (var wi = 0; wi < wcs.length; wi++) {
        var wc = wcs[wi];
        if (!(wc instanceof DistanceConstraint)) continue;
        if (wc.a === sp.particle || wc.b === sp.particle) { alive = true; break; }
      }
      if (!alive) { liftFoot(fs, spider); fs.cooldown = Math.max(fs.cooldown || 0, cdShort); return; }
    }
    liftFoot(fs, spider);
    audioEngine.playSfxFootstep();
    var d = fs.particle.pos.dist(sp.particle.pos);
    var c = new DistanceConstraint(fs.particle, sp.particle, 1, d);
    spider.constraints.push(c);
    fs.constraintA = c;
    fs.landedNode = sp.particle;
    fs.holdFrames = Math.max(tune.holdNodeMin, Math.min(tune.holdNodeMax, tune.holdNodeBase - stepLen * tune.holdNodeScale));
  } else {
    if (!sp.pa || !sp.pb) { liftFoot(fs, spider); fs.cooldown = Math.max(fs.cooldown || 0, cdShort); return; }
    if (spiderweb) {
      var paAlive = false, pbAlive = false, edgeAlive = false;
      var paPid2 = sp.pa.__pid, pbPid2 = sp.pb.__pid;
      var wcs2 = spiderweb.constraints;
      for (var wi2 = 0; wi2 < wcs2.length; wi2++) {
        var wc2 = wcs2[wi2];
        if (!(wc2 instanceof DistanceConstraint)) continue;
        if (wc2.a === sp.pa || wc2.b === sp.pa) paAlive = true;
        if (wc2.a === sp.pb || wc2.b === sp.pb) pbAlive = true;
        if (paPid2 && pbPid2 &&
            ((wc2.a === sp.pa && wc2.b === sp.pb) || (wc2.a === sp.pb && wc2.b === sp.pa))) {
          edgeAlive = true;
        }
        if (paAlive && pbAlive && edgeAlive) break;
      }
      if (!paAlive || !pbAlive || !edgeAlive) { liftFoot(fs, spider); fs.cooldown = Math.max(fs.cooldown || 0, cdShort); return; }
    }
    liftFoot(fs, spider);
    audioEngine.playSfxFootstep();
    var dA = fs.particle.pos.dist(sp.pa.pos), dB = fs.particle.pos.dist(sp.pb.pos);
    var cA = new DistanceConstraint(fs.particle, sp.pa, 1, dA);
    var cB = new DistanceConstraint(fs.particle, sp.pb, 1, dB);
    spider.constraints.push(cA);
    spider.constraints.push(cB);
    fs.constraintA = cA;
    fs.constraintB = cB;
    fs.landedSeg = _persistStepPoint(sp);
    fs.holdFrames = Math.max(tune.holdSegMin, Math.min(tune.holdSegMax, tune.holdSegBase - stepLen * tune.holdSegScale));
  }
}

/* ─── triggerStep ────────────────────────────────────────────────────── */

/**
 * 收集当前腿的占用上下文（其他腿的位置、foothold、连线）
 * @returns {{ occupied, occupiedSegments, occupiedFootholds }}
 */
function buildOccupiedStepContext(i, footState, spider) {
  var occupied = [];
  var occupiedSegments = [];
  var occupiedFootholds = new Set();

  for (var oi = 0; oi < footState.length; oi++) {
    if (oi === i) continue;
    var other = footState[oi];
    occupied.push({ x: other.current.x, y: other.current.y });

    if (other.landedNode) {
      var nk = getNodeFootholdKey(other.landedNode);
      if (nk) occupiedFootholds.add(nk);
    } else if (other.landedSeg) {
      var sk = getSegmentFootholdKey(other.landedSeg.pa, other.landedSeg.pb, other.landedSeg.t);
      if (sk) occupiedFootholds.add(sk);
    }
    if (other.targetStepPoint) {
      var tk = getCandidateFootholdKey(other.targetStepPoint);
      if (tk) occupiedFootholds.add(tk);
    }

    if (other.stepping) continue;
    var hip = spider.legChains && spider.legChains[oi] && spider.legChains[oi][0]
      ? spider.legChains[oi][0].pos
      : spider.particles[0].pos;
    occupiedSegments.push({ hx: hip.x, hy: hip.y, fx: other.current.x, fy: other.current.y });
  }

  return { occupied: occupied, occupiedSegments: occupiedSegments, occupiedFootholds: occupiedFootholds };
}

/**
 * 触发迈步
 *
 * @param {number}  i             腿索引
 * @param {object}  md            移动方向 Vec2（可为 null）
 * @param {Array}   footState     全部腿状态
 * @param {object}  spiderweb     网 composite
 * @param {object}  spider        蜘蛛 composite
 * @param {Array}   samplePoints  全量采样点（spatial 不可用时 fallback）
 * @param {object}  moveDir       移动方向（用于 minStepDist 判断）
 * @param {number}  STEP_COOLDOWN 迈步冷却帧数
 * @param {number}  maxStepR      最大搜索半径覆盖（可选）
 * @param {boolean} preferStable  偏好稳定点（可选）
 * @param {object}  spatialOpts   { index, queryBuf }，null 则 fallback 全量（可选）
 * @param {number}  stuckTier     卡住分级（0=正常）
 */
export function triggerStep(i, md, footState, spiderweb, spider, samplePoints, moveDir, STEP_COOLDOWN, maxStepR, preferStable, spatialOpts, stuckTier) {
  var tune = _getGaitTune();
  stuckTier = stuckTier || 0;
  var fs = footState[i];
  if (!fs || fs.stepping || fs.cooldown > 0) return;

  if (stuckTier >= 2) preferStable = false;

  var ctx = buildOccupiedStepContext(i, footState, spider);

  var sp = findStepTarget(
    spiderweb, i, spider, md || null, samplePoints,
    ctx.occupied, ctx.occupiedSegments,
    maxStepR, preferStable,
    { x: fs.current.x, y: fs.current.y },
    ctx.occupiedFootholds,
    spatialOpts || null,
    true,
    stuckTier
  );
  if (!sp) return;

  var hip = spider.legChains && spider.legChains[i] && spider.legChains[i][0]
    ? spider.legChains[i][0].pos
    : spider.particles[0].pos;
  var hdx = sp.x - hip.x, hdy = sp.y - hip.y;
  var hipMax = tune.maxHipTargetDist * (stuckTier >= 2 ? 1.18 : 1);
  if (hdx * hdx + hdy * hdy > hipMax * hipMax) return;

  var dx = sp.x - fs.current.x, dy = sp.y - fs.current.y;
  var stepMoveLen = md ? Math.sqrt(md.x * md.x + md.y * md.y) : 0;
  var minStepDist = (preferStable && stepMoveLen > 0 && maxStepR != null)
    ? tune.minStepDistIdle
    : (stepMoveLen > 0.2 ? tune.minStepDistMove : tune.minStepDistIdle);
  if (stuckTier >= 2) minStepDist *= 0.55;
  else if (stuckTier >= 1) minStepDist *= 0.78;
  if (dx * dx + dy * dy < minStepDist * minStepDist) return;

  liftFoot(fs, spider);
  fs.from = new Vec2(fs.current.x, fs.current.y);
  fs.targetPos = new Vec2(sp.x, sp.y);
  fs.targetStepPoint = _persistStepPoint(sp);
  fs.stepping = true;
  fs.t = 0;
  fs.cooldown = STEP_COOLDOWN;
}
