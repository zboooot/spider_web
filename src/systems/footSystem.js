import { Vec2 } from '../engine/Vec2.js';
import { DistanceConstraint } from '../engine/constraints.js';
import { audioEngine } from '../audio/audioEngine.js';

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
  holdNodeBase: 11,
  holdNodeScale: 0.08,
  holdNodeMin: 6,
  holdNodeMax: 12,
  holdSegBase: 14,
  holdSegScale: 0.1,
  holdSegMin: 8,
  holdSegMax: 16
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
 * @param {object} pa
 * @param {object} pb
 * @param {number} t  0~1
 */
export function getSegmentFootholdKey(pa, pb, t) {
  if (!pa || !pb || !pa.__pid || !pb.__pid) return null;
  var minPid = Math.min(pa.__pid, pb.__pid);
  var maxPid = Math.max(pa.__pid, pb.__pid);
  /* 离散到 4 档: 0.25 / 0.5 / 0.75 / 1.0 → 用 round(t*4)/4 */
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
  /* 固定槽位，忽略传入的 N 参数（保留参数以免旧调用出错） */
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

/* ─── findStepTarget ─────────────────────────────────────────────────── */

/**
 * 寻找最佳落脚目标
 * @param {Set|null} occupiedFootholds  其他腿已占用的 foothold key 集合（硬排除）
 */
export function findStepTarget(webComp, legIndex, spiderComp, moveDir, samplePoints, occupiedPositions, occupiedSegments, maxStepR, preferStable, currentFootPos, occupiedFootholds) {
  if (typeof window !== 'undefined' && window._spiderStats) window._spiderStats.findStepTargetCalls = (window._spiderStats.findStepTargetCalls || 0) + 1;
  var tune = _getGaitTune();
  var stepR = maxStepR || 42, minR = 16;
  var MIN_LEG_SEP = 14;
  var MIN_STEP_PROGRESS = 20;
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

  var aliveParticles = {};
  var aliveEdges = {};
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
      var paPid = sp.pa.__pid, pbPid = sp.pb.__pid;
      if (!paPid || !pbPid) continue;
      if (!aliveParticles[paPid] || !aliveParticles[pbPid]) continue;
      var spEdgeKey = paPid < pbPid ? paPid + '-' + pbPid : pbPid + '-' + paPid;
      if (!aliveEdges[spEdgeKey]) continue;
      cands.push(sp);
    }
  }
  if (!cands.length) return null;

  /* 硬排除：同 foothold key 已被其他腿占用 */
  if (occupiedFootholds && occupiedFootholds.size > 0) {
    cands = cands.filter(function (c) {
      var k = getCandidateFootholdKey(c);
      return !k || !occupiedFootholds.has(k);
    });
    if (!cands.length) return null;
  }

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

  function score(cand, mode) {
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

    /* node 优先：segment 额外惩罚，鼓励优先踩节点 */
    if (cand.type === 'segment') penalty += SEG_PENALTY;

    return base + penalty;
  }

  var hardFree = cands.filter(function (c) { return !tooCloseToOccupied(c.x, c.y); });
  var pool = hardFree.length ? hardFree : cands;

  var tierModes = [
    { relaxCross: false, relaxSide: false, relaxProgress: false },
    { relaxCross: true,  relaxSide: false, relaxProgress: false },
    { relaxCross: true,  relaxSide: true,  relaxProgress: true }
  ];

  var best = null, bs = Number.POSITIVE_INFINITY;
  for (var tm = 0; tm < tierModes.length; tm++) {
    var mode = tierModes[tm];
    for (var ci = 0; ci < pool.length; ci++) {
      var s = score(pool[ci], mode);
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
  if (!sp) { liftFoot(fs, spider); fs.cooldown = Math.max(fs.cooldown || 0, 12); if (typeof window !== 'undefined' && window._spiderStats) window._spiderStats.landFootRejects = (window._spiderStats.landFootRejects || 0) + 1; return; }

  /* ── 二次 foothold key 冲突检查（最终保险丝） ── */
  if (footState) {
    var myKey = getCandidateFootholdKey(sp);
    if (myKey) {
      for (var ci = 0; ci < footState.length; ci++) {
        var other = footState[ci];
        if (other === fs) continue;
        /* 检查已着陆的脚 */
        var otherKey = null;
        if (other.landedNode) otherKey = getNodeFootholdKey(other.landedNode);
        else if (other.landedSeg) otherKey = getSegmentFootholdKey(other.landedSeg.pa, other.landedSeg.pb, other.landedSeg.t);
        if (otherKey && otherKey === myKey) {
          liftFoot(fs, spider);
          fs.cooldown = Math.max(fs.cooldown || 0, 18);
          if (typeof window !== 'undefined' && window._spiderStats) window._spiderStats.landFootRejects = (window._spiderStats.landFootRejects || 0) + 1;
          return;
        }
        /* 检查另一条腿正在飞向的目标 */
        if (other.targetStepPoint) {
          var targetKey = getCandidateFootholdKey(other.targetStepPoint);
          if (targetKey && targetKey === myKey) {
            liftFoot(fs, spider);
            fs.cooldown = Math.max(fs.cooldown || 0, 18);
            if (typeof window !== 'undefined' && window._spiderStats) window._spiderStats.landFootRejects = (window._spiderStats.landFootRejects || 0) + 1;
            return;
          }
        }
      }
    }
  }

  if (sp.type === 'node') {
    if (!sp.particle || !sp.particle.__pid) { liftFoot(fs, spider); fs.cooldown = Math.max(fs.cooldown || 0, 12); return; }
    if (spiderweb) {
      var alive = false;
      var wcs = spiderweb.constraints;
      for (var wi = 0; wi < wcs.length; wi++) {
        var wc = wcs[wi];
        if (!(wc instanceof DistanceConstraint)) continue;
        if (wc.a === sp.particle || wc.b === sp.particle) { alive = true; break; }
      }
      if (!alive) { liftFoot(fs, spider); fs.cooldown = Math.max(fs.cooldown || 0, 12); return; }
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
    if (!sp.pa || !sp.pb) { liftFoot(fs, spider); fs.cooldown = Math.max(fs.cooldown || 0, 12); return; }
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
      if (!paAlive || !pbAlive || !edgeAlive) { liftFoot(fs, spider); fs.cooldown = Math.max(fs.cooldown || 0, 12); return; }
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
    fs.landedSeg = sp;
    fs.holdFrames = Math.max(tune.holdSegMin, Math.min(tune.holdSegMax, tune.holdSegBase - stepLen * tune.holdSegScale));
  }
}

/* ─── triggerStep ────────────────────────────────────────────────────── */

/**
 * 触发迈步
 */
export function triggerStep(i, md, footState, spiderweb, spider, samplePoints, moveDir, STEP_COOLDOWN, maxStepR, preferStable) {
  var tune = _getGaitTune();
  var fs = footState[i];
  if (!fs || fs.stepping || fs.cooldown > 0) return;

  var occupied = [];
  var occupiedSegments = [];
  /* 收集已占用的 foothold key 集合（包含已着陆 + 正在飞向的目标） */
  var occupiedFootholds = new Set();

  for (var oi = 0; oi < footState.length; oi++) {
    if (oi === i) continue;
    var other = footState[oi];
    occupied.push({ x: other.current.x, y: other.current.y });

    /* 收集 foothold key：已着陆 */
    if (other.landedNode) {
      var nk = getNodeFootholdKey(other.landedNode);
      if (nk) occupiedFootholds.add(nk);
    } else if (other.landedSeg) {
      var sk = getSegmentFootholdKey(other.landedSeg.pa, other.landedSeg.pb, other.landedSeg.t);
      if (sk) occupiedFootholds.add(sk);
    }
    /* 收集 foothold key：正飞向的目标（同帧防抢） */
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

  var sp = findStepTarget(spiderweb, i, spider, md || null, samplePoints, occupied, occupiedSegments, maxStepR, preferStable, { x: fs.current.x, y: fs.current.y }, occupiedFootholds);
  if (!sp) return;
  var hip = spider.legChains && spider.legChains[i] && spider.legChains[i][0]
    ? spider.legChains[i][0].pos
    : spider.particles[0].pos;
  var hdx = sp.x - hip.x, hdy = sp.y - hip.y;
  if (hdx * hdx + hdy * hdy > tune.maxHipTargetDist * tune.maxHipTargetDist) return;
  var dx = sp.x - fs.current.x, dy = sp.y - fs.current.y;
  var minStepDist = moveDir ? tune.minStepDistMove : tune.minStepDistIdle;
  if (dx * dx + dy * dy < minStepDist * minStepDist) return;

  liftFoot(fs, spider);
  fs.from = new Vec2(fs.current.x, fs.current.y);
  fs.targetPos = new Vec2(sp.x, sp.y);
  fs.targetStepPoint = sp;
  fs.stepping = true;
  fs.t = 0;
  fs.cooldown = STEP_COOLDOWN;
}
