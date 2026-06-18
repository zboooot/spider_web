import flyUrl from '../assets/fly.png';
import fly01Url from '../assets/fly01.png';
import fly02Url from '../assets/fly02.png';
import wormUrl from '../assets/worm.png';
import worm00Url from '../assets/worm00.png';
import worm01Url from '../assets/worm01.png';
import worm02Url from '../assets/worm02.png';
import leafUrl from '../assets/leaf.png';
import { statsDc } from '../debug/renderStats.js';

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

    /* ── 毛毛虫 ── */
    if (obj.kind === 'boulder') {
      ctx.save(); ctx.translate(px, py);
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
      }
      ctx.restore();
    }

    /* ── 苍蝇 ── */
    else if (obj.kind === 'bug') {
      ctx.save(); ctx.translate(px, py);
      ctx.rotate(obj.angle + Math.PI / 2 + (obj._wrapAngle || 0));
      var flyFrame = getAnimatedFlyImage(obj);
      if (flyFrame.complete && flyFrame.naturalWidth > 0) {
        var flyH = def.r * 4.32;
        var flyW = flyH * (flyFrame.naturalWidth / flyFrame.naturalHeight);
        ctx.drawImage(flyFrame, -flyW * 0.5, -flyH * 0.5, flyW, flyH);
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
      }
      ctx.restore();
    }

    /* ── 树叶 ── */
    else if (obj.kind === 'drop') {
      ctx.save(); ctx.translate(px, py); ctx.rotate(obj.angle + (obj._wrapAngle || 0));
      if (leafImg.complete && leafImg.naturalWidth > 0) {
        var leafW = def.r * 6.08;  // 3.8 × 1.6
        var leafH = leafW * (leafImg.naturalHeight / leafImg.naturalWidth);
        ctx.drawImage(leafImg, -leafW * 0.5, -leafH * 0.5, leafW, leafH);
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
      }
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

    /* wrapping silk thread */
    if (obj.state === 'wrapping') {
      var wt = obj.wrapT;
      var startA = -Math.PI / 2;
      ctx.beginPath();
      ctx.arc(px, py, def.r * 1.6, startA, startA + wt * 2 * Math.PI);
      ctx.strokeStyle = 'rgba(255,255,255,0.88)';
      ctx.lineWidth = 2.2;
      ctx.stroke();
      statsDc('stroke');
      if (wt > 0.4) {
        var arc2 = ((wt - 0.4) / 0.6) * 2 * Math.PI;
        ctx.beginPath();
        ctx.arc(px, py, def.r * 1.2, startA, startA + arc2);
        ctx.strokeStyle = 'rgba(255,255,255,0.62)';
        ctx.lineWidth = 1.6;
        ctx.stroke();
        statsDc('stroke');
      }
      var tipAngle = startA + wt * 2 * Math.PI;
      var tr = def.r * 1.6;
      ctx.beginPath();
      ctx.arc(px + Math.cos(tipAngle) * tr, py + Math.sin(tipAngle) * tr, 2.2, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fill();
      statsDc('arc');
    }

    ctx.restore();
  }
}
