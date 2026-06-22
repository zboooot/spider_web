/**
 * Sylvan Background Renderer — 5套自然时相动态景深背景
 * 完全程序化生成，零外部文件依赖
 */

import { statsDc, statsAddBgLeaves, statsSetScene } from '../debug/renderStats.js';

/* ── 5套主题配置 ── */
export var THEMES = [
  {
    id: 'morning-jade',
    name: '晨曦碧翠',
    bgGradient: ['#29664e', '#3da86c', '#2c593f', '#5cb385'],
    accent: '#d1fae5',
    motesColor: 'rgba(167, 243, 208, 0.45)',
    rayColor: 'rgba(255, 255, 255, 0.12)',
    leafColors: ['#4ade80', '#22c55e', '#10b981', '#86efac', '#16a34a'],
    barkColor: '#2b1f18',
    highlightColor: 'rgba(212, 251, 230, 0.35)',
    leafShape: 'broad',
    branchType: 'standard',
    leafSizeRange: [70, 100],
    leafDensityRange: [2, 3]
  },
  {
    id: 'golden-autumn',
    name: '金秋枫影',
    bgGradient: ['#8c5127', '#b46e34', '#a4672d', '#facc15'],
    accent: '#fef08a',
    motesColor: 'rgba(254, 240, 138, 0.45)',
    rayColor: 'rgba(255, 255, 255, 0.14)',
    leafColors: ['#e3b85d', '#cca041', '#f0cf75', '#d99f36', '#ffd984'],
    barkColor: '#3d2216',
    highlightColor: 'rgba(254, 215, 170, 0.3)',
    leafShape: 'maple',
    branchType: 'wide',
    leafSizeRange: [120, 170],
    leafDensityRange: [2, 3]
  },
  {
    id: 'misty-violet',
    name: '幽谷蓝楹',
    bgGradient: ['#6347a1', '#8b5cf6', '#6c53a3', '#e9d5ff'],
    accent: '#e9d5ff',
    motesColor: 'rgba(216, 180, 254, 0.45)',
    rayColor: 'rgba(255, 255, 255, 0.1)',
    leafColors: ['#7c3aed', '#8b5cf6', '#a78bfa', '#c084fc', '#4c1d95'],
    barkColor: '#252136',
    highlightColor: 'rgba(243, 232, 255, 0.25)',
    leafShape: 'jacaranda',
    branchType: 'elegant',
    leafSizeRange: [35, 65],
    leafDensityRange: [1, 2]
  },
  {
    id: 'cherry-blossom',
    name: '春樱盛绽',
    bgGradient: ['#f2a6b5', '#fff0f2', '#ffaec9', '#fda4af'],
    accent: '#ffe4e6',
    motesColor: 'rgba(255, 204, 213, 0.5)',
    rayColor: 'rgba(255, 241, 242, 0.12)',
    leafColors: ['#ff668a', '#ff8da1', '#ffa6c9', '#ffb3c1', '#ffccd5'],
    barkColor: '#2b1b20',
    highlightColor: 'rgba(255, 241, 242, 0.3)',
    leafShape: 'sakura',
    branchType: 'gnarled',
    leafSizeRange: [55, 85],
    leafDensityRange: [4, 6]
  },
  {
    id: 'midnight-lume',
    name: '暗夜蓝杉',
    bgGradient: ['#2e4d9c', '#3b82f6', '#1e3a8a', '#67e8f9'],
    accent: '#67e8f9',
    motesColor: 'rgba(34, 211, 238, 0.45)',
    rayColor: 'rgba(14, 165, 233, 0.12)',
    leafColors: ['#0284c7', '#0ea5e9', '#38bdf8', '#7dd3fc', '#0369a1'],
    barkColor: '#12182b',
    highlightColor: 'rgba(224, 242, 254, 0.3)',
    leafShape: 'spruce',
    branchType: 'conifer',
    leafSizeRange: [65, 95],
    leafDensityRange: [12, 16]
  }
];

export var activeTheme = THEMES[0];

/* ── 内部状态 ── */
var canvases = {}, ctxs = {};
var _scratch = {};
var _bgSharp = null;
var bokehParticles = [], treesDeep = [], treesMid = [], lightRays = [];
var time = 0;
var globalWindForce = 0;
var _W = 450, _H = 800;
var _dpr = 1;
var _bgBakeDone = false;
var _bgBakeIdleId = null;
var _bgBakeUseTimeout = false;
var _BG_BAKE_IDLE_TIMEOUT = 2000;

/* PR1：Canvas 预模糊，去掉合成时大半径 CSS blur（?legacyBg=1 回滚旧路径） */
var USE_LEGACY_BG = typeof location !== 'undefined'
  && /(?:^|[?&])legacyBg=1/.test(location.search);

/** 半分辨率绘制层（再放大 + 预模糊，减像素量） */
var LAYER_DRAW_SCALE = { deep: 0.5, mid: 0.5 };
/**
 * 烘焙 / CSS tail 相对「旧方案 BASE_BLURS×blurScale」的配比。
 * deep/mid 半分辨率放大后会偏锐，BAKE_FRAC >1 做补偿。
 */
var BAKE_FRAC = { bg: 0.92, deep: 1.7, mid: 1.45, fg: 0.8 };
var CSS_TAIL_FRAC = 0.22;

/* ── 背景可调参数（供外部面板控制） ── */
export var bgConfig = {
  blurScale: 1.0,    // 模糊系数倍率，1.0 = 原版默认
  windSpeed: 1.0,    // 风速倍率
  rayOpacity: 0.55,  // 原版默认光束强度
  particleCount: 40, // 原版默认孢子粒子数量
  darken: 0,         // 额外变暗遮罩 0~1
  purity: 1.0,       // 纯度/饱和度倍率
  yOffset: 0.10      // 背景整体上移比例（相对画布高度）
};

/* 基准模糊值（blurScale=1.0时的像素数，legacy 模式 CSS 全量） */
var BASE_BLURS = { bg: 90, deep: 48, mid: 20, fg: 4 };

function _targetBlurPx(key) {
  return BASE_BLURS[key] * bgConfig.blurScale;
}

function _bakeBlurPx(key) {
  return _targetBlurPx(key) * BAKE_FRAC[key];
}

function _cssBlurPx(key) {
  var target = _targetBlurPx(key);
  if (USE_LEGACY_BG) return target;
  return target * CSS_TAIL_FRAC;
}

function _ensureScratch(key, scale) {
  if (!_scratch[key]) {
    _scratch[key] = document.createElement('canvas');
  }
  var sw = Math.max(1, Math.round(_W * scale * _dpr));
  var sh = Math.max(1, Math.round(_H * scale * _dpr));
  if (_scratch[key].width !== sw) _scratch[key].width = sw;
  if (_scratch[key].height !== sh) _scratch[key].height = sh;
  return { canvas: _scratch[key], ctx: _scratch[key].getContext('2d'), scale: scale };
}

function _scratchDrawSetup(sctx, scale) {
  sctx.setTransform(_dpr * scale, 0, 0, _dpr * scale, 0, 0);
}

function _blitWithBakeBlur(displayCtx, scratchCanvas, blurPx) {
  displayCtx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
  displayCtx.clearRect(0, 0, _W, _H);
  if (blurPx > 0) displayCtx.filter = 'blur(' + blurPx + 'px)';
  displayCtx.drawImage(scratchCanvas, 0, 0, _W, _H);
  displayCtx.filter = 'none';
}

function _cancelBgBakeSchedule() {
  if (_bgBakeIdleId == null) return;
  if (_bgBakeUseTimeout) clearTimeout(_bgBakeIdleId);
  else if (typeof cancelIdleCallback === 'function') cancelIdleCallback(_bgBakeIdleId);
  _bgBakeIdleId = null;
}

function _applyBgCssFilter() {
  if (!canvases.bg) return;
  if (USE_LEGACY_BG || _bgBakeDone) {
    canvases.bg.style.filter = 'blur(' + _cssBlurPx('bg') + 'px)';
    return;
  }
  /* 烘焙完成前：用与旧方案等价的 CSS blur 兜底 */
  canvases.bg.style.filter = 'blur(' + _targetBlurPx('bg') + 'px)';
}

function _bakeBgFromSharp() {
  if (USE_LEGACY_BG || !_bgSharp || !ctxs.bg) return;
  var ctx = ctxs.bg;
  var w = canvases.bg.width;
  var h = canvases.bg.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  var blurPx = _bakeBlurPx('bg');
  if (blurPx > 0) ctx.filter = 'blur(' + blurPx + 'px)';
  ctx.drawImage(_bgSharp, 0, 0);
  ctx.filter = 'none';
  ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
  _bgBakeDone = true;
  _applyBgCssFilter();
}

function _runDeferredBgBake() {
  _bgBakeIdleId = null;
  _bakeBgFromSharp();
}

function _scheduleBgBake(urgent) {
  if (USE_LEGACY_BG || !_bgSharp) return;
  _cancelBgBakeSchedule();
  _bgBakeDone = false;
  _applyBgCssFilter();

  if (urgent) {
    _runDeferredBgBake();
    return;
  }

  if (typeof requestIdleCallback === 'function') {
    _bgBakeUseTimeout = false;
    _bgBakeIdleId = requestIdleCallback(function () {
      _runDeferredBgBake();
    }, { timeout: _BG_BAKE_IDLE_TIMEOUT });
  } else {
    _bgBakeUseTimeout = true;
    _bgBakeIdleId = setTimeout(_runDeferredBgBake, 16);
  }
}

function _renderBakedLayer(key, scale, drawFn) {
  var sc = _ensureScratch(key, scale);
  _scratchDrawSetup(sc.ctx, sc.scale);
  sc.ctx.clearRect(0, 0, _W, _H);
  drawFn(sc.ctx);
  sc.ctx.setTransform(1, 0, 0, 1, 0, 0);
  _blitWithBakeBlur(ctxs[key], sc.canvas, _bakeBlurPx(key));
}

export function applyBgBlur() {
  if (!canvases.bg) return;
  var keys = ['deep', 'mid', 'fg'];
  for (var i = 0; i < keys.length; i++) {
    canvases[keys[i]].style.filter = 'blur(' + _cssBlurPx(keys[i]) + 'px)';
  }
  _applyBgCssFilter();
  if (!USE_LEGACY_BG && _bgSharp) {
    if (_bgBakeDone) _bakeBgFromSharp();
    else _scheduleBgBake(false);
  }
}

export function applyBgPresentation() {
  var wrap = document.getElementById('sylvan-bg-wrap');
  var darkenEl = document.getElementById('sylvan-bg-darken');
  if (!wrap) return;
  wrap.style.filter = 'saturate(' + bgConfig.purity + ')';
  if (darkenEl) darkenEl.style.opacity = String(bgConfig.darken);
}

export function setBgParticleCount(n) {
  bgConfig.particleCount = n;
  if (n > bokehParticles.length) {
    while (bokehParticles.length < n) bokehParticles.push(new Bokeh());
  } else {
    bokehParticles.splice(n);
  }
}

function randomRange(min, max) { return min + Math.random() * (max - min); }

/* ══════════════════════════════════════════
   CLASS: Bokeh — 孢子/光斑/星芒浮游粒子
══════════════════════════════════════════ */
function Bokeh() {
  this.reset();
  this.x = Math.random() * _W;
  this.y = Math.random() * _H;
}

Bokeh.prototype.reset = function () {
  var r = Math.random();
  if (r < 0.3) {
    this.type = 'lens';
    this.radius = randomRange(6, 18);
    this.sides = Math.random() > 0.5 ? 6 : 8;
  } else if (r < 0.75) {
    this.type = 'pollen';
    this.radius = randomRange(8, 15);
    this.numFilaments = Math.floor(randomRange(4, 7));
  } else {
    this.type = 'glint';
    this.radius = randomRange(5, 11);
  }
  this.x = Math.random() * _W;
  this.y = _H + this.radius + randomRange(10, 100);
  this.baseSpeedX = randomRange(-0.15, 0.15);
  this.baseSpeedY = this.type === 'glint' ? randomRange(-0.8, -1.8) : randomRange(-0.5, -1.3);
  this.alpha = this.type === 'lens' ? randomRange(0.03, 0.09) : randomRange(0.08, 0.25);
  this.maxAlpha = this.alpha;
  this.pulseSpeed = randomRange(0.005, 0.02);
  this.pulsePhase = Math.random() * Math.PI * 2;
  this.rotation = Math.random() * Math.PI * 2;
  this.rotationSpeed = randomRange(-0.006, 0.006);
  this.offsetX = 0; this.offsetY = 0;
};

Bokeh.prototype.update = function (wind, mx, my) {
  var currentWindForce = wind * 0.15;
  var wave = Math.sin(this.pulsePhase) * (this.type === 'glint' ? 0.35 : 0.18);
  this.x += this.baseSpeedX + currentWindForce + wave;
  this.y += this.baseSpeedY;
  this.rotation += this.rotationSpeed;
  this.pulsePhase += this.pulseSpeed;
  this.alpha = this.maxAlpha * (0.65 + Math.sin(this.pulsePhase) * 0.35);

  var dx = this.x - mx, dy = this.y - my;
  var dist = Math.sqrt(dx * dx + dy * dy);
  var maxInfl = 160;
  if (dist < maxInfl && dist > 0.1) {
    var force = (maxInfl - dist) / maxInfl;
    this.offsetX += (dx / dist) * force * 1.2;
    this.offsetY += (dy / dist) * force * 1.2;
  }
  this.x += this.offsetX; this.y += this.offsetY;
  this.offsetX *= 0.95; this.offsetY *= 0.95;

  if (this.y < -this.radius || this.x < -this.radius || this.x > _W + this.radius) {
    this.reset();
    this.y = _H + this.radius;
  }
};

Bokeh.prototype.draw = function (ctx) {
  ctx.save();
  ctx.globalAlpha = this.alpha;

  if (this.type === 'lens') {
    ctx.beginPath();
    for (var i = 0; i < this.sides; i++) {
      var a = (i / this.sides) * Math.PI * 2 + this.rotation;
      var px = this.x + Math.cos(a) * this.radius;
      var py = this.y + Math.sin(a) * this.radius;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = activeTheme.motesColor; ctx.fill();
    ctx.strokeStyle = activeTheme.highlightColor; ctx.lineWidth = 0.5; ctx.stroke();
    statsDc('quad', 2);

  } else if (this.type === 'pollen') {
    ctx.translate(this.x, this.y); ctx.rotate(this.rotation);
    ctx.strokeStyle = activeTheme.motesColor; ctx.lineWidth = 0.4;
    for (var i = 0; i < this.numFilaments; i++) {
      var a = (i / this.numFilaments) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(
        Math.cos(a + 0.12) * (this.radius * 0.42), Math.sin(a + 0.12) * (this.radius * 0.42),
        Math.cos(a) * this.radius, Math.sin(a) * this.radius
      );
      ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(0, 0, 0.9, 0, Math.PI * 2);
    ctx.fillStyle = activeTheme.accent; ctx.fill();
    statsDc('line', this.numFilaments + 1);

  } else if (this.type === 'glint') {
    ctx.translate(this.x, this.y); ctx.rotate(this.rotation);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(-this.radius, 0); ctx.lineTo(this.radius, 0);
    ctx.moveTo(0, -this.radius); ctx.lineTo(0, this.radius);
    ctx.stroke();
    var glow = ctx.createRadialGradient(0, 0, 0, 0, 0, this.radius * 0.8);
    glow.addColorStop(0, 'rgba(255,255,255,0.35)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, this.radius * 0.8, 0, Math.PI * 2); ctx.fill();
    statsDc('quad', 2);
  }
  ctx.restore();
};

/* ══════════════════════════════════════════
   CLASS: Joint — 树枝骨架弹簧关节
══════════════════════════════════════════ */
function Joint(length, angleOffset, elasticity, damping, level, leafDensity) {
  this.length = length;
  this.angleOffset = angleOffset;
  this.elasticity = elasticity;
  this.damping = damping;
  this.level = level;
  this.angle = angleOffset;
  this.angularVel = 0;
  this.children = [];
  this.leaves = [];

  if (level < 3) {
    var childCount = level === 0 ? (activeTheme.branchType === 'conifer' ? 4 : 3) : Math.floor(randomRange(2, 4));
    for (var i = 0; i < childCount; i++) {
      var childAngle = 0, childLen = length;
      if (activeTheme.branchType === 'conifer') {
        if (level === 0) {
          if (i === 0) { childAngle = randomRange(-0.05, 0.05); childLen = length * 0.75; }
          else {
            var d = (i % 2 === 0) ? -1 : 1;
            childAngle = d * (Math.PI / 2 - randomRange(0.05, 0.2));
            childLen = length * 0.68;
          }
        } else {
          var d = (i % 2 === 0) ? -1 : 1;
          childAngle = d * (Math.PI / 3) + randomRange(-0.05, 0.05);
          childLen = length * 0.65;
        }
      } else {
        var spread = activeTheme.branchType === 'wide' ? 0.55 :
          activeTheme.branchType === 'gnarled' ? 0.65 :
          activeTheme.branchType === 'elegant' ? 0.38 : 0.45;
        childAngle = randomRange(-0.3, 0.3) + (i - (childCount - 1) / 2) * spread;
        childLen = length * randomRange(0.68, 0.78);
      }
      this.children.push(new Joint(childLen, childAngle, elasticity * 1.5, damping * 0.82, level + 1, leafDensity));
    }
  }

  if (level > 0) {
    var baseDensity = randomRange(activeTheme.leafDensityRange[0], activeTheme.leafDensityRange[1]);
    var numLeaves = Math.floor(baseDensity * (level === 1 ? 0.4 : 1.1));
    for (var i = 0; i < numLeaves; i++) {
      var leafSize;
      if (activeTheme.leafShape === 'maple') leafSize = randomRange(130, 180);
      else if (activeTheme.leafShape === 'jacaranda') leafSize = randomRange(40, 70);
      else if (activeTheme.leafShape === 'sakura') leafSize = randomRange(60, 95);
      else if (activeTheme.leafShape === 'spruce') leafSize = randomRange(70, 110);
      else leafSize = randomRange(75, 115);
      this.leaves.push({
        posRatio: randomRange(0.1, 1.0),
        spreadAngle: randomRange(-Math.PI / 1.5, Math.PI / 1.5),
        size: leafSize * (1 - level * 0.12),
        color: activeTheme.leafColors[Math.floor(Math.random() * activeTheme.leafColors.length)],
        phase: Math.random() * Math.PI * 2,
        flutterSpeed: randomRange(0.012, 0.03),
        flutterRange: randomRange(0.025, 0.07)
      });
    }
  }
}

Joint.prototype.update = function (px, py, parentAngle, wind) {
  var worldAngle = parentAngle + this.angle;
  var endX = px + Math.cos(worldAngle) * this.length;
  var endY = py + Math.sin(worldAngle) * this.length;
  var windTorque = Math.sin(worldAngle - Math.PI / 2) * wind * (0.0006 / (this.level + 1));
  var springTorque = -this.elasticity * (this.angle - this.angleOffset);
  this.angularVel = (this.angularVel + springTorque + windTorque) * this.damping;
  this.angle += this.angularVel;

  for (var i = 0; i < this.children.length; i++)
    this.children[i].update(endX, endY, worldAngle, wind);
  for (var i = 0; i < this.leaves.length; i++)
    this.leaves[i].phase += this.leaves[i].flutterSpeed * (1 + wind * 0.5);

  return { startX: px, startY: py, endX: endX, endY: endY, angle: worldAngle };
};

Joint.prototype.draw = function (ctx, sx, sy, ex, ey, worldAngle, thickness, barkColor) {
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey);
  ctx.strokeStyle = barkColor; ctx.lineWidth = thickness; ctx.lineCap = 'round'; ctx.stroke();
  statsDc('line');

  for (var li = 0; li < this.leaves.length; li++) {
    var leaf = this.leaves[li];
    var lx = sx + (ex - sx) * leaf.posRatio;
    var ly = sy + (ey - sy) * leaf.posRatio;
    var a = worldAngle + leaf.spreadAngle + Math.sin(leaf.phase) * leaf.flutterRange - this.angularVel * 4;
    ctx.save(); ctx.translate(lx, ly); ctx.rotate(a);
    var s = leaf.size;

    if (activeTheme.leafShape === 'maple') {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(s * 0.3, -s * 0.45, s * 0.45, -s * 0.4); ctx.lineTo(s * 0.45, -s * 0.15);
      ctx.quadraticCurveTo(s * 0.5, -s * 0.25, s, 0);
      ctx.quadraticCurveTo(s * 0.5, s * 0.25, s * 0.45, s * 0.15); ctx.lineTo(s * 0.45, s * 0.4);
      ctx.quadraticCurveTo(s * 0.3, s * 0.45, 0, 0);
      ctx.closePath(); ctx.fillStyle = leaf.color; ctx.fill();
      statsDc('quad'); statsAddBgLeaves(1);

    } else if (activeTheme.leafShape === 'jacaranda') {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(s * 0.3, -s * 0.3, s * 0.65, -s * 0.2, s * 0.9, -s * 0.15);
      ctx.quadraticCurveTo(s, -s * 0.25, s, -s * 0.05); ctx.lineTo(s, s * 0.05);
      ctx.quadraticCurveTo(s, s * 0.25, s * 0.9, s * 0.15);
      ctx.bezierCurveTo(s * 0.65, s * 0.2, s * 0.3, s * 0.3, 0, 0);
      ctx.closePath(); ctx.fillStyle = leaf.color; ctx.fill();
      statsDc('quad'); statsAddBgLeaves(1);

    } else if (activeTheme.leafShape === 'sakura') {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(s * 0.25, -s * 0.5, s * 0.75, -s * 0.35, s * 0.9, -s * 0.1);
      ctx.lineTo(s * 0.82, 0); ctx.lineTo(s * 0.9, s * 0.1);
      ctx.bezierCurveTo(s * 0.75, s * 0.35, s * 0.25, s * 0.5, 0, 0);
      ctx.closePath(); ctx.fillStyle = leaf.color; ctx.fill();
      statsDc('quad'); statsAddBgLeaves(1);

    } else if (activeTheme.leafShape === 'spruce') {
      ctx.strokeStyle = leaf.color; ctx.lineWidth = 0.8;
      for (var n = 0; n < 5; n++) {
        var na = -Math.PI / 2.5 + (n / 4) * (Math.PI * 2 / 2.5);
        ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(na) * s * 1.1, Math.sin(na) * s * 1.1);
        ctx.stroke();
        statsDc('line');
      }
      statsAddBgLeaves(1);
    } else {
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.quadraticCurveTo(s / 2, -s / 3, s, 0); ctx.quadraticCurveTo(s / 2, s / 3, 0, 0);
      ctx.closePath(); ctx.fillStyle = leaf.color; ctx.fill();
      statsDc('quad'); statsAddBgLeaves(1);
    }
    ctx.restore();
  }

  for (var ci = 0; ci < this.children.length; ci++) {
    var c = this.children[ci];
    var ca = worldAngle + c.angle;
    c.draw(ctx, ex, ey, ex + Math.cos(ca) * c.length, ey + Math.sin(ca) * c.length, ca, thickness * 0.65, barkColor);
  }
};

/* ══════════════════════════════════════════
   CLASS: SylvanTree — 完整树体控制器
══════════════════════════════════════════ */
function SylvanTree(x, y, length, baseAngle, barkThickness, leafDensity) {
  this.x = x; this.y = y; this.baseAngle = baseAngle; this.barkThickness = barkThickness;
  this.root = new Joint(length, 0, randomRange(0.0003, 0.0007), randomRange(0.88, 0.93), 0, leafDensity);
}

SylvanTree.prototype.draw = function (ctx) {
  var sk = this.root.update(this.x, this.y, this.baseAngle, globalWindForce);
  this.root.draw(ctx, sk.startX, sk.startY, sk.endX, sk.endY, sk.angle, this.barkThickness, activeTheme.barkColor);
};

/* ══════════════════════════════════════════
   CLASS: LightRay — 丁达尔圣光折射光束
══════════════════════════════════════════ */
function LightRay() {
  this.reset();
  this.phase = Math.random() * Math.PI;
}

LightRay.prototype.reset = function () {
  this.originX = randomRange(-_W * 0.2, _W * 0.25);
  this.originY = randomRange(-_H * 0.15, -20);
  this.width = randomRange(120, 280);
  this.length = Math.max(_W, _H) * 1.6;
  this.angle = randomRange(0.75, 1.15);
  this.maxAlpha = randomRange(0.25, 0.55);
  this.phase = 0;
  this.speed = randomRange(0.001, 0.0035);
  this.angleSpeed = randomRange(-0.00005, 0.00005);
};

LightRay.prototype.update = function () {
  this.angle += this.angleSpeed;
  this.phase += this.speed;
  this.alpha = Math.sin(this.phase) * this.maxAlpha;
  if (this.phase >= Math.PI) this.reset();
};

LightRay.prototype.draw = function (ctx) {
  if (this.alpha <= 0.001) return;
  ctx.save();
  ctx.globalAlpha = this.alpha * bgConfig.rayOpacity;
  ctx.globalCompositeOperation = 'multiply';
  var cos = Math.cos(this.angle), sin = Math.sin(this.angle);
  var p1x = this.originX - sin * (this.width / 2), p1y = this.originY + cos * (this.width / 2);
  var p2x = this.originX + sin * (this.width / 2), p2y = this.originY - cos * (this.width / 2);
  var p3x = p2x + cos * this.length + sin * (this.width * 2), p3y = p2y + sin * this.length - cos * (this.width * 2);
  var p4x = p1x + cos * this.length - sin * (this.width * 2), p4y = p1y + sin * this.length + cos * (this.width * 2);
  var gr = ctx.createLinearGradient(this.originX, this.originY, this.originX + cos * this.length, this.originY + sin * this.length);
  gr.addColorStop(0, activeTheme.accent);
  gr.addColorStop(0.3, activeTheme.rayColor);
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gr;
  ctx.beginPath(); ctx.moveTo(p1x, p1y); ctx.lineTo(p2x, p2y); ctx.lineTo(p3x, p3y); ctx.lineTo(p4x, p4y);
  ctx.closePath(); ctx.fill();
  statsDc('quad');
  ctx.restore();
};

/* ══════════════════════════════════════════
   初始化 DOM 注入背景容器
══════════════════════════════════════════ */
export function initSylvanBackground(W, H, screenShellEl) {
  _W = W; _H = H;

  // 创建背景容器
  var wrap = document.createElement('div');
  wrap.id = 'sylvan-bg-wrap';
  wrap.style.cssText = 'position:absolute;inset:0;overflow:hidden;z-index:0;border-radius:4px;pointer-events:none;background:' + activeTheme.bgGradient[0] + ';';

  var darkenEl = document.createElement('div');
  darkenEl.id = 'sylvan-bg-darken';
  darkenEl.style.cssText = 'position:absolute;inset:0;z-index:6;pointer-events:none;opacity:0;background:rgba(0,0,0,1);';

  var keys = ['bg', 'deep', 'mid', 'fg'];
  var opacities = { bg: 0.9, deep: 0.85, mid: 0.9, fg: 0.95 };
  var zindices = { bg: 1, deep: 2, mid: 3, fg: 4 };

  keys.forEach(function (key) {
    var c = document.createElement('canvas');
    c.id = 'sylvan-canvas-' + key;
    c.style.cssText = [
      'filter:none',
      'opacity:' + opacities[key],
      'z-index:' + zindices[key],
      'pointer-events:none',
      'position:absolute',
      'top:-5%',
      'left:-5%',
      'width:110%',
      'height:110%',
      'will-change:transform',
      'transition:transform 0.1s cubic-bezier(0.25, 0.46, 0.45, 0.94)'
    ].join(';');
    wrap.appendChild(c);
    canvases[key] = c;
    ctxs[key] = c.getContext('2d');
  });

  wrap.appendChild(darkenEl);

  // 插入到 screen-shell 的最底层（蛛网 canvas 之前）
  screenShellEl.insertBefore(wrap, screenShellEl.firstChild);

  _resizeCanvases();
  _createEntities();
  applyBgPresentation();
  applyBgBlur();
}

function _resizeCanvases() {
  _dpr = window.devicePixelRatio || 1;
  var keys = ['bg', 'deep', 'mid', 'fg'];
  keys.forEach(function (key) {
    canvases[key].width = Math.round(_W * _dpr);
    canvases[key].height = Math.round(_H * _dpr);
    ctxs[key].setTransform(1, 0, 0, 1, 0, 0);
    ctxs[key].scale(_dpr, _dpr);
  });
  _bgSharp = null;
  _bgBakeDone = false;
  _cancelBgBakeSchedule();
  _initBackgroundMesh();
}

/* ══════════════════════════════════════════
   背景底层光晕渐变静态绘制（仅主题切换时重绘）
══════════════════════════════════════════ */
function _initBackgroundMesh() {
  var ctx = ctxs.bg;
  var w = canvases.bg.width;
  var h = canvases.bg.height;
  var wrap = document.getElementById('sylvan-bg-wrap');
  if (wrap) wrap.style.background = activeTheme.bgGradient[0];
  ctx.clearRect(0, 0, w, h);

  // 主底色
  if (activeTheme.id === 'cherry-blossom') {
    var vg = ctx.createLinearGradient(0, 0, 0, h);
    vg.addColorStop(0, '#ff7d90'); vg.addColorStop(0.45, '#e11d48'); vg.addColorStop(1, '#6b0108');
    ctx.fillStyle = vg;
  } else {
    ctx.fillStyle = activeTheme.bgGradient[0];
  }
  ctx.fillRect(0, 0, w, h);

  // 顶角强光晕
  var sg = ctx.createRadialGradient(w * 0.05, h * 0.03, 0, w * 0.05, h * 0.03, w * 0.85);
  sg.addColorStop(0, '#ffffff');
  sg.addColorStop(0.15, activeTheme.accent);
  sg.addColorStop(0.5, activeTheme.bgGradient[3] || 'rgba(0,0,0,0)');
  sg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sg; ctx.fillRect(0, 0, w, h);

  // 环境光晕叠加
  ctx.globalCompositeOperation = 'screen';
  var grds = [
    { x: w * 0.15, y: h * 0.15, r: w * 0.5 },
    { x: w * 0.85, y: h * 0.25, r: w * 0.4 },
    { x: w * 0.45, y: h * 0.75, r: w * 0.65 }
  ];
  grds.forEach(function (g, idx) {
    var col = activeTheme.bgGradient[idx % activeTheme.bgGradient.length];
    var rg = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, g.r);
    rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2); ctx.fill();
  });

  // 春樱特殊中央晕光
  if (activeTheme.id === 'cherry-blossom') {
    var cx = w * 0.5, cy = h * 0.45, r = w * 0.85;
    var cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    cg.addColorStop(0, 'rgba(255,255,255,0.95)');
    cg.addColorStop(0.25, 'rgba(255,186,201,0.82)');
    cg.addColorStop(0.6, 'rgba(255,204,213,0.35)');
    cg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  if (!USE_LEGACY_BG) {
    if (!_bgSharp) _bgSharp = document.createElement('canvas');
    _bgSharp.width = w;
    _bgSharp.height = h;
    _bgSharp.getContext('2d').drawImage(canvases.bg, 0, 0);
    _bgBakeDone = false;
    _scheduleBgBake(false);
  }
}

/* ══════════════════════════════════════════
   创建场景实体（树木 / 粒子 / 光束）
══════════════════════════════════════════ */
function _createEntities() {
  bokehParticles = []; treesDeep = []; treesMid = []; lightRays = [];

  // 丁达尔光束
  for (var i = 0; i < 5; i++) lightRays.push(new LightRay());

  // 孢子光斑粒子（移动端关闭）
  var _isMobileBg = navigator.maxTouchPoints > 1 || /iPhone|iPad|Android/i.test(navigator.userAgent);
  var _particleTarget = _isMobileBg ? 0 : bgConfig.particleCount;
  for (var i = 0; i < _particleTarget; i++) bokehParticles.push(new Bokeh());

  // 深景深大树 (6棵) — 与原版参数对齐
  var numDeep = 6;
  for (var i = 0; i < numDeep; i++) {
    var x = (i / (numDeep - 1)) * _W * 1.1 - _W * 0.05 + randomRange(-40, 40);
    var y = -100 - randomRange(0, 60);   // 在原版基础上整体上移一点
    var angle = randomRange(Math.PI / 2.2, Math.PI / 1.8);
    var len = randomRange(_H * 0.16, _H * 0.24);   // 原版: h*0.16 ~ h*0.24
    treesDeep.push(new SylvanTree(x, y, len, angle, randomRange(12, 22), 0.4));
  }

  // 中景侧入梢枝 (4棵) — 与原版参数对齐
  var numMid = 4;
  for (var i = 0; i < numMid; i++) {
    var isLeft = Math.random() > 0.5;
    var x = isLeft ? randomRange(-50, _W * 0.3) : randomRange(_W * 0.7, _W + 50);
    var y = -110 - randomRange(0, 50);   // 在原版基础上整体上移一点
    var angle = isLeft ? randomRange(0.2, 0.9) : randomRange(2.2, 2.9);
    var len = randomRange(_H * 0.18, _H * 0.28);   // 原版: h*0.18 ~ h*0.28
    treesMid.push(new SylvanTree(x, y, len, angle, randomRange(8, 14), 1.2));
  }
}

/* ══════════════════════════════════════════
   切换主题（关卡切换时调用）
══════════════════════════════════════════ */
export function switchSylvanTheme(levelIndex) {
  var idx = Math.max(0, Math.min(THEMES.length - 1, levelIndex));
  activeTheme = THEMES[idx];
  _cancelBgBakeSchedule();
  _initBackgroundMesh();
  _createEntities();
  applyBgBlur();
}

/* ══════════════════════════════════════════
   每帧更新（主循环调用）
   smoothDrag: {x, y} 已阻尼的拖拽差值
   mx, my: canvas 内坐标系下的鼠标/触控位置
══════════════════════════════════════════ */
export function updateSylvanBackground(windSpeed, isMouseDown, smoothDrag, mx, my) {
  time += 0.5;
  var baseScale = 1.2;
  var baseShiftY = -_H * bgConfig.yOffset;

  // 极弱自然呼吸风 0.02~0.05 m/s，偶发细微阵风
  var baseWind = 0.035 + Math.sin(time * 0.003) * 0.015;
  var gustRaw = Math.sin(time * 0.008) * Math.sin(time * 0.002 + 1.5);
  var gust = gustRaw > 0.4 ? (gustRaw - 0.4) * (gustRaw - 0.4) * 0.12 : 0;
  globalWindForce = (baseWind + gust) * bgConfig.windSpeed;

  // 视差计算：归一化鼠标位置 [-0.5, 0.5]
  var pxX = (mx / _W) - 0.5;
  var pxY = (my / _H) - 0.5;

  // 拖拽弹性位移 — 背景远层移动远大于蛛网变形量，制造深度撑开感
  var maxDisp = 8.5;
  var dx = Math.max(-maxDisp, Math.min(maxDisp, smoothDrag.x));
  var dy = Math.max(-maxDisp, Math.min(maxDisp, smoothDrag.y));

  // 各层倍率：背景层最小，前景层最大（整体缩减为原来的10%）
  var bgX = pxX * -6 + dx * 0.05,  bgY = pxY * -6 + dy * 0.05;
  var deepX = pxX * -13 + dx * 0.12, deepY = pxY * -13 + dy * 0.12;
  var midX = pxX * -26 + dx * 0.22,  midY = pxY * -26 + dy * 0.22;
  var fgX = pxX * -48 + dx * 0.35,  fgY = pxY * -48 + dy * 0.35;

  canvases.bg.style.transform   = 'translate(' + bgX   + 'px,' + (bgY + baseShiftY)   + 'px) scale(' + (1.02 * baseScale) + ')';
  canvases.deep.style.transform = 'translate(' + deepX + 'px,' + (deepY + baseShiftY) + 'px) scale(' + (1.04 * baseScale) + ')';
  canvases.mid.style.transform  = 'translate(' + midX  + 'px,' + (midY + baseShiftY)  + 'px) scale(' + (1.06 * baseScale) + ')';
  canvases.fg.style.transform   = 'translate(' + fgX   + 'px,' + (fgY + baseShiftY)   + 'px) scale(' + (1.08 * baseScale) + ')';

  // 更新粒子和光束
  for (var i = 0; i < bokehParticles.length; i++) bokehParticles[i].update(globalWindForce, mx, my);
  for (var i = 0; i < lightRays.length; i++) lightRays[i].update();
}

/* ══════════════════════════════════════════
   每帧绘制（主循环调用，在 sim.draw() 之前）
══════════════════════════════════════════ */
export function getBgEntityCounts() {
  return {
    bgTrees: treesDeep.length + treesMid.length,
    bgRays: lightRays.length,
    bgBokeh: bokehParticles.length
  };
}

export function renderSylvanBackground() {
  statsSetScene(Object.assign({ bgRendered: true }, getBgEntityCounts()));

  if (USE_LEGACY_BG) {
    ctxs.deep.clearRect(0, 0, _W, _H);
    statsDc('clear');
    for (var di = 0; di < treesDeep.length; di++) treesDeep[di].draw(ctxs.deep);

    ctxs.mid.clearRect(0, 0, _W, _H);
    statsDc('clear');
    for (var mi = 0; mi < treesMid.length; mi++) treesMid[mi].draw(ctxs.mid);
    for (var ri = 0; ri < lightRays.length; ri++) lightRays[ri].draw(ctxs.mid);

    ctxs.fg.clearRect(0, 0, _W, _H);
    statsDc('clear');
    for (var fi = 0; fi < bokehParticles.length; fi++) bokehParticles[fi].draw(ctxs.fg);
    return;
  }

  // 深景深：半分辨率绘制 + Canvas 预模糊
  _renderBakedLayer('deep', LAYER_DRAW_SCALE.deep, function (ctx) {
    for (var i = 0; i < treesDeep.length; i++) treesDeep[i].draw(ctx);
  });
  statsDc('clear');

  // 中景：先树枝、后光束，乘法混合才能作用在已有像素上
  _renderBakedLayer('mid', LAYER_DRAW_SCALE.mid, function (ctx) {
    for (var j = 0; j < treesMid.length; j++) treesMid[j].draw(ctx);
    for (var k = 0; k < lightRays.length; k++) lightRays[k].draw(ctx);
  });
  statsDc('clear');

  // 近景：全分辨率 + 轻预模糊
  _renderBakedLayer('fg', 1, function (ctx) {
    for (var p = 0; p < bokehParticles.length; p++) bokehParticles[p].draw(ctx);
  });
  statsDc('clear');
}
