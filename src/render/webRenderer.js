import { DistanceConstraint } from '../engine/constraints.js';
import { getNextPid } from '../systems/footSystem.js';
import { statsDc } from '../debug/renderStats.js';
import { spatialIndex, isWebConstraintAlive } from '../physics/SpatialIndexService.js';
import { segmentHitsCircle } from '../entities/ThrownObj.js';
import { TUTORIAL_STONE_PULL_FRAMES } from '../tutorial/tutorialController.js';

var _pToCI = null;
var _dangerFinal = null;
var _dangerRaw = null;
var _connected = null;
var _connectedSize = 0;
var _n = 0;

var _DEFAULT_STROKE = 'rgba(230,230,230,0.55)';
var _DEFAULT_WIDTH = 1.6;

function _aliveWebSeg(c) {
  return c instanceof DistanceConstraint && isWebConstraintAlive(c, spatialIndex);
}

function _ensurePid(p) {
  return p.__pid || (p.__pid = getNextPid());
}

function _ensureConnectedSize(minSize) {
  if (_connectedSize >= minSize) return;
  _connectedSize = minSize < 256 ? 256 : minSize;
  _connected = new Uint8Array(_connectedSize);
}

function _ensureDangerBuffers(n) {
  if (!_dangerFinal || _dangerFinal.length < n) {
    _dangerFinal = new Float32Array(n);
    _dangerRaw = new Uint8Array(n);
  }
}

/**
 * 建网后重建粒子→约束邻接表（拓扑不变时复用，避免每帧分配）
 */
function rebuildWebRenderTopology(comp) {
  var n = comp.constraints.length;
  _n = n;
  _ensureDangerBuffers(n);

  var pToCI = {};
  var maxPid = 0;
  for (var ci = 0; ci < n; ci++) {
    var cc = comp.constraints[ci];
    if (!(cc instanceof DistanceConstraint)) continue;
    var pa_id = _ensurePid(cc.a);
    var pb_id = _ensurePid(cc.b);
    if (pa_id > maxPid) maxPid = pa_id;
    if (pb_id > maxPid) maxPid = pb_id;
    if (!pToCI[pa_id]) pToCI[pa_id] = [];
    if (!pToCI[pb_id]) pToCI[pb_id] = [];
    pToCI[pa_id].push(ci);
    pToCI[pb_id].push(ci);
  }
  _pToCI = pToCI;
  _ensureConnectedSize(maxPid + 1);
}

function _markConnectedAlive(comp) {
  _connected.fill(0);
  for (var ci = 0; ci < comp.constraints.length; ci++) {
    var c = comp.constraints[ci];
    if (!_aliveWebSeg(c)) continue;
    _connected[c.a.__pid] = 1;
    _connected[c.b.__pid] = 1;
  }
}

function _drawWebParticles(ctx, comp) {
  _markConnectedAlive(comp);
  for (var i = 0; i < comp.particles.length; i++) {
    var pt = comp.particles[i];
    var pid = pt.__pid;
    if (!pid || !_connected[pid]) continue;
    ctx.beginPath();
    ctx.arc(pt.pos.x, pt.pos.y, 1.3, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(220,220,220,0.55)';
    ctx.fill();
    statsDc('arc');
  }
}

function _growLineTo(ctx, c) {
  var t = c.__growT;
  if (t == null || t >= 1) {
    ctx.moveTo(c.a.pos.x, c.a.pos.y);
    ctx.lineTo(c.b.pos.x, c.b.pos.y);
  } else {
    /* ease-out for natural feel */
    var et = 1 - (1 - t) * (1 - t);
    var bx = c.a.pos.x + (c.b.pos.x - c.a.pos.x) * et;
    var by = c.a.pos.y + (c.b.pos.y - c.a.pos.y) * et;
    ctx.moveTo(c.a.pos.x, c.a.pos.y);
    ctx.lineTo(bx, by);
    /* advance grow */
    c.__growT = Math.min(1, t + 1 / (c.__growDur || 12));
  }
}

function _applyFlash(ctx, c) {
  var ft = c.__flashT;
  if (ft == null || ft >= 1) return false;
  var et = 1 - (1 - ft) * (1 - ft); /* ease-out */
  /* white(255,255,255) → default(230,230,230,0.55) */
  var a = 1.0 - et * 0.45;  /* 1.0 → 0.55 */
  var w = 3.0 - et * 1.4;   /* 3.0 → 1.6 */
  ctx.strokeStyle = 'rgba(255,255,255,' + a.toFixed(2) + ')';
  ctx.lineWidth = w;
  c.__flashT = Math.min(1, ft + 1 / (c.__flashDur || 30));
  return true;
}

function _drawCalmSegments(ctx, comp, n) {
  ctx.strokeStyle = _DEFAULT_STROKE;
  ctx.lineWidth = _DEFAULT_WIDTH;
  for (var i = 0; i < n; i++) {
    var c = comp.constraints[i];
    if (c instanceof DistanceConstraint) {
      if (!_aliveWebSeg(c)) continue;
      var flashing = _applyFlash(ctx, c);
      ctx.beginPath();
      _growLineTo(ctx, c);
      ctx.stroke();
      statsDc('line');
      if (flashing) {
        ctx.strokeStyle = _DEFAULT_STROKE;
        ctx.lineWidth = _DEFAULT_WIDTH;
      }
    } else {
      c.draw(ctx);
      statsDc('line');
    }
  }
}

function _needsDangerPass(thrownObjects, tutorialImpact) {
  for (var ti = 0; ti < thrownObjects.length; ti++) {
    var obj = thrownObjects[ti];
    if (obj.kind === 'drop') continue;
    if ((obj.state !== 'stuck' && obj.state !== 'freeing') || !obj.stuckOnConstraint) continue;
    if (!_aliveWebSeg(obj.stuckOnConstraint)) continue;
    if (obj.state === 'freeing') return true;
    var ramp = Math.max(0, obj.stayFrames - 72);
    if (obj.stayTimer > ramp) return true;
  }
  return false;
}

function _applyTutorialStoneImpactDanger(comp, n, tutorialImpact) {
  return;
}

function _applyDangerBfs(comp, n) {
  for (var ci = 0; ci < n; ci++) {
    if (!_dangerRaw[ci]) continue;
    var d0 = 1;
    if (_dangerFinal[ci] < d0) _dangerFinal[ci] = d0;
    var cc = comp.constraints[ci];
    if (!_aliveWebSeg(cc)) continue;
    var pts = [cc.a.__pid, cc.b.__pid];
    for (var pi = 0; pi < pts.length; pi++) {
      var nbrs = _pToCI[pts[pi]] || [];
      for (var ni2 = 0; ni2 < nbrs.length; ni2++) {
        var ni3 = nbrs[ni2];
        if (ni3 === ci) continue;
        var d1 = d0 * 0.45;
        if (_dangerFinal[ni3] < d1) _dangerFinal[ni3] = d1;
        var cc1 = comp.constraints[ni3];
        if (!_aliveWebSeg(cc1)) continue;
        var pts2 = [cc1.a.__pid, cc1.b.__pid];
        for (var pi2 = 0; pi2 < pts2.length; pi2++) {
          var nbrs2 = _pToCI[pts2[pi2]] || [];
          for (var ni4 = 0; ni4 < nbrs2.length; ni4++) {
            var ni5 = nbrs2[ni4];
            if (ni5 === ci || ni5 === ni3) continue;
            var d2 = d0 * 0.45 * 0.45;
            if (_dangerFinal[ni5] < d2) _dangerFinal[ni5] = d2;
          }
        }
      }
    }
  }
}

function _applyBreakFlashes(comp, n, webBreakFlashes, breakFrame) {
  for (var ci3 = 0; ci3 < n; ci3++) {
    var cfl = comp.constraints[ci3];
    if (!_aliveWebSeg(cfl)) continue;
    var mcx = (cfl.a.pos.x + cfl.b.pos.x) * 0.5;
    var mcy = (cfl.a.pos.y + cfl.b.pos.y) * 0.5;
    var bestFlash = 0;
    for (var fi3 = 0; fi3 < webBreakFlashes.length; fi3++) {
      var bf = webBreakFlashes[fi3];
      var fbcx = (bf.ax + bf.bx) * 0.5;
      var fbcy = (bf.ay + bf.by) * 0.5;
      var dx = mcx - fbcx;
      var dy = mcy - fbcy;
      var hop = Math.sqrt(dx * dx + dy * dy) / 3;
      if (hop > 0.3) continue;
      if (breakFrame - bf.t > 18) continue;
      bestFlash = 0.42;
    }
    if (bestFlash > 0 && _dangerFinal[ci3] < bestFlash) _dangerFinal[ci3] = bestFlash;
  }
}

function _drawDangerSegments(ctx, comp, n, now) {
  for (var i = 0; i < n; i++) {
    var c = comp.constraints[i];
    if (c instanceof DistanceConstraint) {
      if (!_aliveWebSeg(c)) continue;
      /* flash 优先于 danger 着色 */
      if (_applyFlash(ctx, c)) {
        ctx.beginPath();
        _growLineTo(ctx, c);
        ctx.stroke();
        statsDc('line');
        continue;
      }
      ctx.beginPath();
      _growLineTo(ctx, c);
      var d = _dangerFinal[i];
      if (d > 0) {
        var isDirect = !!_dangerRaw[i];
        var isBreakFlash = !isDirect;
        var strokeR, strokeG, strokeB, strokeA, strokeW;

        if (isBreakFlash) {
          var bfPhase = (now / 1000 * 8) % 1;
          if (bfPhase < 0.5) {
            strokeR = 255; strokeG = 30; strokeB = 20; strokeA = 0.50;
          } else {
            strokeR = 230; strokeG = 230; strokeB = 230; strokeA = 0.55;
          }
          strokeW = 1.6;
        } else if (isDirect) {
          var flashHz = 1 + d * 7;
          var phase = (now / 1000 * flashHz) % 1;
          var blink = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
          strokeR = Math.round(230 + 25 * d);
          strokeG = Math.round(230 * (1 - d * 0.92));
          strokeB = Math.round(230 * (1 - d));
          strokeA = 0.4 + blink * (0.55 + d * 0.45);
          strokeW = 1.6 + d * 5.0 + blink * d * 2.4;
        } else {
          strokeR = Math.round(230 + 25 * d);
          strokeG = Math.round(230 * (1 - d * 0.92));
          strokeB = Math.round(230 * (1 - d));
          strokeA = 0.3 + d * 0.5;
          strokeW = 1.6 + d * 3.0;
        }
        ctx.strokeStyle = 'rgba(' + strokeR + ',' + strokeG + ',' + strokeB + ',' + strokeA + ')';
        ctx.lineWidth = strokeW;
      } else {
        ctx.strokeStyle = _DEFAULT_STROKE;
        ctx.lineWidth = _DEFAULT_WIDTH;
      }
      ctx.stroke();
      statsDc('line');
    } else {
      c.draw(ctx);
      statsDc('line');
    }
  }
}

var _brokenEndFrame = 0;

function _drawBrokenEnds(ctx, getBrokenEnds) {
  _brokenEndFrame++;
  var brokenEnds = getBrokenEnds ? getBrokenEnds() : [];
  if (!brokenEnds.length) return;
  var alpha = 0.35 + 0.65 * Math.abs(Math.sin(_brokenEndFrame * 0.07));
  ctx.save();
  ctx.strokeStyle = 'rgba(80,220,100,' + alpha.toFixed(2) + ')';
  ctx.lineWidth = 1.2;
  for (var bi = 0; bi < brokenEnds.length; bi++) {
    var bp = brokenEnds[bi];
    if (!bp.__isStub) continue; /* 只给 stub 画绿圈 */
    ctx.beginPath();
    ctx.arc(bp.pos.x, bp.pos.y, 8.5, 0, 2 * Math.PI);
    ctx.stroke();
    statsDc('stroke');
  }
  ctx.restore();
}

/**
 * 绘制拖拽预览环：闪烁高亮直线
 */
var _previewFrame = 0;
function _drawPreviewRing(ctx, getPreviewRing) {
  if (!getPreviewRing) return;
  var ring = getPreviewRing();
  if (!ring || ring.length < 2) return;

  _previewFrame++;
  var pulse = 0.3 + 0.35 * Math.sin(_previewFrame * 0.15);

  ctx.save();
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(140,220,255,' + pulse.toFixed(2) + ')';

  ctx.beginPath();
  ctx.moveTo(ring[0].pos.x, ring[0].pos.y);
  for (var i = 1; i < ring.length; i++) {
    ctx.lineTo(ring[i].pos.x, ring[i].pos.y);
  }
  ctx.lineTo(ring[0].pos.x, ring[0].pos.y);
  ctx.stroke();
  statsDc('stroke');

  ctx.restore();
}

/**
 * 绘制补网任务的环高亮：沿 ring 节点连线画发光边
 */
var _repairHighlightFrame = 0;
function _drawRepairRingHighlight(ctx, getRepairQueue) {
  if (!getRepairQueue) return;
  var queue = getRepairQueue();
  if (!queue || queue.length === 0) return;

  _repairHighlightFrame++;
  var pulse = 0.35 + 0.25 * Math.sin(_repairHighlightFrame * 0.08);

  ctx.save();
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';

  for (var qi = 0; qi < queue.length; qi++) {
    var task = queue[qi];
    var ring = task.ring;
    if (!ring || ring.length < 2) continue;

    /* 任务状态不同颜色微调 */
    var r = 120, g = 210, b = 255; /* 浅蓝 */
    if (task.state === 'repairing') { r = 100; g = 255; b = 180; } /* 修复中偏绿 */

    ctx.strokeStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + pulse.toFixed(2) + ')';

    /* 画环上相邻节点之间的连线 */
    ctx.beginPath();
    ctx.moveTo(ring[0].pos.x, ring[0].pos.y);
    for (var ri = 1; ri < ring.length; ri++) {
      ctx.lineTo(ring[ri].pos.x, ring[ri].pos.y);
    }
    /* 闭合环：首尾相连（首尾通过修复边连接） */
    ctx.lineTo(ring[0].pos.x, ring[0].pos.y);
    ctx.stroke();
    statsDc('stroke');
  }

  ctx.restore();
}

/**
 * 设置蜘蛛网的自定义绘制函数
 */
function _drawTutorialStoneImpactRing(ctx, tutorialImpact, now) {
  if (!tutorialImpact || tutorialImpact.phase !== 'pull') return;
  var progress = Math.min(1, tutorialImpact.timer / TUTORIAL_STONE_PULL_FRAMES);
  var pulse = 0.45 + 0.55 * Math.abs(Math.sin(now / 1000 * (4 + progress * 6) * Math.PI));
  ctx.save();
  ctx.beginPath();
  ctx.arc(tutorialImpact.x, tutorialImpact.y, tutorialImpact.r, 0, 2 * Math.PI);
  ctx.strokeStyle = 'rgba(255,55,35,' + (0.25 + pulse * 0.45).toFixed(2) + ')';
  ctx.lineWidth = 2.2 + progress * 3.5;
  ctx.stroke();
  ctx.restore();
}

export function setupWebDraw(spiderweb, getThrownObjects, getWebBreakFlashes, getBreakFrame, fifthArg, sixthArg, getRepairQueue, getPreviewRing, getTutorialStoneImpact, getSnapCandidates) {
  var getLogicalTime = sixthArg ? null : fifthArg;
  var getBrokenEnds = sixthArg ? fifthArg : null;
  var getSnapTarget = sixthArg || null;
  rebuildWebRenderTopology(spiderweb);

  spiderweb.drawParticles = function (ctx, comp) {
    _drawWebParticles(ctx, comp);
    _drawBrokenEnds(ctx, getBrokenEnds);

    var snapCandidates = getSnapCandidates ? getSnapCandidates() : null;
    if (snapCandidates && snapCandidates.length) {
      var candPulse = 0.42 + 0.58 * Math.abs(Math.sin(_brokenEndFrame * 0.12));
      ctx.save();
      for (var ci = 0; ci < snapCandidates.length; ci++) {
        var cp = snapCandidates[ci];
        if (!cp || !cp.pos) continue;
        ctx.beginPath();
        ctx.arc(cp.pos.x, cp.pos.y, 7.5 + candPulse * 2.2, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(170,235,255,' + (0.26 + candPulse * 0.36).toFixed(2) + ')';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cp.pos.x, cp.pos.y, 2.2, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(215,248,255,' + (0.45 + candPulse * 0.4).toFixed(2) + ')';
        ctx.fill();
        statsDc('stroke');
      }
      ctx.restore();
    }

    /* ── 吸附目标高亮 ── */
    var snapPt = getSnapTarget ? getSnapTarget() : null;
    if (snapPt) {
      var snapAlpha = 0.5 + 0.5 * Math.abs(Math.sin(_brokenEndFrame * 0.15));
      ctx.save();
      ctx.strokeStyle = 'rgba(100,200,255,' + snapAlpha.toFixed(2) + ')';
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.arc(snapPt.pos.x, snapPt.pos.y, 12, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.restore();
    }

    /* ── 拖拽预览环（虚线） ── */
    _drawPreviewRing(ctx, getPreviewRing);

    /* ── 补网任务环高亮 ── */
    _drawRepairRingHighlight(ctx, getRepairQueue);

    var tutorialImpact = getTutorialStoneImpact ? getTutorialStoneImpact() : null;
    if (tutorialImpact) {
      _drawTutorialStoneImpactRing(ctx, tutorialImpact, Date.now());
    }
  };

  spiderweb.drawConstraints = function (ctx, comp) {
    var n = comp.constraints.length;
    if (n !== _n) rebuildWebRenderTopology(comp);

    var thrownObjects = getThrownObjects();
    var webBreakFlashes = getWebBreakFlashes();
    var tutorialImpact = getTutorialStoneImpact ? getTutorialStoneImpact() : null;
    var needDanger = _needsDangerPass(thrownObjects, tutorialImpact);
    var needFlash = webBreakFlashes.length > 0;

    if (!needDanger && !needFlash) {
      _drawCalmSegments(ctx, comp, n);
      return;
    }

    var now = getLogicalTime ? getLogicalTime() : Date.now();
    _dangerFinal.fill(0);
    _dangerRaw.fill(0);

    if (tutorialImpact && tutorialImpact.phase === 'pull') {
      _applyTutorialStoneImpactDanger(comp, n, tutorialImpact);
    }

    if (needDanger) {
      for (var ti = 0; ti < thrownObjects.length; ti++) {
        var obj = thrownObjects[ti];
        if (obj.kind === 'drop') continue;
        if ((obj.state !== 'stuck' && obj.state !== 'freeing') || !obj.stuckOnConstraint) continue;
        var bc = obj.stuckOnConstraint;
        if (!_aliveWebSeg(bc)) continue;
        var ci2 = bc.__ci;
        if (ci2 == null || ci2 < 0 || ci2 >= n) continue;
        var ramp = Math.max(0, obj.stayFrames - 72);
        var danger = 0;
        if (obj.state === 'freeing') danger = 1;
        else if (obj.stayTimer > ramp) danger = 1;
        else if (obj.state === 'stuck' && (obj._pickupTension || 0) > 0.08) danger = 1;
        if (danger > 0 && !_dangerRaw[ci2]) _dangerRaw[ci2] = 1;
      }
      _applyDangerBfs(comp, n);
    }

    if (needFlash) _applyBreakFlashes(comp, n, webBreakFlashes, getBreakFrame());

    _drawDangerSegments(ctx, comp, n, now);
  };

  return {
    annotateFlash: function (bf) {
      var cs = spiderweb.constraints;
      var hopDist = 3, maxHop = 0.3;
      var fcx = (bf.ax + bf.bx) * 0.5, fcy = (bf.ay + bf.by) * 0.5;
      var affected = [];
      for (var ci = 0; ci < cs.length; ci++) {
        var c = cs[ci];
        if (!(c instanceof DistanceConstraint)) continue;
        var mcx = (c.a.pos.x + c.b.pos.x) * 0.5;
        var mcy = (c.a.pos.y + c.b.pos.y) * 0.5;
        var dist = Math.sqrt((mcx - fcx) * (mcx - fcx) + (mcy - fcy) * (mcy - fcy));
        if (dist / hopDist <= maxHop) affected.push(ci);
      }
      bf.affectedCI = affected;
    }
  };
}
