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

export function statsBeginFrame() {
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
  var faces = s.faces;
  return [
    'FPS ' + (s.fps || '—') + '  ' + s.frameMs + 'ms',
    'Draw ' + s.drawCalls + '  Line ' + s.lines + '  Face ' + faces,
    'Img ' + s.images + '  Clear ' + s.clears,
    'Phys ' + sc.verletParticles + 'p × ' + sc.physicsIters + 'i',
    'Web ' + sc.webConstraints + 'c  Spider ' + sc.spiderConstraints + 'c',
    'Prey ' + sc.preyActive,
    'BG tree ' + sc.bgTrees + ' leaf ' + sc.bgLeaves + ' ray ' + sc.bgRays + ' bokeh ' + sc.bgBokeh
      + (sc.bgRendered ? '' : ' (skip)'),
    'DPR ' + sc.dpr
  ];
}

export function statsBindPanel(el) {
  if (!el) return function () {};
  return function updatePanel() {
    var lines = statsFormatPanel();
    el.textContent = lines.join('\n');
  };
}