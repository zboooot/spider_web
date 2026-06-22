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
  liftFoot, landFoot, triggerStep
} from './systems/footSystem.js';

import {
  getWebOuterR, inWebZone, radialRatioAt,
  collectPathHitCandidates, collectPathHitCandidatesSpatial, chooseStickCandidate,
  mergeStickHits, stickHitScratch
} from './systems/stickSystem.js';

import {
  buildWebGridList, cellCovered, cellCoveredSpatial,
  markDirtyCellsFromSegment, markDirtyRegionFromAABB, tickDirtyCells,
  scanWebCellsBatch, WEB_BUILD_BATCH, WEB_RESCAN_BATCH
} from './systems/webIntegrity.js';

import {
  spatialIndex, spatialQueryBuf,
  assignWebConstraintIds, resetWebConstraintIds
} from './physics/SpatialIndexService.js';

import {
  LEVEL_CONFIGS, GAME_DURATION, SCORE_MULT,
  calcWaveScore, getLevelCfg, framesToTime
} from './systems/levelSystem.js';

import { audioEngine } from './audio/audioEngine.js';

import { setupWebDraw } from './render/webRenderer.js';
import { setupSpiderDraw } from './render/spiderRenderer.js';
import { drawThrownObjects } from './render/objectRenderer.js';
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

import {
  statsBeginFrame, statsEndFrame, statsSetScene, statsBindPanel
} from './debug/renderStats.js';
import { getBgEntityCounts } from './render/sylvanBackground.js';

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
  var USE_LEGACY_COLLISION = /(?:^|[?&])legacy=1/.test(location.search)
    || !!(P.useLegacyCollision);
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
    audioEngine.unlockAudio(function () {
      if (P.bgMusicOn) audioEngine.playLevelBGM(P.bgTheme || 0);
    });
    window.removeEventListener('click', _unlockAudio);
    window.removeEventListener('touchstart', _unlockAudio);
    window.removeEventListener('keydown', _unlockAudio);
  }
  window.addEventListener('click', _unlockAudio);
  window.addEventListener('touchstart', _unlockAudio);
  window.addEventListener('keydown', _unlockAudio);

  /* runtime refs */
  var spiderweb, spider, legConstraintCount, samplePoints = [], footState = [];
  var STEP_SPEED, STEP_THRESH, REST_THRESH, STEP_COOLDOWN = 6;
  var target = null, moveDir = null, moveSpeed = P.moveSpeed, arriveThreshold = 6;

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
    resetWebConstraintIds();
    spiderweb = createSpiderweb(sim, new Vec2(ocx, ocy), rad, segs, depth, P.webStiff, pStep);
    sim.gravityComposite = spiderweb;
    webCx = ocx; webCy = ocy; webRad = rad;
    assignWebConstraintIds(spiderweb);
    spatialIndex.syncAliveFromWeb(spiderweb);
    var wi = sim.composites.indexOf(spiderweb);
    if (wi !== 0) { sim.composites.splice(wi, 1); sim.composites.unshift(spiderweb); }
    samplePoints = USE_LEGACY_COLLISION ? getWebSamplePoints(spiderweb, 4) : [];
    setupWebDraw(spiderweb, function () { return thrownObjects; }, function () { return webBreakFlashes; }, function () { return _breakFrame; });
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
    var _spatialOpts = USE_LEGACY_COLLISION ? null : { index: spatialIndex, queryBuf: spatialQueryBuf };
    setTimeout(function () {
      triggerStep(0, null, footState, spiderweb, spider, samplePoints, moveDir, STEP_COOLDOWN, _spatialOpts);
      triggerStep(2, null, footState, spiderweb, spider, samplePoints, moveDir, STEP_COOLDOWN, _spatialOpts);
    }, 60);
    setTimeout(function () {
      triggerStep(1, null, footState, spiderweb, spider, samplePoints, moveDir, STEP_COOLDOWN, _spatialOpts);
      triggerStep(3, null, footState, spiderweb, spider, samplePoints, moveDir, STEP_COOLDOWN, _spatialOpts);
    }, 210);
  }

  /* initial build */
  buildWeb(); buildSpider();
  renderInventoryArts();

  /* ── overlay init ── */
  initOverlay();

  var updateStatsPanel = statsBindPanel(document.getElementById('stats-panel'));

  function countSimStats(physicsIters) {
    var particles = 0;
    var webC = 0;
    var spiderC = 0;
    for (var ci = 0; ci < sim.composites.length; ci++) {
      var comp = sim.composites[ci];
      particles += comp.particles.length;
      if (comp === spiderweb) webC = comp.constraints.length;
      else if (comp === spider) spiderC = comp.constraints.length;
    }
    statsSetScene({
      verletParticles: particles,
      webConstraints: webC,
      spiderConstraints: spiderC,
      preyActive: thrownObjects.length,
      physicsIters: physicsIters,
      dpr: dpr
    });
    statsSetScene(getBgEntityCounts());
  }

  /* ================================================================
     THROWN OBJECTS & GAME STATE
  ================================================================ */
  var thrownObjects = [];
  var objCounts = { boulder: 0, bug: 0, drop: 0 };
  var inventoryCounts = { boulder: 0, bug: 0, drop: 0 };
  var wrappingTarget = null;

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
  var webRescanActive = false;
  var webRescanIdx = 0;
  var webRescanCover = 0;
  var webIntegrityState = {
    webGridList: null,
    cellCovered: null,
    coveredCount: 0,
    dirtyIndices: [],
    dirtyFlags: null
  };
  var webLossPct = 0;
  var webBreakFlashes = [];
  var _breakFrame = 0;

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
    + '<div class="overlay-subtitle" style="margin-bottom:22px;opacity:0.6">Survive for 3 minutes. If the web breaks, you lose.</div>'
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
    document.getElementById('wave-bar').style.display = 'block';
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
    document.getElementById('wave-bar').style.display = 'block';
    levelTimer = 0;
    webWarmupFrames = 90;
    webGridList = null; webInitCells = 1; webRescanActive = false; webRescanIdx = 0;
    webRescanCover = 0; webLossPct = 0;
    webIntegrityState.webGridList = null;
    webIntegrityState.cellCovered = null;
    webIntegrityState.coveredCount = 0;
    webIntegrityState.dirtyIndices = [];
    webIntegrityState.dirtyFlags = null;
    webGridBuildIdx = 0; webGridInitCover = 0;

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
    document.getElementById('wave-bar').style.display = 'none';
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
    document.getElementById('wave-bar').style.display = 'none';
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
    document.getElementById('wave-bar').style.display = 'none';
    var timeUsed = framesToTime(gameFrames);
    showOverlay(
      '<div class="overlay-title">Web Broken</div>'
      + '<div class="overlay-subtitle">Survived ' + timeUsed + '</div>'
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
  function _spatialBounds() {
    var pad = webRad * 1.1;
    return {
      minX: webCx - pad, minY: webCy - pad,
      maxX: webCx + pad, maxY: webCy + pad
    };
  }

  function rebuildSpatialIndex() {
    if (USE_LEGACY_COLLISION || !spiderweb) return;
    spatialIndex.build(spiderweb, _spatialBounds());
  }

  function _markDirtyAABB(minX, minY, maxX, maxY) {
    if (!webGridList) return;
    var dirty = markDirtyRegionFromAABB(minX, minY, maxX, maxY, webGridList);
    for (var di = 0; di < dirty.length; di++) _markDirtyCell(dirty[di]);
  }

  function _spatialOpts() {
    return USE_LEGACY_COLLISION ? null : {
      index: spatialIndex,
      queryBuf: spatialQueryBuf,
      markDirtyAABB: _markDirtyAABB
    };
  }

  function _constraintAlive(c) {
    return !c.__webId || spatialIndex.isAliveId(c.__webId);
  }

  function _buildWebGrid() {
    webGridList = buildWebGridList(webCx, webCy, webRad, webGridStep);
    webGridBuildIdx = 0;
    webGridInitCover = 0;
    webInitCells = 1;
    webIntegrityState.webGridList = webGridList;
    webIntegrityState.cellCovered = new Uint8Array(webGridList.length);
    webIntegrityState.dirtyFlags = new Uint8Array(webGridList.length);
    webIntegrityState.coveredCount = 0;
    webIntegrityState.dirtyIndices = [];
  }

  function continueWebGridBuild() {
    if (!webGridList || webGridBuildIdx >= webGridList.length) return;
    if (!USE_LEGACY_COLLISION) rebuildSpatialIndex();
    var end = Math.min(webGridBuildIdx + WEB_BUILD_BATCH, webGridList.length);
    for (var k = webGridBuildIdx; k < end; k++) {
      var cov;
      if (USE_LEGACY_COLLISION) {
        cov = cellCovered(webGridList[k].x, webGridList[k].y, spiderweb, webGridCoverD, null);
      } else {
        cov = cellCoveredSpatial(webGridList[k].x, webGridList[k].y, spatialIndex, spatialQueryBuf, webGridCoverD);
      }
      webIntegrityState.cellCovered[k] = cov ? 1 : 0;
      if (cov) webGridInitCover++;
    }
    webGridBuildIdx = end;
    if (webGridBuildIdx >= webGridList.length) {
      webInitCells = webGridInitCover || 1;
      webIntegrityState.coveredCount = webGridInitCover;
    }
  }

  function _markDirtyCell(idx) {
    if (!webIntegrityState.dirtyFlags || idx < 0) return;
    if (!webIntegrityState.dirtyFlags[idx]) {
      webIntegrityState.dirtyFlags[idx] = 1;
      webIntegrityState.dirtyIndices.push(idx);
    }
  }

  function _onWebSegmentBroken(c, opts) {
    if (!c) return;
    if (c.__webId) spatialIndex.removeConstraint(c.__webId);
    if (USE_LEGACY_COLLISION) {
      _queueWebRescan();
      return;
    }
    if (opts && opts.skipDirty) return;
    if (!webGridList) return;
    var dirty = markDirtyCellsFromSegment(
      c.a.pos.x, c.a.pos.y, c.b.pos.x, c.b.pos.y, webGridCoverD, webGridList
    );
    for (var di = 0; di < dirty.length; di++) _markDirtyCell(dirty[di]);
  }

  function _queueWebRescan() {
    webRescanActive = true;
    webRescanIdx = 0;
    webRescanCover = 0;
  }

  function _applyWebCover(covered) {
    if (!webInitCells) return;
    var loss = 1 - covered / webInitCells;
    if (loss < 0) loss = 0;
    webLossPct = Math.round(loss * 100);
  }

  function tickWebRescan() {
    if (!webRescanActive || !webGridList) return;
    var batch = scanWebCellsBatch(
      webGridList, spiderweb, webGridCoverD, webRescanIdx, WEB_RESCAN_BATCH,
      USE_LEGACY_COLLISION ? null : spatialIndex
    );
    webRescanCover += batch.covered;
    webRescanIdx = batch.nextIdx;
    if (batch.done) {
      webRescanActive = false;
      _applyWebCover(webRescanCover);
    }
  }

  function checkWebIntegrity() {
    if (gameState !== 'LEVEL_ACTIVE') return;
    if (!spiderweb) return;
    if (webWarmupFrames > 0) {
      webWarmupFrames--;
      if (webWarmupFrames === 0) _buildWebGrid();
      var dbgEl = document.getElementById('dbg-web');
      if (dbgEl) dbgEl.textContent = 'WEB 100%';
      return;
    }
    if (webGridBuildIdx < (webGridList ? webGridList.length : 0)) {
      continueWebGridBuild();
    } else if (USE_LEGACY_COLLISION) {
      if (webRescanActive) tickWebRescan();
    } else if (webIntegrityState.dirtyIndices.length) {
      rebuildSpatialIndex();
      webIntegrityState.webGridList = webGridList;
      tickDirtyCells(
        webIntegrityState, spatialIndex, spatialQueryBuf, webGridCoverD, WEB_RESCAN_BATCH
      );
      _applyWebCover(webIntegrityState.coveredCount);
    }
    var dbgEl = document.getElementById('dbg-web');
    if (dbgEl) dbgEl.textContent = 'WEB ' + Math.max(0, Math.round(100 - webLossPct * 2)) + '%';
    if (webLossPct >= 50) showGameOver();
  }

  /* ── Timer & spawner ── */
  function updateLevelTimer() {
    if (gameState === 'IDLE' || gameState === 'GAME_OVER' || gameState === 'SUCCESS') return;
    levelTimer++;
    gameFrames++;
    var remaining = Math.max(0, GAME_DURATION - gameFrames);
    var rs = Math.ceil(remaining / 60);
    var rm = Math.floor(rs / 60); var rsec = rs % 60;
    var cntStr = rm + ':' + (rsec < 10 ? '0' : '') + rsec;
    if (gameState === 'LEVEL_ACTIVE') {
      document.getElementById('wave-bar').textContent = cntStr;
      if (gameFrames >= GAME_DURATION) endLevel();
      return;
    }
    if (gameState === 'LEVEL_RESULT') {
      document.getElementById('wave-bar').textContent = cntStr;
      if (gameFrames >= GAME_DURATION) { endLevel(); return; }
      return;
    }
  }

  function spawnRandom() {
    var kinds = ['boulder', 'bug', 'drop'];
    launchObject(kinds[Math.floor(Math.random() * kinds.length)]);
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

  function captureThrownStickPrev() {
    for (var oi = 0; oi < thrownObjects.length; oi++) {
      var obj = thrownObjects[oi];
      if (!obj || !obj.particle || obj.state !== 'falling') continue;
      obj._stickPrevX = obj.particle.pos.x;
      obj._stickPrevY = obj.particle.pos.y;
    }
  }

  /* ── updateThrownObjects：运动积分（粘网查询在 physics+build 之后） ── */
  function integrateThrownObjects() {
    for (var oi = thrownObjects.length - 1; oi >= 0; oi--) {
      var obj = thrownObjects[oi];
      if (!obj || !obj.def) continue;
      var def = obj.def, p = obj.particle;
      obj.animT++;

      if (obj.state === 'falling') {
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
          var offScreen = p.pos.x < -80 || p.pos.x > W + 80 || p.pos.y < -80 || p.pos.y > H + 80;
          var timeout = obj.released && (obj.animT - obj._releaseFrame > 200);
          if (offScreen || timeout) {
            audioEngine.stopBugBuzz(oi);
            obj.destroy(sim); thrownObjects.splice(oi, 1); updateBadge(obj.kind, -1); continue;
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

        if (obj.kind !== 'bug' && p.pos.y > H + 60) {
          obj.destroy(sim); thrownObjects.splice(oi, 1); updateBadge(obj.kind, -1);
        }

      } else if (obj.state === 'sticking') {
        obj.stickT = Math.min(1, obj.stickT + 0.06);
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
          obj.release(spiderweb, webBreakFlashes, _breakFrame, _onWebSegmentBroken, _spatialOpts());
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
          audioEngine.playCollectSound(obj.kind);
          playCollectFX(obj, screenShellEl, canvas, collectLayer, W, H, SCORE_MULT);
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

  /* ── 粘网查询（physics + spatial build 之后） ── */
  function queryThrownStick() {
    for (var oi = thrownObjects.length - 1; oi >= 0; oi--) {
      var obj = thrownObjects[oi];
      if (!obj || !obj.def || obj.state !== 'falling' || obj.released) continue;
      var p = obj.particle;
      var prevX = obj._stickPrevX, prevY = obj._stickPrevY;
      var stepDx = p.pos.x - prevX, stepDy = p.pos.y - prevY;
      var stepLen = Math.sqrt(stepDx * stepDx + stepDy * stepDy);

      if (!_inWebZone(p.pos.x, p.pos.y) && !obj.enteredWebZone) continue;

      if (!obj.enteredWebZone) {
        obj.enteredWebZone = true;
        obj.penetrationDist = 0;
        obj.hitHistory = [];
        obj._hitHistoryCount = 0;
        var outerR = _getWebOuterR();
        var minDelay = P.stickDelayMin * outerR;
        var maxDelay = P.stickDelayMax * outerR;
        if (maxDelay < minDelay) maxDelay = minDelay;
        obj.stickDelay = minDelay + Math.random() * (maxDelay - minDelay);
      }
      obj.penetrationDist += stepLen;

      if (USE_LEGACY_COLLISION) {
        var legacyHits = collectPathHitCandidates(
          prevX, prevY, p.pos.x, p.pos.y, P.stickCatchRadius, spiderweb, _radialRatioAt
        );
        for (var lhi = 0; lhi < legacyHits.length; lhi++) {
          legacyHits[lhi].penetration = obj.penetrationDist;
          var lastL = obj._hitHistoryCount ? obj.hitHistory[obj._hitHistoryCount - 1] : null;
          if (lastL) {
            var dxl = lastL.x - legacyHits[lhi].x, dyl = lastL.y - legacyHits[lhi].y;
            if (dxl * dxl + dyl * dyl < 16) continue;
          }
          if (!obj.hitHistory[obj._hitHistoryCount]) obj.hitHistory[obj._hitHistoryCount] = {};
          var ls = obj.hitHistory[obj._hitHistoryCount++];
          Object.assign(ls, legacyHits[lhi]);
        }
        if (obj._hitHistoryCount > P.stickHistory) {
          var ldrop = obj._hitHistoryCount - P.stickHistory;
          for (var li = 0; li < P.stickHistory; li++) obj.hitHistory[li] = obj.hitHistory[li + ldrop];
          obj._hitHistoryCount = P.stickHistory;
        }
      } else {
        var newCount = collectPathHitCandidatesSpatial(
          prevX, prevY, p.pos.x, p.pos.y, P.stickCatchRadius,
          spatialIndex, spatialQueryBuf, stickHitScratch, _radialRatioAt
        );
        obj._hitHistoryCount = mergeStickHits(
          obj.hitHistory, obj._hitHistoryCount, stickHitScratch, newCount,
          obj.penetrationDist, P.stickHistory
        );
      }

      if (obj.penetrationDist >= obj.stickDelay && obj._hitHistoryCount) {
        var pick = chooseStickCandidate(
          obj.hitHistory, obj._hitHistoryCount,
          USE_LEGACY_COLLISION ? spiderweb : spatialIndex, P.stickMidBias
        );
        obj._hitHistoryCount = pick.count;
        if (pick.candidate) {
          obj.stickToPoint(pick.candidate, spiderweb, USE_LEGACY_COLLISION ? null : spatialIndex);
        }
      }
      if (!_inWebZone(p.pos.x, p.pos.y) && obj.state === 'falling') {
        obj.enteredWebZone = false;
        obj.penetrationDist = 0;
        obj._hitHistoryCount = 0;
      }
    }
  }

  function _resyncFootParticles() {
    for (var fi = 0; fi < footState.length; fi++) {
      var fs = footState[fi];
      if (!fs || !fs.particle) continue;
      fs.particle.pos.mutableSet(fs.current);
      fs.particle.lastPos.mutableSet(fs.current);
    }
  }

  function updateFootTriggers() {
    var spatialOpts = _spatialOpts();
    for (var fi = 0; fi < footState.length; fi++) {
      var fs = footState[fi];
      if (fs.stepping || fs.cooldown > 0) continue;
      var drift2 = fs.current.dist2(spider.thorax.pos);
      var partner = footState[fi % 2 === 0 ? fi + 1 : fi - 1];
      var ps = partner && partner.stepping;
      if (ps) continue;
      if (target && drift2 > STEP_THRESH * STEP_THRESH) {
        triggerStep(fi, moveDir, footState, spiderweb, spider, samplePoints, moveDir, STEP_COOLDOWN, spatialOpts);
      } else if (!target && drift2 > REST_THRESH * REST_THRESH) {
        triggerStep(fi, null, footState, spiderweb, spider, samplePoints, moveDir, STEP_COOLDOWN, spatialOpts);
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
    launchObject: launchObject
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
    statsBeginFrame();

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
    /* 移动端每 3 帧渲染一次背景（约 20fps），桌面端每帧渲染 */
    if (!IS_MOBILE || _bgFrame % 3 === 0) {
      renderSylvanBackground();
    }

    if (gameState === 'IDLE' || gameState === 'GAME_OVER') {
      updateLevelTimer();
      countSimStats(0);
      statsEndFrame(timestamp);
      updateStatsPanel();
      requestAnimFrame(loop);
      return;
    }

    captureThrownStickPrev();

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
        if (fs.landedNode) {
          if (fs.landedNode.pos) {
            fs.current.x = fs.landedNode.pos.x; fs.current.y = fs.landedNode.pos.y;
          } else fs.landedNode = null;
        } else if (fs.landedSeg) {
          var sp = fs.landedSeg;
          if (sp.pa && sp.pb && sp.pa.pos && sp.pb.pos) {
            fs.current.x = sp.pa.pos.x + (sp.pb.pos.x - sp.pa.pos.x) * sp.t;
            fs.current.y = sp.pa.pos.y + (sp.pb.pos.y - sp.pa.pos.y) * sp.t;
          } else fs.landedSeg = null;
        }
        if (fs.landedNode || fs.landedSeg) { fs.particle.pos.mutableSet(fs.current); fs.particle.lastPos.mutableSet(fs.current); }
      }
    }

    integrateThrownObjects();

    /* Phase C：physics → build → query（单步 11 iter，仅蛛网受重力） */
    var physicsIters = 11;
    countSimStats(physicsIters);
    sim.frame(
      physicsIters,
      USE_LEGACY_COLLISION ? null : _constraintAlive
    );
    _resyncFootParticles();

    if (USE_LEGACY_COLLISION) updateSamplePoints(samplePoints);
    else rebuildSpatialIndex();

    updateFootTriggers();

    /* 断网红闪帧计数 */
    _breakFrame++;
    if (webBreakFlashes.length > 0) {
      var flashWrite = 0;
      for (var fwi = 0; fwi < webBreakFlashes.length; fwi++) {
        if (_breakFrame - webBreakFlashes[fwi].t < 20) webBreakFlashes[flashWrite++] = webBreakFlashes[fwi];
      }
      webBreakFlashes.length = flashWrite;
    }

    /* wave system */
    updateLevelTimer();
    updateLevelSpawner();
    checkWebIntegrity();

    queryThrownStick();
    tryCollectObjects();
    if (pendingLevelCheck) { pendingLevelCheck = false; checkLevelComplete(); }

    updateBlink();
    sim.draw();
    drawThrownObjects(sim.ctx, thrownObjects);
    if (spider && spider.drawConstraints) spider.drawConstraints(sim.ctx, spider);
    statsEndFrame(timestamp);
    updateStatsPanel();
    requestAnimFrame(loop);
  };
  requestAnimFrame(loop);
};
