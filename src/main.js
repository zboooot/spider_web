/* Version: V3.2 — Sylvan Background + Procedural BGM */
import { Vec2 } from './engine/Vec2.js';
import { Particle } from './engine/Particle.js';
import { DistanceConstraint } from './engine/constraints.js';
import { Composite } from './engine/Composite.js';
import { VerletJS } from './engine/VerletJS.js';

import { createSpiderweb } from './entities/spiderweb.js';
import { createSpider } from './entities/spider.js';
import { ThrownObj, clearObjectConstraints, collapseChain } from './entities/ThrownObj.js';

import {
  getWebSamplePoints, updateSamplePoints,
  liftFoot, landFoot, triggerStep,
  getNextPid
} from './systems/footSystem.js';

import {
  getWebOuterR, inWebZone, radialRatioAt,
  collectPathHitCandidates, collectPathHitCandidatesSpatial, chooseStickCandidate,
  findNearestWebSegment,
  mergeStickHits, stickHitScratch
} from './systems/stickSystem.js';
import { findWrappedReanchorPoint } from './systems/wrappedSupport.js';

import {
  buildWebGridList, cellCovered,
  scanWebCellsBatch, WEB_BUILD_BATCH, WEB_RESCAN_BATCH
} from './systems/webIntegrity.js';

import {
  spatialIndex, spatialQueryBuf,
  assignWebConstraintIds, resetWebConstraintIds
} from './physics/SpatialIndexService.js';

import {
  LEVEL_CONFIGS, SCORE_MULT,
  calcCollectedSilk, getLevelCfg, getWaveCfg, framesToTime
} from './systems/levelSystem.js';
import { SHARED_GAME_DEFAULTS } from './data/sharedGameDefaults.js';

import { audioEngine } from './audio/audioEngine.js';

import { setupWebDraw } from './render/webRenderer.js';
import { setupSpiderDraw } from './render/spiderRenderer.js';
import { drawThrownObjects, buildSilkSpiral, buildCollectSnapshot, drawWrappingOverlay } from './render/objectRenderer.js';
import { renderArtToCanvas, renderInventoryArts } from './render/inventoryArt.js';

import {
  initSylvanBackground,
  updateSylvanBackground,
  renderSylvanBackground,
  switchSylvanTheme,
  bgConfig,
  applyBgBlur,
  applyBgPresentation,
  applyBgVignette,
  setBgParticleCount,
  THEMES as BG_THEMES
} from './render/sylvanBackground.js';

import { initOverlay, showOverlay, hideOverlay, refreshWaveHUD, playCollectFX, playFloatingText } from './ui/overlay.js';
import { initPanel } from './ui/panel.js';

import {
  statsBeginFrame, statsEndFrame, statsSetScene, statsBindPanel,
  statsTimeStart, statsTimeEnd, statsGetPanelVisible, statsSetPanelVisible
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
  var WAVE_CONFIG_STORAGE_KEY = 'spiderWaveConfigs';
  var LEVEL_CONDITIONS_STORAGE_KEY = 'spiderLevelConditions';

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeWaveConfigs(configs) {
    if (!Array.isArray(configs)) return configs;
    configs.forEach(function (level) {
      if (!level || !Array.isArray(level.waves)) return;
      level.waves.forEach(function (wave) {
        if (!wave) return;
        if (wave.burstGap == null && wave.cooldownDuration != null) wave.burstGap = wave.cooldownDuration;
        if (wave.burstGap == null) wave.burstGap = 0;
        if (wave.burstIntervalMin == null && wave.burstInterval != null) wave.burstIntervalMin = wave.burstInterval;
        if (wave.burstIntervalMax == null && wave.burstInterval != null) wave.burstIntervalMax = wave.burstInterval;
        if (wave.burstIntervalMin == null) wave.burstIntervalMin = 30;
        if (wave.burstIntervalMax == null) wave.burstIntervalMax = wave.burstIntervalMin;
        if (wave.burstCount == null) {
          var avgBurstSize = ((wave.burstMin || 1) + (wave.burstMax || 1)) * 0.5;
          var avgInterval = ((wave.burstIntervalMin || 0) + (wave.burstIntervalMax || 0)) * 0.5;
          var avgBurstFrames = Math.max(0, avgBurstSize - 1) * avgInterval;
          var baseFalling = Math.max(0, wave.fallingDuration || 0);
          var denom = Math.max(1, avgBurstFrames + (wave.burstGap || 0));
          wave.burstCount = Math.max(1, Math.round((baseFalling - (wave.firstBurstDelay || 0) + (wave.burstGap || 0)) / denom));
        }
      });
    });
    return configs;
  }

  function replaceLevelConfigs(nextConfigs) {
    LEVEL_CONFIGS.splice(0, LEVEL_CONFIGS.length);
    nextConfigs.forEach(function (levelCfg) {
      LEVEL_CONFIGS.push(levelCfg);
    });
  }

  function mergePlainObject(baseObj, savedObj) {
    var out = cloneJson(baseObj || {});
    if (!savedObj || typeof savedObj !== 'object') return out;
    Object.keys(savedObj).forEach(function (key) {
      if (savedObj[key] != null) out[key] = savedObj[key];
    });
    return out;
  }

  function mergeWaveWithBase(baseWave, savedWave) {
    var out = cloneJson(baseWave || {});
    if (!savedWave || typeof savedWave !== 'object') return out;
    Object.keys(savedWave).forEach(function (key) {
      if (key === 'catR' || key === 'flyR') return;
      if (key === 'spawnWeights') {
        out.spawnWeights = mergePlainObject(baseWave && baseWave.spawnWeights, savedWave.spawnWeights);
      } else if (savedWave[key] != null) {
        out[key] = savedWave[key];
      }
    });
    return out;
  }

  function applySharedWaveConfigs(sharedWaveConfigs) {
    if (!Array.isArray(sharedWaveConfigs)) return;
    for (var i = 0; i < LEVEL_CONFIGS.length; i++) {
      var baseLevel = LEVEL_CONFIGS[i];
      var sharedLevel = sharedWaveConfigs[i];
      if (!sharedLevel || !Array.isArray(sharedLevel.waves)) continue;
      var nextWaves = [];
      var waveCount = Math.max(baseLevel.waves.length, sharedLevel.waves.length);
      for (var wi = 0; wi < waveCount; wi++) {
        var baseWave = baseLevel.waves[Math.min(wi, baseLevel.waves.length - 1)];
        var sharedWave = sharedLevel.waves[wi];
        nextWaves.push(mergeWaveWithBase(baseWave, sharedWave));
      }
      LEVEL_CONFIGS[i].waves = nextWaves;
    }
    normalizeWaveConfigs(LEVEL_CONFIGS);
  }

  function applySharedLevelConditions(sharedLevelConditions) {
    if (!Array.isArray(sharedLevelConditions)) return;
    for (var i = 0; i < LEVEL_CONFIGS.length; i++) {
      if (!sharedLevelConditions[i]) continue;
      LEVEL_CONFIGS[i].targets = mergePlainObject(LEVEL_CONFIGS[i].targets, sharedLevelConditions[i]);
    }
  }

  normalizeWaveConfigs(LEVEL_CONFIGS);
  applySharedWaveConfigs(SHARED_GAME_DEFAULTS.waveConfigs);
  applySharedLevelConditions(SHARED_GAME_DEFAULTS.levelConditions);
  var BASE_LEVEL_CONFIGS = cloneJson(LEVEL_CONFIGS);
  var BASE_LEVEL_TARGETS = BASE_LEVEL_CONFIGS.map(function (level) { return cloneJson(level.targets); });

  function loadSavedWaveConfigs() {
    try {
      var raw = localStorage.getItem(WAVE_CONFIG_STORAGE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      for (var i = 0; i < LEVEL_CONFIGS.length; i++) {
        var baseLevel = BASE_LEVEL_CONFIGS[i];
        var savedLevel = parsed[i];
        if (!savedLevel || !Array.isArray(savedLevel.waves)) continue;
        var nextWaves = [];
        var waveCount = Math.max(baseLevel.waves.length, savedLevel.waves.length);
        for (var wi = 0; wi < waveCount; wi++) {
          var baseWave = baseLevel.waves[Math.min(wi, baseLevel.waves.length - 1)];
          var savedWave = savedLevel.waves[wi];
          nextWaves.push(mergeWaveWithBase(baseWave, savedWave));
        }
        LEVEL_CONFIGS[i].waves = nextWaves;
      }
      normalizeWaveConfigs(LEVEL_CONFIGS);
    } catch (e) { }
  }

  function sanitizeWaveForStorage(wave) {
    var out = cloneJson(wave || {});
    delete out.catR;
    delete out.flyR;
    return out;
  }

  function saveWaveConfigsToStorage() {
    var wavePayload = LEVEL_CONFIGS.map(function (level) {
      return {
        waves: (level.waves || []).map(function (wave) {
          return sanitizeWaveForStorage(wave);
        })
      };
    });
    localStorage.setItem(WAVE_CONFIG_STORAGE_KEY, JSON.stringify(wavePayload));
  }

  function buildSharedDefaultsPayload(P) {
    return {
      panelParams: cloneJson(P),
      waveConfigs: LEVEL_CONFIGS.map(function (level) {
        return {
          waves: (level.waves || []).map(function (wave) {
            return sanitizeWaveForStorage(wave);
          })
        };
      }),
      levelConditions: LEVEL_CONFIGS.map(function (level) {
        return cloneJson(level.targets);
      })
    };
  }

  function resetWaveConfigsToDefault() {
    for (var i = 0; i < LEVEL_CONFIGS.length; i++) {
      LEVEL_CONFIGS[i].waves = cloneJson(BASE_LEVEL_CONFIGS[i].waves);
    }
    normalizeWaveConfigs(LEVEL_CONFIGS);
    localStorage.removeItem(WAVE_CONFIG_STORAGE_KEY);
  }

  function loadSavedLevelConditions() {
    try {
      var raw = localStorage.getItem(LEVEL_CONDITIONS_STORAGE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      for (var i = 0; i < LEVEL_CONFIGS.length; i++) {
        if (!parsed[i]) continue;
        LEVEL_CONFIGS[i].targets = mergePlainObject(BASE_LEVEL_TARGETS[i], parsed[i]);
      }
    } catch (e) { }
  }

  function saveLevelConditionsToStorage() {
    var payload = LEVEL_CONFIGS.map(function (level) {
      return cloneJson(level.targets);
    });
    localStorage.setItem(LEVEL_CONDITIONS_STORAGE_KEY, JSON.stringify(payload));
  }

  function resetLevelConditionsToDefault(levelIndex) {
    if (typeof levelIndex === 'number') {
      LEVEL_CONFIGS[levelIndex].targets = cloneJson(BASE_LEVEL_TARGETS[levelIndex]);
      saveLevelConditionsToStorage();
    } else {
      for (var i = 0; i < LEVEL_CONFIGS.length; i++) {
        LEVEL_CONFIGS[i].targets = cloneJson(BASE_LEVEL_TARGETS[i]);
      }
      localStorage.removeItem(LEVEL_CONDITIONS_STORAGE_KEY);
    }
  }

  loadSavedWaveConfigs();
  loadSavedLevelConditions();

  /* ── params ── */
  var DEFAULTS = {
    webRadius: 1.45, webSegs: 30, webDepth: 11, webStiff: 0.6,
    radialWobbleScale: 0.55, spiralWobbleScale: 1.0,
    moveSpeed: 1.8, stepSpeed: 0.18, stepThresh: 22, restThresh: 50,
    legStiff: 0.3, jointStiff: 0.35,
    stickDelayMin: 0.10, stickDelayMax: 0.45, stickCatchRadius: 18,
    stickMidBias: 0.8, stickHistory: 40,
    caterpillarGravity: 2.0,
    caterpillarWeight: 5, flyWeight: 3, leafWeight: 1,
    leafGravityMin: 0.5, leafGravityMax: 0.6, leafMaxSpeed: 0.8,
    caterpillarReleaseSec: 5, flyReleaseSec: 3.5, leafReleaseSec: 0,
    bgTheme: 0, bgBlur: 25, bgWind: 1.0, bgRay: 100,
    bgDarken: 15, bgPurity: 140, bgYOffset: 13,
    bgPart: 24, bgVol: 50, bgMusicOn: 1, bgLayoutVersion: 3,
    stubReachRadius: 200, stubSnapRadius: 28, repairPatch: 1
  };
  Object.assign(DEFAULTS, cloneJson(SHARED_GAME_DEFAULTS.panelParams || {}));
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
  sim.stubReachRadius = P.stubReachRadius;
  sim.snapRadius = P.stubSnapRadius;

  /* ── 拖拽弹性视差交互状态机 ── */
  var _dragStart = { x: 0, y: 0 };
  var _dragOffset = { x: 0, y: 0 };
  var _smoothDrag = { x: 0, y: 0 };
  var _pointerStartClient = { x: 0, y: 0 };
  var _pointerMoved = false;
  var TAP_MOVE_THRESHOLD = 12;
  var PICKUP_PULL_STRENGTH = 0.26;
  var PICKUP_TENSION_THRESHOLD = 0.42;
  var PICKUP_TENSION_RELEASE_RATE = 0.05;
  var STUCK_PLUCK_THRESHOLD = 0.72;
  var STUCK_BREAK_THRESHOLD = 1.1;
  var STUCK_FORCE_THRESHOLD_BOULDER = 14;
  var STUCK_FORCE_THRESHOLD_BUG = 12;
  var STUCK_FORCE_THRESHOLD_POOP = 6;
  var STUCK_OVERFORCE_BOULDER = 15;
  var STUCK_OVERFORCE_BUG = 12;
  var STUCK_OVERFORCE_POOP = 7;
  var _pickupDrag = null;
  var _suppressMoveCommand = false;

  function _getCanvasPos(clientX, clientY) {
    var r = canvas.getBoundingClientRect();
    return {
      x: (clientX - r.left) * (W / r.width),
      y: (clientY - r.top) * (H / r.height)
    };
  }

  function _getWrappedPickupRadius(obj) {
    if (obj.kind === 'boulder') return obj.def.r * 5.6;
    if (obj.kind === 'drop') return obj.def.r * 5.0;
    if (obj.kind === 'poop') return obj.def.r * 2.2;
    return obj.def.r * 3.8;
  }

  function _getPickupForceThreshold(obj) {
    if (obj.kind === 'boulder') return 8;
    if (obj.kind === 'bug') return 5;
    return 3;
  }

  function _findWrappedPreyAt(clientX, clientY) {
    var pos = _getCanvasPos(clientX, clientY);
    var best = null;
    var bestD2 = Infinity;
    for (var oi = 0; oi < thrownObjects.length; oi++) {
      var obj = thrownObjects[oi];
      if (obj.state !== 'wrapped' && obj.state !== 'stuck') continue;
      if (obj.state === 'stuck' && obj.kind === 'drop') continue;
      var p = obj.particle.pos;
      var radius = _getWrappedPickupRadius(obj);
      var dx = pos.x - p.x, dy = pos.y - p.y, d2 = dx * dx + dy * dy;
      if (d2 > radius * radius) continue;
      if (d2 < bestD2) {
        best = obj;
        bestD2 = d2;
      }
    }
    return best ? { obj: best, pos: pos } : null;
  }

  function _beginWrappedPickup(clientX, clientY) {
    if (sim.draggedEntity && sim.draggedEntity.__isStub) return false; /* stub 优先 */
    var hit = _findWrappedPreyAt(clientX, clientY);
    if (!hit) return false;
    _pickupDrag = {
      obj: hit.obj,
      startX: hit.obj.particle.pos.x,
      startY: hit.obj.particle.pos.y,
      pointerX: hit.pos.x,
      pointerY: hit.pos.y,
      gripDX: hit.pos.x - hit.obj.particle.pos.x,
      gripDY: hit.pos.y - hit.obj.particle.pos.y,
      active: true
    };
    hit.obj._pickupTension = 0;
    hit.obj._pickupCharge = 0;
    hit.obj.dragStrain = 0;
    if (hit.obj.kind === 'poop') {
      hit.obj.playerDragging = true;
      _suppressPriorityClick = true;
    }
    audioEngine.startPickupTearLoop();
    audioEngine.updatePickupTearLoop(0);
    _suppressMoveCommand = true;
    sim.draggedEntity = null;
    return true;
  }

  function _updateWrappedPickup(clientX, clientY) {
    if (!_pickupDrag) return false;
    var pos = _getCanvasPos(clientX, clientY);
    _pickupDrag.pointerX = pos.x;
    _pickupDrag.pointerY = pos.y;
    _pointerMoved = true;
    sim.draggedEntity = null;
    return false;
  }

  function _endWrappedPickup() {
    if (_pickupDrag) {
      if (_pickupDrag.obj) {
        _pickupDrag.obj._pickupTension = 0;
        _pickupDrag.obj._pickupCharge = 0;
        _pickupDrag.obj.dragStrain = 0;
        _pickupDrag.obj.playerDragging = false;
      }
      audioEngine.stopPickupTearLoop();
      _suppressMoveCommand = true;
      _pickupDrag = null;
      sim.draggedEntity = null;
      return true;
    }
    return false;
  }

  window.addEventListener('mousedown', function (e) {
    _beginWrappedPickup(e.clientX, e.clientY);
    var p = _getCanvasPos(e.clientX, e.clientY);
    _dragStart.x = p.x; _dragStart.y = p.y;
    _dragOffset.x = 0; _dragOffset.y = 0;
    _pointerStartClient.x = e.clientX;
    _pointerStartClient.y = e.clientY;
    _pointerMoved = false;
  });
  window.addEventListener('mousemove', function (e) {
    if (_updateWrappedPickup(e.clientX, e.clientY)) return;
    if (sim.mouseDown) {
      var p = _getCanvasPos(e.clientX, e.clientY);
      _dragOffset.x = p.x - _dragStart.x;
      _dragOffset.y = p.y - _dragStart.y;
      var moveDx = e.clientX - _pointerStartClient.x;
      var moveDy = e.clientY - _pointerStartClient.y;
      if (Math.sqrt(moveDx * moveDx + moveDy * moveDy) >= TAP_MOVE_THRESHOLD) _pointerMoved = true;
    }
  });
  window.addEventListener('mouseup', function () {
    _endWrappedPickup();
    _dragOffset.x = 0; _dragOffset.y = 0;
  });
  window.addEventListener('touchstart', function (e) {
    if (e.touches.length > 0) {
      _beginWrappedPickup(e.touches[0].clientX, e.touches[0].clientY);
      var p = _getCanvasPos(e.touches[0].clientX, e.touches[0].clientY);
      _dragStart.x = p.x; _dragStart.y = p.y;
      _dragOffset.x = 0; _dragOffset.y = 0;
      _pointerStartClient.x = e.touches[0].clientX;
      _pointerStartClient.y = e.touches[0].clientY;
      _pointerMoved = false;
    }
  }, { passive: true });
  window.addEventListener('touchmove', function (e) {
    if (e.touches.length > 0 && _updateWrappedPickup(e.touches[0].clientX, e.touches[0].clientY)) return;
    if (sim.mouseDown && e.touches.length > 0) {
      var p = _getCanvasPos(e.touches[0].clientX, e.touches[0].clientY);
      _dragOffset.x = p.x - _dragStart.x;
      _dragOffset.y = p.y - _dragStart.y;
      var moveDx = e.touches[0].clientX - _pointerStartClient.x;
      var moveDy = e.touches[0].clientY - _pointerStartClient.y;
      if (Math.sqrt(moveDx * moveDx + moveDy * moveDy) >= TAP_MOVE_THRESHOLD) _pointerMoved = true;
    }
  }, { passive: true });
  window.addEventListener('touchend', function () {
    _endWrappedPickup();
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
  var _webDrawApi = null;
  var spiderweb, spider, legConstraintCount, samplePoints = [], footState = [];
  var STEP_SPEED, STEP_THRESH, REST_THRESH, STEP_COOLDOWN = 6;
  var target = null, moveDir = null, moveSpeed = P.moveSpeed, arriveThreshold = 6;
  var _spawnAnim = { active: false, t: 0, fromY: 0, toY: 0, duration: 52 };
  var _samplePointsTopologyVersion = -1;
  var _gaitTuneDefaults = {
    minStepDistMove: 28,
    minStepDistIdle: 22,
    maxHipTargetDist: 60,
    segPenaltyMoving: 160,
    segPenaltyLowMove: 280,
    segPenaltyStable: 760,
    forwardMinProgressMove: 18,
    forwardMinProgressIdle: 10,
    forwardProgressPenalty: 18,
    holdNodeBase: 11,
    holdNodeScale: 0.08,
    holdNodeMin: 6,
    holdNodeMax: 12,
    holdSegBase: 14,
    holdSegScale: 0.1,
    holdSegMin: 8,
    holdSegMax: 16
  };
  if (typeof window !== 'undefined') window._gaitTune = Object.assign({}, _gaitTuneDefaults, window._gaitTune || {});

  /* ── blink + mood ── */
  var blinkState = { scale: 1, blinking: false, t: 0, nextBlink: 180 + Math.floor(Math.random() * 240), mood: 'calm', headShake: 0, headShakeAmp: 0 };
  var _autoTarget = new Vec2(0, 0); /* 复用对象，避免每帧 GC */
  var isGameplayTestMode = false;

  function updateBlink() {
    var blinkInterval = blinkState.mood === 'startled' ? 40 + Math.floor(Math.random() * 60)
                      : blinkState.mood === 'curious'  ? 120 + Math.floor(Math.random() * 180)
                      : 180 + Math.floor(Math.random() * 300);
    if (blinkState.blinking) {
      blinkState.t += 0.18;
      if (blinkState.t <= 1) blinkState.scale = 1 - 0.95 * (blinkState.t < 0.5 ? 2 * blinkState.t * blinkState.t : -1 + (4 - 2 * blinkState.t) * blinkState.t);
      else if (blinkState.t <= 2) { var t2 = blinkState.t - 1; blinkState.scale = 0.05 + 0.95 * (t2 < 0.5 ? 2 * t2 * t2 : -1 + (4 - 2 * t2) * t2); }
      else { blinkState.scale = 1; blinkState.blinking = false; blinkState.t = 0; blinkState.nextBlink = blinkInterval; }
    } else { blinkState.nextBlink--; if (blinkState.nextBlink <= 0) { blinkState.blinking = true; blinkState.t = 0; } }

    if (blinkState.headShake > 0) {
      blinkState.headShake--;
      blinkState.headShakeAmp *= 0.88;
    }
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
    spiderweb = createSpiderweb(sim, new Vec2(ocx, ocy), rad, segs, depth, P.webStiff, pStep, {
      radialStiffnessMul: 1.4,
      spiralStiffnessMul: 0.85,
      radialTensorMul: 0.85,
      spiralTensorMul: 1.0,
      centerTensionBoost: 0.08
    });
    sim.gravityComposite = spiderweb;
    webCx = ocx; webCy = ocy; webRad = rad;
    assignWebConstraintIds(spiderweb);
    spatialIndex.syncAliveFromWeb(spiderweb);
    var wi = sim.composites.indexOf(spiderweb);
    if (wi !== 0) { sim.composites.splice(wi, 1); sim.composites.unshift(spiderweb); }
    samplePoints = getWebSamplePoints(spiderweb, 4);
    _samplePointsTopologyVersion = spiderweb._topologyVersion || 0;
    setupWebDraw(spiderweb, function () { return thrownObjects; }, function () { return webBreakFlashes; }, function () { return _breakFrame; }, function () { return brokenEnds; }, function () { return sim.snapTarget; });
  }

  function _syncStepSearchTopology() {
    if (!spiderweb) return;
    var curVer = spiderweb._topologyVersion || 0;
    if (curVer !== _samplePointsTopologyVersion) {
      samplePoints = getWebSamplePoints(spiderweb, 4);
      _samplePointsTopologyVersion = curVer;
    }
    updateSamplePoints(samplePoints);
  }

  function _collectAliveWebPoints() {
    if (!spiderweb) return [];
    var alive = [];
    var seen = [];
    for (var ci = 0; ci < spiderweb.constraints.length; ci++) {
      var c = spiderweb.constraints[ci];
      if (!c || !c.a || !c.b || !c.a.pos || !c.b.pos) continue;
      if (seen.indexOf(c.a) === -1) { seen.push(c.a); alive.push({ x: c.a.pos.x, y: c.a.pos.y }); }
      if (seen.indexOf(c.b) === -1) { seen.push(c.b); alive.push({ x: c.b.pos.x, y: c.b.pos.y }); }
    }
    for (var si = 0; si < samplePoints.length; si++) {
      var sp = samplePoints[si];
      if (!sp || !sp.pa || !sp.pb) continue;
      alive.push({ x: sp.x, y: sp.y });
    }
    return alive;
  }

  function _snapPointToWeb(x, y, fromPos, maxReach, forwardDir) {
    var pts = _collectAliveWebPoints();
    if (!pts.length) return null;
    var best = null;
    var bestScore = Number.POSITIVE_INFINITY;
    var maxReach2 = maxReach != null ? maxReach * maxReach : 0;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (fromPos) {
        var fdx = p.x - fromPos.x, fdy = p.y - fromPos.y;
        var fd2 = fdx * fdx + fdy * fdy;
        if (maxReach != null && fd2 > maxReach2) continue;
        if (forwardDir) {
          var dot = fdx * forwardDir.x + fdy * forwardDir.y;
          if (dot < -4) continue;
        }
      }
      var dx = p.x - x, dy = p.y - y;
      var score = dx * dx + dy * dy;
      if (fromPos) {
        var tdx = p.x - fromPos.x, tdy = p.y - fromPos.y;
        score += (tdx * tdx + tdy * tdy) * 0.15;
      }
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best ? new Vec2(best.x, best.y) : null;
  }

  function buildSpider() {
    if (spider) { var si = sim.composites.indexOf(spider); if (si !== -1) sim.composites.splice(si, 1); }
    var spawnFromY = cy - 110;
    spider = createSpider(sim, new Vec2(cx, spawnFromY), { legStiff: P.legStiff, jointStiff: P.jointStiff });
    spider.thorax.pos.mutableSet(new Vec2(cx, spawnFromY)); spider.thorax.lastPos.mutableSet(new Vec2(cx, spawnFromY));
    spider.head.pos.mutableSet(new Vec2(cx, spawnFromY - 6)); spider.head.lastPos.mutableSet(new Vec2(cx, spawnFromY - 6));
    spider.abdomen.pos.mutableSet(new Vec2(cx, spawnFromY + 12)); spider.abdomen.lastPos.mutableSet(new Vec2(cx, spawnFromY + 12));
    legConstraintCount = spider.constraints.length;
    STEP_SPEED = P.stepSpeed; STEP_THRESH = P.stepThresh; REST_THRESH = P.restThresh;
    footState = spider.legs.map(function (lp, idx) {
      var footOffsets = [
        new Vec2(16, -1),
        new Vec2(-16, -1),
        new Vec2(15, 4),
        new Vec2(-15, 4)
      ];
      var ip = new Vec2(cx + footOffsets[idx].x, spawnFromY + footOffsets[idx].y);
      lp.pos.mutableSet(ip); lp.lastPos.mutableSet(ip);
      return {
        particle: lp, current: new Vec2(ip.x, ip.y), from: new Vec2(ip.x, ip.y),
        targetPos: new Vec2(ip.x, ip.y), targetStepPoint: null,
        landedNode: null, landedSeg: null, constraintA: null, constraintB: null,
        stepping: false, t: 1, cooldown: idx * 6, needsEmergencyStep: false
      };
    });
    _spawnAnim.active = true;
    _spawnAnim.t = 0;
    _spawnAnim.fromY = spawnFromY;
    _spawnAnim.toY = cy;
    _spawnAnim.duration = 52;
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

  (function initStatsPanelToggle() {
    var btn = document.getElementById('btn-stats-toggle');
    if (!btn) return;
    function syncBtn() {
      btn.textContent = statsGetPanelVisible()
        ? '\uD83D\uDCCA \u9690\u85cf\u6027\u80fd\u9762\u677f'
        : '\uD83D\uDCCA \u663e\u793a\u6027\u80fd\u9762\u677f';
    }
    syncBtn();
    btn.onclick = function () {
      statsSetPanelVisible(!statsGetPanelVisible());
      syncBtn();
    };
  })();

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
  var objCounts = { boulder: 0, bug: 0, drop: 0, poop: 0 };
  var inventoryCounts = { boulder: 0, bug: 0, drop: 0 };
  var wrappingTarget = null;
  var userPriorityTarget = null; /* { type:'object'|'point', obj?, point? } */
  var autoChaseTarget = null;   /* 自动模式下当前锁定的掉落物 */
  var brokenEnds = [];      /* 断线头粒子列表，每帧更新，传给 webRenderer */
  var repairQueue = [];     /* 补网任务队列 [{ring, pos, state, timer}] */
  var REPAIR_WORK_DUR = 50; /* 修复工作时长（帧），与树叶采集相同 */
  var autoPlay = true;      /* 自动寻路打包开关，默认开启 */
  var _autoPlayPause = 0;   /* 打包完成或丢失目标后的停顿帧计数 */
  var poopStunTimer = 0;
  var _suppressPriorityClick = false;
  var WAVE_FALLING = 'WAVE_FALLING';
  var WAVE_PAUSE = 'WAVE_PAUSE';
  var WAVE_OVERTIME = 'WAVE_OVERTIME';

  var gameState = 'IDLE';
  var currentLevelIndex = 0;
  var currentWaveIndex = 0;
  var currentWavePhase = WAVE_FALLING;
  var wavePhaseTimer = 0;
  var totalSilkCount = 0;
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
  var _burstParticles = []; /* 打包完成放射粒子 */
  var _currentTimeScale = 1.0; /* 子弹时间：供投掷物积分使用 */
  var _webDisplayPct = 100;   /* 当前显示值 */
  var _webTargetPct = 100;    /* 目标值 */
  var _webRollTimer = 0;      /* 滚动帧计数 */
  var _webRollFrom = 100;     /* 滚动起始值 */
  var silkCount = 0;

  /* ── 爆发-冷却掉落状态机 ── */
  var spawnPhase = 'start_delay';
  var burstCount = 0;
  var burstTimer = 0;
  var burstGapTimer = 0;
  var firstBurstDelayTimer = 0;
  var burstsDone = 0;
  var burstCountCur = 0;
  var levelCollected = { boulder: 0, bug: 0, drop: 0 };
  var webGridBuildIdx = 0;
  var webGridInitCover = 0;

  /* helper: get level/wave cfg with current difficulty */
  function getLevelCfgAt(n) { return getLevelCfg(n, difficultyLevel); }
  function getWaveCfgAt(levelIndex, waveIndex) { return getWaveCfg(levelIndex, waveIndex, difficultyLevel); }

  function refreshWavePhaseHUD() {
    var el = document.getElementById('phase-bar');
    if (!el) return;
    if (gameState !== 'LEVEL_ACTIVE') {
      el.style.display = 'none';
      return;
    }
    var phaseLabel = currentWavePhase === WAVE_PAUSE ? 'PAUSE'
      : currentWavePhase === WAVE_OVERTIME ? 'OVERTIME'
      : 'FALLING';
    el.style.display = 'block';
    el.textContent = 'L' + (currentLevelIndex + 1) + ' W' + (currentWaveIndex + 1) + ' ' + phaseLabel;
  }

  function resetSpawnerState(cfg) {
    spawnPhase = (cfg.firstBurstDelay || 0) > 0 ? 'start_delay' : 'burst_gap';
    firstBurstDelayTimer = 0;
    burstGapTimer = (cfg.firstBurstDelay || 0) > 0 ? 0 : (cfg.burstGap || 0);
    burstTimer = 0;
    burstCount = 0;
    burstsDone = 0;
    burstCountCur = 0;
  }

  function startBurst(cfg) {
    spawnPhase = 'burst';
    burstTimer = 0;
    cfg._currentBurstInterval = 0;
    burstCountCur = cfg.burstMin + Math.floor(Math.random() * (cfg.burstMax - cfg.burstMin + 1));
    burstCount = burstCountCur;
    if (burstCount > 0) {
      spawnRandom();
      burstCount--;
      if (burstCount > 0) {
        var minI = Math.min(cfg.burstIntervalMin, cfg.burstIntervalMax);
        var maxI = Math.max(cfg.burstIntervalMin, cfg.burstIntervalMax);
        cfg._currentBurstInterval = minI + Math.floor(Math.random() * (maxI - minI + 1));
      }
    }
    if (burstCount <= 0) {
      burstsDone++;
      spawnPhase = 'burst_gap';
      burstGapTimer = 0;
    }
  }

  function enterWaveFalling(waveIndex, overtime) {
    currentWaveIndex = waveIndex;
    currentWavePhase = overtime ? WAVE_OVERTIME : WAVE_FALLING;
    wavePhaseTimer = 0;
    resetSpawnerState(getWaveCfgAt(currentLevelIndex, currentWaveIndex));
    refreshWavePhaseHUD();
  }

  function enterWavePause() {
    currentWavePhase = WAVE_PAUSE;
    wavePhaseTimer = 0;
    refreshWavePhaseHUD();
  }

  function advanceWavePhase() {
    var levelCfg = getLevelCfgAt(currentLevelIndex);
    if (currentWaveIndex < levelCfg.waves.length - 1) {
      enterWaveFalling(currentWaveIndex + 1, false);
      return;
    }
    enterWaveFalling(currentWaveIndex, true);
  }

  function refreshSilkHUD() {
    var el = document.getElementById('silk-count');
    if (el) el.textContent = String(silkCount);
  }

  function refreshLevelTargetHUD() {
    var cfg = getLevelCfgAt(currentLevelIndex);
    ['boulder', 'bug'].forEach(function (k) {
      var el = document.getElementById('inv-' + k + '-count');
      if (el) el.textContent = levelCollected[k] + '/' + (cfg.targets[k] || 0);
    });
  }

  /* ── show IDLE start screen ── */
  showOverlay(
    '<div class="overlay-title">SPIDER WEB</div>'
    + '<div class="overlay-subtitle" style="margin-bottom:6px">Collect prey caught in the web</div>'
    + '<div class="overlay-subtitle" style="margin-bottom:22px;opacity:0.6">Keep the web intact. If it breaks, you lose.</div>'
    + '<button class="overlay-btn" id="btn-start-game">Start Game</button>'
    + '<br><button class="overlay-btn" style="background:#3b5f8a;margin-top:8px;display:none" id="btn-gameplay-test">Gameplay Test</button>'
  );
  document.getElementById('btn-start-game').onclick = startGameFromBeginning;
  document.getElementById('btn-gameplay-test').onclick = startGameplayTest;

  function pickObjectAt(x, y) {
    for (var i = thrownObjects.length - 1; i >= 0; i--) {
      var obj = thrownObjects[i];
      if (!obj || obj.state !== 'stuck') continue;
      var r = obj.def ? obj.def.r * 2.2 : 16;
      var dx = obj.particle.pos.x - x;
      var dy = obj.particle.pos.y - y;
      if (dx * dx + dy * dy <= r * r) return obj;
    }
    return null;
  }

  function _isWebAttachedState(state) {
    return state === 'sticking'
      || state === 'stuck'
      || state === 'freeing'
      || state === 'wrapping'
      || state === 'wrapped';
  }

  function _isWebConstraintAlive(c) {
    if (!c) return false;
    if (c.__webId && spatialIndex && typeof spatialIndex.isAliveId === 'function') {
      return spatialIndex.isAliveId(c.__webId);
    }
    return !!spiderweb && spiderweb.constraints.indexOf(c) !== -1;
  }

  function _isSpiderFootNodeAlive(node) {
    if (!node || !node.pos || !spiderweb) return false;
    for (var wi = 0; wi < spiderweb.constraints.length; wi++) {
      var wc = spiderweb.constraints[wi];
      if (!(wc instanceof DistanceConstraint)) continue;
      if (!_constraintAlive(wc)) continue;
      if (wc.a === node || wc.b === node) return true;
    }
    return false;
  }

  function _isSpiderFootSegmentAlive(sp) {
    if (!sp || !sp.pa || !sp.pb || !sp.pa.pos || !sp.pb.pos || !spiderweb) return false;
    for (var wi = 0; wi < spiderweb.constraints.length; wi++) {
      var wc = spiderweb.constraints[wi];
      if (!(wc instanceof DistanceConstraint)) continue;
      if (!_constraintAlive(wc)) continue;
      if ((wc.a === sp.pa && wc.b === sp.pb) || (wc.a === sp.pb && wc.b === sp.pa)) return true;
    }
    return false;
  }

  function _invalidateSpiderFoot(fs) {
    if (!fs) return;
    if (wrappingTarget) cancelWrappingDueToSupportLoss();
    liftFoot(fs, spider);
    fs.cooldown = 0;
    fs.needsEmergencyStep = true;
  }

  function _detachObjectFromBrokenWeb(obj) {
    if (!obj || !_isWebAttachedState(obj.state) || !obj.particle) return false;
    if (!obj.stuckOnConstraint && !obj.cA && !obj.cB) return false;
    var p = obj.particle;
    var currentVx = p.pos.x - p.lastPos.x;
    var currentVy = p.pos.y - p.lastPos.y;
    var detachKick = obj.kind === 'boulder'
      ? obj.def.weight * 0.405
      : obj.def.weight * 0.45;

    clearObjectConstraints(obj);
    obj.stuckOnConstraint = null;
    obj.state = 'falling2';
    obj.freeTimer = 0;
    obj.stayTimer = 0;
    obj.stickT = 0;
    obj.playerDragging = false;
    obj.dragStrain = 0;
    obj._pickupTension = 0;
    obj._pickupCharge = 0;
    p._noSimDrag = false;

    if (_pickupDrag && _pickupDrag.obj === obj) {
      _pickupDrag = null;
      sim.draggedEntity = null;
      obj.dragStrain = 0;
    }

    if (obj.kind === 'drop' || obj.kind === 'poop') {
      obj.vx = currentVx;
      obj.vy = currentVy + detachKick;
    }
    p.lastPos.x = p.pos.x - currentVx;
    p.lastPos.y = p.pos.y - (currentVy + detachKick);
    return true;
  }

  function spawnPoopBurst(x, y) {
    _burstParticles.push({
      x: x, y: y,
      vx: 0, vy: 0,
      life: 1.0,
      decay: 0.020,
      r: 13,
      grow: 0.156,
      drag: 0.904,
      speedScale: 1.5,
      smoke: true,
      occlude: 0.88,
      color: '#0a0808'
    });

    for (var i = 0; i < 36; i++) {
      var ang = (i / 36) * Math.PI * 2 + Math.random() * 0.6;
      var spd = 2.1 + Math.random() * 3.4;
      _burstParticles.push({
        x: x, y: y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd * 0.82,
        life: 1.0,
        decay: 0.024 + Math.random() * 0.012,
        r: 6.76 + Math.random() * 7.54,
        grow: 0.091 + Math.random() * 0.065,
        drag: 0.856 + Math.random() * 0.032,
        speedScale: 1.5,
        smoke: true,
        occlude: 0.78 + Math.random() * 0.08,
        color: ['#090707', '#151110', '#211917', '#2b221f'][Math.floor(Math.random() * 4)]
      });
    }

    for (var j = 0; j < 12; j++) {
      var ang2 = (j / 12) * Math.PI * 2 + Math.random() * 0.4;
      var spd2 = 4.6 + Math.random() * 2.8;
      _burstParticles.push({
        x: x, y: y,
        vx: Math.cos(ang2) * spd2,
        vy: Math.sin(ang2) * spd2 * 0.76,
        life: 1.0,
        decay: 0.040 + Math.random() * 0.016,
        r: 4.16 + Math.random() * 3.12,
        grow: 0.052 + Math.random() * 0.039,
        drag: 0.810 + Math.random() * 0.036,
        speedScale: 1.5,
        smoke: true,
        occlude: 0.82,
        color: '#120d0c'
      });
    }
  }

  function handlePoopCapture(obj) {
    var idx = thrownObjects.indexOf(obj);
    if (idx === -1) return;
    clearObjectConstraints(obj);
    obj.stuckOnConstraint = null;
    spawnPoopBurst(obj.particle.pos.x, obj.particle.pos.y);
    if (userPriorityTarget && userPriorityTarget.type === 'object' && userPriorityTarget.obj === obj) {
      clearPriorityTarget();
    }
    if (autoChaseTarget === obj) autoChaseTarget = null;
    obj.destroy(sim);
    thrownObjects.splice(idx, 1);
    updateBadge(obj.kind, -1);
    target = null;
    poopStunTimer = 180;
    pauseAndClearCurrentTarget();
  }

  function setPriorityTarget(x, y) {
    var picked = pickObjectAt(x, y);
    if (picked) {
      userPriorityTarget = { type: 'object', obj: picked };
      return;
    }
    /* 点目标只允许落在当前仍有网线覆盖的区域；网外或破洞无效 */
    if (!spiderweb || !cellCovered(x, y, spiderweb, webGridCoverD)) return;
    userPriorityTarget = { type: 'point', point: new Vec2(x, y) };
  }

  function setPriorityTargetFromClient(clientX, clientY) {
    var r = canvas.getBoundingClientRect();
    setPriorityTarget((clientX - r.left) * (W / r.width), (clientY - r.top) * (H / r.height));
  }

  function clearPriorityTarget() {
    userPriorityTarget = null;
  }

  function isTargetObjectChaseable(obj) {
    return !!(
      obj
      && thrownObjects.indexOf(obj) !== -1
      && obj.state === 'stuck'
      && !obj.playerDragging
    );
  }

  function pauseAndClearCurrentTarget() {
    target = null;
    autoChaseTarget = null;
    _autoPlayPause = 30; /* 0.5秒停顿 */
  }

  function getActivePriorityObject() {
    if (!userPriorityTarget || userPriorityTarget.type !== 'object') return null;
    var obj = userPriorityTarget.obj;
    return isTargetObjectChaseable(obj) ? obj : null;
  }

  /* click to move (desktop) */
  canvas.addEventListener('click', function (e) {
    e.stopPropagation();
    if (_suppressPriorityClick || sim.suppressClick || _touchWasSwipe || _pointerMoved) {
      _suppressPriorityClick = false;
      sim.suppressClick = false;
      _touchWasSwipe = false;
      return;
    }
    setPriorityTargetFromClient(e.clientX, e.clientY);
  });
  /* screen-shell 兜底：点击网外空白区域也能设置点目标 */
  screenShellEl.addEventListener('click', function (e) {
    if (e.target === canvas) return;
    if (e.target.closest('#inventory-bar') || e.target.closest('#dbg-web') || e.target.closest('#game-overlay')) return;
    if (_touchWasSwipe || _pointerMoved) { _touchWasSwipe = false; return; }
    setPriorityTargetFromClient(e.clientX, e.clientY);
  });

  /* tap to move (iOS / mobile) — touchend with no drag */
  var _touchStartX = 0, _touchStartY = 0;
  var _touchWasSwipe = false;
  canvas.addEventListener('touchstart', function (e) {
    if (e.touches.length === 1) {
      _touchStartX = e.touches[0].clientX;
      _touchStartY = e.touches[0].clientY;
      _touchWasSwipe = false;
    }
  }, { passive: true });
  canvas.addEventListener('touchend', function (e) {
    if (e.changedTouches.length === 1) {
      var t = e.changedTouches[0];
      var isTap = !_pointerMoved;
      _touchWasSwipe = !isTap;
      if (!_suppressPriorityClick && !sim.suppressClick && isTap) {
        setPriorityTargetFromClient(t.clientX, t.clientY);
      }
      _suppressPriorityClick = false;
      sim.suppressClick = false;
    }
    endPoopPointer();
  }, { passive: true });

  /* ── Game flow functions ── */
  function createWebOverrideForLevel(levelIndex) {
    var maxLevel = Math.max(1, LEVEL_CONFIGS.length - 1);
    var phase = Math.max(0, Math.min(1, levelIndex / maxLevel));
    /* 复杂度随关卡递增：辐射数、圈数、半径逐步增加，只保留少量随机抖动 */
    var segsBase = 20 + Math.round(phase * 14);   /* 20 -> 34 */
    var depthBase = 8 + Math.round(phase * 7);    /* 8 -> 15 */
    var radiusBase = 1.22 + phase * 0.28;         /* 1.22 -> 1.50 */
    return {
      segs: segsBase + Math.floor(Math.random() * 3),
      depth: depthBase + Math.floor(Math.random() * 2),
      radius: Math.round(Math.min(W, H) / 2 * (radiusBase + Math.random() * 0.08) * WEB_SCALE),
      cx: cx + (Math.random() - 0.5) * 24,
      cy: cy + (Math.random() - 0.5) * 24,
      pinStep: 4
    };
  }

  function startGame() {
    wrappingTarget = null;
    repairQueue = [];
    target = null;
    autoChaseTarget = null;
    clearPriorityTarget();
    _endWrappedPickup();
    silkCount = 0;
    refreshSilkHUD();
    totalSilkCount = 0;
    poopStunTimer = 0;
    currentLevelIndex = 0;
    currentWaveIndex = 0;
    gameFrames = 0;
    levelScored = false;
    var phaseBarEl = document.getElementById('phase-bar');
    if (phaseBarEl) phaseBarEl.style.display = 'none';
    webOverride = createWebOverrideForLevel(0);
    buildWeb(); buildSpider();
    startLevel(0);
  }

  function startGameFromBeginning() {
    isGameplayTestMode = false;
    difficultyLevel = 1;
    startGame();
  }

  function startGameplayTest() {
    isGameplayTestMode = true;
    difficultyLevel = 1;
    startGame();
  }

  function startLevel(n) {
    wrappingTarget = null;
    repairQueue = [];
    target = null;
    autoChaseTarget = null;
    clearPriorityTarget();
    _endWrappedPickup();
    currentLevelIndex = n;
    currentWaveIndex = 0;
    currentWavePhase = WAVE_FALLING;
    wavePhaseTimer = 0;
    levelTimer = 0;
    levelScored = false;
    pendingLevelCheck = false;
    poopStunTimer = 0;
    levelCollected = { boulder: 0, bug: 0, drop: 0 };
    inventoryCounts = { boulder: 0, bug: 0, drop: 0 };
    clearAllObjects();
    var cfg = getLevelCfgAt(n);
    ['boulder', 'bug'].forEach(function (k) {
      var el = document.getElementById('inv-' + k + '-count');
      if (el) el.textContent = '0/' + cfg.targets[k];
    });
    gameState = 'LEVEL_ACTIVE';
    hideOverlay();
    levelTimer = 0;
    webWarmupFrames = 90;
    webGridList = null; webInitCells = 1; webScanPending = 0; webRescanActive = false;
    webRescanIdx = 0; webRescanCover = 0; webLossPct = 0;
    webIntegrityState.webGridList = null;
    webIntegrityState.cellCovered = null;
    webIntegrityState.coveredCount = 0;
    webIntegrityState.dirtyIndices = [];
    webIntegrityState.dirtyFlags = null;
    webGridBuildIdx = 0; webGridInitCover = 0;
    brokenEnds = [];

    /* ── 同步切换背景主题与BGM ── */
    P.bgTheme = n;
    switchSylvanTheme(n);
    document.querySelectorAll('.bg-theme-dot').forEach(function (d, idx) {
      d.classList.toggle('active', idx === n);
    });
    if (P.bgMusicOn) audioEngine.playLevelBGM(n);
    enterWaveFalling(0, false);
  }

  function endLevel() {
    if (gameState !== 'LEVEL_ACTIVE' && gameState !== 'LEVEL_RESULT') return;
    if (levelScored) return;
    levelScored = true;
    var cfg = getLevelCfgAt(currentLevelIndex);
    var levelSilkGain = calcCollectedSilk(levelCollected, cfg.targets);
    totalSilkCount += levelSilkGain;
    var isLast = (currentLevelIndex >= LEVEL_CONFIGS.length - 1);
    if (isLast) showSuccess();
    else showLevelResult(levelSilkGain);
  }

  function showLevelResult(levelSilkGain) {
    if (gameState === 'GAME_OVER' || gameState === 'SUCCESS') return;
    gameState = 'LEVEL_RESULT';
    refreshWavePhaseHUD();
    audioEngine.playSfxSuccess();
    clearAllObjects();
    showOverlay(
      '<div class="overlay-title">Level Complete</div>'
      + '<div class="overlay-subtitle">Level targets secured.</div>'
      + '<button class="overlay-btn" id="btn-nextwv" style="margin-top:16px">Next Level</button>'
      + '<br><button class="overlay-btn" style="background:#555;margin-top:8px" id="btn-restart-wr">Restart</button>'
    );
    var btn = document.getElementById('btn-nextwv');
    if (btn) { btn.onclick = resetWebAndStartNextLevel; }
    document.getElementById('btn-restart-wr').onclick = startGameFromBeginning;
  }

  function resetWebAndStartNextLevel() {
    gameFrames = 0;
    webOverride = createWebOverrideForLevel(currentLevelIndex + 1);
    buildWeb(); buildSpider();
    startLevel(currentLevelIndex + 1);
  }

  function retryCurrentLevel() {
    gameFrames = 0;
    silkCount = 0;
    refreshSilkHUD();
    poopStunTimer = 0;
    webOverride = createWebOverrideForLevel(currentLevelIndex);
    buildWeb(); buildSpider();
    startLevel(currentLevelIndex);
  }

  function showSuccess() {
    if (gameState === 'SUCCESS' || gameState === 'GAME_OVER') return;
    gameState = 'SUCCESS';
    refreshWavePhaseHUD();
    audioEngine.playSfxSuccess();
    clearAllObjects();
    showOverlay(
      '<div class="overlay-title">All Levels Clear</div>'
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
    refreshWavePhaseHUD();
    audioEngine.playSfxGameOver();
    clearAllObjects();
    var timeUsed = framesToTime(gameFrames);
    showOverlay(
      '<div class="overlay-title">Web Broken</div>'
      + '<div class="overlay-subtitle">Survived&nbsp;' + timeUsed + '</div>'
      + '<button class="overlay-btn" id="btn-retry" style="margin-bottom:8px">Try Again</button>'
      + '<br><button class="overlay-btn" style="background:#555;margin-top:4px" id="btn-restart-f">Restart</button>'
    );
    document.getElementById('btn-retry').onclick = retryCurrentLevel;
    document.getElementById('btn-restart-f').onclick = startGameFromBeginning;
  }

  function checkLevelComplete() {
    var cfg = getLevelCfgAt(currentLevelIndex);
    var done = ['boulder', 'bug'].every(function (k) {
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

  function _spatialOpts() {
    return USE_LEGACY_COLLISION ? null : {
      index: spatialIndex,
      queryBuf: spatialQueryBuf
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
      var cov = cellCovered(
        webGridList[k].x, webGridList[k].y, spiderweb, webGridCoverD,
        USE_LEGACY_COLLISION ? null : spatialIndex
      );
      webIntegrityState.cellCovered[k] = cov ? 1 : 0;
      if (cov) webGridInitCover++;
    }
    webGridBuildIdx = end;
    if (webGridBuildIdx >= webGridList.length) {
      webInitCells = webGridInitCover || 1;
      webIntegrityState.coveredCount = webGridInitCover;
    }
  }

  function _onWebSegmentBroken(c, opts) {
    if (!c) return;
    if (c.__mainTrunk) return;
    if (c.__webId) spatialIndex.removeConstraint(c.__webId);
    for (var oi = thrownObjects.length - 1; oi >= 0; oi--) {
      var obj = thrownObjects[oi];
      if (!obj || obj === (opts && opts.sourceObj)) continue;
      if (obj.stuckOnConstraint !== c) continue;
      _detachObjectFromBrokenWeb(obj);
    }
    webScanPending = 12;
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

  /* ── 补网修复 ── */

  /**
   * BFS 找 A→B 的最短路径（沿网线，排除锚定边）
   * 返回路径节点数组 [A, ..., B]，找不到返回 null
   */
  function bfsPath(A, B, spiderweb) {
    if (A === B) return [A];

    /* 建邻接表 */
    var adj = {};
    for (var i = 0; i < spiderweb.constraints.length; i++) {
      var c = spiderweb.constraints[i];
      if (!(c instanceof DistanceConstraint)) continue;
      if (c.__isStubAnchor) continue;
      var idA = c.a.__pid, idB = c.b.__pid;
      if (!idA || !idB) continue;
      if (!adj[idA]) adj[idA] = [];
      if (!adj[idB]) adj[idB] = [];
      adj[idA].push({ node: c.b, pid: idB });
      adj[idB].push({ node: c.a, pid: idA });
    }

    var startPid = A.__pid, endPid = B.__pid;
    if (!startPid || !endPid) return null;
    if (!adj[startPid]) return null;

    var visited = {};
    var prev = {};    /* pid → { node, prevPid } */
    var queue = [{ node: A, pid: startPid }];
    visited[startPid] = true;

    while (queue.length > 0) {
      var cur = queue.shift();
      var neighbors = adj[cur.pid] || [];
      for (var ni = 0; ni < neighbors.length; ni++) {
        var nb = neighbors[ni];
        if (visited[nb.pid]) continue;
        visited[nb.pid] = true;
        prev[nb.pid] = { node: cur.node, pid: cur.pid };
        if (nb.pid === endPid) {
          /* 回溯路径 */
          var path = [B];
          var trace = endPid;
          while (prev[trace]) {
            path.push(prev[trace].node);
            trace = prev[trace].pid;
          }
          path.reverse();
          return path;
        }
        queue.push(nb);
      }
    }
    return null; /* 不连通 */
  }

  /**
   * 在环内部打补丁：根据环的大小创建新粒子和边
   * ring: 环上的节点数组（有序，首尾通过新边 A—B 闭合）
   */
  var REPAIR_TENSOR = 0.3; /* 与原网 spiderweb.js 的 tensor 保持一致 */

  function addRepairEdge(a, b, spiderweb) {
    var d = a.pos.dist(b.pos) * REPAIR_TENSOR;
    spiderweb.constraints.push(new DistanceConstraint(a, b, 0.6, d));
  }

  function patchHole(ring, spiderweb) {
    var len = ring.length;
    /* 环太小不需要补丁 */
    if (len <= 4) return;

    /* 计算环的几何中心 */
    var cx = 0, cy = 0;
    for (var i = 0; i < len; i++) {
      cx += ring[i].pos.x;
      cy += ring[i].pos.y;
    }
    cx /= len;
    cy /= len;

    /* 根据环大小决定补几个点 */
    var patchCount;
    if (len <= 6) patchCount = 1;       /* 5-6 节点：1个中心点 */
    else if (len <= 9) patchCount = 2;  /* 7-9 节点：2个点 */
    else patchCount = 3;                /* 10+ 节点：3个点 */

    var newPts = [];
    if (patchCount === 1) {
      /* 单点放中心 */
      newPts.push({ x: cx, y: cy });
    } else {
      /* 多点沿中心均匀分布 */
      var spreadR = 0;
      for (var si = 0; si < len; si++) {
        var sdx = ring[si].pos.x - cx, sdy = ring[si].pos.y - cy;
        spreadR += Math.sqrt(sdx * sdx + sdy * sdy);
      }
      spreadR = (spreadR / len) * 0.4; /* 环内半径的 40% */
      for (var pi = 0; pi < patchCount; pi++) {
        var ang = (pi / patchCount) * Math.PI * 2;
        newPts.push({
          x: cx + Math.cos(ang) * spreadR,
          y: cy + Math.sin(ang) * spreadR
        });
      }
    }

    /* 创建新粒子 */
    var newParticles = [];
    for (var ni = 0; ni < newPts.length; ni++) {
      var np = new Particle(new Vec2(newPts[ni].x, newPts[ni].y));
      np.__pid = getNextPid();
      spiderweb.particles.push(np);
      newParticles.push(np);
    }

    /* 连接新粒子到环上的节点 */
    var ringA = ring[0], ringB = ring[len - 1];
    var midNode = ring[Math.floor(len / 2)];
    if (patchCount === 1) {
      /* 补1个点：连 A、B、路径中间点 */
      var mp1 = newParticles[0];
      addRepairEdge(mp1, ringA, spiderweb);
      addRepairEdge(mp1, ringB, spiderweb);
      addRepairEdge(mp1, midNode, spiderweb);
    } else if (patchCount === 2) {
      /* 补2个点 P Q */
      var P = newParticles[0], Q = newParticles[1];
      var idxOneThird = Math.max(1, Math.floor(len / 3));
      var idxTwoThird = Math.min(len - 2, Math.floor(len * 2 / 3));
      var nodeNearA = ring[idxOneThird];
      var nodeNearB = ring[idxTwoThird];
      /* P 连 A、Q、路径1/3处 */
      addRepairEdge(P, ringA, spiderweb);
      addRepairEdge(P, Q, spiderweb);
      addRepairEdge(P, nodeNearA, spiderweb);
      /* Q 连 B、路径2/3处（P—Q 已建） */
      addRepairEdge(Q, ringB, spiderweb);
      addRepairEdge(Q, nodeNearB, spiderweb);
    } else {
      /* 补3个点 P Q R */
      var P3 = newParticles[0], Q3 = newParticles[1], R3 = newParticles[2];
      var idxQuarter = Math.max(1, Math.floor(len / 4));
      var idxMid = Math.floor(len / 2);
      var idxThreeQuarter = Math.min(len - 2, Math.floor(len * 3 / 4));
      var nodeQuarterA = ring[idxQuarter];
      var nodeMid3 = ring[idxMid];
      var nodeQuarterB = ring[idxThreeQuarter];
      /* P 连 A、Q、路径1/4处 */
      addRepairEdge(P3, ringA, spiderweb);
      addRepairEdge(P3, Q3, spiderweb);
      addRepairEdge(P3, nodeQuarterA, spiderweb);
      /* Q 连 R、路径中间点（P—Q 已建） */
      addRepairEdge(Q3, R3, spiderweb);
      addRepairEdge(Q3, nodeMid3, spiderweb);
      /* R 连 B、路径3/4处（Q—R 已建） */
      addRepairEdge(R3, ringB, spiderweb);
      addRepairEdge(R3, nodeQuarterB, spiderweb);
    }
  }

  function repairWeb(stub, snapTarget) {
    if (!spiderweb || !snapTarget) return;

    /* 找 stub 的锚点 */
    var anchorPt = null;
    for (var i = 0; i < spiderweb.constraints.length; i++) {
      var c = spiderweb.constraints[i];
      if (!c.__isStubAnchor) continue;
      if (c.a === stub) { anchorPt = c.b; break; }
      if (c.b === stub) { anchorPt = c.a; break; }
    }

    if (anchorPt && anchorPt !== snapTarget) {
      if (P.repairPatch) {
        /* 先 BFS 找最小环（在建新边之前，否则 BFS 会直接走新边） */
        var path = bfsPath(anchorPt, snapTarget, spiderweb);

        /* 建 A—B 主线（立即） */
        addRepairEdge(anchorPt, snapTarget, spiderweb);

        /* 环够大则把补丁任务放入队列，等蜘蛛过来修 */
        if (path && path.length > 4) {
          /* 计算环的几何中心作为蜘蛛目标位置 */
          var rcx = 0, rcy = 0;
          for (var ri = 0; ri < path.length; ri++) {
            rcx += path[ri].pos.x;
            rcy += path[ri].pos.y;
          }
          rcx /= path.length;
          rcy /= path.length;
          repairQueue.push({
            ring: path,
            pos: new Vec2(rcx, rcy),
            state: 'pending',
            timer: REPAIR_WORK_DUR
          });
        }
      } else {
        /* 只修一根 */
        addRepairEdge(anchorPt, snapTarget, spiderweb);
      }
    }

    /* 删掉 stub 的锚定边 */
    spiderweb.constraints = spiderweb.constraints.filter(function (c) {
      if (c.__isStubAnchor && (c.a === stub || c.b === stub)) return false;
      return true;
    });

    /* 删掉 stub 粒子 */
    var si = spiderweb.particles.indexOf(stub);
    if (si !== -1) spiderweb.particles.splice(si, 1);

    /* 刷新断线头列表和网完整度 */
    _refreshBrokenEnds();
    webScanPending = 3;
  }

  /**
   * 检查补网任务是否仍然有效：ring 上的节点是否还在 spiderweb.particles 中
   * 超过半数节点失效则视为任务无效
   */
  function _isRepairTaskValid(task) {
    if (!spiderweb || !task.ring) return false;
    var alive = 0;
    for (var i = 0; i < task.ring.length; i++) {
      if (spiderweb.particles.indexOf(task.ring[i]) !== -1) alive++;
    }
    return alive > task.ring.length / 2;
  }

  /* 注册修复回调 */
  sim.onRepairDrop = repairWeb;

  function checkWebIntegrity() {
    if (gameState !== 'LEVEL_ACTIVE') return;
    if (!spiderweb) return;
    if (webWarmupFrames > 0) {
      webWarmupFrames = Math.max(0, webWarmupFrames - _currentTimeScale);
      if (webWarmupFrames === 0 && !webGridList) _buildWebGrid();
      var warmNumEl = document.getElementById('dbg-web-num');
      if (warmNumEl) warmNumEl.textContent = '100';
      return;
    }
    if (webGridBuildIdx < (webGridList ? webGridList.length : 0)) {
      continueWebGridBuild();
    } else {
      if (webScanPending > 0) {
        webScanPending = Math.max(0, webScanPending - _currentTimeScale);
        if (webScanPending === 0) _queueWebRescan();
      }
      if (webRescanActive) tickWebRescan();
    }
    var _newPct = Math.max(0, Math.round(100 - webLossPct * 2));
    if (_newPct !== _webTargetPct) {
      _webRollFrom = _webDisplayPct;
      _webTargetPct = _newPct;
      _webRollTimer = 0;
    }
    var _rollDur = 20;
    if (_webRollTimer < _rollDur) {
      _webRollTimer += _currentTimeScale;
      var _rollT = 1 - Math.pow(1 - _webRollTimer / _rollDur, 2);
      _webDisplayPct = Math.round(_webRollFrom + (_webTargetPct - _webRollFrom) * _rollT);
    } else {
      _webDisplayPct = _webTargetPct;
    }
    var _numEl = document.getElementById('dbg-web-num');
    if (_numEl) {
      var _showing = parseInt(_numEl.textContent, 10);
      if (_showing !== _webDisplayPct) {
        _numEl.textContent = String(_webDisplayPct);
        if (_webRollTimer === 1) {
          _numEl.classList.remove('dbg-web-flash');
          void _numEl.offsetWidth;
          _numEl.classList.add('dbg-web-flash');
        }
      }
    }
    if (webLossPct >= 50) showGameOver();
  }

  /* ── Timer & spawner ── */
  function updateLevelTimer() {
    if (gameState === 'IDLE' || gameState === 'GAME_OVER' || gameState === 'SUCCESS') return;
    levelTimer += _currentTimeScale;
    gameFrames += _currentTimeScale;
  }

  function spawnRandom() {
    if (isGameplayTestMode) return;
    var cfg = getWaveCfgAt(currentLevelIndex, currentWaveIndex);
    var weights = cfg && cfg.spawnWeights;
    var kind = null;
    if (weights) {
      var order = ['boulder', 'bug', 'drop', 'poop'];
      var total = 0;
      for (var wi = 0; wi < order.length; wi++) total += Math.max(0, weights[order[wi]] || 0);
      if (total > 0) {
        var r = Math.random() * total;
        var acc = 0;
        for (var oi = 0; oi < order.length; oi++) {
          acc += Math.max(0, weights[order[oi]] || 0);
          if (r <= acc) { kind = order[oi]; break; }
        }
      }
    }
    if (!kind) {
      /* 默认兜底：大便低概率出现，作为持续惩罚物 */
      var fallbackR = Math.random();
      kind = fallbackR < 0.08 ? 'poop' : fallbackR < 0.18 ? 'bug' : fallbackR < 0.58 ? 'boulder' : 'drop';
    }
    launchObject(kind);
  }

  function updateLevelSpawner() {
    if (gameState !== 'LEVEL_ACTIVE') return;
    var levelCfg = getLevelCfgAt(currentLevelIndex);
    var cfg = getWaveCfgAt(currentLevelIndex, currentWaveIndex);
    wavePhaseTimer += _currentTimeScale;
    if (currentWavePhase === WAVE_PAUSE) {
      if (wavePhaseTimer >= cfg.pauseDuration) advanceWavePhase();
      return;
    }
    if (!levelCfg.waves.length) return;
    if (spawnPhase === 'start_delay') {
      firstBurstDelayTimer += _currentTimeScale;
      if (firstBurstDelayTimer >= cfg.firstBurstDelay) startBurst(cfg);
      return;
    }
    if (spawnPhase === 'burst_gap') {
      burstGapTimer += _currentTimeScale;
      if (burstGapTimer >= (cfg.burstGap || 0)) startBurst(cfg);
      return;
    }
    if (spawnPhase === 'burst') {
      burstTimer += _currentTimeScale;
      if (burstTimer < (cfg._currentBurstInterval || cfg.burstIntervalMin || 1)) return;
      burstTimer = 0;
      spawnRandom();
      burstCount--;
      if (burstCount > 0) {
        var minInterval = Math.min(cfg.burstIntervalMin, cfg.burstIntervalMax);
        var maxInterval = Math.max(cfg.burstIntervalMin, cfg.burstIntervalMax);
        cfg._currentBurstInterval = minInterval + Math.floor(Math.random() * (maxInterval - minInterval + 1));
      }
      if (burstCount <= 0) {
        burstsDone++;
        if (burstsDone >= Math.max(1, cfg.burstCount || 1)) {
          enterWavePause();
          return;
        }
        spawnPhase = 'burst_gap';
        burstGapTimer = 0;
      }
    }
  }

  /* ── Object management ── */
  function updateBadge(kind, delta) {
    objCounts[kind] = Math.max(0, objCounts[kind] + delta);
    document.getElementById('cnt-' + kind).textContent = objCounts[kind];
  }

  function launchObject(kind) {
    var obj = new ThrownObj(kind, W, H, sim, P, gameState, getWaveCfgAt, currentLevelIndex, currentWaveIndex);
    obj._W = W; obj._H = H;
    thrownObjects.push(obj);
    updateBadge(kind, 1);
  }

  function clearAllObjects() {
    wrappingTarget = null;
    autoChaseTarget = null;
    clearPriorityTarget();
    _endWrappedPickup();
    audioEngine.stopAllBugBuzz();
    thrownObjects.forEach(function (o) {
      if (o.collectEl && o.collectEl.parentNode) o.collectEl.parentNode.removeChild(o.collectEl);
      o.collectCanvas = null;
      o.destroy(sim);
    });
    thrownObjects = [];
    ['boulder', 'bug', 'drop', 'poop'].forEach(function (k) {
      objCounts[k] = 0;
      document.getElementById('cnt-' + k).textContent = 0;
    });
  }

  function updateInventoryBadge(kind, delta) {
    inventoryCounts[kind] = Math.max(0, inventoryCounts[kind] + delta);
    if (gameState === 'LEVEL_ACTIVE' && delta > 0) {
      levelCollected[kind]++;
      silkCount += (typeof SCORE_MULT[kind] === 'number' ? SCORE_MULT[kind] : 1) * delta;
      refreshSilkHUD();
      refreshWaveHUD(kind, gameState, getLevelCfgAt, currentLevelIndex, levelCollected);
      pendingLevelCheck = true;
    } else {
      var el = document.getElementById('inv-' + kind + '-count');
      if (el) el.textContent = inventoryCounts[kind];
    }
  }

  function restartCurrentWaveFromEditor() {
    if (gameState !== 'LEVEL_ACTIVE') return;
    clearAllObjects();
    wrappingTarget = null;
    target = null;
    autoChaseTarget = null;
    clearPriorityTarget();
    currentWavePhase = WAVE_FALLING;
    wavePhaseTimer = 0;
    resetSpawnerState(getWaveCfgAt(currentLevelIndex, currentWaveIndex));
    refreshWavePhaseHUD();
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
    if (!slot) return null;
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

  function beginPlucking(obj) {
    if (_pickupDrag && _pickupDrag.obj === obj) _pickupDrag = null;
    audioEngine.stopPickupTearLoop();
    audioEngine.playSfxPluckSnap();
    clearObjectConstraints(obj);
    obj.state = 'plucking';
    obj._pluckT = 0;
    obj._pickupTension = 0;
    obj._pickupCharge = 0;
    var pullAngle = obj._pickupPullAngle || -Math.PI / 2;
    obj._pluckVx = Math.cos(pullAngle) * 2.2;
    obj._pluckVy = Math.sin(pullAngle) * 2.2;
    obj.particle._noSimDrag = false;
    obj.particle.lastPos.x = obj.particle.pos.x;
    obj.particle.lastPos.y = obj.particle.pos.y;
    sim.draggedEntity = null;
    var pluckPos = getCanvasPointOnStage(obj.particle.pos.x, obj.particle.pos.y);
    playCollectFX(pluckPos.x, pluckPos.y, collectLayer, obj.kind, false);
  }

  function beginCollectObject(obj) {
    var p = obj.particle;
    var startPos = getCanvasPointOnStage(p.pos.x, p.pos.y);
    var targetPos = getInventoryTarget(obj.kind);
    if (!targetPos) targetPos = startPos; /* 无对应 inventory slot 时原地收集 */
    var snapshot = buildCollectSnapshot(obj);
    if (_pickupDrag && _pickupDrag.obj === obj) _pickupDrag = null;
    clearObjectConstraints(obj);
    obj.state = 'collecting';
    obj.collectT = 0;
    obj.collectPause = 10;
    obj.collectFlash = 0;
    obj.collectDur = 34;
    obj.travelT = 0;
    obj.alpha = 0;
    obj._shrinkScale = 1;
    obj.collectFromX = startPos.x; obj.collectFromY = startPos.y;
    obj.collectToX = targetPos.x; obj.collectToY = targetPos.y;
    p.lastPos.x = p.pos.x; p.lastPos.y = p.pos.y;
    obj._pickupTension = 0;
    obj._pickupCharge = 0;
    obj.collectEl = document.createElement('div');
    obj.collectEl.className = 'collect-token';
    if (snapshot) {
      obj.collectCanvas = snapshot.canvas;
      obj.collectEl.style.width = snapshot.size + 'px';
      obj.collectEl.style.height = snapshot.size + 'px';
      obj.collectEl.style.marginLeft = (-snapshot.size * 0.5) + 'px';
      obj.collectEl.style.marginTop = (-snapshot.size * 0.5) + 'px';
      obj.collectEl.appendChild(snapshot.canvas);
      obj._collectStartScale = 1;
      obj._collectEndScale = 34 / snapshot.size;
    } else {
      obj.collectCanvas = document.createElement('canvas');
      obj.collectCanvas.className = 'collect-token-art';
      obj.collectCanvas.width = 34; obj.collectCanvas.height = 34;
      renderArtToCanvas(obj.collectCanvas, obj.kind);
      obj.collectEl.appendChild(obj.collectCanvas);
      obj._collectStartScale = 1.15;
      obj._collectEndScale = 0.82;
    }
    obj.collectEl.style.left = obj.collectFromX + 'px';
    obj.collectEl.style.top = obj.collectFromY + 'px';
    collectLayer.appendChild(obj.collectEl);
    obj.particle._noSimDrag = false;
  }

  function beginWrapping(obj) {
    obj.state = 'wrapping';
    obj.wrapT = 0;
    obj.wrapDur = obj.def.wrapDur;
    obj.particle.lastPos.mutableSet(obj.particle.pos);
    obj.particle._noSimDrag = true;
    wrappingTarget = obj;
    if (autoChaseTarget === obj) autoChaseTarget = null;
    if (userPriorityTarget && userPriorityTarget.type === 'object' && userPriorityTarget.obj === obj) {
      clearPriorityTarget();
    }
    target = null;

    obj._silkLines = null;
    obj._silkSpiral = buildSilkSpiral(obj);
  }

  function cancelWrappingDueToSupportLoss() {
    var obj = wrappingTarget;
    if (!obj) return;
    wrappingTarget = null;
    pauseAndClearCurrentTarget();
    if (obj.state !== 'wrapping') return;
    obj.state = 'stuck';
    obj.wrapT = 0;
    obj.particle._noSimDrag = false;
    obj.particle.lastPos.mutableSet(obj.particle.pos);
    obj._silkLines = null;
  }

  function preserveWrappedSupport(obj) {
    var p = obj.particle.pos;
    var reanchorPoint = findWrappedReanchorPoint(
      p.x,
      p.y,
      obj.stuckOnConstraint,
      spiderweb,
      _spatialOpts()
    );
    if (!reanchorPoint) return false;
    return obj.reanchorWrappedToPoint(reanchorPoint, spiderweb, USE_LEGACY_COLLISION ? null : spatialIndex);
  }

  function finishLeafWrap(obj) {
    wrappingTarget = null;
    if (autoPlay) _autoPlayPause = 24;
    audioEngine.playCollectSound(obj.kind);
    var leafFxPos = getCanvasPointOnStage(obj.particle.pos.x, obj.particle.pos.y);
    playCollectFX(leafFxPos.x, leafFxPos.y, collectLayer, obj.kind);
    var _bx = obj.particle.pos.x, _by = obj.particle.pos.y;
    var _colors = ['#aaffaa', '#ffffaa', '#ffffff'];
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
    obj.destroy(sim);
    var idx = thrownObjects.indexOf(obj);
    if (idx !== -1) thrownObjects.splice(idx, 1);
    updateBadge(obj.kind, -1);
  }

  function tryCollectObjects() {
    if (wrappingTarget !== null || poopStunTimer > 0) return;
    for (var fi = 0; fi < footState.length; fi++) {
      if (footState[fi] && footState[fi].needsEmergencyStep) return;
    }
    var priorityObj = getActivePriorityObject();
    if (userPriorityTarget) {
      if (userPriorityTarget.type === 'point') return;
      if (!priorityObj) { clearPriorityTarget(); pauseAndClearCurrentTarget(); return; }
    }
    var thorax = spider.thorax.pos;
    var abdomen = spider.abdomen.pos;
    for (var oi = 0; oi < thrownObjects.length; oi++) {
      var obj = thrownObjects[oi];
      if (priorityObj && obj !== priorityObj) continue;
      if (obj.playerDragging) continue;
      if (obj.state !== 'stuck') continue;
      var p = obj.particle.pos;
      if (!circlesOverlap(thorax.x, thorax.y, 11, p.x, p.y, obj.def.collectRadius)
        && !circlesOverlap(abdomen.x, abdomen.y, 19, p.x, p.y, obj.def.collectRadius)) continue;
      if (obj.state === 'stuck') {
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

  /* ── 投掷物运动积分（保持旧 gameplay：先按当前路径做粘网判定，再进 physics） ── */
  function integrateThrownObjects() {
    for (var oi = thrownObjects.length - 1; oi >= 0; oi--) {
      var obj = thrownObjects[oi];
      if (!obj || !obj.def) continue;
      var def = obj.def, p = obj.particle;

      if (_isWebAttachedState(obj.state) && obj.stuckOnConstraint && !_isWebConstraintAlive(obj.stuckOnConstraint)) {
        _detachObjectFromBrokenWeb(obj);
      }

      if (obj.state === 'falling') {
        if (obj.kind === 'boulder' || obj.kind === 'poop') {
          obj.segT += 0.22 * _currentTimeScale;
          var bGrav = obj.grav * 2.6 * _currentTimeScale;
          var driftX = (obj.spawnVx || 0) * _currentTimeScale;
          var driftY = (obj.spawnVy || 0) * _currentTimeScale;
          p.pos.x += driftX;
          p.pos.y += driftY + bGrav;
          p.lastPos.x = p.pos.x - driftX;
          p.lastPos.y = p.pos.y - (driftY + bGrav);
          obj.spawnVx = (obj.spawnVx || 0) * 0.985;
          obj.spawnVy = (obj.spawnVy || 0) * 0.985;
        } else if (obj.kind === 'bug') {
          var bx = obj.baseVx + Math.sin(obj.animT * obj.buzzFreqX + obj.buzzPhaseX) * obj.buzzAmp * 0.08
            + Math.cos(obj.animT * obj.buzzFreqX * 1.7 + obj.buzzPhaseX) * obj.buzzAmp * 0.04
            + (Math.random() - 0.5) * 0.5;
          var by = obj.baseVy + Math.sin(obj.animT * obj.buzzFreqY + obj.buzzPhaseY) * obj.buzzAmp * 0.08
            + Math.cos(obj.animT * obj.buzzFreqY * 2.1 + obj.buzzPhaseY) * obj.buzzAmp * 0.04
            + (Math.random() - 0.5) * 0.5;
          if (!obj.released && Math.random() < 0.018) { obj.baseVx = (Math.random() - 0.5) * 5; obj.baseVy = (Math.random() - 0.5) * 5; }

          var _bxs = bx * _currentTimeScale, _bys = by * _currentTimeScale;
          p.pos.x += _bxs; p.pos.y += _bys;
          p.lastPos.x = p.pos.x - _bxs; p.lastPos.y = p.pos.y - _bys;
          obj.angle = Math.atan2(_bys, _bxs);
          obj.wingT += 0.55 * _currentTimeScale;
          if (!obj._buzzStarted) { obj._buzzStarted = true; audioEngine.startBugBuzz(oi); }

          /* 环绕穿越：飞出一侧从对面出现，轨迹不被阻挡 */
          var _wrap = 100;
          if (p.pos.x < -_wrap)   { p.pos.x += W + _wrap * 2; p.lastPos.x = p.pos.x - bx; }
          if (p.pos.x > W + _wrap) { p.pos.x -= W + _wrap * 2; p.lastPos.x = p.pos.x - bx; }
          if (p.pos.y < -_wrap)   { p.pos.y += H + _wrap * 2; p.lastPos.y = p.pos.y - by; }
          if (p.pos.y > H + _wrap) { p.pos.y -= H + _wrap * 2; p.lastPos.y = p.pos.y - by; }
          /* 挣脱后乱飞一段再重新粘网（无限循环，飞出屏幕才消失） */
          if (obj.released) {
            obj._reStickTimer = (obj._reStickTimer || 0) + _currentTimeScale;
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
          var swayLift = Math.sin(obj.animT * obj.swaySpeed + obj.swayPhase) * obj.swayAmp;
          var lift = Math.sin(obj.angle) * obj.glideForce + swayLift;
          obj.vx += lift; obj.vy += obj.grav;
          obj.vx *= obj.drag; obj.vy *= obj.drag;
          var spd = Math.sqrt(obj.vx * obj.vx + obj.vy * obj.vy);
          var leafMaxSpeed = def.maxSpeed || 0.8;
          if (spd > leafMaxSpeed) { obj.vx = obj.vx / spd * leafMaxSpeed; obj.vy = obj.vy / spd * leafMaxSpeed; }
          var _lvx = obj.vx * _currentTimeScale, _lvy = obj.vy * _currentTimeScale;
          p.pos.x += _lvx; p.pos.y += _lvy;
          p.lastPos.x = p.pos.x - _lvx; p.lastPos.y = p.pos.y - _lvy;
          if (p.pos.y > H + 60) { obj.destroy(sim); thrownObjects.splice(oi, 1); updateBadge(obj.kind, -1); continue; }
        }

        if (obj.kind !== 'bug' && p.pos.y > H + 60) {
          obj.destroy(sim); thrownObjects.splice(oi, 1); updateBadge(obj.kind, -1);
        }

      } else if (obj.state === 'sticking') {
        obj.stickT = Math.min(1, obj.stickT + 0.078 * _currentTimeScale);
        var ease = obj.stickT < 0.5 ? 2 * obj.stickT * obj.stickT : -1 + (4 - 2 * obj.stickT) * obj.stickT;
        if (obj.cA) obj.cA.distance = obj.stickyFromA + (obj.stickyToA - obj.stickyFromA) * ease;
        if (obj.cB) obj.cB.distance = obj.stickyFromB + (obj.stickyToB - obj.stickyFromB) * ease;
        if (obj.stickT >= 1) {
          if (obj.cA) obj.cA.distance = obj.stickyToA;
          if (obj.cB) obj.cB.distance = obj.stickyToB;
          if (obj.kind === 'bug') audioEngine.stopBugBuzz(thrownObjects.indexOf(obj));
          audioEngine.playSfxLand(obj.kind);
          var _ws = obj._stickIsRadial ? P.radialWobbleScale : P.spiralWobbleScale;
          if (obj.kind === 'drop') {
            obj.state = 'stuck';
            obj.stayTimer = 0;
            obj.wobbleAmp = 0.04;
          } else {
            obj.state = 'stuck'; obj.stayTimer = 0;
            if (obj.kind === 'boulder') obj.wobbleAmp = 0.10 * _ws;
            if (obj.kind === 'bug') obj.wobbleAmp = 0.28 * _ws;
            if (obj.kind === 'poop') obj.wobbleAmp = 0.10 * _ws;
          }
        }

      } else if (obj.state === 'stuck') {
        if (_pickupDrag && _pickupDrag.obj === obj) {
          var sTargetGripX = _pickupDrag.pointerX - _pickupDrag.gripDX;
          var sTargetGripY = _pickupDrag.pointerY - _pickupDrag.gripDY;
          var sPullDx = sTargetGripX - p.pos.x;
          var sPullDy = sTargetGripY - p.pos.y;
          var sAppliedForce = Math.sqrt(sPullDx * sPullDx + sPullDy * sPullDy) * PICKUP_PULL_STRENGTH / Math.max(1, obj.def.r);
          var sForceThresh = obj.kind === 'boulder' ? STUCK_FORCE_THRESHOLD_BOULDER : obj.kind === 'poop' ? STUCK_FORCE_THRESHOLD_POOP : STUCK_FORCE_THRESHOLD_BUG;
          p.pos.x += sPullDx * PICKUP_PULL_STRENGTH;
          p.pos.y += sPullDy * PICKUP_PULL_STRENGTH;
          obj._pickupPullAngle = Math.atan2(sPullDy, sPullDx);
          var sTensionA = 0, sTensionB = 0;
          if (obj.cA) { var sAnchorA = obj.cA.a === p ? obj.cA.b : obj.cA.a; sTensionA = Math.max(0, p.pos.dist(sAnchorA.pos) / Math.max(1, obj.cA.distance) - 1); }
          if (obj.cB) { var sAnchorB = obj.cB.a === p ? obj.cB.b : obj.cB.a; sTensionB = Math.max(0, p.pos.dist(sAnchorB.pos) / Math.max(1, obj.cB.distance) - 1); }
          var sTension = sTensionA + sTensionB;
          obj._pickupTension = sTension;
          obj._pickupCharge = Math.min(1, sTension / Math.max(0.001, STUCK_PLUCK_THRESHOLD));
          var sOverForce = obj.kind === 'boulder' ? STUCK_OVERFORCE_BOULDER : obj.kind === 'poop' ? STUCK_OVERFORCE_POOP : STUCK_OVERFORCE_BUG;
          audioEngine.updatePickupTearLoop(Math.min(1, Math.max(obj._pickupCharge, sAppliedForce / Math.max(1, sOverForce))));
          if (sAppliedForce >= sOverForce) {
            audioEngine.stopPickupTearLoop();
            _pickupDrag = null;
            sim.draggedEntity = null;
            obj._pickupTension = 0; obj._pickupCharge = 0;
            if (obj.kind === 'poop') {
              obj.peelOff(sPullDx, sPullDy);
            } else {
              obj.state = 'freeing'; obj.freeTimer = 0;
            }
            continue;
          } else if (sAppliedForce >= sForceThresh) {
            if (sTension >= STUCK_PLUCK_THRESHOLD) {
              _pickupDrag = null;
              sim.draggedEntity = null;
              if (obj.kind === 'poop') {
                obj._pickupTension = 0; obj._pickupCharge = 0;
                obj.peelOff(sPullDx, sPullDy);
              } else {
                beginPlucking(obj);
              }
              continue;
            } else if (sTension >= STUCK_BREAK_THRESHOLD) {
              audioEngine.stopPickupTearLoop();
              _pickupDrag = null;
              sim.draggedEntity = null;
              obj._pickupTension = 0; obj._pickupCharge = 0;
              if (obj.kind === 'poop') {
                obj.peelOff(sPullDx, sPullDy);
              } else {
                obj.state = 'freeing'; obj.freeTimer = 0;
              }
              continue;
            }
          }
        } else {
          audioEngine.stopPickupTearLoop();
          obj._pickupTension = Math.max(0, (obj._pickupTension || 0) * 0.82 - 0.01);
          obj._pickupCharge = Math.max(0, (obj._pickupCharge || 0) - PICKUP_TENSION_RELEASE_RATE);
        }
        obj.stayTimer += _currentTimeScale;
        var sagRate = obj.kind === 'boulder' || obj.kind === 'poop' ? 0.10 : obj.kind === 'bug' ? 0.06 : 0.008;
        p.pos.y += sagRate * _currentTimeScale;
        if (obj.kind === 'boulder') {
          obj.segT += 0.13 * _currentTimeScale;
          p.pos.x += Math.sin(obj.segT) * obj.wobbleAmp * (0.4 + Math.random() * 0.2);
          p.pos.y += Math.cos(obj.segT * 0.6) * obj.wobbleAmp * 0.3;
        } else if (obj.kind === 'poop') {
          obj.segT += 0.13 * _currentTimeScale;
          p.pos.x += Math.sin(obj.segT) * obj.wobbleAmp * (0.4 + Math.random() * 0.2);
          p.pos.y += Math.cos(obj.segT * 0.6) * obj.wobbleAmp * 0.3;
        } else if (obj.kind === 'bug') {
          p.pos.x += (Math.random() - 0.5) * obj.wobbleAmp * 2;
          p.pos.y += (Math.random() - 0.5) * obj.wobbleAmp;
          if (obj.stuckOnConstraint) {
            var nearStuck = findNearestWebSegment(
              p.pos.x, p.pos.y, spiderweb, _spatialOpts(), obj.stuckOnConstraint
            );
            if (nearStuck) obj.stuckOnConstraint = nearStuck;
          }
          obj.wingT += 0.55 * _currentTimeScale;
        } else if (obj.kind === 'drop') {
          obj.angleVel = 0;
        } else {
          obj.angleVel += (Math.random() - 0.5) * 0.0005 * _currentTimeScale;
          obj.angleVel *= Math.pow(0.98, _currentTimeScale);
          obj.angle += obj.angleVel * _currentTimeScale;
        }
        if (obj.kind !== 'drop' && obj.kind !== 'poop') {
          var ramp = Math.max(0, obj.stayFrames - 72);
          if (obj.stayTimer > ramp) {
            var progress = (obj.stayTimer - ramp) / Math.max(1, obj.stayFrames - ramp);
            var _wm = obj._stickIsRadial ? P.radialWobbleScale : P.spiralWobbleScale;
            var wobbleMax = (obj.kind === 'boulder' ? 12.0 : obj.kind === 'bug' ? 9.0 : 1.5) * _wm;
            obj.wobbleAmp = Math.min(wobbleMax, obj.wobbleAmp + (0.08 + progress * 0.18) * _currentTimeScale);
            if (obj.kind === 'boulder') obj.segT += progress * 0.4 * _currentTimeScale;
            if (obj.kind === 'bug') obj.wingT += progress * 0.8 * _currentTimeScale;
          }
          if (obj.stayTimer >= obj.stayFrames) { obj.state = 'freeing'; obj.freeTimer = 0; }
        }

      } else if (obj.state === 'freeing') {
        obj.freeTimer += _currentTimeScale;
        if (obj.kind === 'bug' && obj.stuckOnConstraint) {
          var nearSeg = findNearestWebSegment(
            p.pos.x, p.pos.y, spiderweb, _spatialOpts(), obj.stuckOnConstraint
          );
          if (nearSeg) obj.stuckOnConstraint = nearSeg;
        }
        var thrash = obj.kind === 'boulder' ? 18 : obj.kind === 'bug' ? 14 : 4;
        p.pos.x += (Math.random() - 0.5) * thrash;
        p.pos.y += (Math.random() - 0.5) * (thrash * 0.6);
        if (obj.freeTimer > 28) {
          obj.release(spiderweb, webBreakFlashes, _breakFrame, _onWebSegmentBroken, _spatialOpts());
          spiderweb._topologyVersion = (spiderweb._topologyVersion || 0) + 1;
          if (_webDrawApi) {
            for (var _fi = 0; _fi < webBreakFlashes.length; _fi++) {
              if (!webBreakFlashes[_fi].affectedCI) _webDrawApi.annotateFlash(webBreakFlashes[_fi]);
            }
          }
          webScanPending = 12;
        }

      } else if (obj.state === 'falling2') {
        if (obj.kind === 'drop') {
          obj.angleVel += (Math.random() - 0.5) * obj.angleTurb * _currentTimeScale;
          obj.angleVel *= Math.pow(obj.angleDrag, _currentTimeScale);
          obj.angle += obj.angleVel * _currentTimeScale;
          obj.vx += Math.sin(obj.angle) * obj.glideForce * _currentTimeScale;
          obj.vy += obj.grav * _currentTimeScale;
          var dragScale = Math.pow(obj.drag, _currentTimeScale);
          obj.vx *= dragScale; obj.vy *= dragScale;
          var maxSpd = def.maxSpeed || 0.8;
          var spd2 = Math.sqrt(obj.vx * obj.vx + obj.vy * obj.vy);
          if (spd2 > maxSpd) { obj.vx = obj.vx / spd2 * maxSpd; obj.vy = obj.vy / spd2 * maxSpd; }
          p.pos.x += obj.vx * _currentTimeScale; p.pos.y += obj.vy * _currentTimeScale;
        } else if (obj.kind === 'poop') {
          var peelDragScale = Math.pow(obj.def.peelDrag, _currentTimeScale);
          obj.vx *= peelDragScale;
          obj.vy *= peelDragScale;
          obj.vy += obj.grav * 0.34 * _currentTimeScale;
          p.pos.x += obj.vx * _currentTimeScale;
          p.pos.y += obj.vy * _currentTimeScale;
        } else {
          p.pos.y += obj.grav * _currentTimeScale;
        }
        if (obj.kind === 'poop') {
          if (p.pos.y > H + 80 || p.pos.x < -90 || p.pos.x > W + 90) {
            obj.destroy(sim); thrownObjects.splice(oi, 1); updateBadge(obj.kind, -1);
          }
        } else {
          obj.alpha = Math.max(0, obj.alpha - 0.016 * _currentTimeScale);
          if (obj.alpha <= 0) { obj.destroy(sim); thrownObjects.splice(oi, 1); updateBadge(obj.kind, -1); }
        }

      } else if (obj.state === 'wrapping') {
        p.lastPos.mutableSet(p.pos);
        obj.wrapT = Math.min(1, obj.wrapT + (_currentTimeScale === 0 ? 0 : 1 / obj.wrapDur));
        if (Math.round(obj.wrapT * obj.wrapDur) % 12 === 0) audioEngine.playSfxWrap(obj.wrapT);
        if (obj.wrapT >= 1) {
          if (obj.kind === 'drop') {
            finishLeafWrap(obj);
            continue;
          }
          wrappingTarget = null;
          obj.state = 'wrapped';
          obj._popT = 0;
          audioEngine.playCollectSound(obj.kind);
          var packedFxPos = getCanvasPointOnStage(p.pos.x, p.pos.y);
          playFloatingText(packedFxPos.x, packedFxPos.y, collectLayer, 'Packed');
        }

      } else if (obj.state === 'wrapped') {
        preserveWrappedSupport(obj);
        if (obj._popT <= obj._popDur) obj._popT++;
        if (_pickupDrag && _pickupDrag.obj === obj) {
          var targetGripX = _pickupDrag.pointerX - _pickupDrag.gripDX;
          var targetGripY = _pickupDrag.pointerY - _pickupDrag.gripDY;
          var pullDx = targetGripX - p.pos.x;
          var pullDy = targetGripY - p.pos.y;
          var appliedPullForce = Math.sqrt(pullDx * pullDx + pullDy * pullDy) * PICKUP_PULL_STRENGTH / Math.max(1, obj.def.r);
          p.pos.x += pullDx * PICKUP_PULL_STRENGTH;
          p.pos.y += pullDy * PICKUP_PULL_STRENGTH;
          obj._pickupPullAngle = Math.atan2(pullDy, pullDx);
          var tensionA = 0;
          var tensionB = 0;
          if (obj.cA) {
            var anchorA = obj.cA.a === p ? obj.cA.b : obj.cA.a;
            tensionA = Math.max(0, p.pos.dist(anchorA.pos) / Math.max(1, obj.cA.distance) - 1);
          }
          if (obj.cB) {
            var anchorB = obj.cB.a === p ? obj.cB.b : obj.cB.a;
            tensionB = Math.max(0, p.pos.dist(anchorB.pos) / Math.max(1, obj.cB.distance) - 1);
          }
          obj._pickupTension = tensionA + tensionB;
          obj._pickupCharge = Math.min(1, obj._pickupTension / Math.max(0.001, PICKUP_TENSION_THRESHOLD));
          audioEngine.updatePickupTearLoop(Math.min(1, Math.max(obj._pickupCharge, appliedPullForce / Math.max(1, _getPickupForceThreshold(obj)))));
          if (obj._pickupTension >= PICKUP_TENSION_THRESHOLD && appliedPullForce >= _getPickupForceThreshold(obj)) {
            if (obj.kind === 'poop') {
              audioEngine.stopPickupTearLoop();
              _pickupDrag = null;
              sim.draggedEntity = null;
              obj._pickupTension = 0;
              obj._pickupCharge = 0;
              obj.peelOff(pullDx, pullDy);
            } else {
              beginPlucking(obj);
            }
            continue;
          }
        } else {
          audioEngine.stopPickupTearLoop();
          obj._pickupTension = Math.max(0, (obj._pickupTension || 0) * 0.82 - 0.01);
          obj._pickupCharge = Math.max(0, (obj._pickupCharge || 0) - PICKUP_TENSION_RELEASE_RATE);
        }

      } else if (obj.state === 'plucking') {
        obj._pluckT++;
        var pluckPop  = 20;
        var pluckTot  = pluckPop;
        if (obj._pluckT <= pluckPop) {
          var gravity = 0.18;
          obj._pluckVy += gravity;
          obj._pluckVx *= 0.88;
          obj._pluckVy *= 0.88;
          p.pos.x += obj._pluckVx;
          p.pos.y += obj._pluckVy;
          p.lastPos.x = p.pos.x; p.lastPos.y = p.pos.y;
        }
        if (obj._pluckT >= pluckTot) {
          if (autoPlay) _autoPlayPause = 24;
          audioEngine.playCollectSound(obj.kind);
          var collectFxPos = getCanvasPointOnStage(p.pos.x, p.pos.y);
          playCollectFX(collectFxPos.x, collectFxPos.y, collectLayer, obj.kind, 'Collected');
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
          scale = Math.max(obj._collectEndScale, 1 + (obj._collectEndScale - 1) * easeIn);
          opacity = 1 - obj.travelT * 0.08;
        }

        obj.alpha = 0;
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
        var stickMult = obj.kind === 'bug' ? 2.0 : 1.0;
        obj.stickDelay = (minDelay + Math.random() * (maxDelay - minDelay)) * stickMult;
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
          USE_LEGACY_COLLISION ? spiderweb : spatialIndex, P.stickMidBias,
          obj.kind === 'bug' ? p.pos.x : null,
          obj.kind === 'bug' ? p.pos.y : null
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
      /* 只有落脚/迈步中才钉脚；失去支撑后让脚端跟随腿链自由回收，避免被钉在空中拉长 */
      if (fs.stepping || fs.landedNode || fs.landedSeg) {
        fs.particle.pos.x = fs.current.x;
        fs.particle.pos.y = fs.current.y;
      } else {
        fs.current.x = fs.particle.pos.x;
        fs.current.y = fs.particle.pos.y;
      }
    }
  }

  function updateFootTriggers() {
    if (poopStunTimer > 0) return;
    var spatialOpts = _spatialOpts();
    for (var fi = 0; fi < footState.length; fi++) {
      var fs = footState[fi];
      if (fs.stepping || fs.cooldown > 0) continue;
      var drift2 = fs.current.dist2(spider.thorax.pos);
      var partner = footState[fi % 2 === 0 ? fi + 1 : fi - 1];
      var ps = partner && partner.stepping;
      if (ps) continue;
      if (fs.needsEmergencyStep) {
        if (target) triggerStep(fi, moveDir, footState, spiderweb, spider, samplePoints, moveDir, STEP_COOLDOWN, undefined, false, spatialOpts);
        else triggerStep(fi, null, footState, spiderweb, spider, samplePoints, moveDir, STEP_COOLDOWN, undefined, true, spatialOpts);
        if (fs.stepping) fs.needsEmergencyStep = false;
        continue;
      }
      if (target && drift2 > STEP_THRESH * STEP_THRESH) {
        triggerStep(fi, moveDir, footState, spiderweb, spider, samplePoints, moveDir, STEP_COOLDOWN, undefined, false, spatialOpts);
      } else if (!target && drift2 > REST_THRESH * REST_THRESH) {
        triggerStep(fi, null, footState, spiderweb, spider, samplePoints, moveDir, STEP_COOLDOWN, undefined, true, spatialOpts);
      }
    }
  }

  /* ── Panel init ── */
  initPanel(P, DEFAULTS, {
    buildWeb: buildWeb,
    buildSpider: buildSpider,
    getSharedDefaultsJson: function () {
      return JSON.stringify(buildSharedDefaultsPayload(P), null, 2);
    },
    onMotionChange: function () {
      moveSpeed = P.moveSpeed; STEP_SPEED = P.stepSpeed;
      STEP_THRESH = P.stepThresh; REST_THRESH = P.restThresh;
    },
    onRepairChange: function () {
      sim.stubReachRadius = P.stubReachRadius;
      sim.snapRadius = P.stubSnapRadius;
    },
    clearAllObjects: clearAllObjects,
    launchObject: launchObject,
    isAutoPlayOn: function () {
      return autoPlay;
    },
    toggleAutoPlay: function () {
      autoPlay = !autoPlay;
      if (!autoPlay) target = null; /* 关闭时清除自动目标 */
      return autoPlay;
    },
    setAutoPlay: function (on) {
      autoPlay = !!on;
      if (!autoPlay) target = null;
      return autoPlay;
    },
    getWaveEditorConfigs: function () {
      return LEVEL_CONFIGS;
    },
    getCurrentLevelIndex: function () {
      return currentLevelIndex;
    },
    getCurrentWaveIndex: function () {
      return currentWaveIndex;
    },
    saveWaveEditorConfigs: function () {
      saveWaveConfigsToStorage();
    },
    resetWaveEditorConfigs: function () {
      resetWaveConfigsToDefault();
      refreshWavePhaseHUD();
      if (gameState === 'LEVEL_ACTIVE') refreshLevelTargetHUD();
    },
    saveLevelConditions: function () {
      saveLevelConditionsToStorage();
    },
    resetLevelConditions: function (levelIndex) {
      resetLevelConditionsToDefault(levelIndex);
      if (gameState === 'LEVEL_ACTIVE') {
        refreshLevelTargetHUD();
        pendingLevelCheck = true;
      }
    },
    getDefaultLevelTargets: function (levelIndex) {
      return cloneJson(BASE_LEVEL_TARGETS[levelIndex]);
    },
    onLevelConditionsChange: function (levelIndex) {
      if (levelIndex !== currentLevelIndex) return;
      if (gameState === 'LEVEL_ACTIVE') {
        refreshLevelTargetHUD();
        pendingLevelCheck = true;
      }
    },
    queueWaveEditorLiveApply: (function () {
      var applyTimer = null;
      return function (levelIndex, waveIndex, path) {
        if (path === 'label' || path === 'question' || path === 'notes') return;
        if (applyTimer) clearTimeout(applyTimer);
        applyTimer = setTimeout(function () {
          if (gameState !== 'LEVEL_ACTIVE') return;
          if (levelIndex !== currentLevelIndex || waveIndex !== currentWaveIndex) return;
          restartCurrentWaveFromEditor();
        }, 280);
      };
    })(),
    onWaveEditorChange: function (levelIndex, waveIndex) {
      if (levelIndex === currentLevelIndex) {
        currentWaveIndex = Math.min(currentWaveIndex, Math.max(0, LEVEL_CONFIGS[levelIndex].waves.length - 1));
      }
      if (gameState !== 'LEVEL_ACTIVE') return;
      if (levelIndex === currentLevelIndex) refreshLevelTargetHUD();
      if (levelIndex === currentLevelIndex) refreshWavePhaseHUD();
    },
    onWaveEditorCommit: function (levelIndex, waveIndex, path) {
      if (gameState !== 'LEVEL_ACTIVE') return;
      if (levelIndex !== currentLevelIndex || waveIndex !== currentWaveIndex) return;
      if (path === 'label' || path === 'question' || path === 'notes') return;
      restartCurrentWaveFromEditor();
    }
  });

  /* ── 调试：手动触发 collapseChain ── */
  document.getElementById('btn-debugCollapse').onclick = function () {
    if (!spiderweb) return;
    var stubs = [];
    for (var i = 0; i < spiderweb.particles.length; i++) {
      if (spiderweb.particles[i].__isStub) stubs.push(spiderweb.particles[i]);
    }
    for (var j = 0; j < stubs.length; j++) {
      collapseChain(stubs[j], spiderweb, USE_LEGACY_COLLISION ? null : spatialIndex);
    }
    _refreshBrokenEnds();
  };

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

  function _mountDevGaitTunePanel() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    var host = window.location && window.location.hostname ? window.location.hostname : '';
    var q = window.location && window.location.search ? window.location.search : '';
    var isDevHost = host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
    var forceShow = q.indexOf('gaitdev=1') !== -1;
    if (!isDevHost && !forceShow) return;

    var tune = window._gaitTune || (window._gaitTune = Object.assign({}, _gaitTuneDefaults));

    var panel = document.createElement('div');
    panel.id = 'gait-dev-panel';
    panel.style.position = 'fixed';
    panel.style.right = '12px';
    panel.style.top = '12px';
    panel.style.width = '300px';
    panel.style.maxHeight = '72vh';
    panel.style.overflow = 'auto';
    panel.style.zIndex = '9999';
    panel.style.background = 'rgba(10,12,18,0.86)';
    panel.style.border = '1px solid rgba(255,255,255,0.2)';
    panel.style.borderRadius = '10px';
    panel.style.padding = '10px';
    panel.style.color = '#e8eefc';
    panel.style.font = '12px/1.3 system-ui,-apple-system,Segoe UI,Roboto,sans-serif';

    var title = document.createElement('div');
    title.textContent = 'Gait Tune (Dev)';
    title.style.fontWeight = '700';
    title.style.marginBottom = '8px';
    panel.appendChild(title);

    function addSlider(key, min, max, step) {
      var wrap = document.createElement('div');
      wrap.style.marginBottom = '7px';

      var row = document.createElement('div');
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.marginBottom = '2px';

      var name = document.createElement('span');
      name.textContent = key;
      var val = document.createElement('span');
      val.textContent = String(tune[key]);
      row.appendChild(name);
      row.appendChild(val);

      var input = document.createElement('input');
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(tune[key]);
      input.style.width = '100%';
      input.addEventListener('input', function () {
        var v = parseFloat(input.value);
        tune[key] = v;
        val.textContent = (Math.abs(v % 1) > 0.0001) ? v.toFixed(2) : String(v);
      });

      wrap.appendChild(row);
      wrap.appendChild(input);
      panel.appendChild(wrap);
    }

    addSlider('minStepDistMove', 20, 40, 1);
    addSlider('minStepDistIdle', 16, 30, 1);
    addSlider('segPenaltyMoving', 80, 300, 5);
    addSlider('segPenaltyLowMove', 120, 420, 5);
    addSlider('segPenaltyStable', 300, 900, 10);
    addSlider('forwardMinProgressMove', 8, 30, 1);
    addSlider('forwardMinProgressIdle', 4, 20, 1);
    addSlider('forwardProgressPenalty', 6, 36, 1);
    addSlider('holdNodeBase', 8, 14, 0.5);
    addSlider('holdNodeScale', 0.02, 0.2, 0.01);
    addSlider('holdNodeMin', 4, 10, 0.5);
    addSlider('holdNodeMax', 8, 16, 0.5);
    addSlider('holdSegBase', 10, 18, 0.5);
    addSlider('holdSegScale', 0.02, 0.24, 0.01);
    addSlider('holdSegMin', 6, 12, 0.5);
    addSlider('holdSegMax', 10, 20, 0.5);

    var btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.gap = '8px';
    btnRow.style.marginTop = '8px';

    var resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset';
    resetBtn.style.flex = '1';
    resetBtn.addEventListener('click', function () {
      window._gaitTune = Object.assign({}, _gaitTuneDefaults);
      tune = window._gaitTune;
      panel.parentNode && panel.parentNode.removeChild(panel);
      _mountDevGaitTunePanel();
    });

    var hideBtn = document.createElement('button');
    hideBtn.textContent = 'Hide';
    hideBtn.style.flex = '1';
    hideBtn.addEventListener('click', function () {
      panel.style.display = 'none';
    });

    btnRow.appendChild(resetBtn);
    btnRow.appendChild(hideBtn);
    panel.appendChild(btnRow);

    document.body.appendChild(panel);

    if (!window._gaitTuneHotkeyBound) {
      window.addEventListener('keydown', function (e) {
        if (e.key === '`') {
          var p = document.getElementById('gait-dev-panel');
          if (p) p.style.display = p.style.display === 'none' ? 'block' : 'none';
        }
      });
      window._gaitTuneHotkeyBound = true;
    }
  }
  _mountDevGaitTunePanel();

  /* ================================================================
     MAIN LOOP
  ================================================================ */
  var _lastTimestamp = 0;
  var _bgFrame = 0;
  var _wasBulletTime = false;
  var loop = function (timestamp) {
    statsBeginFrame();

    /* ── 时间差：计算帧缩放比，用于游戏逻辑速度补偿 ── */
    var delta = _lastTimestamp ? Math.min(timestamp - _lastTimestamp, 50) : 16.67;
    _lastTimestamp = timestamp;

    /* ── 子弹时间检测：拖拽断线头时进入 ── */
    var _isBulletTime = !!(sim.draggedEntity && sim.draggedEntity.__isWebParticle);
    /* timeScale: 正常=帧率补偿，子弹时间=0.15 */
    var timeScale = _isBulletTime ? 0.0 : delta / 16.67;
    _currentTimeScale = timeScale;

    /* ── 背景变暗切换（只在状态变化时调用一次） ── */
    if (_isBulletTime !== _wasBulletTime) {
      _wasBulletTime = _isBulletTime;
      bgConfig.darken = _isBulletTime ? 0.72 : P.bgDarken / 100;
      applyBgPresentation();
      applyBgVignette(_isBulletTime);
    }

    /* ── 弹性拖拽平滑阻尼：按时间缩放，避免低帧更慢 ── */
    var dragLerp = 1 - Math.pow(0.9, Math.max(0, timeScale));
    _smoothDrag.x += (_dragOffset.x - _smoothDrag.x) * dragLerp;
    _smoothDrag.y += (_dragOffset.y - _smoothDrag.y) * dragLerp;

    /* ── 更新 & 绘制 Sylvan 背景（子弹时间时冻结背景动画） ── */
    if (!_isBulletTime) {
      _bgFrame++;
      statsTimeStart('bgUpd');
      updateSylvanBackground(1.0, sim.mouseDown, _smoothDrag, sim.mouse.x, sim.mouse.y);
      statsTimeEnd();
      var _bgInterval = IS_MOBILE ? 3 : 2;
      if (_bgFrame % _bgInterval === 0) {
        statsTimeStart('bgRnd');
        renderSylvanBackground();
        statsTimeEnd();
      }
    }

    if (gameState === 'IDLE' || gameState === 'GAME_OVER') {
      statsTimeStart('other');
      updateLevelTimer();
      countSimStats(0);
      statsTimeEnd();
      statsEndFrame(timestamp);
      updateStatsPanel();
      requestAnimFrame(loop);
      return;
    }

    /* spawn descent animation */
    if (_spawnAnim.active && spider) {
      _spawnAnim.t = Math.min(1, _spawnAnim.t + 1 / _spawnAnim.duration);
      var easeOut = 1 - Math.pow(1 - _spawnAnim.t, 3);
      var spawnY = _spawnAnim.fromY + (_spawnAnim.toY - _spawnAnim.fromY) * easeOut;
      var spawnDY = spawnY - spider.thorax.pos.y;
      for (var spi = 0; spi < spider.particles.length; spi++) {
        spider.particles[spi].pos.y += spawnDY;
        spider.particles[spi].lastPos.y += spawnDY;
      }
      for (var sfi = 0; sfi < footState.length; sfi++) {
        footState[sfi].current.y += spawnDY;
        footState[sfi].particle.pos.y += spawnDY;
        footState[sfi].particle.lastPos.y += spawnDY;
      }
      if (_spawnAnim.t >= 1) {
        _spawnAnim.active = false;
        for (var sfi2 = 0; sfi2 < footState.length; sfi2++) footState[sfi2].cooldown = sfi2 * 5;
        triggerStep(0, null, footState, spiderweb, spider, samplePoints, null, STEP_COOLDOWN, undefined, undefined, _spatialOpts());
        triggerStep(2, null, footState, spiderweb, spider, samplePoints, null, STEP_COOLDOWN, undefined, undefined, _spatialOpts());
        setTimeout(function () {
          if (footState) {
            triggerStep(1, null, footState, spiderweb, spider, samplePoints, null, STEP_COOLDOWN, undefined, undefined, _spatialOpts());
            triggerStep(3, null, footState, spiderweb, spider, samplePoints, null, STEP_COOLDOWN, undefined, undefined, _spatialOpts());
          }
        }, 180);
      }
    }

    statsTimeStart('anim');
    captureThrownStickPrev();
    var isPoopStunned = poopStunTimer > 0;
    var isRepairing = false; /* 标记当前是否在执行补网任务 */

    /* ── 补网任务：优先级高于玩家点击和 autoPlay，不可打断 ── */
    if (!isPoopStunned && !wrappingTarget && repairQueue.length > 0) {
      /* 检查队首任务是否仍然有效（ring 上的节点还活着） */
      while (repairQueue.length > 0 && !_isRepairTaskValid(repairQueue[0])) {
        repairQueue.shift();
      }
      if (repairQueue.length > 0) {
        var rTask = repairQueue[0];
        if (rTask.state === 'pending') {
          rTask.state = 'walking';
          _autoTarget.x = rTask.pos.x;
          _autoTarget.y = rTask.pos.y;
          target = _autoTarget;
          isRepairing = true;
        } else if (rTask.state === 'walking') {
          _autoTarget.x = rTask.pos.x;
          _autoTarget.y = rTask.pos.y;
          target = _autoTarget;
          isRepairing = true;
          if (spider.thorax.pos.dist2(rTask.pos) <= 14 * 14) {
            rTask.state = 'repairing';
            target = null;
          }
        } else if (rTask.state === 'repairing') {
          target = null;
          isRepairing = true;
          rTask.timer -= _currentTimeScale;
          if (rTask.timer <= 0) {
            patchHole(rTask.ring, spiderweb);
            repairQueue.shift();
            _refreshBrokenEnds();
            webScanPending = 3;
            isRepairing = false;
          }
        }
      }
    }

    /* ── 玩家优先目标：完成当前工作后优先去用户点选的位置/物体 ── */
    if (!isPoopStunned && !wrappingTarget && !isRepairing && userPriorityTarget) {
      if (userPriorityTarget.type === 'object') {
        if (!getActivePriorityObject()) {
          clearPriorityTarget();
          pauseAndClearCurrentTarget();
        } else {
          _autoTarget.x = userPriorityTarget.obj.particle.pos.x;
          _autoTarget.y = userPriorityTarget.obj.particle.pos.y;
          target = _autoTarget;
        }
      } else if (userPriorityTarget.type === 'point') {
        _autoTarget.x = userPriorityTarget.point.x;
        _autoTarget.y = userPriorityTarget.point.y;
        target = _autoTarget;
        if (spider.thorax.pos.dist2(_autoTarget) <= 14 * 14) {
          clearPriorityTarget();
          pauseAndClearCurrentTarget();
        }
      }
    }

    /* ── autoPlay：自动选取最近 stuck 物体为目标 ── */
    if (_autoPlayPause > 0) { _autoPlayPause--; }
    if (!isPoopStunned && autoPlay && !wrappingTarget && !isRepairing && _autoPlayPause <= 0 && !userPriorityTarget) {
      if (autoChaseTarget && !isTargetObjectChaseable(autoChaseTarget)) {
        pauseAndClearCurrentTarget();
      } else {
        if (!autoChaseTarget) {
          var _bestObj = null, _bestD2 = Infinity;
          var _tx = spider.thorax.pos;
          for (var _oi = 0; _oi < thrownObjects.length; _oi++) {
            var _o = thrownObjects[_oi];
            if (!isTargetObjectChaseable(_o)) continue;
            var _odx = _o.particle.pos.x - _tx.x, _ody = _o.particle.pos.y - _tx.y;
            var _od2 = _odx * _odx + _ody * _ody;
            if (_od2 < _bestD2) { _bestD2 = _od2; _bestObj = _o; }
          }
          autoChaseTarget = _bestObj;
        }
        if (autoChaseTarget) {
          _autoTarget.x = autoChaseTarget.particle.pos.x;
          _autoTarget.y = autoChaseTarget.particle.pos.y;
          target = _autoTarget;
        } else {
          target = null;
        }
      }
    }

    /* body movement */
    var isWrapping = (wrappingTarget !== null);
    var moving = false; moveDir = null;
    if (isPoopStunned) {
      target = null;
    } else if (isWrapping) {
      target = null;
    } else if (target) {
      var tx = spider.thorax.pos;
      var dx = target.x - tx.x, dy = target.y - tx.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > arriveThreshold && !_isBulletTime) {
        moving = true;
        var scaledSpeed = moveSpeed;
        var dirX = dx / dist, dirY = dy / dist;

        /* 玩家优先目标导航：绕开其他掉落物，不在路上触发打包 */
        if (userPriorityTarget) {
          var priorityObj = getActivePriorityObject();
          var avoidRadius = 68;
          for (var ai = 0; ai < thrownObjects.length; ai++) {
            var aobj = thrownObjects[ai];
            if (!aobj || aobj === priorityObj) continue;
            if (aobj.state !== 'stuck' && aobj.state !== 'sticking' && aobj.state !== 'freeing' && aobj.state !== 'wrapping') continue;
            var ap = aobj.particle.pos;
            var adx = tx.x - ap.x;
            var ady = tx.y - ap.y;
            var ad2 = adx * adx + ady * ady;
            if (ad2 <= 1 || ad2 > avoidRadius * avoidRadius) continue;
            var ad = Math.sqrt(ad2);
            var repel = (1 - ad / avoidRadius) * 1.45;
            dirX += (adx / ad) * repel;
            dirY += (ady / ad) * repel;
          }
          var dirL = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
          dirX /= dirL; dirY /= dirL;
        }

        var nx = dirX * scaledSpeed, ny = dirY * scaledSpeed;
        moveDir = new Vec2(dirX, dirY);
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
        fs.t = Math.min(1, fs.t + STEP_SPEED * ((_isBulletTime || isPoopStunned) ? 0 : 1));
        var ease = fs.t < 0.5 ? 2 * fs.t * fs.t : -1 + (4 - 2 * fs.t) * fs.t;
        fs.current.x = fs.from.x + (fs.targetPos.x - fs.from.x) * ease;
        fs.current.y = fs.from.y + (fs.targetPos.y - fs.from.y) * ease;
        fs.particle.pos.mutableSet(fs.current);
        if (fs.t >= 1) {
          fs.current.x = fs.targetPos.x; fs.current.y = fs.targetPos.y;
          fs.particle.pos.mutableSet(fs.current);
          fs.stepping = false;
          landFoot(fs, spider, spiderweb, footState);
        }
      } else {
        if (fs.landedNode) {
          if (_isSpiderFootNodeAlive(fs.landedNode)) {
            fs.current.x = fs.landedNode.pos.x; fs.current.y = fs.landedNode.pos.y;
          } else _invalidateSpiderFoot(fs);
        } else if (fs.landedSeg) {
          var sp = fs.landedSeg;
          if (_isSpiderFootSegmentAlive(sp)) {
            fs.current.x = sp.pa.pos.x + (sp.pb.pos.x - sp.pa.pos.x) * sp.t;
            fs.current.y = sp.pa.pos.y + (sp.pb.pos.y - sp.pa.pos.y) * sp.t;
          } else _invalidateSpiderFoot(fs);
        }
        if (fs.landedNode || fs.landedSeg) { fs.particle.pos.mutableSet(fs.current); fs.particle.lastPos.mutableSet(fs.current); }
      }
    }

    if (!_isBulletTime) {
      integrateThrownObjects();
      if (!USE_LEGACY_COLLISION) rebuildSpatialIndex();
      queryThrownStick();
    }
    statsTimeEnd();

    /* Phase C：physics → build → query（单步 11 iter，仅蛛网受重力） */
    statsTimeStart('phys');
    var physicsIters = 11;
    var physicsSteps = _isBulletTime ? 1 : Math.max(1, Math.min(3, Math.round(timeScale)));
    countSimStats(physicsIters * physicsSteps);
    for (var psi = 0; psi < physicsSteps; psi++) {
      sim.frame(
        physicsIters,
        USE_LEGACY_COLLISION ? null : _constraintAlive
      );
    }
    _resyncFootParticles();
    statsTimeEnd();

    statsTimeStart('query');
    _syncStepSearchTopology();
    if (!USE_LEGACY_COLLISION) rebuildSpatialIndex();

    updateFootTriggers();

    /* 断网红闪帧计数（子弹时间时暂停计数，避免红闪提前消失） */
    if (!_isBulletTime) {
      _breakFrame += timeScale;
      if (webBreakFlashes.length > 0) {
        var flashWrite = 0;
        for (var fwi = 0; fwi < webBreakFlashes.length; fwi++) {
          if (_breakFrame - webBreakFlashes[fwi].t < 20) webBreakFlashes[flashWrite++] = webBreakFlashes[fwi];
        }
        webBreakFlashes.length = flashWrite;
      }
    }

    /* animT：子弹时间时冻结，其他时候每帧 +1 保持动画连续 */
    if (!_isBulletTime) {
      for (var _ai = 0; _ai < thrownObjects.length; _ai++) {
        if (thrownObjects[_ai]) thrownObjects[_ai].animT += timeScale;
      }
    }

    /* wave system + 投掷物更新：子弹时间时全部冻结 */
    if (!_isBulletTime) {
      updateLevelTimer();
      updateLevelSpawner();
      checkWebIntegrity();
      if (poopStunTimer > 0) poopStunTimer = Math.max(0, poopStunTimer - timeScale);
      tryCollectObjects();
      if (pendingLevelCheck) { pendingLevelCheck = false; checkLevelComplete(); }
    }
    statsTimeEnd();

    statsTimeStart('other');
    updateBlink();
    statsTimeEnd();
    statsTimeStart('webRnd');
    sim.draw();
    statsTimeEnd();
    statsTimeStart('preyRnd');
    drawThrownObjects(sim.ctx, thrownObjects, userPriorityTarget);
    statsTimeEnd();
    statsTimeStart('spiderRnd');
    if (spider && spider.drawConstraints) spider.drawConstraints(sim.ctx, spider);
    drawWrappingOverlay(sim.ctx, thrownObjects); /* 打包圆圈在最上层 */

    /* ── 补网修复进度圈 ── */
    if (repairQueue.length > 0 && repairQueue[0].state === 'repairing') {
      var rt = repairQueue[0];
      var progress = 1 - rt.timer / REPAIR_WORK_DUR;
      var rpx = rt.pos.x, rpy = rt.pos.y;
      var rStartA = -Math.PI / 2;
      sim.ctx.beginPath();
      sim.ctx.arc(rpx, rpy, 14, rStartA, rStartA + progress * 2 * Math.PI);
      sim.ctx.strokeStyle = 'rgba(100,220,160,0.85)';
      sim.ctx.lineWidth = 2.2;
      sim.ctx.stroke();
      var rTipAngle = rStartA + progress * 2 * Math.PI;
      sim.ctx.beginPath();
      sim.ctx.arc(rpx + Math.cos(rTipAngle) * 14, rpy + Math.sin(rTipAngle) * 14, 2.2, 0, 2 * Math.PI);
      sim.ctx.fillStyle = 'rgba(100,220,160,0.95)';
      sim.ctx.fill();
    }

    statsTimeEnd();

    /* 放射粒子：更新 + 绘制 */
    if (_burstParticles.length > 0) {
      statsTimeStart('other');
      var _ctx = sim.ctx;
      for (var _bpi = _burstParticles.length - 1; _bpi >= 0; _bpi--) {
        var _bp = _burstParticles[_bpi];
        var _speedScale = (_bp.speedScale || 1) * timeScale;
        _bp.x += _bp.vx * _speedScale; _bp.y += _bp.vy * _speedScale;
        var _drag = _bp.drag || 0.92;
        var _dragScale = Math.pow(_drag, timeScale);
        _bp.vx *= _dragScale;
        _bp.vy *= _dragScale;
        if (_bp.smoke) {
          _bp.r += (_bp.grow || 0.1) * _speedScale;
        }
        _bp.life -= _bp.decay * _speedScale;
        if (_bp.life <= 0) { _burstParticles.splice(_bpi, 1); continue; }
        _ctx.save();
        _ctx.globalAlpha = _bp.smoke ? _bp.life * (_bp.occlude || 0.82) : _bp.life;
        if (_bp.smoke) {
          _ctx.shadowBlur = 30;
          _ctx.shadowColor = _bp.color;
        }
        _ctx.beginPath();
        _ctx.arc(_bp.x, _bp.y, _bp.smoke ? _bp.r : _bp.r * _bp.life, 0, 2 * Math.PI);
        _ctx.fillStyle = _bp.color;
        _ctx.fill();
        if (_bp.smoke) {
          _ctx.globalAlpha *= 0.52;
          _ctx.beginPath();
          _ctx.arc(_bp.x + _bp.r * 0.08, _bp.y - _bp.r * 0.05, _bp.r * 0.68, 0, 2 * Math.PI);
          _ctx.fillStyle = '#080606';
          _ctx.fill();
        }
        _ctx.restore();
      }
      statsTimeEnd();
    }

    /* ── 玩家标记：顶层绘制 ── */
    if (userPriorityTarget) {
      var markerX, markerY, markerPulse = 0.55 + 0.45 * Math.abs(Math.sin(timestamp * 0.012));
      var markerFloat = Math.sin(timestamp * 0.006) * 3;
      var markerObj = null;
      if (userPriorityTarget.type === 'object' && userPriorityTarget.obj && thrownObjects.indexOf(userPriorityTarget.obj) !== -1) {
        markerObj = userPriorityTarget.obj;
        markerX = markerObj.particle.pos.x;
        markerY = markerObj.particle.pos.y;
      } else if (userPriorityTarget.type === 'point') {
        markerX = userPriorityTarget.point.x;
        markerY = userPriorityTarget.point.y;
        sim.ctx.save();
        sim.ctx.strokeStyle = 'rgba(255,255,255,' + markerPulse.toFixed(2) + ')';
        sim.ctx.lineWidth = 2;
        sim.ctx.beginPath();
        sim.ctx.arc(markerX, markerY, 6 + Math.sin(timestamp * 0.02) * 1.2, 0, 2 * Math.PI);
        sim.ctx.stroke();
        sim.ctx.beginPath();
        sim.ctx.arc(markerX, markerY, 1.8, 0, 2 * Math.PI);
        sim.ctx.fillStyle = 'rgba(255,255,255,' + markerPulse.toFixed(2) + ')';
        sim.ctx.fill();
        sim.ctx.restore();
      }

      if (markerX != null && markerY != null) {
        var triY = markerY - (markerObj && markerObj.def ? markerObj.def.r * 2.8 : 20) - 10 + markerFloat;
        sim.ctx.save();
        sim.ctx.fillStyle = 'rgba(255,245,170,0.95)';
        sim.ctx.beginPath();
        sim.ctx.moveTo(markerX, triY + 6);
        sim.ctx.lineTo(markerX - 6, triY - 4);
        sim.ctx.lineTo(markerX + 6, triY - 4);
        sim.ctx.closePath();
        sim.ctx.fill();
        sim.ctx.restore();
      }
    }

    statsEndFrame(timestamp);
    updateStatsPanel();
    requestAnimFrame(loop);
  };
  requestAnimFrame(loop);
};
