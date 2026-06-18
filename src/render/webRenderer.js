import { DistanceConstraint } from '../engine/constraints.js';
import { getNextPid } from '../systems/footSystem.js';

/**
 * 设置蜘蛛网的自定义绘制函数
 * @param {Composite} spiderweb - 蜘蛛网复合体
 * @param {Function} getThrownObjects - 获取投掷物体列表的函数
 * @param {Function} getWebBreakFlashes - 获取断裂闪光列表的函数
 * @param {Function} getBreakFrame - 获取全局帧计数的函数
 */
export function setupWebDraw(spiderweb, getThrownObjects, getWebBreakFlashes, getBreakFrame) {
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
    var now = Date.now();
    var n = comp.constraints.length;
    var thrownObjects = getThrownObjects();
    var webBreakFlashes = getWebBreakFlashes();
    var _breakFrame = getBreakFrame();

    /* Step A：计算直接危险度 */
    var dangerRaw = {};
    for (var ti = 0; ti < thrownObjects.length; ti++) {
      var obj = thrownObjects[ti];
      if (obj.kind === 'drop') continue;
      if ((obj.state === 'stuck' || obj.state === 'freeing') && obj.stuckOnConstraint) {
        var ci2 = comp.constraints.indexOf(obj.stuckOnConstraint);
        if (ci2 === -1) continue;
        var ramp = Math.max(0, obj.stayFrames - 72);
        var danger = 0;
        if (obj.state === 'freeing') danger = 1;
        else if (obj.stayTimer > ramp) danger = 1;
        if (danger > 0) dangerRaw[ci2] = 1;
      }
    }

    /* Step B：粒子→约束邻接表 */
    var pToCI = {};
    for (var ci = 0; ci < n; ci++) {
      var cc = comp.constraints[ci];
      if (!(cc instanceof DistanceConstraint)) continue;
      var pa_id = cc.a.__pid || (cc.a.__pid = getNextPid());
      var pb_id = cc.b.__pid || (cc.b.__pid = getNextPid());
      if (!pToCI[pa_id]) pToCI[pa_id] = [];
      if (!pToCI[pb_id]) pToCI[pb_id] = [];
      pToCI[pa_id].push(ci);
      pToCI[pb_id].push(ci);
    }

    /* Step C：BFS 扩散 2 层 */
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

    /* Step D-pre：断裂红闪 */
    if (webBreakFlashes.length > 0) {
      for (var ci3 = 0; ci3 < n; ci3++) {
        var cfl = comp.constraints[ci3];
        if (!(cfl instanceof DistanceConstraint)) continue;
        var mcx = (cfl.a.pos.x + cfl.b.pos.x) * 0.5;
        var mcy = (cfl.a.pos.y + cfl.b.pos.y) * 0.5;
        var bestFlash = 0;
        for (var fi3 = 0; fi3 < webBreakFlashes.length; fi3++) {
          var bf = webBreakFlashes[fi3];
          var fbcx = (bf.ax + bf.bx) * 0.5, fbcy = (bf.ay + bf.by) * 0.5;
          var dist = Math.sqrt((mcx - fbcx) * (mcx - fbcx) + (mcy - fbcy) * (mcy - fbcy));
          var hopDist = 3;
          var hop = dist / hopDist;
          if (hop > 0.3) continue;
          var age = _breakFrame - bf.t;
          if (age > 18) continue;
          var flash = 0.42;
          if (flash > bestFlash) bestFlash = flash;
        }
        if (bestFlash > 0) {
          if (!dangerFinal[ci3] || dangerFinal[ci3] < bestFlash)
            dangerFinal[ci3] = bestFlash;
        }
      }
    }

    /* Step D：绘制 */
    for (var i = 0; i < n; i++) {
      var c = comp.constraints[i];
      if (c instanceof DistanceConstraint) {
        ctx.beginPath(); ctx.moveTo(c.a.pos.x, c.a.pos.y); ctx.lineTo(c.b.pos.x, c.b.pos.y);
        var d = dangerFinal[i] || 0;
        if (d > 0) {
          var isDirect = !!(dangerRaw[i]);
          var isBreakFlash = !isDirect && d > 0;
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
}
