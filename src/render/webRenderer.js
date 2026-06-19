import { DistanceConstraint } from '../engine/constraints.js';
import { getNextPid } from '../systems/footSystem.js';

/**
 * 设置蜘蛛网的自定义绘制函数
 * @param {Composite} spiderweb - 蜘蛛网复合体
 * @param {Function} getThrownObjects - 获取投掷物体列表的函数
 * @param {Function} getWebBreakFlashes - 获取断裂闪光列表的函数
 * @param {Function} getBreakFrame - 获取全局帧计数的函数
 */
export function setupWebDraw(spiderweb, getThrownObjects, getWebBreakFlashes, getBreakFrame, getLogicalTime) {
  var _adjCacheVersion = -1;
  var _adjCache = {};

  function _getAdjCache(comp) {
    var ver = comp._topologyVersion || 0;
    if (ver === _adjCacheVersion) return _adjCache;
    var cache = {};
    var n = comp.constraints.length;
    for (var ci = 0; ci < n; ci++) {
      var cc = comp.constraints[ci];
      if (!(cc instanceof DistanceConstraint)) continue;
      var pa_id = cc.a.__pid || (cc.a.__pid = getNextPid());
      var pb_id = cc.b.__pid || (cc.b.__pid = getNextPid());
      if (!cache[pa_id]) cache[pa_id] = [];
      if (!cache[pb_id]) cache[pb_id] = [];
      cache[pa_id].push(ci);
      cache[pb_id].push(ci);
    }
    _adjCache = cache;
    _adjCacheVersion = ver;
    return _adjCache;
  }

  var _dangerVersion = -1;
  var _dangerRawCache = {};
  var _dangerFinalCache = {};

  function _rebuildDanger(comp, thrownObjects, pToCI) {
    var dangerRaw = {};
    for (var ti = 0; ti < thrownObjects.length; ti++) {
      var obj = thrownObjects[ti];
      if (obj.kind === 'drop') continue;
      if ((obj.state === 'stuck' || obj.state === 'freeing') && obj.stuckOnConstraint) {
        var ci2 = comp.constraints.indexOf(obj.stuckOnConstraint);
        if (ci2 === -1) continue;
        var ramp = Math.max(0, obj.stayFrames - 72);
        var active = (obj.state === 'freeing') || (obj.stayTimer > ramp);
        if (active) dangerRaw[ci2] = 1;
      }
    }
    var dangerFinal = {};
    for (var ci in dangerRaw) {
      var d0 = dangerRaw[ci];
      if (!dangerFinal[ci] || dangerFinal[ci] < d0) dangerFinal[ci] = d0;
      var cc = comp.constraints[ci];
      if (!(cc instanceof DistanceConstraint)) continue;
      var pts = [cc.a.__pid, cc.b.__pid];
      for (var pi = 0; pi < pts.length; pi++) {
        var nbrs = pToCI[pts[pi]] || [];
        for (var ni2 = 0; ni2 < nbrs.length; ni2++) {
          var ni3 = nbrs[ni2]; if (ni3 == ci) continue;
          var d1 = d0 * 0.45;
          if (!dangerFinal[ni3] || dangerFinal[ni3] < d1) dangerFinal[ni3] = d1;
          var cc1 = comp.constraints[ni3];
          if (!(cc1 instanceof DistanceConstraint)) continue;
          var pts2 = [cc1.a.__pid, cc1.b.__pid];
          for (var pi2 = 0; pi2 < pts2.length; pi2++) {
            var nbrs2 = pToCI[pts2[pi2]] || [];
            for (var ni4 = 0; ni4 < nbrs2.length; ni4++) {
              var ni5 = nbrs2[ni4]; if (ni5 == ci || ni5 == ni3) continue;
              var d2 = d0 * 0.45 * 0.45;
              if (!dangerFinal[ni5] || dangerFinal[ni5] < d2) dangerFinal[ni5] = d2;
            }
          }
        }
      }
    }
    _dangerRawCache = dangerRaw;
    _dangerFinalCache = dangerFinal;
  }

  function _getDangerVersion(thrownObjects) {
    var v = 0;
    for (var ti = 0; ti < thrownObjects.length; ti++) {
      var obj = thrownObjects[ti];
      if (obj.kind === 'drop') continue;
      if (obj.state === 'stuck') v += obj.stayTimer * 31 + 1;
      else if (obj.state === 'freeing') v += 99999;
    }
    return v;
  }

  spiderweb.drawParticles = function (ctx, comp) {
    var connected = {};
    for (var ci = 0; ci < comp.constraints.length; ci++) {
      var c = comp.constraints[ci];
      if (!(c instanceof DistanceConstraint)) continue;
      var idA = c.a.__pid || (c.a.__pid = getNextPid());
      var idB = c.b.__pid || (c.b.__pid = getNextPid());
      connected[idA] = true;
      connected[idB] = true;
    }
    for (var i in comp.particles) {
      var pt = comp.particles[i];
      var pid = pt.__pid || (pt.__pid = getNextPid());
      if (!connected[pid]) continue;
      ctx.beginPath(); ctx.arc(pt.pos.x, pt.pos.y, 1.3, 0, 2 * Math.PI);
      ctx.fillStyle = "rgba(220,220,220,0.55)"; ctx.fill();
    }
  };

  spiderweb.drawConstraints = function (ctx, comp) {
    var now = getLogicalTime ? getLogicalTime() : Date.now();
    var n = comp.constraints.length;
    var thrownObjects = getThrownObjects();
    var webBreakFlashes = getWebBreakFlashes();
    var _breakFrame = getBreakFrame();

    var pToCI = _getAdjCache(comp);

    var dv = _getDangerVersion(thrownObjects);
    var topoVer = comp._topologyVersion || 0;
    if (dv !== _dangerVersion || topoVer !== _adjCacheVersion) {
      _rebuildDanger(comp, thrownObjects, pToCI);
      _dangerVersion = dv;
    }
    var dangerRaw = _dangerRawCache;
    var dangerFinal = _dangerFinalCache;

    var flashDangerSet = {};
    if (webBreakFlashes.length > 0) {
      for (var fi3 = 0; fi3 < webBreakFlashes.length; fi3++) {
        var bf = webBreakFlashes[fi3];
        var age = _breakFrame - bf.t;
        if (age > 18) continue;
        var aci = bf.affectedCI;
        if (aci) {
          for (var ai = 0; ai < aci.length; ai++) flashDangerSet[aci[ai]] = 0.42;
        }
      }
    }

    for (var i = 0; i < n; i++) {
      var c = comp.constraints[i];
      if (c instanceof DistanceConstraint) {
        ctx.beginPath(); ctx.moveTo(c.a.pos.x, c.a.pos.y); ctx.lineTo(c.b.pos.x, c.b.pos.y);
        var d = dangerFinal[i] || flashDangerSet[i] || 0;
        if (d > 0) {
          var isDirect = !!(dangerRaw[i]);
          var isBreakFlash = !isDirect && flashDangerSet[i] > 0;
          var strokeR, strokeG, strokeB, strokeA, strokeW;

          if (isBreakFlash) {
            var bfPhase = (now / 1000 * 8) % 1;
            var isRed = bfPhase < 0.5;
            if (isRed) { strokeR = 255; strokeG = 30; strokeB = 20; strokeA = 0.50; }
            else { strokeR = 230; strokeG = 230; strokeB = 230; strokeA = 0.55; }
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
          ctx.strokeStyle = "rgba(230,230,230,0.55)"; ctx.lineWidth = 1.6;
        }
        ctx.stroke();
      } else c.draw(ctx);
    }
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
