/* Version: V3.2 — Sylvan Background + Procedural BGM */
import './style.css';

import { Vec2 } from './engine/Vec2.js';
import { DistanceConstraint } from './engine/constraints.js';
import { Composite } from './engine/Composite.js';
import { VerletJS } from './engine/VerletJS.js';

import { createSpiderweb } from './entities/spiderweb.js';
import { createSpider } from './entities/spider.js';
import { ThrownObj, clearObjectConstraints } from './entities/ThrownObj.js';

import {
  getWebSamplePoints, updateSamplePoints,
  findStepTarget, liftFoot, landFoot, triggerStep
} from './systems/footSystem.js';

import {
  getWebOuterR, inWebZone, radialRatioAt,
  collectPathHitCandidates, chooseStickCandidate
} from './systems/stickSystem.js';

import {
  buildWebGridList, cellCovered, scanWebCells
} from './systems/webIntegrity.js';

import {
  LEVEL_CONFIGS, SCORE_MULT,
  calcWaveScore, getLevelCfg, framesToTime
} from './systems/levelSystem.js';

import { audioEngine } from './audio/audioEngine.js';

import { setupWebDraw } from './render/webRenderer.js';
import { setupSpiderDraw } from './render/spiderRenderer.js';
import { drawThrownObjects, drawWrappingOverlay } from './render/objectRenderer.js';
import { renderArtToCanvas, renderInventoryArts } from './render/inventoryArt.js';

import {
  initSylvanBackground,
  updateSylvanBackground,
  renderSylvanBackground,
  switchSylvanTheme,
  bgConfig,
  applyBgBlur,
  applyBgPresentation,
  setBgParticleCount,
  THEMES as BG_THEMES
} from './render/sylvanBackground.js';

import { initOverlay, showOverlay, hideOverlay, refreshWaveHUD, playCollectFX } from './ui/overlay.js';
import { initPanel } from './ui/panel.js';

/* ── requestAnimFrame polyfill ── */
var requestAnimFrame = window.requestAnimationFrame
  || window.webkitRequestAnimationFrame
  || window.mozRequestAnimationFrame
  || function (cb) { window.setTimeout(cb, 1000 / 60); };

/* ── Mobile detection ── */
var IS_MOBILE = navigator.maxTouchPoints > 1 || /iPhone|iPad|Android/i.test(navigator.userAgent);

/* ================================================================
   MAIN
================================================================ */
window.onload = function () {
  var WEB_SCALE = 1.2;

  /* ── params ── */
  var DEFAULTS = {
    webRadius: 1.45, webSegs: 30, webDepth: 11, webStiff: 0.6,
    moveSpeed: 1.8, stepSpeed: 0.18, stepThresh: 22, restThresh: 50,
    legStiff: 0.3, jointStiff: 0.35,
    stickDelayMin: 0.10, stickDelayMax: 0.45, stickCatchRadius: 18,
    stickMidBias: 0.8, stickHistory: 40,
    caterpillarGravity: 2.0,
    caterpillarWeight: 5, flyWeight: 3, leafWeight: 1,
    caterpillarReleaseSec: 3, flyReleaseSec: 2, leafReleaseSec: 0,
    bgTheme: 0, bgBlur: 25, bgWind: 1.0, bgRay: 100,
    bgDarken: 15, bgPurity: 140, bgYOffset: 13,
    bgPart: 24, bgVol: 50, bgMusicOn: 1, bgLayoutVersion: 3
  };
  var P = Object.assign({}, DEFAULTS);
  try {
    var saved = JSON.parse(localStorage.getItem('spiderPanelParams') || '{}');
    Object.assign(P, saved);
    if (!saved.bgLayoutVersion || saved.bgLayoutVersion < 3) {
      P.bgTheme = DEFAULTS.bgTheme;
      P.bgBlur = DEFAULTS.bgBlur;
      P.bgWind = DEFAULTS.bgWind;
      P.bgRay = DEFAULTS.bgRay;
      P.bgDarken = DEFAULTS.bgDarken;
      P.bgPurity = DEFAULTS.bgPurity;
      P.bgYOffset = DEFAULTS.bgYOffset;
      P.bgPart = DEFAULTS.bgPart;
      P.bgVol = DEFAULTS.bgVol;
      P.bgMusicOn = DEFAULTS.bgMusicOn;
      P.bgLayoutVersion = DEFAULTS.bgLayoutVersion;
    }
  } catch (e) { }

  /* ── canvas ── */
  var screenShellEl = document.querySelector('.screen-shell');
  var canvas = document.getElementById('scratch');
  var collectLayer = document.getElementById('collect-layer');
  var W = parseInt(canvas.style.width), H = parseInt(canvas.style.height);
  var dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.getContext('2d').scale(dpr, dpr);
  var cx = W / 2, cy = H / 2;

  /* ── Sylvan 背景初始化（在 canvas 上方、蛛网下方插入DOM层） ── */
  initSylvanBackground(W, H, screenShellEl);

  var sim = new VerletJS(W, H, canvas);
  sim.gravity = new Vec2(0, 0);

  /* ── 拖拽弹性视差交互状态机 ── */
  var _dragStart = { x: 0, y: 0 };
  var _dragOffset = { x: 0, y: 0 };
  var _smoothDrag = { x: 0, y: 0 };

  function _getCanvasPos(clientX, clientY) {
    var r = canvas.getBoundingClientRect();
    return {
      x: (clientX - r.left) * (W / r.width),
      y: (clientY - r.top) * (H / r.height)
    };
  }

  window.addEventListener('mousedown', function (e) {
    var p = _getCanvasPos(e.clientX, e.clientY);
    _dragStart.x = p.x; _dragStart.y = p.y;
    _dragOffset.x = 0; _dragOffset.y = 0;
  });
  window.addEventListener('mousemove', function (e) {
    if (sim.mouseDown) {
      var p = _getCanvasPos(e.clientX, e.clientY);
      _dragOffset.x = p.x - _dragStart.x;
      _dragOffset.y = p.y - _dragStart.y;
    }
  });
  window.addEventListener('mouseup', function () {
    _dragOffset.x = 0; _dragOffset.y = 0;
  });
  window.addEventListener('touchstart', function (e) {
    if (e.touches.length > 0) {
      var p = _getCanvasPos(e.touches[0].clientX, e.touches[0].clientY);
      _dragStart.x = p.x; _dragStart.y = p.y;
      _dragOffset.x = 0; _dragOffset.y = 0;
    }
  }, { passive: true });
  window.addEventListener('touchmove', function (e) {
    if (sim.mouseDown && e.touches.length > 0) {
      var p = _getCanvasPos(e.touches[0].clientX, e.touches[0].clientY);
      _dragOffset.x = p.x - _dragStart.x;
      _dragOffset.y = p.y - _dragStart.y;
    }
  }, { passive: true });
  window.addEventListener('touchend', function () {
    _dragOffset.x = 0; _dragOffset.y = 0;
  }, { passive: true });

  /* ── 解锁音频上下文（浏览器自动播放安全策略） ── */
  function _unlockAudio() {
    try {
      var ac = audioEngine.getAC();
      if (ac && ac.state === 'suspended') ac.resume();
    } catch (e) {}
    window.removeEventListener('click', _unlockAudio);
    window.removeEventListener('touchstart', _unlockAudio);
    window.removeEventListener('keydown', _unlockAudio);
  }
  window.addEventListener('click', _unlockAudio);
  window.addEventListener('touchstart', _unlockAudio);
  window.addEventListener('keydown', _unlockAudio);

  /* ── 默认开启 BGM（可从已保存背景参数恢复） ── */
  setTimeout(function () {
    if (P.bgMusicOn) audioEngine.playLevelBGM(P.bgTheme || 0);
  }, 500);

  /* runtime refs */
  var spiderweb, spider, legConstraintCount, samplePoints = [], footState = [];
  var STEP_SPEED, STEP_THRESH, REST_THRESH, STEP_COOLDOWN = 6;
  var target = null, moveDir = null, moveSpeed = P.moveSpeed, arriveThreshold = 6;
  var _autoTarget = new Vec2(0, 0); /* 复用对象，避免每帧 GC */

  /* ── blink ── */
  var blinkState = { scale: 1, blinking: false, t: 0, nextBlink: 180 + Math.floor(Math.random() * 240) };
  function updateBlink() {
    if (blinkState.blinking) {
      blinkState.t += 0.18;
      if (blinkState.t <= 1) blinkState.scale = 1 - 0.95 * (blinkState.t < 0.5 ? 2 * blinkState.t * blinkState.t : -1 + (4 - 2 * blinkState.t) * blinkState.t);
      else if (blinkState.t <= 2) { var t2 = blinkState.t - 1; blinkState.scale = 0.05 + 0.95 * (t2 < 0.5 ? 2 * t2 * t2 : -1 + (4 - 2 * t2) * t2); }
      else { blinkState.scale = 1; blinkState.blinking = false; blinkState.t = 0; blinkState.nextBlink = 180 + Math.floor(Math.random() * 300); }
    } else { blinkState.nextBlink--; if (blinkState.nextBlink <= 0) { blinkState.blinking = true; blinkState.t = 0; } }
  }

  /* ── web override ── */
  var webOverride = null;
  var webCx = 0, webCy = 0, webRad = 1;

  function buildWeb() {
    if (spiderweb) {
      var idx = sim.composites.indexOf(spiderweb);
      if (idx !== -1) sim.composites.splice(idx, 1);
    }
    var ov = webOverride || {};
    var segs = ov.segs || P.webSegs;
    var depth = ov.depth || P.webDepth;
    var rad = ov.radius || Math.round(Math.min(W, H) / 2 * P.webRadius * WEB_SCALE);
    var ocx = (ov.cx != null) ? ov.cx : cx;
    var ocy = (ov.cy != null) ? ov.cy : cy;
    var pStep = ov.pinStep || 4;
    spiderweb = createSpiderweb(sim, new Vec2(ocx, ocy), rad, segs, depth, P.webStiff, pStep);
    webCx = ocx; webCy = ocy; webRad = rad;
    var wi = sim.composites.indexOf(spiderweb);
    if (wi !== 0) { sim.composites.splice(wi, 1); sim.composites.unshift(spiderweb); }
    samplePoints = getWebSamplePoints(spiderweb, 4);
    setupWebDraw(spiderweb, function () { return thrownObjects; }, function () { return webBreakFlashes; }, function () { return _breakFrame; }, function () { return brokenEnds; });
  }

  function buildSpider() {
    if (spider) { var si = sim.composites.indexOf(spider); if (si !== -1) sim.composites.splice(si, 1); }
    spider = createSpider(sim, new Vec2(cx, cy), { legStiff: P.legStiff, jointStiff: P.jointStiff });
    spider.thorax.pos.mutableSet(new Vec2(cx, cy)); spider.thorax.lastPos.mutableSet(new Vec2(cx, cy));
    spider.head.pos.mutableSet(new Vec2(cx, cy - 6)); spider.head.lastPos.mutableSet(new Vec2(cx, cy - 6));
    spider.abdomen.pos.mutableSet(new Vec2(cx, cy + 12)); spider.abdomen.lastPos.mutableSet(new Vec2(cx, cy + 12));
    legConstraintCount = spider.constraints.length;
    STEP_SPEED = P.stepSpeed; STEP_THRESH = P.stepThresh; REST_THRESH = P.restThresh;
    footState = spider.legs.map(function (lp, idx) {
      var footOffsets = [
        new Vec2(16, -1),
        new Vec2(-16, -1),
        new Vec2(15, 4),
        new Vec2(-15, 4)
      ];
      var ip = new Vec2(cx + footOffsets[idx].x, cy + footOffsets[idx].y);
      lp.pos.mutableSet(ip); lp.lastPos.mutableSet(ip);
      return {
        particle: lp, current: new Vec2(ip.x, ip.y), from: new Vec2(ip.x, ip.y),
        targetPos: new Vec2(ip.x, ip.y), targetStepPoint: null,
        landedNode: null, landedSeg: null, constraintA: null, constraintB: null,
        stepping: false, t: 1, cooldown: idx * 6
      };
    });
    setupSpiderDraw(spider, legConstraintCount, footState, blinkState, function () { return wrappingTarget; });
    setTimeout(function () { triggerStep(0, null, footState, spiderweb, spider, samplePoints, moveDir, STEP_COOLDOWN); triggerStep(2, null, footState, spiderweb, spider, samplePoints, moveDir, STEP_COOLDOWN); }, 60);
    setTimeout(function () { triggerStep(1, null, footState, spiderweb, spider, samplePoints, moveDir, STEP_COOLDOWN); triggerStep(3, null, footState, spiderweb, spider, samplePoints, moveDir, STEP_COOLDOWN); }, 210);
  }

  /* initial build */
  buildWeb(); buildSpider();
  renderInventoryArts();

  /* ── overlay init ── */
  initOverlay();

  /* ================================================================
     THROWN OBJECTS & GAME STATE
  ================================================================ */
  var thrownObjects = [];
  var objCounts = { boulder: 0, bug: 0, drop: 0 };
  var inventoryCounts = { boulder: 0, bug: 0, drop: 0 };
  var wrappingTarget = null;
  var brokenEnds = [];      /* 断线头粒子列表，每帧更新，传给 webRenderer */
  var autoPlay = false;     /* 自动寻路打包开关 */
  var _autoPlayPause = 0;   /* 打包完成后的停顿帧计数（18帧≈0.3s） */

  var gameState = 'IDLE';
  var currentLevel = 0;
  var totalScore = 0;
  var levelScored = false;
  var pendingLevelCheck = false;
  var levelTimer = 0;
  var gameFrames = 0;
  var difficultyLevel = 1;
  var webGridStep = 35;
  var webGridCoverD = 22;
  var webInitCells = 1;
  var webGridList = null;
  var webWarmupFrames = 0;
  var webScanPending = 0;
  var webLossPct = 0;
  var webBreakFlashes = [];
  var _breakFrame = 0;
  var _burstParticles = []; /* 打包完成放射粒子 */
  var _webDisplayPct = 100;   /* 当前显示值 */
  var _webTargetPct = 100;    /* 目标值 */
  var _webRollTimer = 0;      /* 滚动帧计数 */
  var _webRollFrom = 100;     /* 滚动起始值 */

  /* ── 爆发-冷却掉落状态机 ── */
  var spawnPhase = 'cooldown';
  var burstCount = 0;
  var burstTimer = 0;
  var cooldownTimer = 0;
  var burstsDone = 0;
  var burstCountCur = 0;
  var levelCollected = { boulder: 0, bug: 0, drop: 0 };
  var webGridBuildIdx = 0;
  var webGridInitCover = 0;

  /* helper: getLevelCfg with current difficulty */
  function getCfg(n) { return getLevelCfg(n, difficultyLevel); }

  /* ── show IDLE start screen ── */
  showOverlay(
    '<div class="overlay-title">SPIDER WEB</div>'
    + '<div class="overlay-subtitle" style="margin-bottom:6px">Collect prey caught in the web</div>'
    + '<div class="overlay-subtitle" style="margin-bottom:22px;opacity:0.6">Keep the web intact. If it breaks, you lose.</div>'
    + '<button class="overlay-btn" id="btn-start-game">Start Game</button>'
  );
  document.getElementById('btn-start-game').onclick = startGameFromBeginning;

  /* click to move (desktop) */
  canvas.addEventListener('click', function (e) {
    if (wrappingTarget !== null) return;
    var r = canvas.getBoundingClientRect();
    target = new Vec2((e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height));
  });

  /* tap to move (iOS / mobile) — touchend with no drag */
  var _touchStartX = 0, _touchStartY = 0;
  canvas.addEventListener('touchstart', function (e) {
    if (e.touches.length === 1) {
      _touchStartX = e.touches[0].clientX;
      _touchStartY = e.touches[0].clientY;
    }
  }, { passive: true });
  canvas.addEventListener('touchend', function (e) {
    if (wrappingTarget !== null) return;
    if (e.changedTouches.length === 1) {
      var t = e.changedTouches[0];
      var ddx = t.clientX - _touchStartX;
      var ddy = t.clientY - _touchStartY;
      if (Math.sqrt(ddx * ddx + ddy * ddy) < 12) {
        var r = canvas.getBoundingClientRect();
        target = new Vec2((t.clientX - r.left) * (W / r.width), (t.clientY - r.top) * (H / r.height));
      }
    }
  }, { passive: true });

  /* ── Game flow functions ── */
  function startGame() {
    wrappingTarget = null;
    target = null;
    totalScore = 0;
    currentLevel = 0;
    gameFrames = 0;
    levelScored = false;
    var scoreTxtEl = document.getElementById('score-txt');
    var scoreBarEl = document.getElementById('score-bar');
    if (scoreTxtEl) scoreTxtEl.textContent = '0';
    if (scoreBarEl) scoreBarEl.style.display = 'none';
    webOverride = {
      segs: 20 + Math.floor(Math.random() * 18),
      depth: 8 + Math.floor(Math.random() * 7),
      radius: Math.round(Math.min(W, H) / 2 * (1.25 + Math.random() * 0.35) * WEB_SCALE),
      cx: cx + (Math.random() - 0.5) * 40,
      cy: cy + (Math.random() - 0.5) * 40,
      pinStep: 3 + Math.floor(Math.random() * 4)
    };
    buildWeb(); buildSpider();
    startLevel(0);
  }

  function startGameFromBeginning() {
    difficultyLevel = 1;
    startGame();
  }

  function startLevel(n) {
    wrappingTarget = null;
    target = null;
    currentLevel = n;
    levelTimer = 0;
    levelScored = false;
    pendingLevelCheck = false;
    levelCollected = { boulder: 0, bug: 0, drop: 0 };
    inventoryCounts = { boulder: 0, bug: 0, drop: 0 };
    clearAllObjects();
    var cfg = getCfg(n);
    spawnPhase = 'cooldown';
    cooldownTimer = 0 - (cfg.firstBurstDelay || 60);
    burstTimer = 0; burstCount = 0; burstsDone = 0; burstCountCur = 0;
    ['boulder', 'bug', 'drop'].forEach(function (k) {
      var el = document.getElementById('inv-' + k + '-count');
      if (el) el.textContent = '0/' + cfg.targets[k];
    });
    gameState = 'LEVEL_ACTIVE';
    hideOverlay();
    levelTimer = 0;
    webWarmupFrames = 90;
    webGridList = null; webInitCells = 1; webScanPending = 0; webLossPct = 0;
    webGridBuildIdx = 0; webGridInitCover = 0;
    brokenEnds = [];

    /* ── 同步切换背景主题与BGM ── */
    P.bgTheme = n;
    switchSylvanTheme(n);
    document.querySelectorAll('.bg-theme-dot').forEach(function (d, idx) {
      d.classList.toggle('active', idx === n);
    });
    if (P.bgMusicOn) audioEngine.playLevelBGM(n);
  }

  function endLevel() {
    if (gameState !== 'LEVEL_ACTIVE' && gameState !== 'LEVEL_RESULT') return;
    if (levelScored) return;
    levelScored = true;
    var cfg = getCfg(currentLevel);
    var ws = calcWaveScore(levelCollected, cfg.targets);
    totalScore += ws;
    var scoreTxtEl = document.getElementById('score-txt');
    if (scoreTxtEl) scoreTxtEl.textContent = totalScore;
    var isLast = (currentLevel >= LEVEL_CONFIGS.length - 1);
    if (isLast) showSuccess();
    else showLevelResult(ws);
  }

  function showLevelResult(levelScore) {
    if (gameState === 'GAME_OVER' || gameState === 'SUCCESS') return;
    gameState = 'LEVEL_RESULT';
    audioEngine.playSfxSuccess();
    clearAllObjects();
    var nextNum = currentLevel + 2;
    showOverlay(
      '<div class="overlay-title">Wave Complete</div>'
      + '<div class="overlay-subtitle">The web held together.</div>'
      + '<button class="overlay-btn" id="btn-nextwv" style="margin-top:16px">Next Wave</button>'
      + '<br><button class="overlay-btn" style="background:#555;margin-top:8px" id="btn-restart-wr">Restart</button>'
    );
    var btn = document.getElementById('btn-nextwv');
    if (btn) { btn.onclick = resetWebAndStartNextLevel; }
    document.getElementById('btn-restart-wr').onclick = startGameFromBeginning;
  }

  function resetWebAndStartNextLevel() {
    gameFrames = 0;
    webOverride = {
      segs: 20 + Math.floor(Math.random() * 18),
      depth: 8 + Math.floor(Math.random() * 7),
      radius: Math.round(Math.min(W, H) / 2 * (1.25 + Math.random() * 0.35) * WEB_SCALE),
      cx: cx + (Math.random() - 0.5) * 40,
      cy: cy + (Math.random() - 0.5) * 40,
      pinStep: 3 + Math.floor(Math.random() * 4)
    };
    buildWeb(); buildSpider();
    startLevel(currentLevel + 1);
  }

  function showSuccess() {
    if (gameState === 'SUCCESS' || gameState === 'GAME_OVER') return;
    gameState = 'SUCCESS';
    audioEngine.playSfxSuccess();
    clearAllObjects();
    showOverlay(
      '<div class="overlay-title">All Waves Clear</div>'
      + '<div class="overlay-subtitle">The web survived the full run.</div>'
      + '<button class="overlay-btn" id="btn-nextlv" style="margin-bottom:8px">Higher Challenge</button>'
      + '<br><button class="overlay-btn" style="background:#555;margin-top:4px" id="btn-restart-s">Restart</button>'
    );
    document.getElementById('btn-nextlv').onclick = function () { difficultyLevel++; startGame(); };
    document.getElementById('btn-restart-s').onclick = startGameFromBeginning;
  }

  function showGameOver() {
    if (gameState === 'GAME_OVER' || gameState === 'SUCCESS') return;
    gameState = 'GAME_OVER';
    audioEngine.playSfxGameOver();
    clearAllObjects();
    var timeUsed = framesToTime(gameFrames);
    showOverlay(
      '<div class="overlay-title">Web Broken</div>'
      + '<div class="overlay-subtitle">Survived&nbsp;' + timeUsed + '</div>'
      + '<button class="overlay-btn" id="btn-retry" style="margin-bottom:8px">Try Again</button>'
      + '<br><button class="overlay-btn" style="background:#555;margin-top:4px" id="btn-restart-f">Restart</button>'
    );
    document.getElementById('btn-retry').onclick = startGame;
    document.getElementById('btn-restart-f').onclick = startGameFromBeginning;
  }

  function checkLevelComplete() {
    var cfg = getCfg(currentLevel);
    var done = ['boulder', 'bug', 'drop'].every(function (k) {
      return levelCollected[k] >= (cfg.targets[k] || 0);
    });
    if (done) endLevel();
  }

  /* ── Web integrity ── */
  function _buildWebGrid() {
    webGridList = buildWebGridList(webCx, webCy, webRad, webGridStep);
    webGridBuildIdx = 0;
    webGridInitCover = 0;
    webInitCells = 1;
  }

  function continueWebGridBuild() {
    if (!webGridList || webGridBuildIdx >= webGridList.length) return;
    var batchSize = 50;
    var end = Math.min(webGridBuildIdx + batchSize, webGridList.length);
    for (var k = webGridBuildIdx; k < end; k++) {
      if (cellCovered(webGridList[k].x, webGridList[k].y, spiderweb, webGridCoverD)) webGridInitCover++;
    }
    webGridBuildIdx = end;
    if (webGridBuildIdx >= webGridList.length) {
      webInitCells = webGridInitCover || 1;
    }
  }

  function _scanWebCells() {
    if (!webGridList || webGridList.length === 0) return;
    var covered = scanWebCells(webGridList, spiderweb, webGridCoverD);
    var loss = 1 - covered / webInitCells;
    if (loss < 0) loss = 0;
    var pct = Math.round(loss * 100);
    if (pct > webLossPct) webLossPct = pct;
    /* 顺带更新断线头 + 清除孤立点（事件驱动，不每帧执行） */
    _refreshBrokenEnds();
  }

  function _refreshBrokenEnds() {
    if (!spiderweb) return;
    var _connMap = {};
    for (var _ci = 0; _ci < spiderweb.constraints.length; _ci++) {
      var _cc = spiderweb.constraints[_ci];
      if (!(_cc instanceof DistanceConstraint)) continue;
      var _pidA = _cc.a.__pid, _pidB = _cc.b.__pid;
      if (_pidA) _connMap[_pidA] = (_connMap[_pidA] || 0) + 1;
      if (_pidB) _connMap[_pidB] = (_connMap[_pidB] || 0) + 1;
    }
    var _newBroken = [], _newParticles = [];
    for (var _pi = 0; _pi < spiderweb.particles.length; _pi++) {
      var _pp = spiderweb.particles[_pi];
      var _cnt = _pp.__pid ? (_connMap[_pp.__pid] || 0) : 0;
      if (_cnt === 0) continue;          /* 孤立点：丢弃 */
      _newParticles.push(_pp);
      if (_cnt === 1) _newBroken.push(_pp); /* 断线头 */
    }
    spiderweb.particles = _newParticles;
    brokenEnds = _newBroken;
  }

  function checkWebIntegrity() {
    if (gameState !== 'LEVEL_ACTIVE') return;
    if (!spiderweb) return;
    if (webWarmupFrames > 0) {
      webWarmupFrames--;
      if (webWarmupFrames === 0) _buildWebGrid();
      var dbgEl = document.getElementById('dbg-web');
      if (dbgEl) dbgEl.innerHTML = 'WEB <span id="dbg-web-num">100%</span>';
      return;
    }
    if (webGridBuildIdx < (webGridList ? webGridList.length : 0)) continueWebGridBuild();
    if (webScanPending > 0) {
      webScanPending--;
      if (webScanPending === 0) _scanWebCells();
    }
    var dbgEl = document.getElementById('dbg-web');
    if (dbgEl) {
      var _newPct = Math.max(0, Math.round(100 - webLossPct * 2));
      /* 新目标出现时启动滚动 */
      if (_newPct !== _webTargetPct) {
        _webRollFrom = _webDisplayPct;
        _webTargetPct = _newPct;
        _webRollTimer = 0;
      }
      /* 滚动过程：20帧内从旧值快速跳到新值，每帧更新一次显示 */
      var _rollDur = 20;
      if (_webRollTimer < _rollDur) {
        _webRollTimer++;
        /* 快速跳数：用 easeOut 让开头快、结尾慢 */
        var _rollT = 1 - Math.pow(1 - _webRollTimer / _rollDur, 2);
        _webDisplayPct = Math.round(_webRollFrom + (_webTargetPct - _webRollFrom) * _rollT);
      } else {
        _webDisplayPct = _webTargetPct;
      }
      var _numEl = document.getElementById('dbg-web-num');
      if (!_numEl) {
        dbgEl.innerHTML = 'WEB <span id="dbg-web-num">' + _webDisplayPct + '%</span>';
        _numEl = document.getElementById('dbg-web-num');
      } else {
        var _showing = parseInt(_numEl.textContent);
        if (_showing !== _webDisplayPct) {
          _numEl.textContent = _webDisplayPct + '%';
          /* 只在滚动开始时闪红一次 */
          if (_webRollTimer === 1) {
            _numEl.classList.remove('dbg-web-flash');
            void _numEl.offsetWidth;
            _numEl.classList.add('dbg-web-flash');
          }
        }
      }
    }
    if (webLossPct >= 50) showGameOver();
  }

  /* ── Timer & spawner ── */
  function updateLevelTimer() {
    if (gameState === 'IDLE' || gameState === 'GAME_OVER' || gameState === 'SUCCESS') return;
    levelTimer++;
    gameFrames++;
  }

  function spawnRandom() {
    /* bug 占 30% 的原概率再降到 30%，即约 10% 总概率 */
    var r = Math.random();
    var kind = r < 0.10 ? 'bug' : r < 0.55 ? 'boulder' : 'drop';
    launchObject(kind);
  }

  function updateLevelSpawner() {
    if (gameState !== 'LEVEL_ACTIVE') return;
    var cfg = getCfg(currentLevel);
    if (spawnPhase === 'cooldown') {
      cooldownTimer++;
      if (cooldownTimer >= cfg.cooldownDuration) {
        if (burstsDone >= cfg.totalBursts) return;
        spawnPhase = 'burst';
        burstTimer = 0;
        burstCountCur = cfg.burstMin + Math.floor(Math.random() * (cfg.burstMax - cfg.burstMin + 1));
        burstCount = burstCountCur;
      }
      return;
    }
    if (spawnPhase === 'burst') {
      burstTimer++;
      if (burstTimer < cfg.burstInterval) return;
      burstTimer = 0;
      spawnRandom();
      burstCount--;
      if (burstCount <= 0) {
        burstsDone++;
        spawnPhase = 'cooldown';
        cooldownTimer = 0;
      }
    }
  }

  /* ── Object management ── */
  function updateBadge(kind, delta) {
    objCounts[kind] = Math.max(0, objCounts[kind] + delta);
    document.getElementById('cnt-' + kind).textContent = objCounts[kind];
  }

  function launchObject(kind) {
    var obj = new ThrownObj(kind, W, H, sim, P, gameState, getCfg, currentLevel);
    obj._W = W; obj._H = H;
    thrownObjects.push(obj);
    updateBadge(kind, 1);
  }

  function clearAllObjects() {
    wrappingTarget = null;
    audioEngine.stopAllBugBuzz();
    thrownObjects.forEach(function (o) {
      if (o.collectEl && o.collectEl.parentNode) o.collectEl.parentNode.removeChild(o.collectEl);
      o.collectCanvas = null;
      o.destroy(sim);
    });
    thrownObjects = [];
    ['boulder', 'bug', 'drop'].forEach(function (k) {
      objCounts[k] = 0;
      document.getElementById('cnt-' + k).textContent = 0;
    });
  }

  function updateInventoryBadge(kind, delta) {
    inventoryCounts[kind] = Math.max(0, inventoryCounts[kind] + delta);
    if (gameState === 'LEVEL_ACTIVE' && delta > 0) {
      levelCollected[kind]++;
      refreshWaveHUD(kind, gameState, getCfg, currentLevel, levelCollected);
      pendingLevelCheck = true;
    } else {
      var el = document.getElementById('inv-' + kind + '-count');
      if (el) el.textContent = inventoryCounts[kind];
    }
  }

  function getCanvasPointOnStage(x, y) {
    var stageRect = screenShellEl.getBoundingClientRect();
    var canvasRect = canvas.getBoundingClientRect();
    return {
      x: (canvasRect.left - stageRect.left) + x * (canvasRect.width / W),
      y: (canvasRect.top - stageRect.top) + y * (canvasRect.height / H)
    };
  }

  function getInventoryTarget(kind) {
    var slot = document.getElementById('inv-' + kind);
    var slotRect = slot.getBoundingClientRect();
    var stageRect = screenShellEl.getBoundingClientRect();
    return {
      x: slotRect.left + slotRect.width * 0.5 - stageRect.left,
      y: slotRect.top + slotRect.height * 0.5 - stageRect.top
    };
  }

  function circlesOverlap(ax, ay, ar, bx, by, br) {
    var dx = ax - bx, dy = ay - by, rr = ar + br;
    return dx * dx + dy * dy <= rr * rr;
  }

  function beginCollectObject(obj) {
    var p = obj.particle;
    var startPos = getCanvasPointOnStage(p.pos.x, p.pos.y);
    var targetPos = getInventoryTarget(obj.kind);
    clearObjectConstraints(obj);
    obj.state = 'collecting';
    obj.collectT = 0; obj.collectPause = 12; obj.collectFlash = 0; obj.travelT = 0;
    obj.collectDur = 40;
    obj.collectFromX = startPos.x; obj.collectFromY = startPos.y;
    obj.collectToX = targetPos.x; obj.collectToY = targetPos.y;
    p.lastPos.x = p.pos.x; p.lastPos.y = p.pos.y;
    obj.alpha = 0;
    obj.collectEl = document.createElement('div');
    obj.collectEl.className = 'collect-token';
    obj.collectCanvas = document.createElement('canvas');
    obj.collectCanvas.className = 'collect-token-art';
    obj.collectCanvas.width = 34; obj.collectCanvas.height = 34;
    renderArtToCanvas(obj.collectCanvas, obj.kind);
    obj.collectEl.appendChild(obj.collectCanvas);
    obj.collectEl.style.left = obj.collectFromX + 'px';
    obj.collectEl.style.top = obj.collectFromY + 'px';
    collectLayer.appendChild(obj.collectEl);
  }

  function beginWrapping(obj) {
    clearObjectConstraints(obj);
    obj.state = 'wrapping';
    obj.wrapT = 0;
    obj.wrapDur = obj.def.wrapDur;
    obj.particle.lastPos.mutableSet(obj.particle.pos);
    wrappingTarget = obj;
    target = null;
  }

  function tryCollectObjects() {
    if (wrappingTarget !== null) return;
    var thorax = spider.thorax.pos;
    var abdomen = spider.abdomen.pos;
    for (var oi = 0; oi < thrownObjects.length; oi++) {
      var obj = thrownObjects[oi];
      if (obj.state !== 'stuck') continue;
      var p = obj.particle.pos;
      if (circlesOverlap(thorax.x, thorax.y, 11, p.x, p.y, obj.def.collectRadius)
        || circlesOverlap(abdomen.x, abdomen.y, 19, p.x, p.y, obj.def.collectRadius)) {
        beginWrapping(obj);
        return;
      }
    }
  }

  /* ── Stick system helper closures ── */
  function _radialRatioAt(x, y) { return radialRatioAt(x, y, W, H, P.webRadius * WEB_SCALE); }
  function _inWebZone(x, y) { return inWebZone(x, y, W, H, P.webRadius * WEB_SCALE); }
  function _getWebOuterR() { return getWebOuterR(W, H, P.webRadius * WEB_SCALE); }

  /* ── updateThrownObjects ── */
  function updateThrownObjects() {
    for (var oi = thrownObjects.length - 1; oi >= 0; oi--) {
      var obj = thrownObjects[oi];
      if (!obj || !obj.def) continue;
      var def = obj.def, p = obj.particle;
      obj.animT++;

      if (obj.state === 'falling') {
        var prevX = p.pos.x, prevY = p.pos.y;

        if (obj.kind === 'boulder') {
          obj.segT += 0.22;
          var bGrav = obj.grav * 2.6;
          p.pos.y += bGrav;
          p.lastPos.x = p.pos.x;
          p.lastPos.y = p.pos.y - bGrav;
        } else if (obj.kind === 'bug') {
          var bx = obj.baseVx + Math.sin(obj.animT * obj.buzzFreqX + obj.buzzPhaseX) * obj.buzzAmp * 0.08
            + Math.cos(obj.animT * obj.buzzFreqX * 1.7 + obj.buzzPhaseX) * obj.buzzAmp * 0.04
            + (Math.random() - 0.5) * 0.5;
          var by = obj.baseVy + Math.sin(obj.animT * obj.buzzFreqY + obj.buzzPhaseY) * obj.buzzAmp * 0.08
            + Math.cos(obj.animT * obj.buzzFreqY * 2.1 + obj.buzzPhaseY) * obj.buzzAmp * 0.04
            + (Math.random() - 0.5) * 0.5;
          if (!obj.released && Math.random() < 0.018) { obj.baseVx = (Math.random() - 0.5) * 5; obj.baseVy = (Math.random() - 0.5) * 5; }

          p.pos.x += bx; p.pos.y += by;
          p.lastPos.x = p.pos.x - bx; p.lastPos.y = p.pos.y - by;
          obj.angle = Math.atan2(by, bx);
          obj.wingT += 0.55;
          if (!obj._buzzStarted) { obj._buzzStarted = true; audioEngine.startBugBuzz(oi); }

          /* 环绕穿越：飞出一侧从对面出现，轨迹不被阻挡 */
          var _wrap = 100;
          if (p.pos.x < -_wrap)   { p.pos.x += W + _wrap * 2; p.lastPos.x = p.pos.x - bx; }
          if (p.pos.x > W + _wrap) { p.pos.x -= W + _wrap * 2; p.lastPos.x = p.pos.x - bx; }
          if (p.pos.y < -_wrap)   { p.pos.y += H + _wrap * 2; p.lastPos.y = p.pos.y - by; }
          if (p.pos.y > H + _wrap) { p.pos.y -= H + _wrap * 2; p.lastPos.y = p.pos.y - by; }
          /* 挣脱后乱飞一段再重新粘网（无限循环，飞出屏幕才消失） */
          if (obj.released) {
            obj._reStickTimer = (obj._reStickTimer || 0) + 1;
            if (obj._reStickTimer >= (obj._reStickDelay || 80)) {
              /* 完全重置粘网状态，允许再次被网捕获 */
              obj.released = false;
              obj._reStickTimer = 0;
              obj.enteredWebZone = false;
              obj.hitHistory = [];
              obj.penetrationDist = 0;
              obj.stickDelay = 0;
              /* 重置 stayFrames，下次粘住后有正常停留时间 */
              obj.stayFrames = obj.def.stayFrames;
              /* 保留原本随机飞行行为，只给 baseVx/baseVy 加一个微弱的网中心偏移
                 让苍蝇自然地偏向网而不是直线冲过去 */
              var _tcx = W * 0.3 + Math.random() * W * 0.4;
              var _tcy = H * 0.3 + Math.random() * H * 0.4;
              var _ddx = _tcx - p.pos.x, _ddy = _tcy - p.pos.y;
              var _dd = Math.sqrt(_ddx * _ddx + _ddy * _ddy) || 1;
              var _bias = 0.6 + Math.random() * 0.4; /* 微弱偏移，不覆盖随机性 */
              obj.baseVx = (_ddx / _dd) * _bias + (Math.random() - 0.5) * 2.0;
              obj.baseVy = (_ddy / _dd) * _bias + (Math.random() - 0.5) * 2.0;
            }
          }
        } else {
          obj.angleVel += (Math.random() - 0.5) * obj.angleTurb;
          obj.angleVel *= obj.angleDrag;
          obj.angleVel = Math.max(-0.025, Math.min(0.025, obj.angleVel));
          obj.angle += obj.angleVel;
          var maxAngle = 1.4;
          if (obj.angle > maxAngle) obj.angleVel -= 0.004;
          if (obj.angle < -maxAngle) obj.angleVel += 0.004;
          var lift = Math.sin(obj.angle) * obj.glideForce;
          obj.vx += lift; obj.vy += obj.grav;
          obj.vx *= obj.drag; obj.vy *= obj.drag;
          var spd = Math.sqrt(obj.vx * obj.vx + obj.vy * obj.vy);
          if (spd > 0.8) { obj.vx = obj.vx / spd * 0.8; obj.vy = obj.vy / spd * 0.8; }
          p.pos.x += obj.vx; p.pos.y += obj.vy;
          p.lastPos.x = p.pos.x - obj.vx; p.lastPos.y = p.pos.y - obj.vy;
          if (p.pos.y > H + 60) { obj.destroy(sim); thrownObjects.splice(oi, 1); updateBadge(obj.kind, -1); continue; }
        }

        /* C方案粘网 */
        var stepDx = p.pos.x - prevX, stepDy = p.pos.y - prevY;
        var stepLen = Math.sqrt(stepDx * stepDx + stepDy * stepDy);

        if (!obj.released && (_inWebZone(p.pos.x, p.pos.y) || obj.enteredWebZone)) {
          if (!obj.enteredWebZone) {
            obj.enteredWebZone = true;
            obj.penetrationDist = 0;
            obj.hitHistory = [];
            var outerR = _getWebOuterR();
            var minDelay = P.stickDelayMin * outerR;
            var maxDelay = P.stickDelayMax * outerR;
            if (maxDelay < minDelay) maxDelay = minDelay;
            var _stickMult = (obj.kind === 'bug') ? 2.0 : 1.0;
            obj.stickDelay = (minDelay + Math.random() * (maxDelay - minDelay)) * _stickMult;
          }
          obj.penetrationDist += stepLen;
          var newHits = collectPathHitCandidates(prevX, prevY, p.pos.x, p.pos.y, P.stickCatchRadius, spiderweb, _radialRatioAt);
          for (var hi = 0; hi < newHits.length; hi++) {
            newHits[hi].penetration = obj.penetrationDist;
            var last = obj.hitHistory.length ? obj.hitHistory[obj.hitHistory.length - 1] : null;
            if (last) {
              var dxh = last.x - newHits[hi].x, dyh = last.y - newHits[hi].y;
              if (dxh * dxh + dyh * dyh < 16) continue;
            }
            obj.hitHistory.push(newHits[hi]);
          }
          if (obj.hitHistory.length > P.stickHistory) {
            obj.hitHistory.splice(0, obj.hitHistory.length - P.stickHistory);
          }
          if (obj.penetrationDist >= obj.stickDelay && obj.hitHistory.length) {
            var chosen = chooseStickCandidate(obj.hitHistory, spiderweb, P.stickMidBias);
            if (chosen) obj.stickToPoint(chosen, spiderweb);
          }
          if (!_inWebZone(p.pos.x, p.pos.y) && obj.state === 'falling') {
            obj.enteredWebZone = false;
            obj.penetrationDist = 0;
            obj.hitHistory = [];
          }
        }

        if (obj.kind !== 'bug' && p.pos.y > H + 60) {
          obj.destroy(sim); thrownObjects.splice(oi, 1); updateBadge(obj.kind, -1);
        }

      } else if (obj.state === 'sticking') {
        obj.stickT = Math.min(1, obj.stickT + 0.078);
        var ease = obj.stickT < 0.5 ? 2 * obj.stickT * obj.stickT : -1 + (4 - 2 * obj.stickT) * obj.stickT;
        if (obj.cA) obj.cA.distance = obj.stickyFromA + (obj.stickyToA - obj.stickyFromA) * ease;
        if (obj.cB) obj.cB.distance = obj.stickyFromB + (obj.stickyToB - obj.stickyFromB) * ease;
        if (obj.stickT >= 1) {
          if (obj.cA) obj.cA.distance = obj.stickyToA;
          if (obj.cB) obj.cB.distance = obj.stickyToB;
          obj.state = 'stuck'; obj.stayTimer = 0;
          if (obj.kind === 'bug') audioEngine.stopBugBuzz(thrownObjects.indexOf(obj));
          audioEngine.playSfxLand(obj.kind);
          if (obj.kind === 'boulder') obj.wobbleAmp = 0.10;
          if (obj.kind === 'bug') obj.wobbleAmp = 0.28;
          if (obj.kind === 'drop') obj.wobbleAmp = 0.04;
        }

      } else if (obj.state === 'stuck') {
        obj.stayTimer++;
        var sagRate = obj.kind === 'boulder' ? 0.10 : obj.kind === 'bug' ? 0.06 : 0.008;
        p.pos.y += sagRate;
        if (obj.kind === 'boulder') {
          obj.segT += 0.13;
          p.pos.x += Math.sin(obj.segT) * obj.wobbleAmp * (0.4 + Math.random() * 0.2);
          p.pos.y += Math.cos(obj.segT * 0.6) * obj.wobbleAmp * 0.3;
        } else if (obj.kind === 'bug') {
          p.pos.x += (Math.random() - 0.5) * obj.wobbleAmp * 2;
          p.pos.y += (Math.random() - 0.5) * obj.wobbleAmp;
          obj.wingT += 0.55;
        } else {
          obj.angleVel += (Math.random() - 0.5) * 0.0005;
          obj.angleVel *= 0.98;
          obj.angle += obj.angleVel;
        }
        if (obj.kind !== 'drop') {
          var ramp = Math.max(0, obj.stayFrames - 72);
          if (obj.stayTimer > ramp) {
            var progress = (obj.stayTimer - ramp) / Math.max(1, obj.stayFrames - ramp);
            var wobbleMax = obj.kind === 'boulder' ? 12.0 : obj.kind === 'bug' ? 9.0 : 1.5;
            obj.wobbleAmp = Math.min(wobbleMax, obj.wobbleAmp + (0.08 + progress * 0.18));
            if (obj.kind === 'boulder') obj.segT += progress * 0.4;
            if (obj.kind === 'bug') obj.wingT += progress * 0.8;
          }
          if (obj.stayTimer >= obj.stayFrames) { obj.state = 'freeing'; obj.freeTimer = 0; }
        }

      } else if (obj.state === 'freeing') {
        obj.freeTimer++;
        var thrash = obj.kind === 'boulder' ? 18 : obj.kind === 'bug' ? 14 : 4;
        p.pos.x += (Math.random() - 0.5) * thrash;
        p.pos.y += (Math.random() - 0.5) * (thrash * 0.6);
        if (obj.freeTimer > 28) {
          obj.release(spiderweb, webBreakFlashes, _breakFrame);
          webScanPending = 12;

        }

      } else if (obj.state === 'falling2') {
        if (obj.kind === 'drop') {
          obj.angleVel += (Math.random() - 0.5) * obj.angleTurb;
          obj.angleVel *= obj.angleDrag;
          obj.angle += obj.angleVel;
          obj.vx += Math.sin(obj.angle) * obj.glideForce;
          obj.vy += obj.grav;
          obj.vx *= obj.drag; obj.vy *= obj.drag;
          var spd2 = Math.sqrt(obj.vx * obj.vx + obj.vy * obj.vy);
          if (spd2 > 0.8) { obj.vx = obj.vx / spd2 * 0.8; obj.vy = obj.vy / spd2 * 0.8; }
          p.pos.x += obj.vx; p.pos.y += obj.vy;
        } else {
          p.pos.y += obj.grav;
        }
        obj.alpha = Math.max(0, obj.alpha - 0.016);
        if (obj.alpha <= 0) { obj.destroy(sim); thrownObjects.splice(oi, 1); updateBadge(obj.kind, -1); }

      } else if (obj.state === 'wrapping') {
        p.lastPos.mutableSet(p.pos);
        obj.wrapT = Math.min(1, obj.wrapT + 1 / obj.wrapDur);
        if (Math.round(obj.wrapT * obj.wrapDur) % 12 === 0) audioEngine.playSfxWrap(obj.wrapT);
        if (obj.wrapT >= 1) {
          wrappingTarget = null;
          if (autoPlay) _autoPlayPause = 24; /* 0.4秒停顿 */
          audioEngine.playCollectSound(obj.kind);
          playCollectFX(obj, screenShellEl, canvas, collectLayer, W, H, SCORE_MULT);
          /* 放射粒子爆发 */
          var _bx = obj.particle.pos.x, _by = obj.particle.pos.y;
          var _colors = obj.kind === 'boulder' ? ['#ff9966','#ffcc88','#ffffff']
                      : obj.kind === 'bug'     ? ['#88ddff','#aaffcc','#ffffff']
                      :                         ['#aaffaa','#ffffaa','#ffffff'];
          for (var _pi = 0; _pi < 14; _pi++) {
            var _ang = (_pi / 14) * Math.PI * 2 + Math.random() * 0.3;
            var _spd = 1.8 + Math.random() * 2.8;
            _burstParticles.push({
              x: _bx, y: _by,
              vx: Math.cos(_ang) * _spd,
              vy: Math.sin(_ang) * _spd,
              life: 1.0,
              decay: 0.045 + Math.random() * 0.025,
              r: 2.2 + Math.random() * 2.0,
              color: _colors[Math.floor(Math.random() * _colors.length)]
            });
          }
          beginCollectObject(obj);
        }

      } else if (obj.state === 'collecting') {
        var drawX = obj.collectFromX;
        var drawY = obj.collectFromY;
        var scale = 1;
        var opacity = 1;

        if (obj.collectPause > 0) {
          obj.collectPause--;
          obj.collectFlash++;
          var holdT = 1 - obj.collectPause / 12;
          var pulse = Math.sin(holdT * Math.PI * 3.2) * 0.18;
          drawX += Math.sin(obj.collectFlash * 0.9) * 1.8;
          drawY += Math.cos(obj.collectFlash * 0.8) * 1.1;
          scale = 1.05 + holdT * 0.42 + pulse;
          opacity = 0.82 + Math.abs(Math.sin(holdT * Math.PI * 4)) * 0.18;
        } else {
          obj.travelT = Math.min(1, obj.travelT + 1 / obj.collectDur);
          var easeIn = obj.travelT * obj.travelT * obj.travelT;
          drawX = obj.collectFromX + (obj.collectToX - obj.collectFromX) * easeIn;
          drawY = obj.collectFromY + (obj.collectToY - obj.collectFromY) * easeIn;
          scale = 1.32 - (0.5 * obj.travelT);
          opacity = 1 - obj.travelT * 0.08;
        }

        if (obj.collectEl) {
          obj.collectEl.style.left = drawX + 'px';
          obj.collectEl.style.top = drawY + 'px';
          obj.collectEl.style.transform = 'scale(' + scale + ')';
          obj.collectEl.style.opacity = String(opacity);
        }
        if (obj.travelT >= 1) {
          if (obj.collectEl && obj.collectEl.parentNode) obj.collectEl.parentNode.removeChild(obj.collectEl);
          obj.collectEl = null;
          obj.collectCanvas = null;
          updateInventoryBadge(obj.kind, 1);
          obj.destroy(sim);
          thrownObjects.splice(oi, 1);
          updateBadge(obj.kind, -1);
        }
      }
    }
  }

  /* ── Panel init ── */
  initPanel(P, DEFAULTS, {
    buildWeb: buildWeb,
    buildSpider: buildSpider,
    onMotionChange: function () {
      moveSpeed = P.moveSpeed; STEP_SPEED = P.stepSpeed;
      STEP_THRESH = P.stepThresh; REST_THRESH = P.restThresh;
    },
    clearAllObjects: clearAllObjects,
    launchObject: launchObject,
    toggleAutoPlay: function () {
      autoPlay = !autoPlay;
      if (!autoPlay) target = null; /* 关闭时清除自动目标 */
      return autoPlay;
    }
  });

  /* ── 背景与音乐控制（左侧参数面板） ── */
  (function initBgPanel() {
    var bgmBtn = document.getElementById('bg-bgm-toggle');
    var slBlur = document.getElementById('sl-bgBlur');
    var lblBlur = document.getElementById('lbl-bgBlur');
    var slWind = document.getElementById('sl-bgWind');
    var lblWind = document.getElementById('lbl-bgWind');
    var slRay = document.getElementById('sl-bgRay');
    var lblRay = document.getElementById('lbl-bgRay');
    var slDarken = document.getElementById('sl-bgDarken');
    var lblDarken = document.getElementById('lbl-bgDarken');
    var slPurity = document.getElementById('sl-bgPurity');
    var lblPurity = document.getElementById('lbl-bgPurity');
    var slYOffset = document.getElementById('sl-bgYOffset');
    var lblYOffset = document.getElementById('lbl-bgYOffset');
    var slPart = document.getElementById('sl-bgPart');
    var lblPart = document.getElementById('lbl-bgPart');
    var slVol = document.getElementById('sl-bgVol');
    var lblVol = document.getElementById('lbl-bgVol');

    function renderThemeDots(activeIndex) {
      document.querySelectorAll('.bg-theme-dot').forEach(function (d, idx) {
        d.classList.toggle('active', idx === activeIndex);
      });
    }

    function applyBgmButton() {
      bgmBtn.textContent = P.bgMusicOn ? '🔊 Music Toggle' : '🔇 Music Toggle';
      bgmBtn.classList.toggle('bgm-on', !!P.bgMusicOn);
    }

    function applyBgParams() {
      bgConfig.blurScale = P.bgBlur / 100;
      bgConfig.windSpeed = P.bgWind;
      bgConfig.rayOpacity = P.bgRay / 100;
      bgConfig.darken = P.bgDarken / 100;
      bgConfig.purity = P.bgPurity / 100;
      bgConfig.yOffset = P.bgYOffset / 100;
      applyBgBlur();
      applyBgPresentation();
      setBgParticleCount(P.bgPart);
      if (audioEngine.setVolume) audioEngine.setVolume(P.bgVol / 100);

      slBlur.value = String(P.bgBlur);
      lblBlur.textContent = P.bgBlur + '%';
      slWind.value = String(P.bgWind);
      lblWind.textContent = Number(P.bgWind).toFixed(1);
      slRay.value = String(P.bgRay);
      lblRay.textContent = P.bgRay + '%';
      slDarken.value = String(P.bgDarken);
      lblDarken.textContent = P.bgDarken + '%';
      slPurity.value = String(P.bgPurity);
      lblPurity.textContent = P.bgPurity + '%';
      slYOffset.value = String(P.bgYOffset);
      lblYOffset.textContent = P.bgYOffset + '%';
      slPart.value = String(P.bgPart);
      lblPart.textContent = String(P.bgPart);
      slVol.value = String(P.bgVol);
      lblVol.textContent = P.bgVol + '%';
      renderThemeDots(P.bgTheme || 0);
      applyBgmButton();
      switchSylvanTheme(P.bgTheme || 0);
    }

    // 主题色点
    var dotsEl = document.getElementById('bg-theme-dots');
    var themeColors = ['#3da86c', '#b46e34', '#8b5cf6', '#ff8da1', '#3b82f6'];
    BG_THEMES.forEach(function (t, i) {
      var dot = document.createElement('div');
      dot.className = 'bg-theme-dot';
      dot.style.background = themeColors[i];
      dot.title = t.name;
      dot.addEventListener('click', function () {
        P.bgTheme = i;
        renderThemeDots(i);
        switchSylvanTheme(i);
        if (P.bgMusicOn) audioEngine.playLevelBGM(i);
      });
      dotsEl.appendChild(dot);
    });

    // 模糊度
    slBlur.addEventListener('input', function () {
      P.bgBlur = parseInt(this.value, 10);
      bgConfig.blurScale = P.bgBlur / 100;
      lblBlur.textContent = P.bgBlur + '%';
      applyBgBlur();
    });

    // 风速
    slWind.addEventListener('input', function () {
      P.bgWind = parseFloat(this.value);
      bgConfig.windSpeed = P.bgWind;
      lblWind.textContent = P.bgWind.toFixed(1);
    });

    // 光束
    slRay.addEventListener('input', function () {
      P.bgRay = parseInt(this.value, 10);
      bgConfig.rayOpacity = P.bgRay / 100;
      lblRay.textContent = P.bgRay + '%';
    });

    slDarken.addEventListener('input', function () {
      P.bgDarken = parseInt(this.value, 10);
      bgConfig.darken = P.bgDarken / 100;
      lblDarken.textContent = P.bgDarken + '%';
      applyBgPresentation();
    });

    slPurity.addEventListener('input', function () {
      P.bgPurity = parseInt(this.value, 10);
      bgConfig.purity = P.bgPurity / 100;
      lblPurity.textContent = P.bgPurity + '%';
      applyBgPresentation();
    });

    slYOffset.addEventListener('input', function () {
      P.bgYOffset = parseInt(this.value, 10);
      bgConfig.yOffset = P.bgYOffset / 100;
      lblYOffset.textContent = P.bgYOffset + '%';
    });

    // 孢子粒子
    slPart.addEventListener('input', function () {
      P.bgPart = parseInt(this.value, 10);
      lblPart.textContent = String(P.bgPart);
      setBgParticleCount(P.bgPart);
    });

    // 音量
    slVol.addEventListener('input', function () {
      P.bgVol = parseInt(this.value, 10);
      lblVol.textContent = P.bgVol + '%';
      if (audioEngine.setVolume) audioEngine.setVolume(P.bgVol / 100);
    });

    // 音乐开关
    bgmBtn.addEventListener('click', function () {
      P.bgMusicOn = P.bgMusicOn ? 0 : 1;
      if (P.bgMusicOn) {
        audioEngine.playLevelBGM(P.bgTheme);
      } else {
        audioEngine.stopBGM();
      }
      applyBgmButton();
    });

    // 让背景参数加入现有保存/重置流程
    var saveBtn = document.getElementById('btn-save');
    var origSave = saveBtn.onclick;
    saveBtn.onclick = function () {
      if (typeof origSave === 'function') origSave.call(this);
    };

    var resetBtn = document.getElementById('btn-reset');
    var origReset = resetBtn.onclick;
    resetBtn.onclick = function () {
      if (typeof origReset === 'function') origReset.call(this);
      applyBgParams();
      if (P.bgMusicOn) audioEngine.playLevelBGM(P.bgTheme);
      else audioEngine.stopBGM();
    };

    applyBgParams();
  })();

  /* ================================================================
     MAIN LOOP
  ================================================================ */
  var _lastTimestamp = 0;
  var _bgFrame = 0;
  var loop = function (timestamp) {
    /* ── 时间差：计算帧缩放比，用于游戏逻辑速度补偿 ── */
    var delta = _lastTimestamp ? Math.min(timestamp - _lastTimestamp, 50) : 16.67;
    _lastTimestamp = timestamp;
    /* timeScale: 60fps=1.0, 30fps=2.0, 120fps=0.5 — 让游戏逻辑速度与帧率解耦 */
    var timeScale = delta / 16.67;

    /* ── 弹性拖拽平滑阻尼 (每帧约逼近10%) ── */
    _smoothDrag.x += (_dragOffset.x - _smoothDrag.x) * 0.1;
    _smoothDrag.y += (_dragOffset.y - _smoothDrag.y) * 0.1;

    /* ── 更新 & 绘制 Sylvan 背景（始终运行，包括IDLE） ── */
    _bgFrame++;
    updateSylvanBackground(1.0, sim.mouseDown, _smoothDrag, sim.mouse.x, sim.mouse.y);
    /* 移动端每 3 帧、桌面端每 2 帧渲染一次背景，降低树叶重绘开销 */
    var _bgInterval = IS_MOBILE ? 3 : 2;
    if (_bgFrame % _bgInterval === 0) {
      renderSylvanBackground();
    }

    if (gameState === 'IDLE' || gameState === 'GAME_OVER') {
      updateLevelTimer();
      requestAnimFrame(loop);
      return;
    }

    updateSamplePoints(samplePoints);

    /* ── autoPlay：自动选取最近 stuck 物体为目标 ── */
    if (_autoPlayPause > 0) { _autoPlayPause--; }
    if (autoPlay && !wrappingTarget && _autoPlayPause <= 0) {
      var _bestObj = null, _bestD2 = Infinity;
      var _tx = spider.thorax.pos;
      for (var _oi = 0; _oi < thrownObjects.length; _oi++) {
        var _o = thrownObjects[_oi];
        if (_o.state !== 'stuck') continue;
        var _odx = _o.particle.pos.x - _tx.x, _ody = _o.particle.pos.y - _tx.y;
        var _od2 = _odx * _odx + _ody * _ody;
        if (_od2 < _bestD2) { _bestD2 = _od2; _bestObj = _o; }
      }
      if (_bestObj) {
        _autoTarget.x = _bestObj.particle.pos.x;
        _autoTarget.y = _bestObj.particle.pos.y;
        target = _autoTarget;
      } else {
        target = null;
      }
    }

    /* body movement */
    var isWrapping = (wrappingTarget !== null);
    var moving = false; moveDir = null;
    if (isWrapping) {
      target = null;
    } else if (target) {
      var tx = spider.thorax.pos, dx = target.x - tx.x, dy = target.y - tx.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > arriveThreshold) {
        moving = true;
        var scaledSpeed = moveSpeed * timeScale;
        var nx = (dx / dist) * scaledSpeed, ny = (dy / dist) * scaledSpeed;
        moveDir = new Vec2(dx / dist, dy / dist);
        for (var p = 0; p < spider.particles.length; p++) {
          spider.particles[p].pos.x += nx; spider.particles[p].pos.y += ny;
          spider.particles[p].lastPos.x += nx; spider.particles[p].lastPos.y += ny;
        }
      } else target = null;
    }

    /* feet */
    for (var fi = 0; fi < footState.length; fi++) {
      var fs = footState[fi];
      if (fs.cooldown > 0) fs.cooldown--;
      if (fs.stepping) {
        fs.t = Math.min(1, fs.t + STEP_SPEED);
        var ease = fs.t < 0.5 ? 2 * fs.t * fs.t : -1 + (4 - 2 * fs.t) * fs.t;
        fs.current.x = fs.from.x + (fs.targetPos.x - fs.from.x) * ease;
        fs.current.y = fs.from.y + (fs.targetPos.y - fs.from.y) * ease;
        fs.particle.pos.mutableSet(fs.current); fs.particle.lastPos.mutableSet(fs.current);
        if (fs.t >= 1) {
          fs.current.x = fs.targetPos.x; fs.current.y = fs.targetPos.y;
          fs.particle.pos.mutableSet(fs.current); fs.particle.lastPos.mutableSet(fs.current);
          fs.stepping = false;
          landFoot(fs, spider);
        }
      } else {
        if (fs.landedNode) { fs.current.x = fs.landedNode.pos.x; fs.current.y = fs.landedNode.pos.y; }
        else if (fs.landedSeg) { var sp = fs.landedSeg; fs.current.x = sp.pa.pos.x + (sp.pb.pos.x - sp.pa.pos.x) * sp.t; fs.current.y = sp.pa.pos.y + (sp.pb.pos.y - sp.pa.pos.y) * sp.t; }
        if (fs.landedNode || fs.landedSeg) { fs.particle.pos.mutableSet(fs.current); fs.particle.lastPos.mutableSet(fs.current); }
        var drift2 = fs.current.dist2(spider.thorax.pos);
        var partner = footState[fi % 2 === 0 ? fi + 1 : fi - 1];
        var ps = partner && partner.stepping;
        if (!ps) {
          if (target && drift2 > STEP_THRESH * STEP_THRESH) triggerStep(fi, moveDir, footState, spiderweb, spider, samplePoints, moveDir, STEP_COOLDOWN);
          else if (!target && drift2 > REST_THRESH * REST_THRESH) triggerStep(fi, null, footState, spiderweb, spider, samplePoints, moveDir, STEP_COOLDOWN);
        }
      }
    }

    /* 断网红闪帧计数 */
    _breakFrame++;
    if (webBreakFlashes.length > 0)
      webBreakFlashes = webBreakFlashes.filter(function (f) { return _breakFrame - f.t < 20; });

    /* wave system */
    updateLevelTimer();
    updateLevelSpawner();
    checkWebIntegrity();

    /* thrown objects */
    tryCollectObjects();
    updateThrownObjects();
    if (pendingLevelCheck) { pendingLevelCheck = false; checkLevelComplete(); }

    updateBlink();
    sim.frame(16);   // 约束迭代次数固定，保持物理稳定性
    sim.draw();
    drawThrownObjects(sim.ctx, thrownObjects);
    if (spider && spider.drawConstraints) spider.drawConstraints(sim.ctx, spider);
    drawWrappingOverlay(sim.ctx, thrownObjects); /* 打包圆圈在最上层 */

    /* 放射粒子：更新 + 绘制 */
    if (_burstParticles.length > 0) {
      var _ctx = sim.ctx;
      for (var _bpi = _burstParticles.length - 1; _bpi >= 0; _bpi--) {
        var _bp = _burstParticles[_bpi];
        _bp.x += _bp.vx; _bp.y += _bp.vy;
        _bp.vx *= 0.92; _bp.vy *= 0.92;
        _bp.life -= _bp.decay;
        if (_bp.life <= 0) { _burstParticles.splice(_bpi, 1); continue; }
        _ctx.save();
        _ctx.globalAlpha = _bp.life;
        _ctx.beginPath();
        _ctx.arc(_bp.x, _bp.y, _bp.r * _bp.life, 0, 2 * Math.PI);
        _ctx.fillStyle = _bp.color;
        _ctx.fill();
        _ctx.restore();
      }
    }

    requestAnimFrame(loop);
  };
  requestAnimFrame(loop);
};
