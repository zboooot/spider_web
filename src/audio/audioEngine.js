/**
 * 音效引擎 — 全部用 Web Audio API 程序生成
 * 包含：5套程序化 Sylvan 环境BGM + 游戏音效
 */

var AC = null;
var _audioUnlocked = false;

/* ── BGM 状态 ── */
var masterBgmGain = null;
var masterLP = null;
var _bgmNodes = [];       // 当前运行的振荡器/增益节点
var scheduledTimers = []; // 定时器句柄（切换时清除）
var activeThemeId = null;
var isBgmPlaying = false;
var targetBgmVolume = 0.60;

/* ── 游戏音效状态 ── */
var bugBuzzNodes = {};
var MAX_BUG_BUZZ = 3;
var pickupTearLoop = null;

/* ── 5套主题ID映射关卡索引 ── */
var THEME_IDS = ['morning-jade', 'golden-autumn', 'misty-violet', 'cherry-blossom', 'midnight-lume'];

/* ══════════════════════════════════════════
   音频上下文管理
══════════════════════════════════════════ */
function getAC() {
  if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
  return AC;
}

function unlockAudio(onReady) {
  try {
    var ctx = getAC();
    if (ctx.state === 'suspended') {
      var p = ctx.resume();
      if (p && typeof p.then === 'function') {
        return p.then(function () {
          _audioUnlocked = true;
          if (onReady) onReady();
        }).catch(function () {});
      }
    }
    _audioUnlocked = true;
    if (onReady) onReady();
  } catch (e) {}
}

/* 初始化或复用 masterBgmGain → masterLP → destination 路由 */
function _ensureMasterGain() {
  if (masterBgmGain) return;
  var ctx = getAC();
  masterLP = ctx.createBiquadFilter();
  masterLP.type = 'lowpass'; masterLP.frequency.value = 3200; masterLP.Q.value = 0.5;
  masterLP.connect(ctx.destination);

  masterBgmGain = ctx.createGain();
  masterBgmGain.gain.setValueAtTime(0, ctx.currentTime);
  masterBgmGain.connect(masterLP);
}

/* ══════════════════════════════════════════
   BGM 合成辅助函数
══════════════════════════════════════════ */
function _osc(type, freq, gainVal, target) {
  var ctx = getAC();
  var osc = ctx.createOscillator();
  var g = ctx.createGain();
  osc.type = type || 'sine';
  osc.frequency.value = freq || 440;
  g.gain.setValueAtTime(0, ctx.currentTime);
  g.gain.linearRampToValueAtTime(gainVal, ctx.currentTime + 2.0);
  osc.connect(g);
  g.connect(target || masterBgmGain);
  osc.start(ctx.currentTime);
  _bgmNodes.push(osc, g);
  return { osc: osc, g: g };
}

function _breathSwell(baseFreq, count, gainVal) {
  var ctx = getAC();
  for (var i = 0; i < count; i++) {
    var freq = baseFreq * (1 + (i - count / 2) * 0.003);
    var o = _osc('sine', freq, gainVal / count, masterBgmGain);
    var lfo = ctx.createOscillator();
    var lfoG = ctx.createGain();
    lfoG.gain.value = (gainVal / count) * 0.7;
    lfo.frequency.value = 0.04 + i * 0.025;
    lfo.connect(lfoG); lfoG.connect(o.g.gain);
    lfo.start(); _bgmNodes.push(lfo, lfoG);
  }
}

function _pluck(freq, gainPeak, decaySec) {
  var ctx = getAC();
  var osc = ctx.createOscillator();
  var g = ctx.createGain();
  osc.type = 'sine'; osc.frequency.value = freq;
  var t0 = ctx.currentTime;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gainPeak, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + decaySec);
  osc.connect(g); g.connect(masterBgmGain);
  osc.start(t0); osc.stop(t0 + decaySec + 0.05);
}

function _fmBell(carrierFreq, modRatio, modDepth, gainPeak, decaySec) {
  var ctx = getAC();
  var mod = ctx.createOscillator();
  var modG = ctx.createGain();
  var car = ctx.createOscillator();
  var carG = ctx.createGain();
  mod.type = 'sine'; mod.frequency.value = carrierFreq * modRatio;
  modG.gain.setValueAtTime(modDepth * carrierFreq, ctx.currentTime);
  modG.gain.exponentialRampToValueAtTime(1, ctx.currentTime + decaySec * 0.7);
  mod.connect(modG); modG.connect(car.frequency);
  car.type = 'sine'; car.frequency.value = carrierFreq;
  var t0 = ctx.currentTime;
  carG.gain.setValueAtTime(0, t0);
  carG.gain.linearRampToValueAtTime(gainPeak, t0 + 0.01);
  carG.gain.exponentialRampToValueAtTime(0.0001, t0 + decaySec);
  car.connect(carG); carG.connect(masterBgmGain);
  mod.start(t0); car.start(t0);
  mod.stop(t0 + decaySec + 0.1); car.stop(t0 + decaySec + 0.1);
}

/* ══════════════════════════════════════════
   5套程序化 Sylvan 环境音磐
══════════════════════════════════════════ */

/* 1. 晨曦碧翠 — 《林间清晨》G大调五声，清晨古磬 */
function _startMorningJade() {
  _breathSwell(40, 3, 0.10);
  var padFreqs = [98, 147, 196, 247, 294];
  padFreqs.forEach(function (f, i) {
    _osc('sine', f,        0.048 - i * 0.006, masterBgmGain);
    _osc('sine', f * 1.002, 0.028 - i * 0.004, masterBgmGain);
  });
  var bellScale = [392, 494, 587, 659, 784];
  function sched() {
    if (!isBgmPlaying || activeThemeId !== 'morning-jade') return;
    var f = bellScale[Math.floor(Math.random() * bellScale.length)];
    _fmBell(f, 1.8, 1.2, 0.10, 5.5);
    scheduledTimers.push(setTimeout(sched, 5000 + Math.random() * 10000));
  }
  scheduledTimers.push(setTimeout(sched, 2000));
}

/* 2. 金秋枫影 — 《丰收金影》D大调三角波暖垫，原声拨弦 */
function _startGoldenAutumn() {
  _breathSwell(35, 3, 0.12);
  var padFreqs = [73.4, 110, 147, 185, 220];
  padFreqs.forEach(function (f, i) {
    _osc('triangle', f,        0.055 - i * 0.007, masterBgmGain);
    _osc('triangle', f * 1.003, 0.030 - i * 0.004, masterBgmGain);
  });
  var pluckScale = [293.7, 369.9, 440, 493.9, 587.3];
  function sched() {
    if (!isBgmPlaying || activeThemeId !== 'golden-autumn') return;
    var f = pluckScale[Math.floor(Math.random() * pluckScale.length)];
    _pluck(f, 0.15, 4.0);
    if (Math.random() < 0.3) {
      scheduledTimers.push(setTimeout(function () {
        if (isBgmPlaying && activeThemeId === 'golden-autumn') _pluck(f * 1.498, 0.08, 3.0);
      }, 320 + Math.random() * 180));
    }
    scheduledTimers.push(setTimeout(sched, 4000 + Math.random() * 10000));
  }
  scheduledTimers.push(setTimeout(sched, 2500));
}

/* 3. 幽谷蓝楹 — 《幽谷梵音》西藏铜磬A小调，悠远高空风铃 */
function _startMistyViolet() {
  _breathSwell(30, 4, 0.09);
  var bowlFreqs = [55, 82.4, 110, 165, 220];
  bowlFreqs.forEach(function (f, i) {
    _osc('sine', f,        0.062 - i * 0.009, masterBgmGain);
    _osc('sine', f * 1.002, 0.035 - i * 0.005, masterBgmGain);
  });
  var bellScale = [880, 1109, 1319, 1760];
  function sched() {
    if (!isBgmPlaying || activeThemeId !== 'misty-violet') return;
    var f = bellScale[Math.floor(Math.random() * bellScale.length)];
    _fmBell(f, 1.2, 1.0, 0.08, 7.0);
    scheduledTimers.push(setTimeout(sched, 7000 + Math.random() * 14000));
  }
  scheduledTimers.push(setTimeout(sched, 2000));
}

/* 4. 春樱盛绽 — 《春樱梵钟》D大调明亮，竖琴音瀑 */
function _startCherryBlossom() {
  _breathSwell(55, 3, 0.07);
  var padFreqs = [147, 185, 220, 294, 369.9];
  padFreqs.forEach(function (f, i) {
    _osc('sine', f,        0.050 - i * 0.007, masterBgmGain);
    _osc('sine', f * 1.002, 0.026 - i * 0.003, masterBgmGain);
  });
  _osc('sine', 587.3, 0.018, masterBgmGain);
  _osc('sine', 880, 0.012, masterBgmGain);
  var harpNotes = [1175, 987, 880, 784, 659, 587, 494, 440];
  function sched() {
    if (!isBgmPlaying || activeThemeId !== 'cherry-blossom') return;
    harpNotes.forEach(function (f, i) {
      scheduledTimers.push(setTimeout(function () {
        if (isBgmPlaying && activeThemeId === 'cherry-blossom') _pluck(f, 0.10, 2.5);
      }, i * 110));
    });
    scheduledTimers.push(setTimeout(sched, 8000 + Math.random() * 13000));
  }
  scheduledTimers.push(setTimeout(sched, 2500));
}

/* 5. 暗夜蓝杉 — 《暗夜幽蓝》C小调宇宙冷底噪，星芒纯电音 */
function _startMidnightLume() {
  _breathSwell(28, 4, 0.11);
  var padFreqs = [32.7, 65.4, 98, 155.6, 233.1];
  padFreqs.forEach(function (f, i) {
    _osc('triangle', f,        0.070 - i * 0.010, masterBgmGain);
    _osc('sine',     f * 1.002, 0.036 - i * 0.006, masterBgmGain);
  });
  var starFreqs = [1319, 1568, 1760, 2093];
  function sched() {
    if (!isBgmPlaying || activeThemeId !== 'midnight-lume') return;
    var f = starFreqs[Math.floor(Math.random() * starFreqs.length)];
    _fmBell(f, 1.1, 0.8, 0.06, 3.5);
    scheduledTimers.push(setTimeout(function () {
      if (isBgmPlaying && activeThemeId === 'midnight-lume') _fmBell(f * 0.5, 1.1, 0.8, 0.04, 2.5);
    }, 400 + Math.random() * 200));
    scheduledTimers.push(setTimeout(sched, 3000 + Math.random() * 8000));
  }
  scheduledTimers.push(setTimeout(sched, 1500));
}

/* ══════════════════════════════════════════
   停止所有BGM节点（淡出 fadeSec 秒）
══════════════════════════════════════════ */
function _stopAllBgmNodes(fadeSec) {
  var ctx = getAC();
  var now = ctx.currentTime;
  _bgmNodes.forEach(function (n) {
    if (n.gain !== undefined) {
      try {
        n.gain.cancelScheduledValues(now);
        n.gain.setValueAtTime(n.gain.value, now);
        n.gain.linearRampToValueAtTime(0, now + fadeSec);
      } catch (e) {}
    }
  });
  var toStop = _bgmNodes.slice();
  setTimeout(function () {
    toStop.forEach(function (n) {
      try { if (n.stop) n.stop(); n.disconnect(); } catch (e) {}
    });
  }, fadeSec * 1000 + 100);
  _bgmNodes = [];
  scheduledTimers.forEach(function (id) { clearTimeout(id); });
  scheduledTimers = [];
}

/* ══════════════════════════════════════════
   PUBLIC: 按关卡索引播放BGM（0-4）
══════════════════════════════════════════ */
function playLevelBGM(levelIndex) {
  try {
    var ctx = getAC();
    if (ctx.state === 'suspended') {
      if (!_audioUnlocked) return;
      ctx.resume().catch(function () {});
    }
    _ensureMasterGain();

    var themeId = THEME_IDS[Math.max(0, Math.min(THEME_IDS.length - 1, levelIndex))];
    if (isBgmPlaying && activeThemeId === themeId) return;

    if (isBgmPlaying) {
      // Crossfade：旧节点淡出后再启动新主题
      _stopAllBgmNodes(1.5);
    } else {
      // 初次启动：master gain 从0淡入
      masterBgmGain.gain.cancelScheduledValues(ctx.currentTime);
      masterBgmGain.gain.setValueAtTime(0, ctx.currentTime);
      masterBgmGain.gain.linearRampToValueAtTime(targetBgmVolume, ctx.currentTime + 2.5);
    }

    isBgmPlaying = true;
    activeThemeId = themeId;

    // 稍微延迟以避免与旧节点停止冲突
    var startDelay = isBgmPlaying ? 900 : 0;
    scheduledTimers.push(setTimeout(function () {
      if (!isBgmPlaying || activeThemeId !== themeId) return;
      if (themeId === 'morning-jade')    _startMorningJade();
      else if (themeId === 'golden-autumn')  _startGoldenAutumn();
      else if (themeId === 'misty-violet')   _startMistyViolet();
      else if (themeId === 'cherry-blossom') _startCherryBlossom();
      else if (themeId === 'midnight-lume')  _startMidnightLume();
    }, startDelay));
  } catch (e) {}
}

function startBGM() {
  playLevelBGM(0);
}

function stopBGM() {
  try {
    isBgmPlaying = false;
    activeThemeId = null;
    if (masterBgmGain) {
      var ctx = getAC();
      masterBgmGain.gain.cancelScheduledValues(ctx.currentTime);
      masterBgmGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.5);
    }
    _stopAllBgmNodes(1.5);
  } catch (e) {}
}

/* ══════════════════════════════════════════
   以下为原游戏音效（保留完整实现）
══════════════════════════════════════════ */

function makeOscGain(type, freq, gainVal, dest) {
  var ctx = getAC();
  var osc = ctx.createOscillator();
  var g = ctx.createGain();
  osc.type = type || 'sine';
  osc.frequency.value = freq || 440;
  g.gain.value = gainVal || 0.2;
  osc.connect(g);
  g.connect(dest || ctx.destination);
  return { osc: osc, gain: g, ctx: ctx };
}

function playSfxFootstep() {
  try {
    var ctx = getAC();
    var buf = ctx.createBuffer(1, ctx.sampleRate * 0.04, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < d.length; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3) * 0.6;
    }
    var src = ctx.createBufferSource(); src.buffer = buf;
    var g = ctx.createGain(); g.gain.value = 0.22;
    src.connect(g); g.connect(ctx.destination);
    src.start();
  } catch (e) {}
}

function playSfxLand(kind) {
  try {
    var ctx = getAC();
    var freq = (kind === 'boulder' || kind === 'poop') ? 160 : kind === 'bug' ? 280 : 120;
    var n = makeOscGain('sine', freq, 0.25);
    n.osc.frequency.exponentialRampToValueAtTime(freq * 0.4, ctx.currentTime + 0.18);
    n.gain.gain.setValueAtTime(0.25, ctx.currentTime);
    n.gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
    n.osc.start(ctx.currentTime); n.osc.stop(ctx.currentTime + 0.22);
  } catch (e) {}
}

function playSfxEscape() {
  try {
    var ctx = getAC();
    var now = ctx.currentTime;
    var guzhengFreqs = [587, 659, 698, 784, 880];
    var base = guzhengFreqs[Math.floor(Math.random() * guzhengFreqs.length)];

    var harmonics = [1, 2, 3, 4, 6];
    var harmGains = [0.55, 0.30, 0.18, 0.10, 0.05];
    for (var hi = 0; hi < harmonics.length; hi++) {
      var osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = base * harmonics[hi];
      var g = ctx.createGain();
      g.gain.setValueAtTime(harmGains[hi], now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.10 + hi * 0.008);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.12 + hi * 0.01);
    }

    var clickLen = Math.floor(ctx.sampleRate * 0.006);
    var clickBuf = ctx.createBuffer(1, clickLen, ctx.sampleRate);
    var cd = clickBuf.getChannelData(0);
    for (var ci = 0; ci < clickLen; ci++) {
      cd[ci] = (Math.random() * 2 - 1) * Math.pow(1 - ci / clickLen, 3);
    }
    var clickSrc = ctx.createBufferSource(); clickSrc.buffer = clickBuf;
    var bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = 3500; bp.Q.value = 0.8;
    var clickG = ctx.createGain(); clickG.gain.value = 0.45;
    clickSrc.connect(bp); bp.connect(clickG); clickG.connect(ctx.destination);
    clickSrc.start(now);

    var snapLen = Math.floor(ctx.sampleRate * 0.012);
    var snapBuf = ctx.createBuffer(1, snapLen, ctx.sampleRate);
    var sd = snapBuf.getChannelData(0);
    for (var si = 0; si < snapLen; si++) {
      sd[si] = (Math.random() * 2 - 1) * Math.exp(-si / snapLen * 15) * 0.8;
    }
    var snapSrc = ctx.createBufferSource(); snapSrc.buffer = snapBuf;
    var snapHP = ctx.createBiquadFilter(); snapHP.type = 'highpass'; snapHP.frequency.value = 3000;
    var snapG = ctx.createGain(); snapG.gain.value = 0.55;
    snapSrc.connect(snapHP); snapHP.connect(snapG); snapG.connect(ctx.destination);
    snapSrc.start(now + 0.002);
  } catch (e) {}
}

function startBugBuzz(oi) {
  if (bugBuzzNodes[oi]) return;
  if (Object.keys(bugBuzzNodes).length >= MAX_BUG_BUZZ) return;
  try {
    var ctx = getAC();
    var osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 180 + Math.random() * 40;
    var g = ctx.createGain(); g.gain.value = 0.008;
    var lfo = ctx.createOscillator();
    lfo.frequency.value = 24 + Math.random() * 8;
    var lfog = ctx.createGain(); lfog.gain.value = 22;
    lfo.connect(lfog); lfog.connect(osc.frequency);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(); lfo.start();
    bugBuzzNodes[oi] = { osc: osc, gain: g, lfo: lfo };
  } catch (e) {}
}

function stopBugBuzz(oi) {
  var n = bugBuzzNodes[oi];
  if (!n) return;
  try {
    n.gain.gain.setTargetAtTime(0, getAC().currentTime, 0.05);
    setTimeout(function () { try { n.osc.stop(); n.lfo.stop(); } catch (e) {} }, 200);
  } catch (e) {}
  delete bugBuzzNodes[oi];
}

function stopAllBugBuzz() {
  for (var k in bugBuzzNodes) stopBugBuzz(k);
}

function playSfxWrap(progress) {
  try {
    var ctx = getAC();
    var freq = 200 + progress * 300;
    var n = makeOscGain('triangle', freq, 0.08);
    n.osc.frequency.exponentialRampToValueAtTime(freq * 1.3, ctx.currentTime + 0.06);
    n.gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.07);
    n.osc.start(ctx.currentTime); n.osc.stop(ctx.currentTime + 0.07);
  } catch (e) {}
}

function playCollectSound(kind) {
  try {
    var ctx = getAC();
    if (kind === 'drop') {
      var now = ctx.currentTime;
      var len = Math.floor(ctx.sampleRate * 0.055);
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) {
        var t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.1) * 0.18;
      }
      var src = ctx.createBufferSource();
      src.buffer = buf;
      var hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1400;
      var bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2400;
      bp.Q.value = 0.8;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(0.11, now + 0.006);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.065);
      src.connect(hp); hp.connect(bp); bp.connect(g); g.connect(ctx.destination);
      src.start(now);

      var whisper = makeOscGain('triangle', 860, 0.028);
      whisper.osc.frequency.setValueAtTime(860, now);
      whisper.osc.frequency.exponentialRampToValueAtTime(620, now + 0.05);
      whisper.gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
      whisper.osc.start(now); whisper.osc.stop(now + 0.07);
      return;
    }
    var freq = kind === 'boulder' ? 520 : kind === 'bug' ? 720 : 440;
    var n = makeOscGain('sine', freq, 0.22);
    n.osc.frequency.exponentialRampToValueAtTime(freq * 1.7, ctx.currentTime + 0.1);
    n.gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
    n.osc.start(ctx.currentTime); n.osc.stop(ctx.currentTime + 0.22);
    var n2 = makeOscGain('triangle', freq * 2, 0.08);
    n2.osc.frequency.exponentialRampToValueAtTime(freq * 3, ctx.currentTime + 0.12);
    n2.gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    n2.osc.start(ctx.currentTime); n2.osc.stop(ctx.currentTime + 0.15);
  } catch (e) {}
}

function _createNoiseBuffer(durationSec) {
  var ctx = getAC();
  var len = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
  var buf = ctx.createBuffer(1, len, ctx.sampleRate);
  var d = buf.getChannelData(0);
  for (var i = 0; i < len; i++) {
    d[i] = (Math.random() * 2 - 1) * 0.5;
  }
  return buf;
}

function startPickupTearLoop() {
  try {
    if (pickupTearLoop) return;
    var ctx = getAC();
    var now = ctx.currentTime;
    var src = ctx.createBufferSource();
    src.buffer = _createNoiseBuffer(0.18);
    src.loop = true;

    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 110;
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 620;
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 280;
    bp.Q.value = 0.95;
    var trem = ctx.createGain();
    trem.gain.value = 0.001;

    var wood = ctx.createBiquadFilter();
    wood.type = 'bandpass';
    wood.frequency.value = 220;
    wood.Q.value = 1.2;
    var woodGain = ctx.createGain();
    woodGain.gain.value = 0.001;

    var body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.value = 70;
    var bodyGain = ctx.createGain();
    bodyGain.gain.value = 0.001;

    var cello = ctx.createOscillator();
    cello.type = 'sine';
    cello.frequency.value = 50;
    var celloGain = ctx.createGain();
    celloGain.gain.value = 0.001;

    var tension = ctx.createOscillator();
    tension.type = 'triangle';
    tension.frequency.value = 116;
    var tensionGain = ctx.createGain();
    tensionGain.gain.value = 0.001;

    var air = ctx.createOscillator();
    air.type = 'triangle';
    air.frequency.value = 156;
    var airGain = ctx.createGain();
    airGain.gain.value = 0.001;

    var scrape = ctx.createOscillator();
    scrape.type = 'sine';
    scrape.frequency.value = 228;
    var scrapeGain = ctx.createGain();
    scrapeGain.gain.value = 0.001;

    var wobble = ctx.createOscillator();
    wobble.type = 'sine';
    wobble.frequency.value = 0.62;
    var wobbleGain = ctx.createGain();
    wobbleGain.gain.value = 10;

    var shiver = ctx.createOscillator();
    shiver.type = 'sine';
    shiver.frequency.value = 1.3;
    var shiverGain = ctx.createGain();
    shiverGain.gain.value = 0.001;

    var bowPulse = ctx.createOscillator();
    bowPulse.type = 'triangle';
    bowPulse.frequency.value = 0.58;
    var bowPulseGain = ctx.createGain();
    bowPulseGain.gain.value = 0.0;

    var bite = ctx.createOscillator();
    bite.type = 'sine';
    bite.frequency.value = 2.2;
    var biteGain = ctx.createGain();
    biteGain.gain.value = 0.0;

    wobble.connect(wobbleGain); wobbleGain.connect(bp.frequency);
    shiver.connect(shiverGain); shiverGain.connect(trem.gain);
    bowPulse.connect(bowPulseGain); bowPulseGain.connect(bodyGain.gain);
    bowPulse.connect(bowPulseGain); bowPulseGain.connect(tensionGain.gain);
    bite.connect(biteGain); biteGain.connect(trem.gain);
    bite.connect(biteGain); biteGain.connect(tensionGain.gain);

    src.connect(hp); hp.connect(lp); lp.connect(bp); bp.connect(trem); trem.connect(ctx.destination);
    bp.connect(wood); wood.connect(woodGain); woodGain.connect(ctx.destination);
    body.connect(bodyGain); bodyGain.connect(ctx.destination);
    cello.connect(celloGain); celloGain.connect(ctx.destination);
    tension.connect(tensionGain); tensionGain.connect(ctx.destination);
    air.connect(airGain); airGain.connect(ctx.destination);
    scrape.connect(scrapeGain); scrapeGain.connect(ctx.destination);

    trem.gain.setValueAtTime(0.001, now);
    bodyGain.gain.setValueAtTime(0.001, now);
    celloGain.gain.setValueAtTime(0.001, now);
    tensionGain.gain.setValueAtTime(0.001, now);
    airGain.gain.setValueAtTime(0.001, now);
    woodGain.gain.setValueAtTime(0.001, now);
    scrapeGain.gain.setValueAtTime(0.001, now);
    src.start(now);
    body.start(now);
    cello.start(now);
    tension.start(now);
    air.start(now);
    scrape.start(now);
    wobble.start(now);
    shiver.start(now);
    bowPulse.start(now);
    bite.start(now);

    pickupTearLoop = {
      src: src,
      hp: hp,
      lp: lp,
      bp: bp,
      trem: trem,
      body: body,
      bodyGain: bodyGain,
      cello: cello,
      celloGain: celloGain,
      tension: tension,
      tensionGain: tensionGain,
      air: air,
      airGain: airGain,
      wood: wood,
      woodGain: woodGain,
      scrape: scrape,
      scrapeGain: scrapeGain,
      wobble: wobble,
      wobbleGain: wobbleGain,
      shiver: shiver,
      shiverGain: shiverGain,
      bowPulse: bowPulse,
      bowPulseGain: bowPulseGain,
      bite: bite,
      biteGain: biteGain
    };
  } catch (e) {}
}

function updatePickupTearLoop(intensity) {
  try {
    if (!pickupTearLoop) startPickupTearLoop();
    if (!pickupTearLoop) return;
    var ctx = getAC();
    var now = ctx.currentTime;
    var t = Math.max(0, Math.min(1, intensity || 0));
    pickupTearLoop.lp.frequency.setTargetAtTime(360 + t * 220, now, 0.09);
    pickupTearLoop.bp.frequency.setTargetAtTime(205 + t * 82, now, 0.08);
    pickupTearLoop.bp.Q.setTargetAtTime(0.8 + t * 0.8, now, 0.06);
    pickupTearLoop.wood.frequency.setTargetAtTime(190 + t * 36, now, 0.07);
    pickupTearLoop.wood.Q.setTargetAtTime(1.0 + t * 0.8, now, 0.07);
    pickupTearLoop.trem.gain.setTargetAtTime(0.0018 + t * 0.022, now, 0.06);
    pickupTearLoop.body.frequency.setTargetAtTime(66 + t * 10, now, 0.09);
    pickupTearLoop.bodyGain.gain.setTargetAtTime(0.011 + t * 0.036, now, 0.09);
    pickupTearLoop.cello.frequency.setTargetAtTime(48 + t * 6, now, 0.09);
    pickupTearLoop.celloGain.gain.setTargetAtTime(0.015 + t * 0.042, now, 0.09);
    pickupTearLoop.tension.frequency.setTargetAtTime(110 + t * 15, now, 0.08);
    pickupTearLoop.tensionGain.gain.setTargetAtTime(0.0022 + t * 0.009, now, 0.08);
    pickupTearLoop.air.frequency.setTargetAtTime(150 + t * 16, now, 0.08);
    pickupTearLoop.airGain.gain.setTargetAtTime(0.0012 + t * 0.004, now, 0.07);
    pickupTearLoop.woodGain.gain.setTargetAtTime(0.007 + t * 0.018, now, 0.08);
    pickupTearLoop.scrape.frequency.setTargetAtTime(214 + t * 14, now, 0.08);
    pickupTearLoop.scrapeGain.gain.setTargetAtTime(0.0008 + t * 0.0035, now, 0.07);
    pickupTearLoop.wobble.frequency.setTargetAtTime(0.45 + t * 0.38, now, 0.11);
    pickupTearLoop.wobbleGain.gain.setTargetAtTime(7 + t * 9, now, 0.11);
    pickupTearLoop.shiver.frequency.setTargetAtTime(0.9 + t * 0.8, now, 0.10);
    pickupTearLoop.shiverGain.gain.setTargetAtTime(0.00035 + t * 0.0014, now, 0.08);
    pickupTearLoop.bowPulse.frequency.setTargetAtTime(0.42 + t * 0.24, now, 0.14);
    pickupTearLoop.bowPulseGain.gain.setTargetAtTime(0.006 + t * 0.014, now, 0.12);
    pickupTearLoop.bite.frequency.setTargetAtTime(1.2 + t * 0.6, now, 0.10);
    pickupTearLoop.biteGain.gain.setTargetAtTime(0.0007 + t * 0.0035, now, 0.08);
  } catch (e) {}
}

function stopPickupTearLoop() {
  if (!pickupTearLoop) return;
  try {
    var ctx = getAC();
    var now = ctx.currentTime;
    var loop = pickupTearLoop;
    loop.trem.gain.cancelScheduledValues(now);
    loop.trem.gain.setValueAtTime(loop.trem.gain.value, now);
    loop.trem.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    loop.bodyGain.gain.cancelScheduledValues(now);
    loop.bodyGain.gain.setValueAtTime(loop.bodyGain.gain.value, now);
    loop.bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    loop.celloGain.gain.cancelScheduledValues(now);
    loop.celloGain.gain.setValueAtTime(loop.celloGain.gain.value, now);
    loop.celloGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    loop.tensionGain.gain.cancelScheduledValues(now);
    loop.tensionGain.gain.setValueAtTime(loop.tensionGain.gain.value, now);
    loop.tensionGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    loop.airGain.gain.cancelScheduledValues(now);
    loop.airGain.gain.setValueAtTime(loop.airGain.gain.value, now);
    loop.airGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    loop.woodGain.gain.cancelScheduledValues(now);
    loop.woodGain.gain.setValueAtTime(loop.woodGain.gain.value, now);
    loop.woodGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    loop.scrapeGain.gain.cancelScheduledValues(now);
    loop.scrapeGain.gain.setValueAtTime(loop.scrapeGain.gain.value, now);
    loop.scrapeGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    setTimeout(function () {
      try { loop.src.stop(); } catch (e) {}
      try { loop.body.stop(); } catch (e) {}
      try { loop.cello.stop(); } catch (e) {}
      try { loop.tension.stop(); } catch (e) {}
      try { loop.air.stop(); } catch (e) {}
      try { loop.scrape.stop(); } catch (e) {}
      try { loop.wobble.stop(); } catch (e) {}
      try { loop.shiver.stop(); } catch (e) {}
      try { loop.bowPulse.stop(); } catch (e) {}
      try { loop.bite.stop(); } catch (e) {}
      try { loop.src.disconnect(); loop.body.disconnect(); loop.cello.disconnect(); loop.tension.disconnect(); loop.air.disconnect(); loop.wood.disconnect(); loop.scrape.disconnect(); loop.wobble.disconnect(); loop.shiver.disconnect(); loop.bowPulse.disconnect(); loop.bite.disconnect(); } catch (e) {}
    }, 120);
  } catch (e) {}
  pickupTearLoop = null;
}

function playSfxPluckSnap() {
  try {
    var ctx = getAC();
    var now = ctx.currentTime;
    var clickLen = Math.floor(ctx.sampleRate * 0.008);
    var clickBuf = ctx.createBuffer(1, clickLen, ctx.sampleRate);
    var cd = clickBuf.getChannelData(0);
    for (var i = 0; i < clickLen; i++) {
      cd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / clickLen, 2.8);
    }
    var click = ctx.createBufferSource();
    click.buffer = clickBuf;
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2600;
    var g = ctx.createGain();
    g.gain.value = 0.42;
    click.connect(hp); hp.connect(g); g.connect(ctx.destination);
    click.start(now);

    var ping = makeOscGain('triangle', 1180, 0.095);
    ping.osc.frequency.setValueAtTime(1180, now);
    ping.osc.frequency.exponentialRampToValueAtTime(760, now + 0.09);
    ping.gain.gain.setValueAtTime(0.095, now);
    ping.gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    ping.osc.start(now); ping.osc.stop(now + 0.11);
  } catch (e) {}
}

function playSfxPoopBurst() {
  try {
    var ctx = getAC();
    var now = ctx.currentTime;

    var len = Math.floor(ctx.sampleRate * 0.36);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) {
      var t = i / len;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 1.95) * 0.44;
    }
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 560;
    lp.Q.value = 0.9;
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 65;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.18, now + 0.014);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
    src.connect(lp); lp.connect(hp); hp.connect(g); g.connect(ctx.destination);
    src.start(now);

    var toot = makeOscGain('triangle', 132, 0.11);
    toot.osc.frequency.setValueAtTime(132, now);
    toot.osc.frequency.linearRampToValueAtTime(112, now + 0.05);
    toot.osc.frequency.linearRampToValueAtTime(118, now + 0.10);
    toot.osc.frequency.exponentialRampToValueAtTime(72, now + 0.24);
    toot.gain.gain.setValueAtTime(0.001, now);
    toot.gain.gain.linearRampToValueAtTime(0.11, now + 0.012);
    toot.gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
    toot.osc.start(now); toot.osc.stop(now + 0.28);

    var wobble = ctx.createOscillator();
    var wobbleGain = ctx.createGain();
    wobble.type = 'sine';
    wobble.frequency.value = 16;
    wobbleGain.gain.value = 12;
    wobble.connect(wobbleGain); wobbleGain.connect(toot.osc.frequency);
    wobble.start(now); wobble.stop(now + 0.18);

    var tail = makeOscGain('sine', 86, 0.045);
    tail.osc.frequency.exponentialRampToValueAtTime(58, now + 0.18);
    tail.gain.gain.setValueAtTime(0.001, now + 0.03);
    tail.gain.gain.linearRampToValueAtTime(0.045, now + 0.06);
    tail.gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    tail.osc.start(now + 0.03); tail.osc.stop(now + 0.24);
  } catch (e) {}
}

function playSfxSuccess() {
  try {
    var ctx = getAC();
    var notes = [523, 659, 784, 1047];
    notes.forEach(function (f, i) {
      var n = makeOscGain('sine', f, 0.25);
      var t = ctx.currentTime + i * 0.12;
      n.gain.gain.setValueAtTime(0, t);
      n.gain.gain.linearRampToValueAtTime(0.25, t + 0.05);
      n.gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      n.osc.start(t); n.osc.stop(t + 0.35);
    });
  } catch (e) {}
}

function playSfxGameOver() {
  try {
    var ctx = getAC();
    var n = makeOscGain('sawtooth', 220, 0.3);
    n.osc.frequency.exponentialRampToValueAtTime(55, ctx.currentTime + 0.8);
    n.gain.gain.setValueAtTime(0.3, ctx.currentTime);
    n.gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.9);
    n.osc.start(ctx.currentTime); n.osc.stop(ctx.currentTime + 0.9);
    var buf = ctx.createBuffer(1, ctx.sampleRate * 0.15, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / d.length * 6) * 0.5;
    var src = ctx.createBufferSource(); src.buffer = buf;
    var g = ctx.createGain(); g.gain.value = 0.35;
    src.connect(g); g.connect(ctx.destination); src.start();
  } catch (e) {}
}

function playSfxStoneFall() {
  try {
    var ctx = getAC();
    var now = ctx.currentTime;
    var rumble = makeOscGain('triangle', 118, 0.08);
    rumble.osc.frequency.setValueAtTime(118, now);
    rumble.osc.frequency.exponentialRampToValueAtTime(62, now + 0.24);
    rumble.gain.gain.setValueAtTime(0.001, now);
    rumble.gain.gain.linearRampToValueAtTime(0.08, now + 0.03);
    rumble.gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    rumble.osc.start(now); rumble.osc.stop(now + 0.3);
  } catch (e) {}
}

function playSfxWebBreak() {
  try {
    var ctx = getAC();
    var now = ctx.currentTime;
    var len = Math.floor(ctx.sampleRate * 0.12);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) {
      var t = i / len;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.4) * 0.7;
    }
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 960;
    bp.Q.value = 0.7;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.26, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    src.connect(bp); bp.connect(g); g.connect(ctx.destination);
    src.start(now);
  } catch (e) {}
}

function playSfxTutorialPrompt() {
  try {
    var ctx = getAC();
    var now = ctx.currentTime;
    var a = makeOscGain('sine', 740, 0.06);
    a.gain.gain.setValueAtTime(0.001, now);
    a.gain.gain.linearRampToValueAtTime(0.06, now + 0.012);
    a.gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    a.osc.start(now); a.osc.stop(now + 0.18);
    var b = makeOscGain('triangle', 1040, 0.04);
    b.gain.gain.setValueAtTime(0.001, now + 0.03);
    b.gain.gain.linearRampToValueAtTime(0.04, now + 0.05);
    b.gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    b.osc.start(now + 0.03); b.osc.stop(now + 0.22);
  } catch (e) {}
}

function playSfxRepairConnect() {
  try {
    var ctx = getAC();
    var now = ctx.currentTime;
    var a = makeOscGain('triangle', 620, 0.08);
    a.gain.gain.setValueAtTime(0.001, now);
    a.gain.gain.linearRampToValueAtTime(0.08, now + 0.01);
    a.gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    a.osc.frequency.setValueAtTime(620, now);
    a.osc.frequency.exponentialRampToValueAtTime(880, now + 0.09);
    a.osc.start(now); a.osc.stop(now + 0.13);
  } catch (e) {}
}

function playSfxRepairComplete() {
  try {
    var ctx = getAC();
    var now = ctx.currentTime;
    var freqs = [520, 660, 880];
    for (var i = 0; i < freqs.length; i++) {
      var tone = makeOscGain('sine', freqs[i], 0.06);
      var t = now + i * 0.035;
      tone.gain.gain.setValueAtTime(0.001, t);
      tone.gain.gain.linearRampToValueAtTime(0.06, t + 0.012);
      tone.gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      tone.osc.start(t); tone.osc.stop(t + 0.19);
    }
  } catch (e) {}
}

function playSfxRepairWeave() {
  try {
    var ctx = getAC();
    var now = ctx.currentTime;
    var tone = makeOscGain('triangle', 760, 0.035);
    tone.gain.gain.setValueAtTime(0.001, now);
    tone.gain.gain.linearRampToValueAtTime(0.035, now + 0.008);
    tone.gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    tone.osc.frequency.setValueAtTime(760, now);
    tone.osc.frequency.exponentialRampToValueAtTime(980, now + 0.06);
    tone.osc.start(now); tone.osc.stop(now + 0.09);
  } catch (e) {}
}

function playSfxCry() {
  try {
    var ctx = getAC();
    var now = ctx.currentTime;
    var a = makeOscGain('triangle', 520, 0.045);
    a.gain.gain.setValueAtTime(0.001, now);
    a.gain.gain.linearRampToValueAtTime(0.045, now + 0.01);
    a.gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    a.osc.frequency.setValueAtTime(520, now);
    a.osc.frequency.exponentialRampToValueAtTime(410, now + 0.14);
    a.osc.start(now); a.osc.stop(now + 0.17);

    var b = makeOscGain('sine', 760, 0.026);
    b.gain.gain.setValueAtTime(0.001, now + 0.03);
    b.gain.gain.linearRampToValueAtTime(0.026, now + 0.05);
    b.gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    b.osc.frequency.setValueAtTime(760, now + 0.03);
    b.osc.frequency.exponentialRampToValueAtTime(620, now + 0.16);
    b.osc.start(now + 0.03); b.osc.stop(now + 0.19);
  } catch (e) {}
}

/* ══════════════════════════════════════════
   统一导出
══════════════════════════════════════════ */
function setVolume(v) {
  try {
    targetBgmVolume = Math.max(0, Math.min(1, v));
    if (masterBgmGain) {
      var ctx = getAC();
      masterBgmGain.gain.cancelScheduledValues(ctx.currentTime);
      masterBgmGain.gain.setValueAtTime(masterBgmGain.gain.value, ctx.currentTime);
      masterBgmGain.gain.linearRampToValueAtTime(targetBgmVolume, ctx.currentTime + 0.3);
    }
  } catch (e) {}
}

export var audioEngine = {
  getAC: getAC,
  unlockAudio: unlockAudio,
  startBGM: startBGM,
  stopBGM: stopBGM,
  playLevelBGM: playLevelBGM,
  setVolume: setVolume,
  playSfxFootstep: playSfxFootstep,
  playSfxLand: playSfxLand,
  playSfxEscape: playSfxEscape,
  startBugBuzz: startBugBuzz,
  stopBugBuzz: stopBugBuzz,
  stopAllBugBuzz: stopAllBugBuzz,
  playSfxWrap: playSfxWrap,
  playCollectSound: playCollectSound,
  startPickupTearLoop: startPickupTearLoop,
  updatePickupTearLoop: updatePickupTearLoop,
  stopPickupTearLoop: stopPickupTearLoop,
  playSfxPluckSnap: playSfxPluckSnap,
  playSfxPoopBurst: playSfxPoopBurst,
  playSfxSuccess: playSfxSuccess,
  playSfxGameOver: playSfxGameOver,
  playSfxStoneFall: playSfxStoneFall,
  playSfxWebBreak: playSfxWebBreak,
  playSfxTutorialPrompt: playSfxTutorialPrompt,
  playSfxRepairConnect: playSfxRepairConnect,
  playSfxRepairComplete: playSfxRepairComplete,
  playSfxRepairWeave: playSfxRepairWeave,
  playSfxCry: playSfxCry
};
