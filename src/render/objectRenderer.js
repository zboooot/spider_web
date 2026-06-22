import { flyUrl } from '../assets_b64/fly.js';
import { fly01Url } from '../assets_b64/fly01.js';
import { fly02Url } from '../assets_b64/fly02.js';
import { wormUrl } from '../assets_b64/worm.js';
import { worm00Url } from '../assets_b64/worm00.js';
import { worm01Url } from '../assets_b64/worm01.js';
import { worm02Url } from '../assets_b64/worm02.js';
import { leafUrl } from '../assets_b64/leaf.js';

var flyImg = new Image();
flyImg.src = flyUrl;

var fly01Img = new Image();
fly01Img.src = fly01Url;

var fly02Img = new Image();
fly02Img.src = fly02Url;

var wormImg = new Image();
wormImg.src = wormUrl;

var worm00Img = new Image();
worm00Img.src = worm00Url;

var worm01Img = new Image();
worm01Img.src = worm01Url;

var worm02Img = new Image();
worm02Img.src = worm02Url;

var leafImg = new Image();
leafImg.src = leafUrl;

function getAnimatedFlyImage(obj) {
  if (obj.state === 'wrapping' || obj.state === 'wrapped' || obj.state === 'plucking' || obj.state === 'collecting') return flyImg;
  if (obj.state === 'falling' || obj.state === 'freeing') {
    return (Math.floor(obj.animT / 6) % 2 === 0) ? fly01Img : fly02Img;
  }
  return flyImg;
}

function getAnimatedWormImage(obj) {
  if (obj.state === 'wrapping' || obj.state === 'wrapped' || obj.state === 'plucking' || obj.state === 'collecting') return worm00Img;
  var seq = [worm00Img, worm01Img, worm02Img, worm01Img];
  if (obj.state === 'freeing') {
    return seq[Math.floor(obj.freeTimer / 5) % seq.length];
  }
  return seq[Math.floor(obj.animT / 18) % seq.length];
}

var _silkSpiralCache = {};

function _extractContour(img, drawW, drawH, angleSamples) {
  var offscreen = document.createElement('canvas');
  offscreen.width = Math.ceil(drawW);
  offscreen.height = Math.ceil(drawH);
  var oc = offscreen.getContext('2d');
  oc.drawImage(img, 0, 0, offscreen.width, offscreen.height);
  var data = oc.getImageData(0, 0, offscreen.width, offscreen.height).data;
  var cx = offscreen.width / 2;
  var cy = offscreen.height / 2;
  var maxR = Math.sqrt(cx * cx + cy * cy);
  var contour = [];
  for (var ai = 0; ai < angleSamples; ai++) {
    var angle = (ai / angleSamples) * Math.PI * 2;
    var cos = Math.cos(angle), sin = Math.sin(angle);
    var foundR = 0;
    for (var ri = 2; ri <= maxR; ri += 1.5) {
      var px = Math.round(cx + cos * ri);
      var py = Math.round(cy + sin * ri);
      if (px < 0 || px >= offscreen.width || py < 0 || py >= offscreen.height) break;
      var idx = (py * offscreen.width + px) * 4;
      if (data[idx + 3] > 20) foundR = ri;
    }
    contour.push({ r: foundR, angle: angle });
  }
  return contour;
}

/* 对轮廓半径做 Gaussian 加权滑动平均，保形但消除尖刺
   radius = 滑窗半宽（样本数），sigma 控制衰减 */
function _smoothContour(contour, radius, sigma) {
  if (radius === undefined) radius = 7;
  if (sigma === undefined) sigma = 3.5;
  var n = contour.length;
  var weights = [];
  var wSum = 0;
  for (var k = -radius; k <= radius; k++) {
    var w = Math.exp(-(k * k) / (2 * sigma * sigma));
    weights.push(w);
    wSum += w;
  }
  var smoothed = new Array(n);
  for (var i = 0; i < n; i++) {
    var rAcc = 0;
    for (var ki = 0; ki < weights.length; ki++) {
      var idx = ((i + ki - radius) % n + n) % n;
      rAcc += contour[idx].r * weights[ki];
    }
    smoothed[i] = { r: rAcc / wSum, angle: contour[i].angle };
  }
  return smoothed;
}

function _buildSpiralFromContour(contour, loops, stepsPerLoop) {
  var totalSteps = loops * stepsPerLoop;
  var pts = [];
  var n = contour.length;
  for (var si = 0; si <= totalSteps; si++) {
    var frac = si / totalSteps;
    var loopFrac = (si % stepsPerLoop) / stepsPerLoop;
    var angleIdx = loopFrac * n;
    var ai0 = Math.floor(angleIdx) % n;
    var ai1 = (ai0 + 1) % n;
    var t = angleIdx - Math.floor(angleIdx);
    var r0 = contour[ai0].r, r1 = contour[ai1].r;
    var rInterp = r0 + (r1 - r0) * t;
    /* 螺旋从外缘 1.08x 向内收缩到 0.25x，随 frac 线性递减 */
    var scale = 1.08 - frac * 0.83;
    var angle = contour[ai0].angle + t * (contour[ai1].angle - contour[ai0].angle);
    var rFinal = rInterp * scale;
    pts.push({ x: Math.cos(angle) * rFinal, y: Math.sin(angle) * rFinal });
  }
  return pts;
}

export function buildSilkSpiral(obj) {
  if (obj.kind !== 'bug' && obj.kind !== 'boulder') return null;
  var r = obj.def.r;
  var img, drawW, drawH;
  if (obj.kind === 'bug') {
    img = flyImg;
    drawH = r * 4.32;
    drawW = flyImg.complete && flyImg.naturalWidth > 0
      ? drawH * (flyImg.naturalWidth / flyImg.naturalHeight)
      : drawH * 0.766;
  } else {
    img = wormImg;
    drawW = r * 6.3;
    drawH = wormImg.complete && wormImg.naturalWidth > 0
      ? drawW * (wormImg.naturalHeight / wormImg.naturalWidth)
      : drawW * 1.509;
  }
  var cacheKey = obj.kind + '_' + Math.round(r * 10);
  if (!_silkSpiralCache[cacheKey]) {
    if (!img.complete || img.naturalWidth === 0) return null;
    var contour = _smoothContour(_extractContour(img, drawW, drawH, 180));
    _silkSpiralCache[cacheKey] = contour;
  }
  var contour = _silkSpiralCache[cacheKey];
  var loops = obj.kind === 'bug' ? 10 : 12;
  return _buildSpiralFromContour(contour, loops, 64);
}

function getRenderedObjectAngle(obj) {
  if (obj.kind === 'boulder') {
    var baseAngle = obj.state === 'falling' ? obj.initAngle : (obj.stuckAngle || 0);
    return baseAngle + (obj._wrapAngle || 0) + Math.PI / 2;
  }
  if (obj.kind === 'bug') return obj.angle + Math.PI / 2 + (obj._wrapAngle || 0);
  return obj.angle + (obj._wrapAngle || 0);
}

function getRenderedObjectBounds(obj) {
  var def = obj.def;
  if (obj.kind === 'bug') {
    var flyFrame = getAnimatedFlyImage(obj);
    var flyH = def.r * 4.32;
    var flyW = flyFrame.complete && flyFrame.naturalWidth > 0
      ? flyH * (flyFrame.naturalWidth / flyFrame.naturalHeight)
      : def.r * 3.5;
    return { width: flyW, height: flyH };
  }
  if (obj.kind === 'boulder') {
    var wormFrame = getAnimatedWormImage(obj);
    var wormW = def.r * 6.3;
    var wormH = wormFrame.complete && wormFrame.naturalWidth > 0
      ? wormW * (wormFrame.naturalHeight / wormFrame.naturalWidth)
      : def.r * 9.2;
    return { width: wormW, height: wormH };
  }
  return { width: def.r * 2, height: def.r * 2 };
}

function drawSilkSpiralLocal(ctx, obj, progress) {
  if (!obj._silkSpiral || (obj.kind !== 'bug' && obj.kind !== 'boulder')) return;
  var pts = obj._silkSpiral;
  var drawCount = Math.floor(progress * (pts.length - 1));
  if (drawCount < 1) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (var si = 1; si <= drawCount; si++) ctx.lineTo(pts[si].x, pts[si].y);
  ctx.stroke();
  var tip = pts[drawCount];
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, 1.8, 0, 2 * Math.PI);
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.fill();
  ctx.restore();
}

function drawObjectSpriteLocal(ctx, obj) {
  var def = obj.def;
  if (obj.kind === 'boulder') {
    var wormFrame = getAnimatedWormImage(obj);
    if (wormFrame.complete && wormFrame.naturalWidth > 0) {
      var wormW = def.r * 6.3;
      var wormH = wormW * (wormFrame.naturalHeight / wormFrame.naturalWidth);
      ctx.drawImage(wormFrame, -wormW * 0.5, -wormH * 0.5, wormW, wormH);
    }
    return;
  }
  if (obj.kind === 'bug') {
    var flyFrame = getAnimatedFlyImage(obj);
    if (flyFrame.complete && flyFrame.naturalWidth > 0) {
      var flyH = def.r * 4.32;
      var flyW = flyH * (flyFrame.naturalWidth / flyFrame.naturalHeight);
      ctx.drawImage(flyFrame, -flyW * 0.5, -flyH * 0.5, flyW, flyH);
    }
  }
}

export function buildCollectSnapshot(obj) {
  if (obj.kind !== 'bug' && obj.kind !== 'boulder') return null;
  var bounds = getRenderedObjectBounds(obj);
  var size = Math.ceil(Math.sqrt(bounds.width * bounds.width + bounds.height * bounds.height) + 18);
  var canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.className = 'collect-token-art';
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  var ctx = canvas.getContext('2d');
  ctx.translate(size * 0.5, size * 0.5);
  ctx.rotate(getRenderedObjectAngle(obj));
  drawObjectSpriteLocal(ctx, obj);
  drawSilkSpiralLocal(ctx, obj, 1);
  return { canvas: canvas, size: size };
}

export function drawThrownObjects(ctx, thrownObjects) {
  for (var oi = 0; oi < thrownObjects.length; oi++) {
    var obj = thrownObjects[oi], def = obj.def;
    var px = obj.particle.pos.x, py = obj.particle.pos.y;
    ctx.save(); ctx.globalAlpha = obj.alpha;

    /* wrapping 状态：颤抖 + 转动 */
    if (obj.state === 'wrapping') {
      var wt = obj.wrapT;
      var at = obj.animT;
      var tremble = wt * 3.5;
      px += Math.sin(at * 1.9) * tremble + Math.cos(at * 3.1) * tremble * 0.5;
      py += Math.cos(at * 2.2) * tremble * 0.8 + Math.sin(at * 3.7) * tremble * 0.3;
      var wrapAngle = Math.sin(at * 0.85 + wt * 10) * 0.31 * wt;
      obj._wrapAngle = wrapAngle;
      var wrapDeform = Math.sin(at * 0.26 + wt * 8) * 0.035 * wt;
      obj._drawScaleX = 1 + wrapDeform;
      obj._drawScaleY = 1 - wrapDeform * 0.75;
      obj._drawStretchScale = 1;
      obj._drawStretchSquash = 1;
      obj._drawStretchAngle = 0;
    } else if (obj.state === 'wrapped') {
      obj._wrapAngle = 0;
      var popFrac2 = Math.min(1, obj._popT / obj._popDur);
      var popScale = 1 + Math.sin(popFrac2 * Math.PI) * 0.12;
      var idleDeform = Math.sin(obj.animT * 0.16) * 0.028;
      var pullDeform = Math.min(0.22, (obj._pickupCharge || 0) * 0.18 + (obj._pickupTension || 0) * 0.06);
      obj._drawScaleX = popScale * (1 + idleDeform);
      obj._drawScaleY = popScale * (1 - idleDeform * 0.75);
      obj._drawStretchScale = 1 + pullDeform;
      obj._drawStretchSquash = 1 - pullDeform * 0.58;
      obj._drawStretchAngle = obj._pickupPullAngle || 0;
    } else if (obj.state === 'plucking') {
      obj._wrapAngle = 0;
      var pluckPop2 = 20;
      var pluckFrac = Math.min(1, (obj._pluckT || 0) / pluckPop2);
      var pulse = pluckFrac < 0.35
        ? 1 + (pluckFrac / 0.35) * 0.65
        : 1.65 - ((pluckFrac - 0.35) / 0.65) * 0.65;
      obj._drawScaleX = pulse;
      obj._drawScaleY = pulse;
      obj._drawStretchScale = 1;
      obj._drawStretchSquash = 1;
      obj._drawStretchAngle = 0;
    } else if (obj.state === 'collecting') {
      obj._wrapAngle = 0;
      obj._drawScaleX = obj._shrinkScale != null ? obj._shrinkScale : 1;
      obj._drawScaleY = obj._shrinkScale != null ? obj._shrinkScale : 1;
      obj._drawStretchScale = 1;
      obj._drawStretchSquash = 1;
      obj._drawStretchAngle = 0;
    } else {
      obj._wrapAngle = 0;
      obj._drawScaleX = 1;
      obj._drawScaleY = 1;
      obj._drawStretchScale = 1;
      obj._drawStretchSquash = 1;
      obj._drawStretchAngle = 0;
    }

    /* ── 毛毛虫 ── */
    if (obj.kind === 'boulder') {
      ctx.save(); ctx.translate(px, py);
      if (obj._drawStretchScale !== 1 || obj._drawStretchSquash !== 1) {
        ctx.rotate(obj._drawStretchAngle || 0);
        ctx.scale(obj._drawStretchScale || 1, obj._drawStretchSquash || 1);
        ctx.rotate(-(obj._drawStretchAngle || 0));
      }
      if (obj._drawScaleX !== 1 || obj._drawScaleY !== 1) ctx.scale(obj._drawScaleX, obj._drawScaleY);
      var drawAngle;
      if (obj.state === 'falling') drawAngle = obj.initAngle;
      else if (obj.state === 'sticking') drawAngle = obj.initAngle + (obj.stuckAngle - obj.initAngle) * obj.stickT;
      else drawAngle = obj.stuckAngle || 0;
      if (obj._wrapAngle) drawAngle = (drawAngle || 0) + obj._wrapAngle;
      ctx.rotate((drawAngle || 0) + Math.PI / 2);
      var wormFrame = getAnimatedWormImage(obj);
      if (wormFrame.complete && wormFrame.naturalWidth > 0) {
        var wormW = def.r * 6.3;  // 9.0 × 0.7
        var wormH = wormW * (wormFrame.naturalHeight / wormFrame.naturalWidth);
        ctx.drawImage(wormFrame, -wormW * 0.5, -wormH * 0.5, wormW, wormH);
      } else {
        var segs = 4, segR = def.r * 0.92, gap = segR * 1.45;
        var waveScale = (obj.state === 'stuck' || obj.state === 'freeing') ? 1.0 : 0.12;
        for (var si = 0; si < segs; si++) {
          var sy2 = si * gap - (segs - 1) * gap * 0.5 + gap * 0.5;
          var wave = Math.sin(obj.segT + si * 1.0) * 2.5 * waveScale;
          var rv = Math.floor(160 + si * 22);
          ctx.beginPath(); ctx.arc(wave, sy2, segR, 0, 2 * Math.PI);
          ctx.fillStyle = 'rgb(' + rv + ',20,20)'; ctx.fill();
          ctx.strokeStyle = 'rgba(80,0,0,0.45)'; ctx.lineWidth = 0.7; ctx.stroke();
        }
        var headY = -(segs - 1) * gap * 0.5 - gap * 0.15;
        var headWave = Math.sin(obj.segT + segs * 1.0) * 2.5 * waveScale;
        ctx.beginPath(); ctx.arc(headWave, headY, segR * 1.2, 0, 2 * Math.PI);
        ctx.fillStyle = '#b81010'; ctx.fill();
        ctx.strokeStyle = 'rgba(80,0,0,0.55)'; ctx.lineWidth = 0.8; ctx.stroke();
      }
      ctx.restore();
    }

    /* ── 苍蝇 ── */
    else if (obj.kind === 'bug') {
      ctx.save(); ctx.translate(px, py);
      if (obj._drawStretchScale !== 1 || obj._drawStretchSquash !== 1) {
        ctx.rotate(obj._drawStretchAngle || 0);
        ctx.scale(obj._drawStretchScale || 1, obj._drawStretchSquash || 1);
        ctx.rotate(-(obj._drawStretchAngle || 0));
      }
      if (obj._drawScaleX !== 1 || obj._drawScaleY !== 1) ctx.scale(obj._drawScaleX, obj._drawScaleY);
      ctx.rotate(obj.angle + Math.PI / 2 + (obj._wrapAngle || 0));
      var flyFrame = getAnimatedFlyImage(obj);
      if (flyFrame.complete && flyFrame.naturalWidth > 0) {
        var flyH = def.r * 4.32;
        var flyW = flyH * (flyFrame.naturalWidth / flyFrame.naturalHeight);
        ctx.drawImage(flyFrame, -flyW * 0.5, -flyH * 0.5, flyW, flyH);
      } else {
        var r = def.r;
        var wFlapBase = (obj.state === 'stuck' || obj.state === 'freeing' || obj.state === 'wrapping') ? 0.65 * 0.30 : 0.65;
        var wFlap = Math.sin(obj.wingT) * wFlapBase;
        ctx.save(); ctx.rotate(-wFlap);
        ctx.beginPath(); ctx.ellipse(-r * 1.6, -r * 0.2, r * 1.55, r * 0.52, Math.PI * 0.08, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(160,210,255,0.72)'; ctx.fill();
        ctx.strokeStyle = 'rgba(60,100,180,0.55)'; ctx.lineWidth = 0.9; ctx.stroke();
        ctx.restore();
        ctx.save(); ctx.rotate(wFlap);
        ctx.beginPath(); ctx.ellipse(r * 1.6, -r * 0.2, r * 1.55, r * 0.52, -Math.PI * 0.08, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(160,210,255,0.72)'; ctx.fill();
        ctx.strokeStyle = 'rgba(60,100,180,0.55)'; ctx.lineWidth = 0.9; ctx.stroke();
        ctx.restore();
        ctx.beginPath(); ctx.ellipse(0, 0, r * 0.55, r, 0, 0, 2 * Math.PI);
        ctx.fillStyle = '#3a3a2a'; ctx.fill();
      }
      ctx.restore();
    }

    /* ── 树叶 ── */
    else if (obj.kind === 'drop') {
      ctx.save(); ctx.translate(px, py);
      if (obj._drawScaleX !== 1 || obj._drawScaleY !== 1) ctx.scale(obj._drawScaleX, obj._drawScaleY);
      ctx.rotate(obj.angle + (obj._wrapAngle || 0));
      if (leafImg.complete && leafImg.naturalWidth > 0) {
        var leafW = def.r * 6.08;  // 3.8 × 1.6
        var leafH = leafW * (leafImg.naturalHeight / leafImg.naturalWidth);
        ctx.drawImage(leafImg, -leafW * 0.5, -leafH * 0.5, leafW, leafH);
      } else {
        var r = def.r;
        ctx.beginPath();
        ctx.moveTo(0, -r * 1.6);
        ctx.bezierCurveTo(r * 1.1, -r * 0.8, r * 1.1, r * 0.8, 0, r * 1.6);
        ctx.bezierCurveTo(-r * 1.1, r * 0.8, -r * 1.1, -r * 0.8, 0, -r * 1.6);
        ctx.closePath();
        var lg = ctx.createLinearGradient(-r, 0, r, 0);
        lg.addColorStop(0, '#3a7a25'); lg.addColorStop(0.5, '#5aaa35'); lg.addColorStop(1, '#3a7a25');
        ctx.fillStyle = lg; ctx.fill();
      }
      ctx.restore();
    }

    /* sticking ring flash */
    if (obj.state === 'sticking') {
      var flashR = def.r + (1 - obj.stickT) * 18;
      ctx.beginPath(); ctx.arc(px, py, flashR, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(180,220,140,' + (0.55 * (1 - obj.stickT)) + ')';
      ctx.lineWidth = 2; ctx.stroke();
    }

    if ((obj.state === 'wrapping' || obj.state === 'wrapped' || obj.state === 'plucking' || obj.state === 'collecting') && obj._silkSpiral && (obj.kind === 'bug' || obj.kind === 'boulder')) {
      var silkProgress = obj.state === 'wrapping' ? obj.wrapT : 1;
      if (silkProgress > 0) {
        ctx.save();
        ctx.translate(px, py);
        ctx.globalAlpha = obj.alpha;
        if (obj._drawStretchScale !== 1 || obj._drawStretchSquash !== 1) {
          ctx.rotate(obj._drawStretchAngle || 0);
          ctx.scale(obj._drawStretchScale || 1, obj._drawStretchSquash || 1);
          ctx.rotate(-(obj._drawStretchAngle || 0));
        }
        if (obj._drawScaleX !== 1 || obj._drawScaleY !== 1) ctx.scale(obj._drawScaleX, obj._drawScaleY);
        ctx.rotate(getRenderedObjectAngle(obj));
        drawSilkSpiralLocal(ctx, obj, silkProgress);
        ctx.restore();
      }
    }

    ctx.restore();
  }
}
