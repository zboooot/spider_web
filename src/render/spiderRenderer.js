import { DistanceConstraint } from '../engine/constraints.js';
import { statsDc } from '../debug/renderStats.js';

var popoHeadImg = new Image();
popoHeadImg.src = '/src/assets/popo.png';

var popoBlinkImg = new Image();
popoBlinkImg.src = '/src/assets/popo_blink.png';

var popoPackImg = new Image();
popoPackImg.src = '/src/assets/popo_pack.png';

function getSpiderHeadFrame(blinkState, wrappingTarget) {
  if (wrappingTarget) return popoPackImg;
  if (blinkState && blinkState.blinking && blinkState.t >= 0.35 && blinkState.t <= 1.35) {
    return popoBlinkImg;
  }
  return popoHeadImg;
}

var HEAD_IMG_W = 36.8;

/** 头图中心：与 popo 绘制位置一致，作为四条腿的公共根部锚点 */
function getHeadCenter(ax, ay, tx, ty) {
  var fdx = tx - ax, fdy = ty - ay;
  var fl = Math.sqrt(fdx * fdx + fdy * fdy) || 1;
  return {
    x: ax + (fdx / fl) * 4,
    y: ay + (fdy / fl) * 4
  };
}

/**
 * 设置蜘蛛的自定义绘制函数
 */
export function setupSpiderDraw(spider, legConstraintCount, footState, blinkState, getWrappingTarget) {
  spider.deferDraw = true;
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
    var headCenter = getHeadCenter(ax2, ay2, tx2, ty2);

    // Soft curved legs with more joints — 根部统一从头图中心发出，物理链仍从 p1 接出。
    var chains = spider.legChains || [];
    for (var ci = 0; ci < chains.length; ci++) {
      var chain = chains[ci];
      var pts = [{ x: headCenter.x, y: headCenter.y }];
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
          for (var ai = 1; ai < pts.length; ai++) {
            var factor = ai / (pts.length - 1);
            var scrambleForward = Math.sin(legTime * 0.9 + ai * 0.65) * (4 + factor * 8 + wrapT2 * 7);
            var scrambleLateral = Math.cos(legTime * 1.35 + ai * 0.5) * (2 + factor * 5 + wrapT2 * 4);
            pts[ai].x += wrapOX * scrambleForward * factor + perpX * scrambleLateral * factor;
            pts[ai].y += wrapOY * scrambleForward * factor + perpY * scrambleLateral * factor;
          }
        } else {
          for (var bi = 1; bi < pts.length; bi++) {
            var settle = bi / (pts.length - 1);
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

    var headFrame = getSpiderHeadFrame(blinkState, wrappingTarget);
    if (headFrame.complete && headFrame.naturalWidth > 0) {
      var imgH = HEAD_IMG_W * (headFrame.naturalHeight / headFrame.naturalWidth);
      ctx.drawImage(
        headFrame,
        headCenter.x - HEAD_IMG_W * 0.5,
        headCenter.y - imgH * 0.5,
        HEAD_IMG_W,
        imgH
      );
      statsDc('image');
    }
  };

  spider.drawParticles = function () { };
}
