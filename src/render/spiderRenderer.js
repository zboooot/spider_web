import { DistanceConstraint } from '../engine/constraints.js';
import { statsDc } from '../debug/renderStats.js';
import popoHeadUrl from '../assets/popo.png';
import popoBlinkUrl from '../assets/popo_blink.png';
import popoPackUrl from '../assets/popo_pack.png';

var popoHeadImg = new Image();
popoHeadImg.src = popoHeadUrl;

var popoBlinkImg = new Image();
popoBlinkImg.src = popoBlinkUrl;

var popoPackImg = new Image();
popoPackImg.src = popoPackUrl;

function getSpiderHeadFrame(blinkState, wrappingTarget) {
  if (wrappingTarget) return popoPackImg;
  if (blinkState && blinkState.blinking && blinkState.t >= 0.35 && blinkState.t <= 1.35) {
    return popoBlinkImg;
  }
  return popoHeadImg;
}

/**
 * 设置蜘蛛的自定义绘制函数
 */
export function setupSpiderDraw(spider, legConstraintCount, footState, blinkState, getWrappingTarget) {
  spider.drawConstraints = function (ctx, comp) {
    var wrappingTarget = getWrappingTarget();

    /* 打包方向向量 */
    var wrapOX = 0, wrapOY = 0, wrapOL = 1, wrapT2 = 0, wrapAt = 0, wrapSpeed = 0;
    var activeWrapLegs = [];
    if (wrappingTarget) {
      var wo = wrappingTarget;
      wrapOX = wo.particle.pos.x - spider.thorax.pos.x;
      wrapOY = wo.particle.pos.y - spider.thorax.pos.y;
      wrapOL = Math.sqrt(wrapOX * wrapOX + wrapOY * wrapOY) || 1;
      wrapOX /= wrapOL; wrapOY /= wrapOL;
      wrapT2 = wo.wrapT;
      wrapAt = wo.animT;
      wrapSpeed = wrapT2 * wo.wrapDur * 0.58;

      var legDists = [];
      for (var li = 0; li < footState.length; li++) {
        var ldx = footState[li].current.x - wo.particle.pos.x;
        var ldy = footState[li].current.y - wo.particle.pos.y;
        legDists.push({ idx: li, d2: ldx * ldx + ldy * ldy });
      }
      legDists.sort(function (a, b) { return a.d2 - b.d2; });
      activeWrapLegs = [legDists[0].idx, legDists[1].idx];
    }

    var thoraxDX = 0, thoraxDY = 0, abdomenDX = 0, abdomenDY = 0;
    if (wrappingTarget) {
      var lean = 4 * wrapT2;
      thoraxDX = wrapOX * lean; thoraxDY = wrapOY * lean;
      abdomenDX = -wrapOX * lean * 0.4; abdomenDY = -wrapOY * lean * 0.4;
    }

    var footDraw = [];
    for (var fi = 0; fi < footState.length; fi++) {
      var fs = footState[fi];
      var drawCX = fs.current.x, drawCY = fs.current.y;
      footDraw.push({ x: drawCX, y: drawCY });
    }

    var tx2 = spider.thorax.pos.x + thoraxDX, ty2 = spider.thorax.pos.y + thoraxDY;
    var ax2 = spider.abdomen.pos.x + abdomenDX, ay2 = spider.abdomen.pos.y + abdomenDY;

    // Soft curved legs with more joints.
    var chains = spider.legChains || [];
    for (var ci = 0; ci < chains.length; ci++) {
      var chain = chains[ci];
      var pts = [];
      for (var pi = 0; pi < chain.length; pi++) {
        var p = chain[pi].pos;
        pts.push({ x: p.x, y: p.y });
      }
      if (footDraw[ci]) {
        pts[pts.length - 1] = footDraw[ci];
      }

      if (wrappingTarget) {
        var perpX = -wrapOY, perpY = wrapOX;
        var activeIdx = activeWrapLegs.indexOf(ci);

        if (activeIdx !== -1) {
          var legPhase = activeIdx === 0 ? 0 : Math.PI;
          var legTime = wrapAt * 0.95 + legPhase;
          for (var ai = 0; ai < pts.length; ai++) {
            var factor = (ai + 1) / pts.length;
            var scrambleForward = Math.sin(legTime * 0.9 + ai * 0.65) * (4 + factor * 8 + wrapT2 * 7);
            var scrambleLateral = Math.cos(legTime * 1.35 + ai * 0.5) * (2 + factor * 5 + wrapT2 * 4);
            pts[ai].x += wrapOX * scrambleForward * factor + perpX * scrambleLateral * factor;
            pts[ai].y += wrapOY * scrambleForward * factor + perpY * scrambleLateral * factor;
          }
        } else {
          for (var bi = 0; bi < pts.length; bi++) {
            var settle = (bi + 1) / pts.length;
            pts[bi].x += -wrapOX * (1.4 + wrapT2 * 1.8) * settle;
            pts[bi].y += -wrapOY * (1.4 + wrapT2 * 1.8) * settle;
          }
        }
      }

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (var qi = 1; qi < pts.length - 2; qi++) {
        var xc = (pts[qi].x + pts[qi + 1].x) * 0.5;
        var yc = (pts[qi].y + pts[qi + 1].y) * 0.5;
        ctx.quadraticCurveTo(pts[qi].x, pts[qi].y, xc, yc);
      }
      ctx.quadraticCurveTo(
        pts[pts.length - 2].x,
        pts[pts.length - 2].y,
        pts[pts.length - 1].x,
        pts[pts.length - 1].y
      );
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#0c0c0c';
      ctx.lineWidth = 4.6;
      ctx.stroke();
      statsDc('stroke');

      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (var qi2 = 1; qi2 < pts.length - 2; qi2++) {
        var xc2 = (pts[qi2].x + pts[qi2 + 1].x) * 0.5;
        var yc2 = (pts[qi2].y + pts[qi2 + 1].y) * 0.5;
        ctx.quadraticCurveTo(pts[qi2].x, pts[qi2].y, xc2, yc2);
      }
      ctx.quadraticCurveTo(
        pts[pts.length - 2].x,
        pts[pts.length - 2].y,
        pts[pts.length - 1].x,
        pts[pts.length - 1].y
      );
      ctx.strokeStyle = '#1b1b1b';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      statsDc('stroke');
      ctx.restore();
    }

    var ax = ax2, ay = ay2;
    var tx = tx2, ty = ty2;
    var fdx = tx - ax, fdy = ty - ay, fl = Math.sqrt(fdx * fdx + fdy * fdy) || 1;
    var fnx = fdx / fl, fny = fdy / fl, prx = -fny, pry = fnx;

    // Replace old spider body with provided image head while keeping size similar.
    var headFrame = getSpiderHeadFrame(blinkState, wrappingTarget);
    if (headFrame.complete && headFrame.naturalWidth > 0) {
      var imgW = 36.8;
      var imgH = imgW * (headFrame.naturalHeight / headFrame.naturalWidth);
      var imgCX = ax + fnx * 4;
      var imgCY = ay + fny * 4;
      ctx.drawImage(headFrame, imgCX - imgW * 0.5, imgCY - imgH * 0.5, imgW, imgH);
      statsDc('image');
    }
  };

  spider.drawParticles = function () { };
}
