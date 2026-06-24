import { flyImg, wormImg, leafImg, poopImg } from '../assets/imageAssets.js';

/**
 * HUD 物品栏图标绘制
 */

var INVENTORY_ICON_SCALE = 1.3;

export function drawInventoryBoulder(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  if (wormImg.complete && wormImg.naturalWidth > 0) {
    var drawW = 70;
    var drawH = drawW * (wormImg.naturalHeight / wormImg.naturalWidth);
    ctx.drawImage(wormImg, (w - drawW) * 0.5, (h - drawH) * 0.5, drawW, drawH);
    return;
  }
  ctx.save();
  ctx.translate(w * 0.5, h * 0.5 + 1);
  ctx.scale(INVENTORY_ICON_SCALE, INVENTORY_ICON_SCALE);
  var segR = 5.2, gap = 7.2, segs = 4;
  for (var si = 0; si < segs; si++) {
    var sy = si * gap - (segs - 1) * gap * 0.5 + 1.8;
    var rv = Math.floor(160 + si * 22);
    ctx.beginPath(); ctx.arc(0, sy, segR, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgb(' + rv + ',20,20)'; ctx.fill();
    ctx.strokeStyle = 'rgba(80,0,0,0.45)'; ctx.lineWidth = 0.8; ctx.stroke();
  }
  var headY = -(segs - 1) * gap * 0.5 - 2.4;
  ctx.beginPath(); ctx.arc(0, headY, segR * 1.2, 0, 2 * Math.PI);
  ctx.fillStyle = '#b81010'; ctx.fill();
  ctx.strokeStyle = 'rgba(80,0,0,0.55)'; ctx.lineWidth = 0.9; ctx.stroke();
  ctx.strokeStyle = 'rgba(120,0,0,0.75)'; ctx.lineWidth = 0.9;
  ctx.beginPath(); ctx.moveTo(-1, headY - segR * 0.9); ctx.lineTo(-3.8, headY - segR * 1.8); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(1, headY - segR * 0.9); ctx.lineTo(3.8, headY - segR * 1.8); ctx.stroke();
  ctx.restore();
}

export function drawInventoryBug(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  if (flyImg.complete && flyImg.naturalWidth > 0) {
    var drawH = 70;
    var drawW = drawH * (flyImg.naturalWidth / flyImg.naturalHeight);
    ctx.drawImage(flyImg, (w - drawW) * 0.5, (h - drawH) * 0.5, drawW, drawH);
    return;
  }
  ctx.save();
  ctx.translate(w * 0.5, h * 0.56);
  ctx.scale(INVENTORY_ICON_SCALE, INVENTORY_ICON_SCALE);
  var r = 5.2;
  ctx.save(); ctx.rotate(-0.28);
  ctx.beginPath(); ctx.ellipse(-r * 1.5, -r * 0.2, r * 1.4, r * 0.48, Math.PI * 0.08, 0, 2 * Math.PI);
  ctx.fillStyle = 'rgba(160,210,255,0.72)'; ctx.fill();
  ctx.strokeStyle = 'rgba(60,100,180,0.55)'; ctx.lineWidth = 0.8; ctx.stroke();
  ctx.restore();
  ctx.save(); ctx.rotate(0.28);
  ctx.beginPath(); ctx.ellipse(r * 1.5, -r * 0.2, r * 1.4, r * 0.48, -Math.PI * 0.08, 0, 2 * Math.PI);
  ctx.fillStyle = 'rgba(160,210,255,0.72)'; ctx.fill();
  ctx.strokeStyle = 'rgba(60,100,180,0.55)'; ctx.lineWidth = 0.8; ctx.stroke();
  ctx.restore();
  ctx.beginPath(); ctx.ellipse(0, 0, r * 0.55, r, 0, 0, 2 * Math.PI);
  ctx.fillStyle = '#3a3a2a'; ctx.fill();
  ctx.strokeStyle = '#1a1a10'; ctx.lineWidth = 0.9; ctx.stroke();
  for (var si = 0; si < 3; si++) {
    var sy = si * r * 0.55 - r * 0.3;
    ctx.beginPath(); ctx.moveTo(-r * 0.5, sy); ctx.lineTo(r * 0.5, sy);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1.2; ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(0, -r - r * 0.45, r * 0.55, 0, 2 * Math.PI);
  ctx.fillStyle = '#2a2a1a'; ctx.fill(); ctx.strokeStyle = '#111'; ctx.lineWidth = 0.8; ctx.stroke();
  ctx.beginPath(); ctx.arc(-r * 0.28, -r - r * 0.55, r * 0.26, 0, 2 * Math.PI); ctx.fillStyle = '#8a0000'; ctx.fill();
  ctx.beginPath(); ctx.arc(r * 0.28, -r - r * 0.55, r * 0.26, 0, 2 * Math.PI); ctx.fillStyle = '#8a0000'; ctx.fill();
  ctx.restore();
}

export function drawInventoryDrop(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  if (leafImg.complete && leafImg.naturalWidth > 0) {
    var drawW = 30 * INVENTORY_ICON_SCALE;
    var drawH = drawW * (leafImg.naturalHeight / leafImg.naturalWidth);
    ctx.drawImage(leafImg, (w - drawW) * 0.5, (h - drawH) * 0.5, drawW, drawH);
    return;
  }
  ctx.save();
  ctx.translate(w * 0.5, h * 0.5);
  ctx.scale(INVENTORY_ICON_SCALE, INVENTORY_ICON_SCALE);
  ctx.rotate(0.22);
  var r = 6.4;
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.6);
  ctx.bezierCurveTo(r * 1.1, -r * 0.8, r * 1.1, r * 0.8, 0, r * 1.6);
  ctx.bezierCurveTo(-r * 1.1, r * 0.8, -r * 1.1, -r * 0.8, 0, -r * 1.6);
  ctx.closePath();
  var lg = ctx.createLinearGradient(-r, 0, r, 0);
  lg.addColorStop(0, '#3a7a25'); lg.addColorStop(0.5, '#5aaa35'); lg.addColorStop(1, '#3a7a25');
  ctx.fillStyle = lg; ctx.fill();
  ctx.restore();
}

export function drawInventoryPoop(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  if (poopImg.complete && poopImg.naturalWidth > 0) {
    var drawH = 34 * INVENTORY_ICON_SCALE;
    var drawW = drawH * (poopImg.naturalWidth / poopImg.naturalHeight);
    ctx.drawImage(poopImg, (w - drawW) * 0.5, (h - drawH) * 0.5, drawW, drawH);
    return;
  }
  ctx.save();
  ctx.translate(w * 0.5, h * 0.5 + 2);
  ctx.scale(INVENTORY_ICON_SCALE, INVENTORY_ICON_SCALE);
  var r = 6.8;
  ctx.beginPath();
  ctx.ellipse(0, r * 0.58, r * 0.74, r * 0.56, 0, 0, 2 * Math.PI);
  ctx.ellipse(-r * 0.38, -r * 0.12, r * 0.62, r * 0.56, -0.18, 0, 2 * Math.PI);
  ctx.ellipse(r * 0.2, -r * 0.66, r * 0.56, r * 0.48, 0.14, 0, 2 * Math.PI);
  ctx.fillStyle = '#2b221f';
  ctx.fill();
  ctx.restore();
}

export function renderArtToCanvas(canvasEl, kind) {
  var ctx = canvasEl.getContext('2d');
  if (kind === 'boulder') drawInventoryBoulder(ctx, canvasEl.width, canvasEl.height);
  else if (kind === 'bug') drawInventoryBug(ctx, canvasEl.width, canvasEl.height);
  else if (kind === 'poop') drawInventoryPoop(ctx, canvasEl.width, canvasEl.height);
  else drawInventoryDrop(ctx, canvasEl.width, canvasEl.height);
}

export function renderInventoryArts() {
  ['boulder', 'bug', 'drop'].forEach(function (kind) {
    var art = document.getElementById('inv-' + kind + '-art');
    if (art) renderArtToCanvas(art, kind);
  });
}
