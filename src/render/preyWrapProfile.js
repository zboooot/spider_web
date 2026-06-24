/**
 * 猎物打包态渲染配置 — sprite 与丝线轮廓的单一数据源。
 * 换图后只需确认 wrapFrame 指向正确静止帧，必要时调 spiralPhaseOffset。
 */

export var DEBUG_SILK_CONTOUR = false;

var SILK_KINDS = { bug: true, boulder: true, poop: true };

var SIZE_FALLBACK_ASPECT = {
  bug: 0.766,
  boulder: 1.509,
  poop: 2.6 / 3.2
};

var SPIRAL_LOOPS = { bug: 10, boulder: 12, poop: 11 };

/** 轮廓起点相位（弧度）；换图后若仍有固定角度偏差只调这里 */
var SPIRAL_PHASE_OFFSET = { bug: 0, boulder: 0, poop: 0 };

export function isSilkWrappedKind(kind) {
  return !!SILK_KINDS[kind];
}

export function getSpiralLoops(kind) {
  return SPIRAL_LOOPS[kind] || 10;
}

export function getSpiralPhaseOffset(kind) {
  return SPIRAL_PHASE_OFFSET[kind] || 0;
}

export function getWrapDrawSize(kind, r, img) {
  if (kind === 'bug') {
    var flyH = r * 4.32;
    var flyW = img && img.naturalWidth > 0
      ? flyH * (img.naturalWidth / img.naturalHeight)
      : flyH * SIZE_FALLBACK_ASPECT.bug;
    return { width: flyW, height: flyH };
  }
  if (kind === 'boulder') {
    var wormW = r * 6.3;
    var wormH = img && img.naturalWidth > 0
      ? wormW * (img.naturalHeight / img.naturalWidth)
      : wormW * SIZE_FALLBACK_ASPECT.boulder;
    return { width: wormW, height: wormH };
  }
  if (kind === 'poop') {
    var poopH = r * 3.2;
    var poopW = img && img.naturalWidth > 0
      ? poopH * (img.naturalWidth / img.naturalHeight)
      : r * SIZE_FALLBACK_ASPECT.poop;
    return { width: poopW, height: poopH };
  }
  return { width: r * 2, height: r * 2 };
}

export function getPreyRenderAngle(obj) {
  var wrapAngle = obj._wrapAngle || 0;
  if (obj.kind === 'boulder') {
    var drawAngle;
    if (obj.state === 'falling') drawAngle = obj.initAngle;
    else if (obj.state === 'sticking') {
      drawAngle = obj.initAngle + (obj.stuckAngle - obj.initAngle) * obj.stickT;
    } else drawAngle = obj.stuckAngle || 0;
    if (wrapAngle) drawAngle += wrapAngle;
    return drawAngle + Math.PI / 2;
  }
  if (obj.kind === 'bug') return obj.angle + Math.PI / 2 + wrapAngle;
  if (obj.kind === 'poop') return obj.angle * 0.45 + wrapAngle * 0.6;
  return obj.angle + wrapAngle;
}

/** 与 sprite / silk 共用的局部形变（stretch + 打包颤抖缩放） */
export function applyPreyDeform(ctx, obj, springScale) {
  if (obj._drawStretchScale !== 1 || obj._drawStretchSquash !== 1) {
    ctx.rotate(obj._drawStretchAngle || 0);
    ctx.scale(obj._drawStretchScale || 1, obj._drawStretchSquash || 1);
    ctx.rotate(-(obj._drawStretchAngle || 0));
  }
  if (obj._drawScaleX !== 1 || obj._drawScaleY !== 1) {
    ctx.scale(obj._drawScaleX, obj._drawScaleY);
  }
  if (springScale !== undefined && springScale !== 1) {
    ctx.scale(springScale, springScale);
  }
}

export function shouldDrawSilkForObject(obj) {
  if (!isSilkWrappedKind(obj.kind) || !obj._silkSpiral) return false;
  return obj.state === 'wrapping'
    || obj.state === 'wrapped'
    || obj.state === 'plucking'
    || obj.state === 'collecting';
}

export function getSilkProgress(obj) {
  return obj.state === 'wrapping' ? obj.wrapT : 1;
}

export function getSilkShimmer(obj) {
  if (obj.state !== 'wrapped') return 0;
  return (0.5 + 0.5 * Math.sin(obj.animT * 0.18 + (obj._popT || 0) * 0.1)) * 0.7;
}

export function buildContourCacheKey(kind, img, r) {
  var nw = img && img.naturalWidth > 0 ? img.naturalWidth : 0;
  var nh = img && img.naturalHeight > 0 ? img.naturalHeight : 0;
  var src = img && img.src ? img.src : 'pending';
  var phase = getSpiralPhaseOffset(kind);
  return kind + '_' + src + '_' + nw + 'x' + nh + '_' + Math.round(r * 10) + '_p' + phase.toFixed(4);
}

export function applyContourPhaseOffset(contour, phaseOffset) {
  if (!phaseOffset) return contour;
  var shifted = new Array(contour.length);
  for (var i = 0; i < contour.length; i++) {
    shifted[i] = { r: contour[i].r, angle: contour[i].angle + phaseOffset };
  }
  return shifted;
}