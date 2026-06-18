import flyUrl from '../assets/fly.png';
import fly01Url from '../assets/fly01.png';
import fly02Url from '../assets/fly02.png';
import wormUrl from '../assets/worm.png';
import worm00Url from '../assets/worm00.png';
import worm01Url from '../assets/worm01.png';
import worm02Url from '../assets/worm02.png';
import leafUrl from '../assets/leaf.png';

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

/**
 * 投掷物体绘制
 */
export function drawThrownObjects(ctx, thrownObjects) {
  for (var oi = 0; oi < thrownObjects.length; oi++) {
    var obj = thrownObjects[oi], def = obj.def;
    var px = obj.particle.pos.x, py = obj.particle.pos.y;
    ctx.save(); ctx.globalAlpha = obj.alpha;

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
      px += Math.sin(at * 1.9) * tremble + Math.cos(at * 3.1) * tremble * 0.5;
      py += Math.cos(at * 2.2) * tremble * 0.8 + Math.sin(at * 3.7) * tremble * 0.3;
      var wrapAngle = Math.sin(at * 0.85 + wt * 10) * 0.31 * wt;
      obj._wrapAngle = wrapAngle;
    } else {
      obj._wrapAngle = 0;
    }

    /* ── 打包状态：drop-shadow 绿色外发光描边 ── */
    var _isWrapping = obj.state === 'wrapping';
    var _wrapGlowFilter = _isWrapping
      ? 'drop-shadow(0 0 2px #fff8e7) drop-shadow(0 0 6px #ffe8a0) drop-shadow(0 0 12px #ffd060) drop-shadow(0 0 18px #ffb83080)'
      : '';

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
        if (_isWrapping) ctx.filter = _wrapGlowFilter;
        ctx.drawImage(wormFrame, -wormW * 0.5, -wormH * 0.5, wormW, wormH);
        if (_isWrapping) ctx.filter = 'none';
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
      if (_springScale !== 1.0) ctx.scale(_springScale, _springScale);
      ctx.rotate(obj.angle + Math.PI / 2 + (obj._wrapAngle || 0));
      var flyFrame = getAnimatedFlyImage(obj);
      if (flyFrame.complete && flyFrame.naturalWidth > 0) {
        var flyH = def.r * 4.32;
        var flyW = flyH * (flyFrame.naturalWidth / flyFrame.naturalHeight);
        if (_isWrapping) ctx.filter = _wrapGlowFilter;
        ctx.drawImage(flyFrame, -flyW * 0.5, -flyH * 0.5, flyW, flyH);
        if (_isWrapping) ctx.filter = 'none';
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
      if (_springScale !== 1.0) ctx.scale(_springScale, _springScale);
      ctx.rotate(obj.angle + (obj._wrapAngle || 0));
      if (leafImg.complete && leafImg.naturalWidth > 0) {
        var leafW = def.r * 6.08;  // 3.8 × 1.6
        var leafH = leafW * (leafImg.naturalHeight / leafImg.naturalWidth);
        if (_isWrapping) ctx.filter = _wrapGlowFilter;
        ctx.drawImage(leafImg, -leafW * 0.5, -leafH * 0.5, leafW, leafH);
        if (_isWrapping) ctx.filter = 'none';
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
