import { DistanceConstraint } from '../engine/constraints.js';
import { getNextPid } from '../systems/footSystem.js';
import { statsDc } from '../debug/renderStats.js';
import { spatialIndex, isWebConstraintAlive } from '../physics/SpatialIndexService.js';

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

function _drawCalmSegments(ctx, comp, n) {
  ctx.strokeStyle = _DEFAULT_STROKE;
  ctx.lineWidth = _DEFAULT_WIDTH;
  for (var i = 0; i < n; i++) {
    var c = comp.constraints[i];
    if (c instanceof DistanceConstraint) {
      if (!_aliveWebSeg(c)) continue;
      ctx.beginPath();
      ctx.moveTo(c.a.pos.x, c.a.pos.y);
      ctx.lineTo(c.b.pos.x, c.b.pos.y);
      ctx.stroke();
      statsDc('line');
    } else {
      c.draw(ctx);
      statsDc('line');
    }
  }
}

function _needsDangerPass(thrownObjects) {
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
      ctx.beginPath();
      ctx.moveTo(c.a.pos.x, c.a.pos.y);
      ctx.lineTo(c.b.pos.x, c.b.pos.y);
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

/**
 * 设置蜘蛛网的自定义绘制函数
 */
export function setupWebDraw(spiderweb, getThrownObjects, getWebBreakFlashes, getBreakFrame) {
  rebuildWebRenderTopology(spiderweb);

  spiderweb.drawParticles = function (ctx, comp) {
    _drawWebParticles(ctx, comp);
  };

  spiderweb.drawConstraints = function (ctx, comp) {
    var n = comp.constraints.length;
    if (n !== _n) rebuildWebRenderTopology(comp);

    var thrownObjects = getThrownObjects();
    var webBreakFlashes = getWebBreakFlashes();
    var needDanger = _needsDangerPass(thrownObjects);
    var needFlash = webBreakFlashes.length > 0;

    if (!needDanger && !needFlash) {
      _drawCalmSegments(ctx, comp, n);
      return;
    }

    var now = Date.now();
    _dangerFinal.fill(0);
    _dangerRaw.fill(0);

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
        if (danger > 0) _dangerRaw[ci2] = 1;
      }
      _applyDangerBfs(comp, n);
    }

    if (needFlash) _applyBreakFlashes(comp, n, webBreakFlashes, getBreakFrame());

    _drawDangerSegments(ctx, comp, n, now);
  };
}