import { statsDc } from '../debug/renderStats.js';

var flyImg = new Image();
flyImg.src = '/src/assets/fly.png';

var fly01Img = new Image();
fly01Img.src = '/src/assets/fly01.png';

var fly02Img = new Image();
fly02Img.src = '/src/assets/fly02.png';

var wormImg = new Image();
wormImg.src = '/src/assets/worm.png';

var worm00Img = new Image();
worm00Img.src = '/src/assets/worm00.png';

var worm01Img = new Image();
worm01Img.src = '/src/assets/worm01.png';

var worm02Img = new Image();
worm02Img.src = '/src/assets/worm02.png';

var leafImg = new Image();
leafImg.src = '/src/assets/leaf.png';

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
  if (obj.state === 'falling' || obj.state === 'freeing') {
    return (Math.floor(obj.animT / 6) % 2 === 0) ? fly01Img : fly02Img;
  }
  return flyImg;
}

function getAnimatedWormImage(obj) {
  var seq = [worm00Img, worm01Img, worm02Img, worm01Img];
  if (obj.state === 'freeing') {
    // 挣脱时：快速播放
    return seq[Math.floor(obj.freeTimer / 5) % seq.length];
  }
  // 默认状态：慢慢扭动（18 帧/格，约 3fps）
  return seq[Math.floor(obj.animT / 18) % seq.length];
}

function drawPoopBlob(ctx, obj, def, applyPriorityFlashRect) {
  var pulse = obj.state === 'stuck'
    ? (0.38 + 0.24 * Math.abs(Math.sin(obj.animT * 0.08)))
    : 0.22;
  var r = def.r;
  if (obj.cA && obj.cB && (obj.state === 'stuck' || obj.playerDragging)) {
    var strain = obj.playerDragging ? (obj.dragStrain || 0) : 0;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = obj.playerDragging
      ? 'rgba(245,232,205,' + Math.min(0.96, 0.58 + strain * 0.22).toFixed(2) + ')'
      : 'rgba(25,18,14,0.55)';
    ctx.lineWidth = obj.playerDragging ? (7.0 + strain * 4.6) : 3.2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(obj.cA.b.pos.x - obj.particle.pos.x, obj.cA.b.pos.y - obj.particle.pos.y);
    ctx.moveTo(0, 0);
    ctx.lineTo(obj.cB.b.pos.x - obj.particle.pos.x, obj.cB.b.pos.y - obj.particle.pos.y);
    ctx.stroke();
    if (obj.playerDragging) {
      ctx.globalAlpha = 0.34 + Math.min(0.42, strain * 0.22);
      ctx.lineWidth += 3.6;
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.beginPath();
  ctx.ellipse(0, r * 0.58, r * 0.74, r * 0.56, 0, 0, 2 * Math.PI);
  ctx.ellipse(-r * 0.38, -r * 0.12, r * 0.62, r * 0.56, -0.18, 0, 2 * Math.PI);
  ctx.ellipse(r * 0.2, -r * 0.66, r * 0.56, r * 0.48, 0.14, 0, 2 * Math.PI);
  ctx.fillStyle = 'rgba(' + Math.round(18 + pulse * 30) + ',' + Math.round(13 + pulse * 18) + ',' + Math.round(10 + pulse * 14) + ',0.96)';
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(-r * 0.12, r * 0.1, r * 1.05, r * 1.3, 0.08, 0, 2 * Math.PI);
  ctx.strokeStyle = obj.playerDragging ? 'rgba(255,242,220,0.78)' : 'rgba(55,40,34,0.35)';
  ctx.lineWidth = obj.playerDragging ? 3.8 : 1.6;
  ctx.stroke();
  applyPriorityFlashRect(ctx, -r * 2.2, -r * 2.4, r * 4.4, r * 4.9);
}

/**
 * 投掷物体绘制
 */
export function drawThrownObjects(ctx, thrownObjects, priorityTarget) {
  for (var oi = 0; oi < thrownObjects.length; oi++) {
    var obj = thrownObjects[oi], def = obj.def;
    var px = obj.particle.pos.x, py = obj.particle.pos.y;
    ctx.save(); ctx.globalAlpha = obj.alpha;
    var _isPriorityTarget = !!(priorityTarget && priorityTarget.type === 'object' && priorityTarget.obj === obj);
    var _priorityPulse = _isPriorityTarget ? (0.55 + 0.45 * Math.abs(Math.sin(obj.animT * 0.22))) : 0;

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
      var tremble = wt * 3.5;
      px += Math.sin(at * 0.95) * tremble + Math.cos(at * 1.55) * tremble * 0.5;
      py += Math.cos(at * 1.1) * tremble * 0.8 + Math.sin(at * 1.85) * tremble * 0.3;
      var wrapAngle = Math.sin(at * 0.425 + wt * 10) * 0.31 * wt;
      obj._wrapAngle = wrapAngle;
    } else {
      obj._wrapAngle = 0;
    }

    var _isWrapping = obj.state === 'wrapping';

    /* ── 毛毛虫 ── */
    if (obj.kind === 'boulder') {
      ctx.save(); ctx.translate(px, py);
      if (_springScale !== 1.0) ctx.scale(_springScale, _springScale);
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
        if (_isWrapping) { ctx.shadowBlur = 28; ctx.shadowColor = '#ffe8a0'; }
        ctx.drawImage(wormFrame, -wormW * 0.5, -wormH * 0.5, wormW, wormH);
        if (_isPriorityTarget) drawPriorityImage(ctx, wormFrame, -wormW * 0.5, -wormH * 0.5, wormW, wormH, _priorityPulse);
        if (_isWrapping) { ctx.shadowBlur = 0; ctx.shadowColor = 'transparent'; }
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
      ctx.restore();
    }

    /* ── 苍蝇 ── */
    else if (obj.kind === 'bug') {
      ctx.save(); ctx.translate(px, py);
      if (_springScale !== 1.0) ctx.scale(_springScale, _springScale);
      ctx.rotate(obj.angle + Math.PI / 2 + (obj._wrapAngle || 0));
      var flyFrame = getAnimatedFlyImage(obj);
      if (flyFrame.complete && flyFrame.naturalWidth > 0) {
        var flyH = def.r * 4.32;
        var flyW = flyH * (flyFrame.naturalWidth / flyFrame.naturalHeight);
        if (_isWrapping) { ctx.shadowBlur = 28; ctx.shadowColor = '#ffe8a0'; }
        ctx.drawImage(flyFrame, -flyW * 0.5, -flyH * 0.5, flyW, flyH);
        if (_isPriorityTarget) drawPriorityImage(ctx, flyFrame, -flyW * 0.5, -flyH * 0.5, flyW, flyH, _priorityPulse);
        if (_isWrapping) { ctx.shadowBlur = 0; ctx.shadowColor = 'transparent'; }
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
      ctx.restore();
    }

    /* ── 树叶 ── */
    else if (obj.kind === 'drop') {
      ctx.save(); ctx.translate(px, py);
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
      if (_springScale !== 1.0) ctx.scale(_springScale, _springScale);
      ctx.rotate(obj.angle * 0.45 + (obj._wrapAngle || 0) * 0.6);
      if (_isWrapping) { ctx.shadowBlur = 22; ctx.shadowColor = 'rgba(30,20,18,0.9)'; }
      drawPoopBlob(ctx, obj, def, applyPriorityFlashRect);
      if (_isWrapping) { ctx.shadowBlur = 0; ctx.shadowColor = 'transparent'; }
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
    if (obj.state !== 'wrapping') continue;
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
