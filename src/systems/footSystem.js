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

/**
 * 寻找最佳落脚目标
 */
export function findStepTarget(webComp, legIndex, spiderComp, moveDir, samplePoints, occupiedPositions, occupiedSegments, maxStepR, preferStable, currentFootPos) {
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
  var idealDist = 24 + (moveDir ? moveLen * 18 : 0);
  var theta = spiderComp.particles[0].pos.angle2(
    spiderComp.particles[0].pos.add(new Vec2(1, 0)), spiderComp.particles[1].pos);
  // upper-right, upper-left, lower-right, lower-left
  var legAngles = [-0.22, Math.PI + 0.22, 0.28, Math.PI - 0.28];
  var la = theta + legAngles[legIndex];
  var ix = thorax.x + Math.cos(la) * idealDist, iy = thorax.y + Math.sin(la) * idealDist;
  if (moveDir) { ix += moveDir.x * 26; iy += moveDir.y * 26; }

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

  function score(cand) {
    var cx = cand.x, cy = cand.y;
    var dx = cx - ix, dy = cy - iy;
    var base = dx * dx + dy * dy;
    var penalty = 0;

    if (!sideOk(cand)) penalty += SIDE_PENALTY;
    if (crossesOccupied(cand)) penalty += CROSS_PENALTY;

    if (currentFootPos) {
      var rdx = cx - currentFootPos.x, rdy = cy - currentFootPos.y;
      var progressSq = rdx * rdx + rdy * rdy;
      if (progressSq < MIN_STEP_PROGRESS * MIN_STEP_PROGRESS) {
        penalty += (MIN_STEP_PROGRESS * MIN_STEP_PROGRESS - progressSq) * 12;
      }
      if (moveDir && moveLen > 0.01) {
        var prog = rdx * moveDir.x + rdy * moveDir.y;
        if (prog < 0) penalty += prog * prog * 4;
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

    if (preferStable && cand.type === 'segment') penalty += 64;
    return base + penalty;
  }

  var freeCands = cands.filter(function (c) { return !tooCloseToOccupied(c.x, c.y); });
  var pool = freeCands.length ? freeCands : cands;

  var best = null, bs = Number.POSITIVE_INFINITY;
  for (var ci = 0; ci < pool.length; ci++) {
    var s = score(pool[ci]);
    if (s < bs) { best = pool[ci]; bs = s; }
  }
  return best || null;
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
export function landFoot(fs, spider, spiderweb) {
  var sp = fs.targetStepPoint;
  fs.targetStepPoint = null;
  if (!sp) { liftFoot(fs, spider); fs.cooldown = Math.max(fs.cooldown || 0, 12); return; }

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
    fs.holdFrames = 10;
  } else {
    if (!sp.pa || !sp.pb) { liftFoot(fs, spider); fs.cooldown = Math.max(fs.cooldown || 0, 12); return; }
    if (spiderweb) {
      var paAlive = false, pbAlive = false;
      var wcs2 = spiderweb.constraints;
      for (var wi2 = 0; wi2 < wcs2.length; wi2++) {
        var wc2 = wcs2[wi2];
        if (!(wc2 instanceof DistanceConstraint)) continue;
        if (wc2.a === sp.pa || wc2.b === sp.pa) paAlive = true;
        if (wc2.a === sp.pb || wc2.b === sp.pb) pbAlive = true;
        if (paAlive && pbAlive) break;
      }
      if (!paAlive || !pbAlive) { liftFoot(fs, spider); fs.cooldown = Math.max(fs.cooldown || 0, 12); return; }
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
    fs.holdFrames = 16;
  }
}

/**
 * 触发迈步
 */
export function triggerStep(i, md, footState, spiderweb, spider, samplePoints, moveDir, STEP_COOLDOWN, maxStepR, preferStable) {
  var fs = footState[i];
  if (!fs || fs.stepping || fs.cooldown > 0) return;

  var occupied = [];
  var occupiedSegments = [];
  for (var oi = 0; oi < footState.length; oi++) {
    if (oi === i) continue;
    var other = footState[oi];
    occupied.push({ x: other.current.x, y: other.current.y });
    if (other.stepping) continue;
    var hip = spider.legChains && spider.legChains[oi] && spider.legChains[oi][0]
      ? spider.legChains[oi][0].pos
      : spider.particles[0].pos;
    occupiedSegments.push({ hx: hip.x, hy: hip.y, fx: other.current.x, fy: other.current.y });
  }

  var sp = findStepTarget(spiderweb, i, spider, md || null, samplePoints, occupied, occupiedSegments, maxStepR, preferStable, { x: fs.current.x, y: fs.current.y });
  if (!sp) return;
  var dx = sp.x - fs.current.x, dy = sp.y - fs.current.y;
  if (dx * dx + dy * dy < 400) return;

  liftFoot(fs, spider);
  fs.from = new Vec2(fs.current.x, fs.current.y);
  fs.targetPos = new Vec2(sp.x, sp.y);
  fs.targetStepPoint = sp;
  fs.stepping = true;
  fs.t = 0;
  fs.cooldown = STEP_COOLDOWN;
}
