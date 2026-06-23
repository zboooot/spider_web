import { DistanceConstraint } from '../engine/constraints.js';
import { statsDc } from '../debug/renderStats.js';

var popoHeadImg = new Image();
popoHeadImg.src = '/src/assets/popo.png';

var popoBlinkImg = new Image();
popoBlinkImg.src = '/src/assets/popo_blink.png';

var popoPackImg = new Image();
popoPackImg.src = '/src/assets/popo_pack.png';

var popoShockImg = new Image();
popoShockImg.src = '/src/assets/popo_shock.png';

var popoCry01Img = new Image();
popoCry01Img.src = '/src/assets/popo_cry01.png';

var popoCry02Img = new Image();
popoCry02Img.src = '/src/assets/popo_cry02.png';

function getSpiderHeadFrame(blinkState, wrappingTarget) {
  if (wrappingTarget) return popoPackImg;
  if (blinkState && blinkState.mood === 'shock') return popoShockImg;
  if (blinkState && blinkState.mood === 'crying') {
    return (Math.floor((blinkState.faceAnimT || 0) / 10) % 2 === 0) ? popoCry01Img : popoCry02Img;
  }
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
    var _maxFootJump2 = 48 * 48;
    if (!spider._footDrawPrev) spider._footDrawPrev = [];
    for (var fi = 0; fi < footState.length; fi++) {
      var fs = footState[fi];
      var drawCX = fs.current.x, drawCY = fs.current.y;
      var prev = spider._footDrawPrev[fi];
      if (prev) {
        var fjdx = drawCX - prev.x, fjdy = drawCY - prev.y;
        if (fjdx * fjdx + fjdy * fjdy > _maxFootJump2) {
          drawCX = prev.x + fjdx * 0.4;
          drawCY = prev.y + fjdy * 0.4;
        }
      }
      footDraw.push({ x: drawCX, y: drawCY });
      spider._footDrawPrev[fi] = { x: drawCX, y: drawCY };
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
        var fd = footDraw[ci];
        var hx = pts[0].x, hy = pts[0].y;
        var dxh = fd.x - hx, dyh = fd.y - hy;
        var d2h = dxh * dxh + dyh * dyh;
        if (d2h > 66 * 66) {
          var dl = Math.sqrt(d2h) || 1;
          var clamp = 60;
          pts[pts.length - 1] = { x: hx + dxh / dl * clamp, y: hy + dyh / dl * clamp };
        } else {
          pts[pts.length - 1] = fd;
        }
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
      var ax = ax2, ay = ay2;
      var tx = tx2, ty = ty2;
      var fdx = tx - ax, fdy = ty - ay, fl = Math.sqrt(fdx * fdx + fdy * fdy) || 1;
      var fnx = fdx / fl, fny = fdy / fl, prx = -fny, pry = fnx;
      var imgH = HEAD_IMG_W * (headFrame.naturalHeight / headFrame.naturalWidth);
      var shakeOff = (blinkState && blinkState.headShake > 0)
        ? Math.sin(blinkState.headShake * 1.8) * blinkState.headShakeAmp : 0;
      var shockX = 0, shockY = 0, cryDrop = 0;
      if (blinkState && blinkState.mood === 'shock') {
        shockX = Math.sin((blinkState.headShake || 0) * 2.8) * 2.1;
        shockY = Math.cos((blinkState.headShake || 0) * 2.2) * 1.6;
      } else if (blinkState && blinkState.mood === 'crying') {
        cryDrop = 2.8 + Math.abs(Math.sin((blinkState.faceAnimT || 0) * 0.18)) * 1.8;
      }
      var imgCX = headCenter.x + prx * shakeOff + shockX;
      var imgCY = headCenter.y + pry * shakeOff + shockY + cryDrop;
      ctx.drawImage(
        headFrame,
        imgCX - HEAD_IMG_W * 0.5,
        imgCY - imgH * 0.5,
        HEAD_IMG_W,
        imgH
      );
      statsDc('image');
    }
  };

  spider.drawParticles = function () { };
}
