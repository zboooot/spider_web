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
    pacing: 'Pacing gap'
  }
};

var _PROF_EMA = 0.05;
var _DISPLAY_EMA = 0.06;
var _PANEL_REFRESH_MS = 600;
var _DIAG_PANEL_REFRESH_MS = 200;
var _MAX_RECORD_SECONDS = 600;

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

var _diagMode = false;
var _recording = false;
var _recordedSeconds = [];
var _recordingStartedAt = null;
var _diagModeAtStart = false;
var _contextGetter = null;
var _longTaskTotal = 0;

var _live = {
  frameMs: [],
  maxFrames: 300,
  spikesGt33: 0,
  spikesGt50: 0,
  windowStartPerf: 0,
  logicStepsMax: 0,
  backlogMax: 0,
  droppedCatchup: 0,
  p95Ms: 0,
  maxMs: 0
};

var _sec = null;
var _secIndex = 0;

function _nowPerf() {
  return performance.now();
}

function _percentile(sorted, p) {
  if (!sorted.length) return 0;
  var idx = Math.ceil((p / 100) * sorted.length) - 1;
  if (idx < 0) idx = 0;
  if (idx >= sorted.length) idx = sorted.length - 1;
  return sorted[idx];
}

function _avg(nums) {
  if (!nums.length) return 0;
  var sum = 0;
  for (var i = 0; i < nums.length; i++) sum += nums[i];
  return sum / nums.length;
}

function _newSecondBucket(secIndex) {
  return {
    sec: secIndex,
    frameMs: [],
    steps: [],
    backlogs: [],
    spikesGt33: 0,
    spikesGt50: 0,
    droppedCatchup: 0,
    longTasks: 0,
    drawCalls: [],
    lines: [],
    faces: [],
    profileSums: {}
  };
}

function _ensureSecondBucket() {
  if (_sec) return;
  _sec = _newSecondBucket(_secIndex);
}

function _deviceInfo() {
  var ua = navigator.userAgent || '';
  var platform = /iPhone|iPad|iPod/i.test(ua) ? 'iOS'
    : /Android/i.test(ua) ? 'Android'
      : 'Desktop';
  return {
    platform: platform,
    ua: ua,
    dpr: window.devicePixelRatio || 1,
    viewport: window.innerWidth + 'x' + window.innerHeight,
    cores: navigator.hardwareConcurrency || null,
    memoryGb: navigator.deviceMemory || null,
    touchPoints: navigator.maxTouchPoints || 0
  };
}

function _profileFromSums(profileSums, frameCount) {
  var out = {};
  var total = 0;
  var n = Math.max(1, frameCount || 1);
  for (var i = 0; i < _PROF_ORDER.length; i++) {
    var key = _PROF_ORDER[i];
    var ms = (profileSums[key] || 0) / n;
    out[key] = Math.round(ms * 10) / 10;
    total += ms;
  }
  out.jsMeasuredMs = Math.round(total * 10) / 10;
  return out;
}

function _gameContext() {
  if (typeof _contextGetter === 'function') {
    try { return _contextGetter() || {}; } catch (e) { return {}; }
  }
  return {};
}

function _compactSecond(bucket) {
  var frames = bucket.frameMs.slice().sort(function (a, b) { return a - b; });
  var frameCount = frames.length;
  var profile = _profileFromSums(bucket.profileSums, frameCount);
  var jsMeasuredMs = profile.jsMeasuredMs || 0;
  delete profile.jsMeasuredMs;
  var avgFrame = _avg(bucket.frameMs);
  var pacingGapMs = Math.round(Math.max(0, avgFrame - jsMeasuredMs) * 10) / 10;
  return {
    sec: bucket.sec,
    fps: frameCount ? Math.round((frameCount / 1) * 10) / 10 : 0,
    frames: frameCount,
    frameMs: {
      avg: Math.round(avgFrame * 10) / 10,
      p95: Math.round(_percentile(frames, 95) * 10) / 10,
      max: Math.round((frameCount ? frames[frameCount - 1] : 0) * 10) / 10
    },
    spikes: { gt33: bucket.spikesGt33, gt50: bucket.spikesGt50 },
    logic: {
      stepsAvg: Math.round(_avg(bucket.steps) * 100) / 100,
      stepsMax: bucket.steps.length ? Math.max.apply(null, bucket.steps) : 0,
      backlogMax: Math.round((bucket.backlogs.length ? Math.max.apply(null, bucket.backlogs) : 0) * 10) / 10,
      droppedCatchup: bucket.droppedCatchup
    },
    draw: {
      callsAvg: Math.round(_avg(bucket.drawCalls)),
      linesAvg: Math.round(_avg(bucket.lines)),
      facesAvg: Math.round(_avg(bucket.faces))
    },
    scene: Object.assign({}, _scene),
    timing: {
      jsMeasuredMs: jsMeasuredMs,
      pacingGapMs: pacingGapMs,
      profile: profile
    },
    longTasks: bucket.longTasks,
    game: _gameContext()
  };
}

function _flushSecondBucket() {
  if (!_sec || !_sec.frameMs.length) {
    _sec = null;
    return;
  }
  var compact = _compactSecond(_sec);
  if (_recording && _recordedSeconds.length < _MAX_RECORD_SECONDS) {
    _recordedSeconds.push(compact);
  }
  _secIndex++;
  _sec = null;
}

function _trackFrameHitch(frameMs) {
  _live.frameMs.push(frameMs);
  if (_live.frameMs.length > _live.maxFrames) _live.frameMs.shift();
  if (frameMs > 33) {
    _live.spikesGt33++;
    if (_sec) _sec.spikesGt33++;
  }
  if (frameMs > 50) {
    _live.spikesGt50++;
    if (_sec) _sec.spikesGt50++;
  }
  var sorted = _live.frameMs.slice().sort(function (a, b) { return a - b; });
  _live.p95Ms = _percentile(sorted, 95);
  _live.maxMs = sorted.length ? sorted[sorted.length - 1] : 0;
}

function _resetLiveWindow() {
  _live.frameMs = [];
  _live.spikesGt33 = 0;
  _live.spikesGt50 = 0;
  _live.logicStepsMax = 0;
  _live.backlogMax = 0;
  _live.droppedCatchup = 0;
  _live.p95Ms = 0;
  _live.maxMs = 0;
  _live.windowStartPerf = _nowPerf();
}

function _initLongTaskObserver() {
  if (typeof PerformanceObserver === 'undefined') return;
  try {
    var obs = new PerformanceObserver(function (list) {
      var entries = list.getEntries();
      _longTaskTotal += entries.length;
      if (_sec) _sec.longTasks += entries.length;
    });
    obs.observe({ entryTypes: ['longtask'] });
  } catch (e) { /* Safari may not support longtask */ }
}

_initLongTaskObserver();

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

export function statsRecordFrameMeta(meta) {
  if (!_diagMode && !_recording) return;
  _ensureSecondBucket();
  var steps = meta && meta.logicSteps != null ? meta.logicSteps : 0;
  var backlog = meta && meta.backlogMs != null ? meta.backlogMs : 0;
  _sec.steps.push(steps);
  _sec.backlogs.push(backlog);
  if (steps > _live.logicStepsMax) _live.logicStepsMax = steps;
  if (backlog > _live.backlogMax) _live.backlogMax = backlog;
  if (meta && meta.droppedCatchup) {
    _live.droppedCatchup++;
    _sec.droppedCatchup++;
  }
}

export function statsSetRuntimeContextGetter(fn) {
  _contextGetter = fn;
}

export function statsGetDiagnosticMode() {
  return _diagMode;
}

export function statsSetDiagnosticMode(on) {
  _diagMode = !!on;
  if (_panelEl) {
    _panelEl.classList.toggle('perf-diag', _diagMode);
    _panelEl.classList.toggle('perf-recording', _recording);
  }
}

export function statsIsRecording() {
  return _recording;
}

export function statsGetRecordedSecondCount() {
  return _recordedSeconds.length;
}

export function statsStartRecording() {
  if (_recording) return false;
  _recording = true;
  _recordingStartedAt = new Date().toISOString();
  _recordedSeconds = [];
  _secIndex = 0;
  _sec = null;
  _longTaskTotal = 0;
  _resetLiveWindow();
  statsSetDiagnosticMode(true);
  _diagModeAtStart = true;
  statsSetPanelVisible(true, false);
  if (_panelEl) _panelEl.classList.add('perf-recording');
  return true;
}

export function statsStopRecording() {
  if (!_recording) return false;
  _flushSecondBucket();
  _recording = false;
  if (_panelEl) _panelEl.classList.remove('perf-recording');
  return true;
}

export function statsClearRecording() {
  _recordedSeconds = [];
  _secIndex = 0;
  _sec = null;
  _recordingStartedAt = null;
  _resetLiveWindow();
}

function _buildSummary(seconds) {
  var fpsVals = [];
  var spike33 = 0;
  var spike50 = 0;
  var frameMax = 0;
  var worstSec = null;
  var statesSeen = {};
  var levelLabels = {};
  for (var i = 0; i < seconds.length; i++) {
    var row = seconds[i];
    fpsVals.push(row.fps || 0);
    spike33 += row.spikes.gt33 || 0;
    spike50 += row.spikes.gt50 || 0;
    if ((row.frameMs.max || 0) > frameMax) {
      frameMax = row.frameMs.max;
      worstSec = row.sec;
    }
    var g = row.game || {};
    if (g.state) statesSeen[g.state] = true;
    if (g.levelLabel) levelLabels[g.levelLabel] = true;
  }
  var stateList = Object.keys(statesSeen);
  var levelList = Object.keys(levelLabels);
  return {
    fpsAvg: fpsVals.length ? Math.round(_avg(fpsVals) * 10) / 10 : 0,
    fpsMin: fpsVals.length ? Math.min.apply(null, fpsVals) : 0,
    spikeGt33Total: spike33,
    spikeGt50Total: spike50,
    frameMsMax: frameMax,
    worstSec: worstSec,
    statesSeen: stateList,
    levelsSeen: levelList
  };
}

export function statsBuildExportPackage() {
  if (_recording) _flushSecondBucket();
  var seconds = _recordedSeconds.slice();
  return {
    format: 'spider-web-perf/v2',
    exportedAt: new Date().toISOString(),
    durationSec: seconds.length,
    truncated: seconds.length >= _MAX_RECORD_SECONDS,
    notes: {
      pacingGapMs: 'Frame interval minus measured JS work; mostly vsync wait at 60Hz, not GPU load.',
      timingProfile: 'Per-second average of instrumented JS sections (not EMA).',
      game: 'Snapshot at end of each second: level, wave phase, prey breakdown, flags.'
    },
    device: _deviceInfo(),
    session: {
      startedAt: _recordingStartedAt,
      diagnosticModeAtStart: _diagModeAtStart,
      diagnosticModeAtExport: _diagMode,
      longTasksTotal: _longTaskTotal
    },
    summary: _buildSummary(seconds),
    seconds: seconds
  };
}

export function statsDownloadExportPackage() {
  var pkg = statsBuildExportPackage();
  if (!pkg.seconds.length) return { ok: false, reason: 'empty' };
  var blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var stamp = new Date().toISOString().replace(/[:.]/g, '-');
  var a = document.createElement('a');
  a.href = url;
  a.download = 'spider-perf-' + stamp + '.json';
  a.click();
  URL.revokeObjectURL(url);
  return { ok: true, seconds: pkg.seconds.length };
}

export async function statsCopyExportPackage() {
  var pkg = statsBuildExportPackage();
  if (!pkg.seconds.length) return { ok: false, reason: 'empty' };
  var text = JSON.stringify(pkg);
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return { ok: true, bytes: text.length, mode: 'clipboard' };
    }
  } catch (e) { /* fall through */ }
  return statsDownloadExportPackage();
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

  if (_diagMode || _recording) {
    _trackFrameHitch(dt);
    _ensureSecondBucket();
    if (_sec._startedAt == null) _sec._startedAt = _nowPerf();
    _sec.frameMs.push(dt);
    _sec.drawCalls.push(_frame.drawCalls);
    _sec.lines.push(_frame.lines);
    _sec.faces.push(statsFaces());
    for (var si = 0; si < _PROF_ORDER.length; si++) {
      var sk = _PROF_ORDER[si];
      _sec.profileSums[sk] = (_sec.profileSums[sk] || 0) + (_prof.frame[sk] || 0);
    }
    if (_nowPerf() - _sec._startedAt >= 1000) {
      _flushSecondBucket();
    }
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
  lines.push(_padLabel(_prof.labels.pacing, 10) + _padMs(gap) + '    —');
  lines.push('(pacing gap ≈ vsync wait, not GPU)');
  return lines;
}

function _diagHeaderLines() {
  var dev = _deviceInfo();
  var game = _gameContext();
  var lvl = game.levelLabel || (game.level != null ? ('L' + (game.level + 1)) : 'L?');
  var wave = game.waveLabel || (game.wave != null ? ('W' + (game.wave + 1)) : 'W?');
  var rec = _recording ? ('REC ' + _recordedSeconds.length + 's') : 'REC off';
  var phase = game.wavePhase ? String(game.wavePhase).replace('WAVE_', '') : '—';
  var prey = game.preyByKind
    ? (' B' + (game.preyByKind.boulder || 0) + '/g' + (game.preyByKind.bug || 0)
      + '/d' + (game.preyByKind.drop || 0) + '/p' + (game.preyByKind.poop || 0))
    : '';
  var flags = game.flags || {};
  var flagTxt = [
    flags.wrapping ? 'wrap' : '',
    flags.poopStun ? 'poop' : '',
    flags.bulletTime ? 'bullet' : '',
    flags.spawnAnim ? 'spawn' : ''
  ].filter(Boolean).join(',');
  return [
    'now' + _padMs(_fps.ms) + ' p95' + _padMs(_live.p95Ms) + ' max' + _padMs(_live.maxMs),
    'Spk>33 ' + _live.spikesGt33 + '  >50 ' + _live.spikesGt50
      + '  stepMx ' + _live.logicStepsMax + '  bkMx' + _padMs(_live.backlogMax),
    dev.platform + ' DPR' + dev.dpr + ' ' + dev.viewport
      + (dev.cores ? (' c' + dev.cores) : ''),
    lvl + ' ' + wave + ' ' + phase + ' ' + (game.state || '—') + prey,
    (flagTxt || '—') + '  ' + rec
      + (_live.droppedCatchup ? (' drop' + _live.droppedCatchup) : '')
      + '  LT' + _longTaskTotal
  ];
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
  var lines = [
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
  ];
  if (_diagMode) lines = lines.concat(_diagHeaderLines());
  return lines.concat(statsFormatProfile());
}

var _panelEl = null;
var _panelVisible = true;

export function statsGetPanelVisible() {
  return _panelVisible;
}

export function statsSetPanelVisible(visible, persist) {
  _panelVisible = !!visible;
  if (_panelEl) _panelEl.style.display = _panelVisible ? '' : 'none';
  if (persist !== false) {
    try {
      localStorage.setItem('spiderStatsPanelVisible', _panelVisible ? '1' : '0');
    } catch (e) { }
  }
}

function _loadPanelVisiblePref() {
  try {
    if (localStorage.getItem('spiderStatsPanelVisible') === '0') _panelVisible = false;
  } catch (e) { }
}

export function statsBindPanel(el) {
  if (!el) return function () {};
  _panelEl = el;
  _loadPanelVisiblePref();
  statsSetPanelVisible(_panelVisible, false);
  statsSetDiagnosticMode(_diagMode);

  var lastPaint = -_PANEL_REFRESH_MS;
  var cachedText = '';
  return function updatePanel() {
    if (!_panelVisible) return;
    var now = performance.now();
    var refreshMs = _diagMode ? _DIAG_PANEL_REFRESH_MS : _PANEL_REFRESH_MS;
    if (now - lastPaint < refreshMs) return;
    lastPaint = now;
    var lines = statsFormatPanel();
    var text = lines.join('\n');
    if (text === cachedText) return;
    cachedText = text;
    el.textContent = text;
  };
}