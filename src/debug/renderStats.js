/**
 * 每帧渲染与场景统计 — 供 FPS 调试面板使用
 */

var _frame = {
  drawCalls: 0,
  tris: 0,
  quads: 0,
  lines: 0,
  images: 0,
  clears: 0
};

var _scene = {
  verletParticles: 0,
  webConstraints: 0,
  spiderConstraints: 0,
  preyActive: 0,
  physicsIters: 0,
  bgTrees: 0,
  bgLeaves: 0,
  bgRays: 0,
  bgBokeh: 0,
  dpr: 1,
  bgRendered: false
};

var _fps = {
  value: 0,
  ms: 0,
  lastTs: 0,
  accum: 0,
  frames: 0
};

var _PROF_ORDER = [
  'bgUpd', 'bgRnd', 'anim', 'phys', 'query', 'webRnd', 'preyRnd', 'spiderRnd', 'other'
];

var _prof = {
  cur: null,
  frame: {},
  ema: {},
  labels: {
    bgUpd: 'BG upd',
    bgRnd: 'BG draw',
    anim: 'Anim',
    phys: 'Phys',
    query: 'Query',
    webRnd: 'Web',
    preyRnd: 'Prey',
    spiderRnd: 'Spider',
    other: 'Other',
    gpu: 'GPU/other'
  }
};

var _PROF_EMA = 0.05;
var _DISPLAY_EMA = 0.06;
var _PANEL_REFRESH_MS = 600;

var _display = {
  frameMs: 0,
  drawCalls: 0,
  lines: 0,
  faces: 0,
  images: 0,
  clears: 0,
  bgLeaves: 0,
  bgRndPct: 0,
  preyActive: 0
};

function _padLabel(label, width) {
  return label.length >= width ? label : label + new Array(width - label.length + 1).join(' ');
}

function _padInt(n, width) {
  var s = String(Math.round(n));
  return s.length >= width ? s : new Array(width - s.length + 1).join(' ') + s;
}

function _padMs(ms) {
  var s = (Math.round(ms * 10) / 10).toFixed(1);
  return (s + 'ms').length >= 6 ? s + 'ms' : new Array(6 - (s + 'ms').length + 1).join(' ') + s + 'ms';
}

function _padPct(pct) {
  var s = String(pct);
  return (s + '%').length >= 4 ? s + '%' : new Array(4 - (s + '%').length + 1).join(' ') + s + '%';
}

function _smoothDisplay(key, value) {
  var v = value == null ? 0 : value;
  _display[key] = _display[key] != null
    ? _display[key] * (1 - _DISPLAY_EMA) + v * _DISPLAY_EMA
    : v;
}

function _refreshDisplayMetrics() {
  _smoothDisplay('frameMs', _fps.ms);
  _smoothDisplay('drawCalls', _frame.drawCalls);
  _smoothDisplay('lines', _frame.lines);
  _smoothDisplay('faces', statsFaces());
  _smoothDisplay('images', _frame.images);
  _smoothDisplay('clears', _frame.clears);
  _smoothDisplay('bgLeaves', _scene.bgLeaves);
  _smoothDisplay('bgRndPct', _scene.bgRendered ? 100 : 0);
  _smoothDisplay('preyActive', _scene.preyActive);
}

export function statsTimeStart(name) {
  if (_prof.cur) statsTimeEnd();
  _prof.cur = { name: name, t0: performance.now() };
}

export function statsTimeEnd() {
  if (!_prof.cur) return;
  var dt = performance.now() - _prof.cur.t0;
  var n = _prof.cur.name;
  _prof.frame[n] = (_prof.frame[n] || 0) + dt;
  _prof.cur = null;
}

export function statsBeginFrame() {
  statsTimeEnd();
  _prof.frame = {};
  _prof.cur = null;
  _frame.drawCalls = 0;
  _frame.tris = 0;
  _frame.quads = 0;
  _frame.lines = 0;
  _frame.images = 0;
  _frame.clears = 0;
  _scene.bgLeaves = 0;
  _scene.bgRendered = false;
}

/**
 * 记录一次 Canvas 绘制操作
 * @param {'line'|'tri'|'quad'|'image'|'arc'|'clear'|'stroke'|'fill'} kind
 * @param {number} [count=1] 线段数 / 面片数等
 */
export function statsDc(kind, count) {
  var n = count == null ? 1 : count;
  _frame.drawCalls += 1;
  if (kind === 'line' || kind === 'stroke') _frame.lines += n;
  else if (kind === 'tri') _frame.tris += n;
  else if (kind === 'quad') _frame.quads += n;
  else if (kind === 'image') _frame.images += n;
  else if (kind === 'arc' || kind === 'fill') _frame.quads += n;
  else if (kind === 'clear') _frame.clears += n;
}

export function statsSetScene(patch) {
  for (var k in patch) {
    if (Object.prototype.hasOwnProperty.call(patch, k)) _scene[k] = patch[k];
  }
}

export function statsAddBgLeaves(n) {
  _scene.bgLeaves += n;
}

export function statsEndFrame(timestamp) {
  statsTimeEnd();
  for (var pi = 0; pi < _PROF_ORDER.length; pi++) {
    var pk = _PROF_ORDER[pi];
    var v = _prof.frame[pk] || 0;
    _prof.ema[pk] = _prof.ema[pk] != null
      ? _prof.ema[pk] * (1 - _PROF_EMA) + v * _PROF_EMA
      : v;
  }

  if (!_fps.lastTs) {
    _fps.lastTs = timestamp;
    return;
  }
  var dt = timestamp - _fps.lastTs;
  _fps.lastTs = timestamp;
  _fps.ms = dt;
  _fps.accum += dt;
  _fps.frames += 1;
  if (_fps.accum >= 500) {
    _fps.value = Math.round((_fps.frames * 1000) / _fps.accum * 10) / 10;
    _fps.accum = 0;
    _fps.frames = 0;
  }

  _refreshDisplayMetrics();
}

function statsFormatProfile() {
  var lines = ['--- profile (JS ema) ---'];
  var total = 0;
  for (var ti = 0; ti < _PROF_ORDER.length; ti++) {
    total += _prof.ema[_PROF_ORDER[ti]] || 0;
  }

  for (var i = 0; i < _PROF_ORDER.length; i++) {
    var key = _PROF_ORDER[i];
    var ms = _prof.ema[key] || 0;
    var pct = total > 0.05 ? Math.round((ms / total) * 100) : 0;
    lines.push(
      _padLabel(_prof.labels[key], 10) + _padMs(ms) + ' ' + _padPct(pct)
    );
  }

  var gap = Math.max(0, (_display.frameMs || 0) - total);
  lines.push(_padLabel(_prof.labels.gpu, 10) + _padMs(gap) + '    —');
  lines.push('(CSS blur 计入 GPU/other)');
  return lines;
}

export function statsFaces() {
  return _frame.tris + _frame.quads;
}

export function statsSnapshot() {
  return {
    fps: _fps.value,
    frameMs: Math.round(_fps.ms * 10) / 10,
    drawCalls: _frame.drawCalls,
    tris: _frame.tris,
    quads: _frame.quads,
    faces: statsFaces(),
    lines: _frame.lines,
    images: _frame.images,
    clears: _frame.clears,
    scene: Object.assign({}, _scene)
  };
}

export function statsFormatPanel() {
  var s = statsSnapshot();
  var sc = s.scene;
  var d = _display;
  var fpsStr = s.fps ? String(s.fps) : '  —';
  if (fpsStr.length < 4) fpsStr = new Array(4 - fpsStr.length + 1).join(' ') + fpsStr;
  return [
    'FPS ' + fpsStr + '  ' + _padMs(d.frameMs),
    'Draw' + _padInt(d.drawCalls, 5) + ' Line' + _padInt(d.lines, 5) + ' Face' + _padInt(d.faces, 5),
    'Img ' + _padInt(d.images, 3) + '  Clear' + _padInt(d.clears, 3),
    'Phys' + _padInt(sc.verletParticles, 4) + 'p x' + _padInt(sc.physicsIters, 2) + 'i',
    'Web' + _padInt(sc.webConstraints, 4) + 'c Sp' + _padInt(sc.spiderConstraints, 3) + 'c',
    'Prey' + _padInt(d.preyActive, 3),
    'BG t' + _padInt(sc.bgTrees, 1) + ' lf' + _padInt(d.bgLeaves, 4)
      + ' ry' + _padInt(sc.bgRays, 1) + ' bk' + _padInt(sc.bgBokeh, 2)
      + ' rnd' + _padInt(d.bgRndPct, 3) + '%',
    'DPR ' + sc.dpr
  ].concat(statsFormatProfile());
}

export function statsBindPanel(el) {
  if (!el) return function () {};
  var lastPaint = -_PANEL_REFRESH_MS;
  var cachedText = '';
  return function updatePanel() {
    var now = performance.now();
    if (now - lastPaint < _PANEL_REFRESH_MS) return;
    lastPaint = now;
    var lines = statsFormatPanel();
    var text = lines.join('\n');
    if (text === cachedText) return;
    cachedText = text;
    el.textContent = text;
  };
}