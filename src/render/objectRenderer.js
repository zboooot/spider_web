import { statsDc } from '../debug/renderStats.js';
import {
  DEBUG_SILK_CONTOUR,
  applyContourPhaseOffset,
  applyPreyDeform,
  buildContourCacheKey,
  getPreyRenderAngle,
  getSilkProgress,
  getSilkShimmer,
  getSpiralLoops,
  getSpiralPhaseOffset,
  getWrapDrawSize,
  isSilkWrappedKind,
  shouldDrawSilkForObject
} from './preyWrapProfile.js';
import {
  flyImg,
  fly01Img,
  fly02Img,
  wormImg,
  worm00Img,
  worm01Img,
  worm02Img,
  leafImg,
  poopImg,
} from '../assets/imageAssets.js';

function _invalidateSilkContourCache() {
  _silkSpiralCache = {};
}

function _bindSilkContourImage(img) {
  img.onload = function () {
    _invalidateSilkContourCache();
  };
}

_bindSilkContourImage(flyImg);
_bindSilkContourImage(worm00Img);
_bindSilkContourImage(poopImg);

function getSilkContourFrame(kind) {
  if (kind === 'bug') return flyImg;
  if (kind === 'boulder') return worm00Img;
  if (kind === 'poop') return poopImg;
  return null;
}

var _priorityFlashCanvas = document.createElement('canvas');
var _priorityFlashCtx = _priorityFlashCanvas.getContext('2d');

function drawPriorityImage(ctx, img, x, y, w, h, pulse) {
  var pw = Math.max(1, Math.ceil(w));
  var ph = Math.max(1, Math.ceil(h));
  if (_priorityFlashCanvas.width !== pw || _priorityFlashCanvas.height !== ph) {
    _priorityFlashCanvas.width = pw;
    _priorityFlashCanvas.height = ph;
  } else {
    _priorityFlashCtx.clearRect(0, 0, pw, ph);
  }
  _priorityFlashCtx.clearRect(0, 0, pw, ph);
  _priorityFlashCtx.drawImage(img, 0, 0, pw, ph);
  _priorityFlashCtx.globalCompositeOperation = 'source-atop';
  _priorityFlashCtx.globalAlpha = 0.45 * pulse;
  _priorityFlashCtx.fillStyle = '#ffffff';
  _priorityFlashCtx.fillRect(0, 0, pw, ph);
  _priorityFlashCtx.globalAlpha = 1;
  _priorityFlashCtx.globalCompositeOperation = 'source-over';
  ctx.drawImage(_priorityFlashCanvas, x, y, w, h);
}

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
  if (!isSilkWrappedKind(obj.kind)) return null;
  var r = obj.def.r;
  var img = getSilkContourFrame(obj.kind);
  if (!img) return null;
  var size = getWrapDrawSize(obj.kind, r, img);
  var cacheKey = buildContourCacheKey(obj.kind, img, r);
  if (!_silkSpiralCache[cacheKey]) {
    if (!img.complete || img.naturalWidth === 0) return null;
    var raw = _smoothContour(_extractContour(img, size.width, size.height, 180));
    _silkSpiralCache[cacheKey] = applyContourPhaseOffset(raw, getSpiralPhaseOffset(obj.kind));
  }
  var contour = _silkSpiralCache[cacheKey];
  obj._silkContour = contour;
  return _buildSpiralFromContour(contour, getSpiralLoops(obj.kind), 64);
}

export function ensureSilkSpiral(obj) {
  if (!isSilkWrappedKind(obj.kind)) return;
  if (!obj._silkSpiral) obj._silkSpiral = buildSilkSpiral(obj);
}

function getRenderedObjectAngle(obj) {
  if (obj.kind === 'boulder') {
    var baseAngle = (obj.state === 'falling' || obj.state === 'falling2' || obj.state === 'sticking')
      ? obj.initAngle : (obj.stuckAngle || 0);
    return baseAngle + (obj._wrapAngle || 0);
  }
  if (obj.kind === 'bug') {
    if (obj.state === 'falling' && obj._tiltAngle != null) return obj._tiltAngle;
    if ((obj.state === 'stuck' || obj.state === 'sticking') && obj._stuckTiltAngle != null) {
      return obj._stuckTiltAngle;
    }
    return obj.angle + Math.PI / 2 + (obj._wrapAngle || 0);
  }
  if (obj.kind === 'poop') return obj.angle * 0.45 + (obj._wrapAngle || 0) * 0.6;
  return obj.angle + (obj._wrapAngle || 0);
}

function shouldMirrorObjectX(obj) {
  if (obj.kind === 'boulder') return !!obj._mirrorX;
  if (obj.kind === 'bug') {
    if (obj.state === 'falling' && obj._tiltAngle != null) return !!obj._flyMirror;
    if ((obj.state === 'stuck' || obj.state === 'sticking') && obj._stuckTiltAngle != null) {
      return !!obj._stuckFlyMirror;
    }
  }
  return false;
}

function getRenderedObjectBounds(obj) {
  var def = obj.def;
  if (obj.kind === 'bug') return getWrapDrawSize('bug', def.r, getAnimatedFlyImage(obj));
  if (obj.kind === 'boulder') return getWrapDrawSize('boulder', def.r, getAnimatedWormImage(obj));
  if (obj.kind === 'poop') return getWrapDrawSize('poop', def.r, poopImg);
  return { width: def.r * 2, height: def.r * 2 };
}

function strokeSilkContour(ctx, contour, radiusOffset, strokeStyle, lineWidth, shadowBlur, shadowColor) {
  if (!contour || !contour.length) return;
  ctx.save();
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  if (shadowBlur > 0) {
    ctx.shadowBlur = shadowBlur;
    ctx.shadowColor = shadowColor;
  }
  ctx.beginPath();
  for (var ci = 0; ci < contour.length; ci++) {
    var c = contour[ci];
    var r = c.r + (radiusOffset || 0);
    var cx = Math.cos(c.angle) * r;
    var cy = Math.sin(c.angle) * r;
    if (ci === 0) ctx.moveTo(cx, cy);
    else ctx.lineTo(cx, cy);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function drawSilkContourDebug(ctx, obj) {
  if (!DEBUG_SILK_CONTOUR || !obj._silkContour) return;
  strokeSilkContour(ctx, obj._silkContour, 0, 'rgba(255,48,48,0.75)', 1, 0, 'transparent');
}

function drawWrappedPreySelectionOutline(ctx, obj, pulse) {
  ensureSilkSpiral(obj);
  var contour = obj._silkContour;
  if (!contour || !contour.length) return;
  var pad = 4 + pulse * 2.5;
  var alpha = (0.82 + pulse * 0.18).toFixed(2);
  strokeSilkContour(
    ctx,
    contour,
    pad,
    'rgba(255, 255, 255, ' + alpha + ')',
    4.2,
    10,
    'rgba(255, 255, 255, 0.5)'
  );
}

function drawSilkOnCurrentTransform(ctx, obj) {
  if (!shouldDrawSilkForObject(obj)) return;
  var silkProgress = getSilkProgress(obj);
  if (silkProgress <= 0) return;
  drawSilkContourDebug(ctx, obj);
  drawSilkSpiralLocal(ctx, obj, silkProgress, getSilkShimmer(obj));
}

function drawSilkSpiralLocal(ctx, obj, progress, shimmer) {
  if (!obj._silkSpiral || (obj.kind !== 'bug' && obj.kind !== 'boulder' && obj.kind !== 'poop')) return;
  var pts = obj._silkSpiral;
  var drawCount = Math.floor(progress * (pts.length - 1));
  if (drawCount < 1) return;
  var glow = shimmer || 0;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.5 + glow * 0.35;
  ctx.strokeStyle = 'rgba(255,255,255,' + (0.78 + glow * 0.05).toFixed(3) + ')';
  if (glow > 0) {
    ctx.shadowBlur = 8 + glow * 8;
    ctx.shadowColor = 'rgba(255,255,255,' + (0.14 + glow * 0.12).toFixed(3) + ')';
  }
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (var si = 1; si <= drawCount; si++) ctx.lineTo(pts[si].x, pts[si].y);
  ctx.stroke();
  var tip = pts[drawCount];
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, 1.8, 0, 2 * Math.PI);
  ctx.fillStyle = 'rgba(255,255,255,' + (0.84 - glow * 0.04).toFixed(3) + ')';
  ctx.fill();
  ctx.restore();
}

function drawObjectSpriteLocal(ctx, obj) {
  var def = obj.def;
  if (obj.kind === 'boulder') {
    var wormFrame = getAnimatedWormImage(obj);
    if (wormFrame.complete && wormFrame.naturalWidth > 0) {
      var wormSize = getWrapDrawSize('boulder', def.r, wormFrame);
      ctx.drawImage(wormFrame, -wormSize.width * 0.5, -wormSize.height * 0.5, wormSize.width, wormSize.height);
    }
    return;
  }
  if (obj.kind === 'bug') {
    var flyFrame = getAnimatedFlyImage(obj);
    if (flyFrame.complete && flyFrame.naturalWidth > 0) {
      var flySize = getWrapDrawSize('bug', def.r, flyFrame);
      ctx.drawImage(flyFrame, -flySize.width * 0.5, -flySize.height * 0.5, flySize.width, flySize.height);
    }
    return;
  }
  if (obj.kind === 'poop' && poopImg.complete && poopImg.naturalWidth > 0) {
    var poopSize = getWrapDrawSize('poop', def.r, poopImg);
    ctx.drawImage(poopImg, -poopSize.width * 0.5, -poopSize.height * 0.5, poopSize.width, poopSize.height);
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
  applyPreyDeform(ctx, obj, 1);
  if (shouldMirrorObjectX(obj)) ctx.scale(-1, 1);
  ctx.rotate(getRenderedObjectAngle(obj));
  drawObjectSpriteLocal(ctx, obj);
  drawSilkSpiralLocal(ctx, obj, 1, 0);
  return { canvas: canvas, size: size };
}

function drawPoopBlob(ctx, obj, def, applyPriorityFlashRect, applyPriorityFlashImage) {
  var r = def.r;
  var charge = obj._pickupCharge || 0;
  if (obj.cA && obj.cB && obj.state === 'stuck') {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = charge > 0
      ? 'rgba(245,232,205,' + Math.min(0.96, 0.58 + charge * 0.22).toFixed(2) + ')'
      : 'rgba(25,18,14,0.55)';
    ctx.lineWidth = charge > 0 ? (7.0 + charge * 4.6) : 3.2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(obj.cA.b.pos.x - obj.particle.pos.x, obj.cA.b.pos.y - obj.particle.pos.y);
    ctx.moveTo(0, 0);
    ctx.lineTo(obj.cB.b.pos.x - obj.particle.pos.x, obj.cB.b.pos.y - obj.particle.pos.y);
    ctx.stroke();
    if (charge > 0) {
      ctx.globalAlpha = 0.34 + Math.min(0.42, charge * 0.22);
      ctx.lineWidth += 3.6;
      ctx.stroke();
    }
    ctx.restore();
  }
  if (poopImg.complete && poopImg.naturalWidth > 0) {
    var poopSize = getWrapDrawSize('poop', r, poopImg);
    ctx.drawImage(poopImg, -poopSize.width * 0.5, -poopSize.height * 0.5, poopSize.width, poopSize.height);
    if (applyPriorityFlashImage) {
      applyPriorityFlashImage(ctx, poopImg, -poopSize.width * 0.5, -poopSize.height * 0.5, poopSize.width, poopSize.height);
    }
    statsDc('image');
    return;
  }
  var pulse = obj.state === 'stuck'
    ? (0.38 + 0.24 * Math.abs(Math.sin(obj.animT * 0.08)))
    : 0.22;
  ctx.beginPath();
  ctx.ellipse(0, r * 0.58, r * 0.74, r * 0.56, 0, 0, 2 * Math.PI);
  ctx.ellipse(-r * 0.38, -r * 0.12, r * 0.62, r * 0.56, -0.18, 0, 2 * Math.PI);
  ctx.ellipse(r * 0.2, -r * 0.66, r * 0.56, r * 0.48, 0.14, 0, 2 * Math.PI);
  ctx.fillStyle = 'rgba(' + Math.round(18 + pulse * 30) + ',' + Math.round(13 + pulse * 18) + ',' + Math.round(10 + pulse * 14) + ',0.96)';
  ctx.fill();
  applyPriorityFlashRect(ctx, -r * 2.2, -r * 2.4, r * 4.4, r * 4.9);
}

/* wrapped 虫类偶发「可摘取」提示：间隔约 11–19s，单次约 0.7s */
var PICKUP_NUDGE_INTERVAL_MIN = 660;
var PICKUP_NUDGE_INTERVAL_MAX = 1140;
var PICKUP_NUDGE_DUR = 42;

function ensurePickupNudgeSchedule(obj) {
  if (obj._pickupNudgeInterval == null) {
    obj._pickupNudgePhase = Math.random() * 400;
    obj._pickupNudgeInterval = PICKUP_NUDGE_INTERVAL_MIN
      + Math.floor(Math.random() * (PICKUP_NUDGE_INTERVAL_MAX - PICKUP_NUDGE_INTERVAL_MIN));
  }
}

function getPickupNudgeStrength(obj, skipCue) {
  obj._pickupNudgeStrength = 0;
  if (skipCue) return 0;
  if (obj.state !== 'wrapped' || (obj.kind !== 'bug' && obj.kind !== 'boulder')) return 0;
  if ((obj._pickupCharge || 0) > 0.04 || (obj._pickupTension || 0) > 0.05) return 0;
  ensurePickupNudgeSchedule(obj);
  var local = (obj.animT + obj._pickupNudgePhase) % obj._pickupNudgeInterval;
  if (local >= PICKUP_NUDGE_DUR) return 0;
  var strength = Math.sin((local / PICKUP_NUDGE_DUR) * Math.PI);
  obj._pickupNudgeStrength = strength;
  return strength;
}

/** 物体在 Canvas 上的视觉中心（含 wrapping 颤抖偏移） */
export function getRenderedObjectCenter(obj) {
  var px = obj.particle.pos.x;
  var py = obj.particle.pos.y;
  if (obj.state === 'wrapping') {
    var wt = obj.wrapT;
    var at = obj.animT;
    var tremble = wt * 3.5;
    px += Math.sin(at * 0.95) * tremble + Math.cos(at * 1.55) * tremble * 0.5;
    py += Math.cos(at * 1.1) * tremble * 0.8 + Math.sin(at * 1.85) * tremble * 0.3;
  }
  return { x: px, y: py };
}

/**
 * 投掷物体绘制
 */
export function drawThrownObjects(ctx, thrownObjects, priorityTarget, selectedWrappedPrey) {
  for (var oi = 0; oi < thrownObjects.length; oi++) {
    var obj = thrownObjects[oi], def = obj.def;
    var center = getRenderedObjectCenter(obj);
    var px = center.x, py = center.y;
    ctx.save(); ctx.globalAlpha = obj.alpha;
    var _isPriorityTarget = !!(priorityTarget && priorityTarget.type === 'object' && priorityTarget.obj === obj);
    var _priorityPulse = _isPriorityTarget ? (0.55 + 0.45 * Math.abs(Math.sin(obj.animT * 0.22))) : 0;
    var _isWrappedSelected = selectedWrappedPrey === obj && obj.state === 'wrapped'
      && (obj.kind === 'bug' || obj.kind === 'boulder');
    var _selectionPulse = _isWrappedSelected ? (0.55 + 0.45 * Math.abs(Math.sin(obj.animT * 0.22))) : 0;

    function applyPriorityFlashRect(localCtx, x, y, w, h) {
      if (!_isPriorityTarget) return;
      localCtx.save();
      localCtx.globalCompositeOperation = 'source-atop';
      localCtx.globalAlpha = 0.45 * _priorityPulse;
      localCtx.fillStyle = '#ffffff';
      localCtx.fillRect(x, y, w, h);
      localCtx.restore();
    }

    /* sticking 弹簧缩放：粘住瞬间压缩再弹回 */
    var _springScale = 1.0;
    if (obj.state === 'sticking') {
      var _st = obj.stickT; /* 0→1 */
      /* 树叶弹簧幅度减半：压缩到 0.86，弹回到 1.15 */
      var _compress = obj.kind === 'drop' ? 0.14 : 0.28;
      var _bounce   = obj.kind === 'drop' ? 0.29 : 0.58;
      var _peak     = obj.kind === 'drop' ? 1.15 : 1.30;
      var _drop2    = obj.kind === 'drop' ? 0.15 : 0.30;
      if (_st < 0.35) {
        _springScale = 1.0 - (_st / 0.35) * _compress;
      } else if (_st < 0.65) {
        var _t2 = (_st - 0.35) / 0.30;
        _springScale = (1.0 - _compress) + _t2 * _bounce;
      } else {
        var _t3 = (_st - 0.65) / 0.35;
        _springScale = _peak - _t3 * _drop2;
      }
    }

    /* wrapping 状态：颤抖 + 转动 */
    if (obj.state === 'wrapping') {
      var wt = obj.wrapT;
      var at = obj.animT;
      var wrapAngle = Math.sin(at * 0.425 + wt * 10) * 0.31 * wt;
      obj._wrapAngle = wrapAngle;
      var wrapDeform = Math.sin(at * 0.26 + wt * 8) * 0.035 * wt;
      obj._drawScaleX = 1 + wrapDeform;
      obj._drawScaleY = 1 - wrapDeform * 0.75;
      obj._drawStretchScale = 1;
      obj._drawStretchSquash = 1;
      obj._drawStretchAngle = 0;
    } else if (obj.state === 'wrapped') {
      var _pickupNudge = getPickupNudgeStrength(obj, _isPriorityTarget || _isWrappedSelected);
      var popFrac2 = Math.min(1, obj._popT / obj._popDur);
      var popScale = 1 + Math.sin(popFrac2 * Math.PI) * 0.12;
      var idleDeform = Math.sin(obj.animT * 0.16) * 0.028;
      var nudgeDeform = _pickupNudge * Math.sin(obj.animT * 0.72) * 0.055;
      var pullDeform = Math.min(0.22, (obj._pickupCharge || 0) * 0.18 + (obj._pickupTension || 0) * 0.06);
      obj._wrapAngle = _pickupNudge * Math.sin(obj.animT * 0.95) * 0.1;
      obj._drawScaleX = popScale * (1 + idleDeform + nudgeDeform);
      obj._drawScaleY = popScale * (1 - idleDeform * 0.75 - nudgeDeform * 0.65);
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
      obj._pickupNudgeStrength = 0;
    }

    var _pickupNudge = obj._pickupNudgeStrength || 0;
    if (_pickupNudge > 0) {
      px += Math.sin(obj.animT * 0.88) * _pickupNudge * 1.35;
      py += Math.cos(obj.animT * 1.05) * _pickupNudge * 0.95;
    }

    var _isWrapping = obj.state === 'wrapping';

    /* ── 落石（穿透破网，不粘连） ── */
    if (obj.kind === 'stone') {
      ctx.save();
      ctx.translate(px, py);
      if (_springScale !== 1.0) ctx.scale(_springScale, _springScale);
      var stoneR = def.r;
      var pullT = obj._tutorialPullTension || 0;
      ctx.rotate((obj.angle || 0) * 0.45);
      var stoneGrad = ctx.createRadialGradient(-stoneR * 0.28, -stoneR * 0.42, stoneR * 0.08, 0, 0, stoneR * 1.02);
      stoneGrad.addColorStop(0, '#d6dbe0');
      stoneGrad.addColorStop(0.38, '#a3abb4');
      stoneGrad.addColorStop(0.78, '#707982');
      stoneGrad.addColorStop(1, '#4a535c');
      ctx.beginPath();
      ctx.moveTo(-stoneR * 0.78, -stoneR * 0.22);
      ctx.lineTo(-stoneR * 0.42, -stoneR * 0.82);
      ctx.lineTo(stoneR * 0.24, -stoneR * 0.9);
      ctx.lineTo(stoneR * 0.82, -stoneR * 0.34);
      ctx.lineTo(stoneR * 0.72, stoneR * 0.36);
      ctx.lineTo(stoneR * 0.18, stoneR * 0.88);
      ctx.lineTo(-stoneR * 0.46, stoneR * 0.78);
      ctx.lineTo(-stoneR * 0.9, stoneR * 0.18);
      ctx.closePath();
      ctx.fillStyle = stoneGrad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(24,28,34,' + (0.52 + pullT * 0.12).toFixed(2) + ')';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-stoneR * 0.28, -stoneR * 0.34);
      ctx.lineTo(-stoneR * 0.04, -stoneR * 0.52);
      ctx.lineTo(stoneR * 0.16, -stoneR * 0.28);
      ctx.lineTo(stoneR * 0.02, -stoneR * 0.04);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(stoneR * 0.08, stoneR * 0.18);
      ctx.lineTo(stoneR * 0.34, stoneR * 0.06);
      ctx.lineTo(stoneR * 0.28, stoneR * 0.34);
      ctx.lineTo(stoneR * 0.02, stoneR * 0.42);
      ctx.closePath();
      ctx.fillStyle = 'rgba(38,42,47,0.22)';
      ctx.fill();
      statsDc('poly', 3);
      applyPriorityFlashRect(ctx, -stoneR, -stoneR, stoneR * 2, stoneR * 2);
      ctx.restore();
    }

    /* ── 毛毛虫 ── */
    else if (obj.kind === 'boulder') {
      ctx.save(); ctx.translate(px, py);
      applyPreyDeform(ctx, obj, _springScale);
      if (shouldMirrorObjectX(obj)) ctx.scale(-1, 1);
      ctx.rotate(getRenderedObjectAngle(obj));
      var wormFrame = getAnimatedWormImage(obj);
      if (wormFrame.complete && wormFrame.naturalWidth > 0) {
        var wormSize = getWrapDrawSize('boulder', def.r, wormFrame);
        if (_isWrapping) { ctx.shadowBlur = 28; ctx.shadowColor = '#ffe8a0'; }
        if (_pickupNudge > 0.12 && !_isWrapping) {
          ctx.shadowBlur = 8 + _pickupNudge * 8;
          ctx.shadowColor = 'rgba(255,228,130,' + (0.12 + _pickupNudge * 0.2).toFixed(2) + ')';
        }
        ctx.drawImage(wormFrame, -wormSize.width * 0.5, -wormSize.height * 0.5, wormSize.width, wormSize.height);
        if (_isPriorityTarget) {
          drawPriorityImage(ctx, wormFrame, -wormSize.width * 0.5, -wormSize.height * 0.5, wormSize.width, wormSize.height, _priorityPulse);
        } else if (_pickupNudge > 0.12) {
          drawPriorityImage(ctx, wormFrame, -wormSize.width * 0.5, -wormSize.height * 0.5, wormSize.width, wormSize.height, 0.22 + _pickupNudge * 0.26);
        }
        if (_isWrapping || _pickupNudge > 0.12) { ctx.shadowBlur = 0; ctx.shadowColor = 'transparent'; }
        statsDc('image');
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
          statsDc('arc', 2);
        }
        var headY = -(segs - 1) * gap * 0.5 - gap * 0.15;
        var headWave = Math.sin(obj.segT + segs * 1.0) * 2.5 * waveScale;
        ctx.beginPath(); ctx.arc(headWave, headY, segR * 1.2, 0, 2 * Math.PI);
        ctx.fillStyle = '#b81010'; ctx.fill();
        ctx.strokeStyle = 'rgba(80,0,0,0.55)'; ctx.lineWidth = 0.8; ctx.stroke();
        statsDc('arc', 2);
        applyPriorityFlashRect(ctx, -def.r * 3.4, -def.r * 3.4, def.r * 6.8, def.r * 6.8);
      }
      drawSilkOnCurrentTransform(ctx, obj);
      if (_isWrappedSelected) drawWrappedPreySelectionOutline(ctx, obj, _selectionPulse);
      ctx.restore();
    }

    /* ── 苍蝇 ── */
    else if (obj.kind === 'bug') {
      ctx.save(); ctx.translate(px, py);
      applyPreyDeform(ctx, obj, _springScale);
      if (shouldMirrorObjectX(obj)) ctx.scale(-1, 1);
      ctx.rotate(getRenderedObjectAngle(obj));
      var flyFrame = getAnimatedFlyImage(obj);
      if (flyFrame.complete && flyFrame.naturalWidth > 0) {
        var flySize = getWrapDrawSize('bug', def.r, flyFrame);
        if (_isWrapping) { ctx.shadowBlur = 28; ctx.shadowColor = '#ffe8a0'; }
        if (_pickupNudge > 0.12 && !_isWrapping) {
          ctx.shadowBlur = 8 + _pickupNudge * 8;
          ctx.shadowColor = 'rgba(255,228,130,' + (0.12 + _pickupNudge * 0.2).toFixed(2) + ')';
        }
        ctx.drawImage(flyFrame, -flySize.width * 0.5, -flySize.height * 0.5, flySize.width, flySize.height);
        if (_isPriorityTarget) {
          drawPriorityImage(ctx, flyFrame, -flySize.width * 0.5, -flySize.height * 0.5, flySize.width, flySize.height, _priorityPulse);
        } else if (_pickupNudge > 0.12) {
          drawPriorityImage(ctx, flyFrame, -flySize.width * 0.5, -flySize.height * 0.5, flySize.width, flySize.height, 0.22 + _pickupNudge * 0.26);
        }
        if (_isWrapping || _pickupNudge > 0.12) { ctx.shadowBlur = 0; ctx.shadowColor = 'transparent'; }
        statsDc('image');
      } else {
        var r = def.r;
        var wFlapBase = (obj.state === 'stuck' || obj.state === 'freeing' || obj.state === 'wrapping') ? 0.65 * 0.30 : 0.65;
        var wFlap = Math.sin(obj.wingT) * wFlapBase;
        ctx.save(); ctx.rotate(-wFlap);
        ctx.beginPath(); ctx.ellipse(-r * 1.6, -r * 0.2, r * 1.55, r * 0.52, Math.PI * 0.08, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(160,210,255,0.72)'; ctx.fill();
        ctx.strokeStyle = 'rgba(60,100,180,0.55)'; ctx.lineWidth = 0.9; ctx.stroke();
        statsDc('quad', 2);
        ctx.restore();
        ctx.save(); ctx.rotate(wFlap);
        ctx.beginPath(); ctx.ellipse(r * 1.6, -r * 0.2, r * 1.55, r * 0.52, -Math.PI * 0.08, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(160,210,255,0.72)'; ctx.fill();
        ctx.strokeStyle = 'rgba(60,100,180,0.55)'; ctx.lineWidth = 0.9; ctx.stroke();
        statsDc('quad', 2);
        ctx.restore();
        ctx.beginPath(); ctx.ellipse(0, 0, r * 0.55, r, 0, 0, 2 * Math.PI);
        ctx.fillStyle = '#3a3a2a'; ctx.fill();
        statsDc('quad');
        applyPriorityFlashRect(ctx, -r * 3.4, -r * 2.2, r * 6.8, r * 4.4);
      }
      drawSilkOnCurrentTransform(ctx, obj);
      if (_isWrappedSelected) drawWrappedPreySelectionOutline(ctx, obj, _selectionPulse);
      ctx.restore();
    }

    /* ── 树叶 ── */
    else if (obj.kind === 'drop') {
      ctx.save(); ctx.translate(px, py);
      if (obj._drawScaleX !== 1 || obj._drawScaleY !== 1) ctx.scale(obj._drawScaleX, obj._drawScaleY);
      if (_springScale !== 1.0) ctx.scale(_springScale, _springScale);
      ctx.rotate(obj.angle + (obj._wrapAngle || 0));
      if (leafImg.complete && leafImg.naturalWidth > 0) {
        var leafW = def.r * 6.08;  // 3.8 × 1.6
        var leafH = leafW * (leafImg.naturalHeight / leafImg.naturalWidth);
        if (_isWrapping) { ctx.shadowBlur = 28; ctx.shadowColor = '#ffe8a0'; }
        ctx.drawImage(leafImg, -leafW * 0.5, -leafH * 0.5, leafW, leafH);
        if (_isPriorityTarget) drawPriorityImage(ctx, leafImg, -leafW * 0.5, -leafH * 0.5, leafW, leafH, _priorityPulse);
        if (_isWrapping) { ctx.shadowBlur = 0; ctx.shadowColor = 'transparent'; }
        statsDc('image');
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
        statsDc('quad');
        applyPriorityFlashRect(ctx, -r * 2.2, -r * 2.4, r * 4.4, r * 4.8);
      }
      ctx.restore();
    }

    /* ── 大便 ── */
    else if (obj.kind === 'poop') {
      ctx.save(); ctx.translate(px, py);
      applyPreyDeform(ctx, obj, _springScale);
      ctx.rotate(getPreyRenderAngle(obj));
      if (_isWrapping) { ctx.shadowBlur = 22; ctx.shadowColor = 'rgba(30,20,18,0.9)'; }
      drawPoopBlob(ctx, obj, def, applyPriorityFlashRect, function (localCtx, img, x, y, w, h) {
        if (_isPriorityTarget) drawPriorityImage(localCtx, img, x, y, w, h, _priorityPulse);
      });
      if (_isWrapping) { ctx.shadowBlur = 0; ctx.shadowColor = 'transparent'; }
      drawSilkOnCurrentTransform(ctx, obj);
      ctx.restore();
    }

    /* sticking ring flash */
    if (obj.state === 'sticking') {
      var flashR = def.r + (1 - obj.stickT) * 18;
      ctx.beginPath(); ctx.arc(px, py, flashR, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(180,220,140,' + (0.55 * (1 - obj.stickT)) + ')';
      ctx.lineWidth = 2; ctx.stroke();
      statsDc('stroke');
    }

    ctx.restore();
  }
}

/**
 * 单独绘制打包圆圈进度（在蜘蛛层之后调用，确保在最上层）
 */
export function drawWrappingOverlay(ctx, thrownObjects) {
  for (var oi = 0; oi < thrownObjects.length; oi++) {
    var obj = thrownObjects[oi];
    if (obj.state !== 'wrapping' || obj.kind === 'drop') continue;
    var def = obj.def;
    var px = obj.particle.pos.x, py = obj.particle.pos.y;
    var wt = obj.wrapT;

    var startA = -Math.PI / 2;
    ctx.beginPath();
    ctx.arc(px, py, def.r * 1.6, startA, startA + wt * 2 * Math.PI);
    ctx.strokeStyle = 'rgba(255,255,255,0.88)';
    ctx.lineWidth = 2.2;
    ctx.stroke();
    if (wt > 0.4) {
      var arc2 = ((wt - 0.4) / 0.6) * 2 * Math.PI;
      ctx.beginPath();
      ctx.arc(px, py, def.r * 1.2, startA, startA + arc2);
      ctx.strokeStyle = 'rgba(255,255,255,0.62)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    var tipAngle = startA + wt * 2 * Math.PI;
    var tr = def.r * 1.6;
    ctx.beginPath();
    ctx.arc(px + Math.cos(tipAngle) * tr, py + Math.sin(tipAngle) * tr, 2.2, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fill();
  }
}

/* ── 叶子收集碎裂 ── */
var _leafShards = [];
var LEAF_SHARD_HOLD_FRAMES = 28; /* 碎裂后保持可见的帧数 */
var LEAF_SHARD_FADE_FRAMES = 18; /* 随后淡出的帧数 */

/* sx/sy/sw/sh: leaf.png 裁剪区（0~1）；ox/oy: 相对叶心的偏移（相对 leafW） */
var LEAF_SHARD_CUTS = [
  { sx: 0.02, sy: 0.02, sw: 0.46, sh: 0.44, ox: -0.24, oy: -0.26 },
  { sx: 0.50, sy: 0.02, sw: 0.48, sh: 0.46, ox:  0.26, oy: -0.24 },
  { sx: 0.02, sy: 0.46, sw: 0.48, sh: 0.52, ox: -0.22, oy:  0.26 },
  { sx: 0.48, sy: 0.44, sw: 0.50, sh: 0.54, ox:  0.24, oy:  0.24 },
  { sx: 0.30, sy: 0.28, sw: 0.40, sh: 0.36, ox:  0.02, oy:  0.02 }
];

export function spawnLeafShards(x, y, leafR, leafAngle, scatterAngle) {
  if (!leafImg.complete || leafImg.naturalWidth <= 0) return;
  var leafW = leafR * 6.08;
  var leafH = leafW * (leafImg.naturalHeight / leafImg.naturalWidth);
  var imgW = leafImg.naturalWidth;
  var imgH = leafImg.naturalHeight;
  for (var i = 0; i < LEAF_SHARD_CUTS.length; i++) {
    var cut = LEAF_SHARD_CUTS[i];
    var shardAng = scatterAngle + (i / LEAF_SHARD_CUTS.length) * Math.PI * 2 + (Math.random() - 0.5) * 0.55;
    var spd = 1.1 + Math.random() * 1.5;
    _leafShards.push({
      x: x + cut.ox * leafW,
      y: y + cut.oy * leafH,
      t: 0,
      vx: Math.cos(shardAng) * spd,
      vy: Math.sin(shardAng) * spd * 0.38 + 0.22,
      angle: leafAngle + (Math.random() - 0.5) * 0.5,
      angVel: (Math.random() - 0.5) * 0.14,
      w: cut.sw * leafW,
      h: cut.sh * leafH,
      sx: cut.sx * imgW,
      sy: cut.sy * imgH,
      sw: cut.sw * imgW,
      sh: cut.sh * imgH
    });
  }
}

export function updateAndDrawLeafShards(ctx, dt) {
  if (_leafShards.length === 0) return;
  for (var i = _leafShards.length - 1; i >= 0; i--) {
    var s = _leafShards[i];
    s.vy += 0.12 * dt;
    s.vx *= Math.pow(0.958, dt);
    s.vy *= Math.pow(0.993, dt);
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.angle += s.angVel * dt;
    s.angVel *= Math.pow(0.94, dt);
    s.t += dt;
    if (s.t >= LEAF_SHARD_HOLD_FRAMES + LEAF_SHARD_FADE_FRAMES) {
      _leafShards.splice(i, 1);
      continue;
    }
    var alpha = 1;
    if (s.t > LEAF_SHARD_HOLD_FRAMES) {
      alpha = 1 - (s.t - LEAF_SHARD_HOLD_FRAMES) / LEAF_SHARD_FADE_FRAMES;
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(s.x, s.y);
    ctx.rotate(s.angle);
    ctx.drawImage(leafImg, s.sx, s.sy, s.sw, s.sh, -s.w * 0.5, -s.h * 0.5, s.w, s.h);
    ctx.restore();
    statsDc('image');
  }
}
