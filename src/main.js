/* Version: V3.2 — Sylvan Background + Procedural BGM */
import { Vec2 } from './engine/Vec2.js';
import { Particle } from './engine/Particle.js';
import { DistanceConstraint } from './engine/constraints.js';
import { Composite } from './engine/Composite.js';
import { VerletJS } from './engine/VerletJS.js';

import { createSpiderweb } from './entities/spiderweb.js';
import { createSpider } from './entities/spider.js';
import { ThrownObj, clearObjectConstraints, collapseChain, breakWebInRadius, breakWebSegmentAsBug } from './entities/ThrownObj.js';

import {
  getWebSamplePoints, updateSamplePoints,
  liftFoot, landFoot, triggerStep,
  getNextPid
} from './systems/footSystem.js';
import { createSpiderAI } from './systems/spiderAI.js';

import {
  getWebOuterR, inWebZone, radialRatioAt,
  collectPathHitCandidates, collectPathHitCandidatesSpatial, chooseStickCandidate,
  findNearestWebSegment,
  mergeStickHits, stickHitScratch
} from './systems/stickSystem.js';
import { findWrappedReanchorPoint } from './systems/wrappedSupport.js';
import {
  resolveNavigation, isNavReachable, invalidateNavCache,
  getFootSearchRadiusForTier, findNavPath, findNearestNavPoint,
  getNavSteerHint, hasReachedNavGoal
} from './systems/navigationGraph.js';

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
import { drawThrownObjects, buildSilkSpiral, ensureSilkSpiral, buildCollectSnapshot, drawWrappingOverlay, spawnLeafShards, updateAndDrawLeafShards, prewarmSilkSpiralCache } from './render/objectRenderer.js';
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
  createTutorialController,
  shouldStartTutorial,
  isTutorialInsectKind,
  canDragTutorialWrappedPrey,
  shouldTriggerTutorialStoneImpact,
  resolveTutorialStoneImpactPoint,
  createTutorialStoneImpact,
  tickTutorialStoneImpact,
  applyWebPullTowardPoint,
  applyWebImpactKick,
  TUTORIAL_STONE_PULL_FRAMES,
  TUTORIAL_TARGETS
} from './tutorial/tutorialController.js';

import {
  statsBeginFrame, statsEndFrame, statsSetScene, statsBindPanel,
  statsTimeStart, statsTimeEnd,
  statsSetRuntimeContextGetter, statsRecordFrameMeta,
  statsGetDiagnosticMode, statsSetDiagnosticMode,
  statsIsRecording, statsStartRecording, statsStopRecording,
  statsGetRecordedSecondCount, statsClearRecording,
  statsDownloadExportPackage
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
  prewarmSilkSpiralCache();
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
    /* Speed units are fixed-step units. Tune these values, not the RAF loop. */
    moveSpeed: 1.8,
    idleMoveRatio: 0.06,
    idleStepThresh: 20,
    idleStepSpeed: 0.09,
    idleStepCooldown: 11,
    idleStepReach: 34,
    stepSpeed: 0.18, wrapSpeed: 1.0, stepThresh: 22, restThresh: 50,
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
  sim.hasObjectAt = function (x, y) {
    for (var i = thrownObjects.length - 1; i >= 0; i--) {
      var obj = thrownObjects[i];
      if (!obj) continue;
      /* wrapped 物体和 stuck poop 优先于 stub（能真正拽走的） */
      var isHighPriority = obj.state === 'wrapped'
        || (obj.state === 'stuck' && obj.kind === 'poop');
      if (!isHighPriority) continue;
      var r = obj.state === 'wrapped'
        ? _getWrappedPickupRadius(obj)
        : (obj.def ? obj.def.r * 2.2 : 16);
      var dx = obj.particle.pos.x - x;
      var dy = obj.particle.pos.y - y;
      if (dx * dx + dy * dy <= r * r) return true;
    }
    return false;
  };

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
    if (obj.kind === 'boulder') return 6;
    if (obj.kind === 'bug') return 3;
    return 3;
  }

  function _isStuckDragOnly(obj) {
    return obj.state === 'stuck' && (obj.kind === 'drop' || obj.kind === 'bug');
  }

  function _pickPreyAt(x, y, states) {
    var allowed = states || ['wrapped', 'stuck'];
    var bestWebDrag = null;
    var bestWebDragD2 = Infinity;
    var bestOther = null;
    var bestOtherD2 = Infinity;
    for (var oi = thrownObjects.length - 1; oi >= 0; oi--) {
      var obj = thrownObjects[oi];
      if (!obj || allowed.indexOf(obj.state) === -1) continue;
      var p = obj.particle.pos;
      var radius = obj.state === 'wrapped' || obj.state === 'stuck'
        ? _getWrappedPickupRadius(obj)
        : (obj.def ? obj.def.r * 2.2 : 16);
      var dx = x - p.x;
      var dy = y - p.y;
      var d2 = dx * dx + dy * dy;
      if (d2 > radius * radius) continue;
      var isWebDragCandidate = obj.state === 'stuck' && (obj.kind === 'boulder' || obj.kind === 'bug' || obj.kind === 'drop');
      if (isWebDragCandidate) {
        if (d2 < bestWebDragD2) {
          bestWebDrag = obj;
          bestWebDragD2 = d2;
        }
      } else if (d2 < bestOtherD2) {
        bestOther = obj;
        bestOtherD2 = d2;
      }
    }
    return bestOther || bestWebDrag;
  }

  function _findWrappedPreyAt(clientX, clientY) {
    var pos = _getCanvasPos(clientX, clientY);
    var obj = _pickPreyAt(pos.x, pos.y, ['wrapped', 'stuck']);
    return obj ? { obj: obj, pos: pos } : null;
  }

  sim.shouldAllowWebTug = function (x, y) {
    return !_pickPreyAt(x, y, ['wrapped', 'stuck']);
  };

  function _beginWrappedPickup(clientX, clientY) {
    var hit = _findWrappedPreyAt(clientX, clientY);
    if (!hit) return false;
    /* wrapped 和 stuck poop 优先于 stub；stuck web-drag 类（boulder/bug/drop）不覆盖 stub */
    if (sim.draggedEntity && sim.draggedEntity.__isStub) {
      var isHighPriority = hit.obj.state === 'wrapped'
        || (hit.obj.state === 'stuck' && hit.obj.kind === 'poop');
      if (!isHighPriority) return false;
    }
    sim.draggedEntity = null;
    sim.snapTarget = null;
    if (
      isTutorialActive()
      && hit.obj
      && hit.obj.state === 'wrapped'
      && isTutorialInsectKind(hit.obj.kind)
      && !canDragTutorialWrappedPrey(tutorialController.getPhase())
    ) {
      _suppressMoveCommand = true;
      sim.draggedEntity = null;
      if (isTutorialInsectKind(hit.obj.kind)) setSelectedWrappedPrey(hit.obj);
      return true;
    }
    if (hit.obj.state === 'wrapped' && isTutorialInsectKind(hit.obj.kind)) {
      setSelectedWrappedPrey(hit.obj);
    }
    var dragMode = (hit.obj.state === 'stuck' && (hit.obj.kind === 'boulder' || hit.obj.kind === 'bug' || hit.obj.kind === 'drop'))
      ? 'web-drag'
      : 'pluck';
    _pickupDrag = {
      obj: hit.obj,
      startX: hit.obj.particle.pos.x,
      startY: hit.obj.particle.pos.y,
      pointerX: hit.pos.x,
      pointerY: hit.pos.y,
      gripDX: hit.pos.x - hit.obj.particle.pos.x,
      gripDY: hit.pos.y - hit.obj.particle.pos.y,
      mode: dragMode,
      active: true
    };
    hit.obj._pickupTension = 0;
    hit.obj._pickupCharge = 0;
    hit.obj.dragStrain = 0;
    hit.obj.playerDragging = dragMode === 'web-drag' || hit.obj.kind === 'poop';
    if (hit.obj.kind === 'poop') {
      _suppressPriorityClick = true;
    } else if (dragMode === 'pluck') {
      audioEngine.startPickupTearLoop();
      audioEngine.updatePickupTearLoop(0);
      if (isTutorialActive() && isTutorialInsectKind(hit.obj.kind) && hit.obj.state === 'wrapped') {
        tutorialController.handleEvent('prey_drag_started', { kind: hit.obj.kind });
        processTutorialActions();
      }
    }
    sim.draggedEntity = null;
    return true;
  }

  function consumeTutorialAdvanceInput() {
    if (!isTutorialActive()) return false;
    tutorialController.handleEvent('handoff_confirmed');
    processTutorialActions();
    return tutorialBlackoutEl.style.display === 'flex';
  }

  function _updateWrappedPickup(clientX, clientY) {
    if (!_pickupDrag) return false;
    var pos = _getCanvasPos(clientX, clientY);
    _pickupDrag.pointerX = pos.x;
    _pickupDrag.pointerY = pos.y;
    var moveDx = clientX - _pointerStartClient.x;
    var moveDy = clientY - _pointerStartClient.y;
    if (Math.sqrt(moveDx * moveDx + moveDy * moveDy) >= TAP_MOVE_THRESHOLD) {
      _pointerMoved = true;
      if (_pickupDrag.mode === 'pluck' && !_pickupDrag._audioStarted) {
        _pickupDrag._audioStarted = true;
        audioEngine.startPickupTearLoop();
        audioEngine.updatePickupTearLoop(0);
      }
    }
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
      if (_pointerMoved) _suppressMoveCommand = true;
      _pickupDrag = null;
      sim.draggedEntity = null;
      return true;
    }
    return false;
  }

  window.addEventListener('mousedown', function (e) {
    if (consumeTutorialAdvanceInput()) {
      _suppressMoveCommand = true;
      return;
    }
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
      if (consumeTutorialAdvanceInput()) {
        _suppressMoveCommand = true;
        return;
      }
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
  /* moveSpeed is pixels per fixed 60Hz logic step. Do not multiply by RAF delta. */
  var target = null, idleTarget = null, moveDir = null, moveSpeed = P.moveSpeed, arriveThreshold = 6;
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
  var blinkState = { scale: 1, blinking: false, t: 0, nextBlink: 180 + Math.floor(Math.random() * 240), mood: 'calm', headShake: 0, headShakeAmp: 0, faceAnimT: 0, crySfxCooldown: 0 };
  var _autoTarget = new Vec2(0, 0); /* 复用对象，避免每帧 GC */
  var spiderAI = createSpiderAI();
  var idleWanderActive = false;
  var idleWanderSession = false;
  var _idlePauseFootCooldown = 0;
  var _idleBoredPhase = 'wander';
  var _idleBoredTimer = 0;
  var _idleBoredLimit = 0;
  var isGameplayTestMode = false;
  var debugSpawnEnabled = true;

  function randomIdleBoredCycleFrames() {
    return 180 + Math.floor(Math.random() * 121);
  }

  function resetIdleBoredCycle() {
    _idleBoredPhase = 'wander';
    _idleBoredTimer = 0;
    _idleBoredLimit = randomIdleBoredCycleFrames();
  }

  function tickIdleBoredCycle(dt) {
    _idleBoredTimer += dt || 1;
    if (_idleBoredTimer < _idleBoredLimit) return _idleBoredPhase === 'bored';
    _idleBoredTimer = 0;
    _idleBoredLimit = randomIdleBoredCycleFrames();
    _idleBoredPhase = _idleBoredPhase === 'bored' ? 'wander' : 'bored';
    return _idleBoredPhase === 'bored';
  }

  resetIdleBoredCycle();

  function updateBlink() {
    var blinkInterval = blinkState.mood === 'crying'   ? 18 + Math.floor(Math.random() * 26)
                      : blinkState.mood === 'startled' ? 40 + Math.floor(Math.random() * 60)
                      : blinkState.mood === 'curious'  ? 120 + Math.floor(Math.random() * 180)
                      : blinkState.mood === 'bored'    ? 150 + Math.floor(Math.random() * 210)
                      : 180 + Math.floor(Math.random() * 300);
    if (blinkState.blinking) {
      blinkState.t += 0.18;
      if (blinkState.t <= 1) blinkState.scale = 1 - 0.95 * (blinkState.t < 0.5 ? 2 * blinkState.t * blinkState.t : -1 + (4 - 2 * blinkState.t) * blinkState.t);
      else if (blinkState.t <= 2) { var t2 = blinkState.t - 1; blinkState.scale = 0.05 + 0.95 * (t2 < 0.5 ? 2 * t2 * t2 : -1 + (4 - 2 * t2) * t2); }
      else { blinkState.scale = 1; blinkState.blinking = false; blinkState.t = 0; blinkState.nextBlink = blinkInterval; }
    } else { blinkState.nextBlink--; if (blinkState.nextBlink <= 0) { blinkState.blinking = true; blinkState.t = 0; } }

    if (blinkState.mood === 'crying') {
      blinkState.faceAnimT += 1;
      blinkState.crySfxCooldown--;
      if (blinkState.crySfxCooldown <= 0) {
        audioEngine.playSfxCry();
        blinkState.crySfxCooldown = 28 + Math.floor(Math.random() * 18);
      }
    } else {
      blinkState.faceAnimT = 0;
      blinkState.crySfxCooldown = 0;
    }

    if (blinkState.headShake > 0) {
      blinkState.headShake--;
      blinkState.headShakeAmp *= 0.77;
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
    invalidateNavCache();
    spatialIndex.syncAliveFromWeb(spiderweb);
    var wi = sim.composites.indexOf(spiderweb);
    if (wi !== 0) { sim.composites.splice(wi, 1); sim.composites.unshift(spiderweb); }
    samplePoints = getWebSamplePoints(spiderweb, 4);
    _samplePointsTopologyVersion = spiderweb._topologyVersion || 0;
    setupWebDraw(
      spiderweb,
      function () { return thrownObjects; },
      function () { return webBreakFlashes; },
      function () { return _breakFrame; },
      function () { return brokenEnds; },
      function () { return sim.snapTarget; },
      function () { return repairQueue; },
      function () { return _previewRing; },
      function () { return repairCompleteFlashes; },
      function () { return tutorialStoneImpact; },
      function () { return sim.snapCandidates; }
    );
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
        stepping: false, t: 1, cooldown: idx * 6, needsEmergencyStep: false,
        emergencyFrames: 0
      };
    });
    _spawnAnim.active = true;
    _spawnAnim.t = 0;
    _spawnAnim.fromY = spawnFromY;
    _spawnAnim.toY = cy;
    _spawnAnim.duration = 52;
    setupSpiderDraw(spider, legConstraintCount, footState, blinkState, function () {
      if (wrappingTarget) return wrappingTarget;
      if (repairQueue.length > 0 && repairQueue[0].state === 'repairing') return _repairAnimProxy;
      return null;
    });
    spiderAI.reset(spiderweb);
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
  var perfRecordBtnEl = document.getElementById('btn-perf-record');
  function syncPerfRecordBtnLabel() {
    if (!perfRecordBtnEl || !statsIsRecording()) return;
    perfRecordBtnEl.textContent = 'Record Perf: ON (' + statsGetRecordedSecondCount() + 's)';
  }

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
  var userPriorityTarget = null; /* { type:'object'|'point', obj?, point? } — 躯干只朝最终点走，不沿 waypoint 折线 */
  var selectedWrappedPrey = null; /* 玩家选中的 wrapped 虫类（苍蝇/毛毛虫），用于轮廓高亮 */
  var autoChaseTarget = null;   /* 自动模式下当前锁定的掉落物 */
  var _navSteerPath = null;     /* 仅卡住时用于轻微转向提示，不驱动日常躯干位移 */
  var _locomotion = { noStepFrames: 0, stallFrames: 0, frameTick: 0, lastGoalDist: Infinity };
  var EMERGENCY_STEP_MAX_FRAMES = 45;
  var brokenEnds = [];      /* 断线头粒子列表，每帧更新，传给 webRenderer */
  var repairQueue = [];     /* 补网任务队列 [{ring, pos, state, timer}] */
  var repairCompleteFlashes = []; /* 补网完成后的区域闪烁 [{ring, t, duration}] */
  var _repairAnimProxy = {  /* 补网时复用打包动画的代理目标 */
    particle: { pos: { x: 0, y: 0 } },
    wrapT: 0,
    animT: 0,
    wrapDur: 60
  };
  var _previewRing = null;  /* 拖拽 stub 时的 BFS 环路预览 */
  var _previewSnapTarget = null; /* 上次计算预览时的 snapTarget，避免重复 BFS */
  var REPAIR_WORK_DUR = 50; /* 修复工作时长（帧），与树叶采集相同 */
  var autoPlay = true;      /* 自动寻路打包开关，默认开启 */
  var _autoPlayPause = 0;   /* 打包完成或丢失目标后的停顿帧计数 */
  var POOP_STUN_FRAMES = 180;
  var poopStunTimer = 0;
  var LEVEL_START_LOCK_FRAMES = 120; /* 2秒 @60Hz，每关开始蜘蛛冻结 */
  var levelStartLockTimer = 0;       /* 倒计时，>0 时蜘蛛不可移动 */
  var LEVEL_START_STONE_DELAY = 60;  /* 1秒后掉石头 */
  var _levelStartStoneTimer = 0;     /* 倒计时，归零时发射石头 */
  var _levelStartStonePending = false;
  var _draggingPoop = null;
  var _poopPointerDown = null;
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
  var _burstParticlePool = [];

  function _pushBurstParticle(props) {
    var p = _burstParticlePool.length ? _burstParticlePool.pop() : {};
    for (var pk in props) {
      if (Object.prototype.hasOwnProperty.call(props, pk)) p[pk] = props[pk];
    }
    _burstParticles.push(p);
    return p;
  }

  function _recycleBurstParticle(p) {
    p.sparkle = false;
    p.smoke = false;
    p.grow = 0;
    p.occlude = 0;
    p.phase = 0;
    _burstParticlePool.push(p);
  }
  var _wrapSplashParticles = []; /* 打包中白色线状飞溅（顶层绘制） */
  var _wrapSplashTimer = 0;
  var _wrapSplashInterval = 9; /* 每组飞溅的间隔（帧） */
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

  function buildPerfGameContext() {
    var preyByState = { falling: 0, stuck: 0, wrapped: 0, other: 0 };
    var preyByKind = { boulder: 0, bug: 0, drop: 0, poop: 0 };
    for (var pi = 0; pi < thrownObjects.length; pi++) {
      var pobj = thrownObjects[pi];
      if (!pobj) continue;
      if (pobj.kind && preyByKind[pobj.kind] != null) preyByKind[pobj.kind]++;
      var pst = pobj.state || 'other';
      if (pst === 'falling' || pst === 'falling2') preyByState.falling++;
      else if (pst === 'stuck' || pst === 'freeing') preyByState.stuck++;
      else if (pst === 'wrapped') preyByState.wrapped++;
      else preyByState.other++;
    }
    return {
      state: gameState,
      level: currentLevelIndex,
      levelLabel: 'L' + (currentLevelIndex + 1),
      wave: currentWaveIndex,
      waveLabel: 'W' + (currentWaveIndex + 1),
      wavePhase: currentWavePhase,
      spawnPhase: spawnPhase,
      tutorial: !!tutorialActive,
      mobile: IS_MOBILE,
      autoPlay: autoPlay,
      flags: {
        wrapping: wrappingTarget !== null,
        poopStun: poopStunTimer > 0,
        bulletTime: !!(sim.draggedEntity && sim.draggedEntity.__isStub),
        spawnAnim: _spawnAnim.active,
        idleWander: idleWanderActive
      },
      preyByKind: preyByKind,
      preyByState: preyByState,
      onField: {
        boulder: objCounts.boulder || 0,
        bug: objCounts.bug || 0,
        drop: objCounts.drop || 0,
        poop: objCounts.poop || 0
      },
      inventory: {
        boulder: inventoryCounts.boulder || 0,
        bug: inventoryCounts.bug || 0,
        drop: inventoryCounts.drop || 0
      },
      collected: {
        boulder: levelCollected.boulder || 0,
        bug: levelCollected.bug || 0,
        drop: levelCollected.drop || 0
      },
      webDamage: {
        brokenStubs: brokenEnds.length,
        repairJobs: repairQueue.length
      },
      levelTimeSec: Math.round(levelTimer / 60)
    };
  }

  statsSetRuntimeContextGetter(buildPerfGameContext);

  var tutorialActive = false;
  var tutorialController = createTutorialController(W, H, cx, cy);
  var tutorialTargets = cloneJson(TUTORIAL_TARGETS);
  var tutorialHintEl = document.getElementById('tutorial-hint');
  var tutorialFocusEl = document.createElement('div');
  var tutorialFocusRingEl = document.createElement('div');
  var tutorialFocusIconEl = document.createElement('div');
  var tutorialBlackoutEl = document.createElement('div');
  var tutorialSpawnQueue = [];
  var _tutorialRepairDragDone = false;
  var _tutorialRepairPending = false;
  var _tutorialStubNotified = false;
  var tutorialStoneImpact = null;
  var tutorialFocusActive = false;
  var tutorialFocusTarget = 'stub';
  var _urlSearchParams = new URLSearchParams(window.location.search);

  tutorialFocusEl.className = 'tutorial-focus-overlay';
  tutorialFocusEl.style.display = 'none';
  tutorialFocusRingEl.className = 'tutorial-focus-ring';
  tutorialFocusIconEl.className = 'tutorial-focus-icon';
  tutorialFocusEl.appendChild(tutorialFocusRingEl);
  tutorialFocusEl.appendChild(tutorialFocusIconEl);
  screenShellEl.appendChild(tutorialFocusEl);
  tutorialBlackoutEl.className = 'tutorial-blackout';
  tutorialBlackoutEl.style.display = 'none';
  screenShellEl.appendChild(tutorialBlackoutEl);

  /* ── 关卡切换黑屏遮罩 ── */
  var levelTransitionEl = document.createElement('div');
  levelTransitionEl.className = 'level-transition-blackout';
  screenShellEl.appendChild(levelTransitionEl);

  function doLevelTransition(callback) {
    levelTransitionEl.classList.remove('active');
    /* 强制 reflow 让 animation 重新触发 */
    void levelTransitionEl.offsetWidth;
    levelTransitionEl.classList.add('active');
    /* 关卡实际切换在动画中点（opacity 达到1后约 0.3s）执行 */
    var SWITCH_DELAY = 300; /* ms，对应动画 25% 处 opacity=1 */
    setTimeout(function () {
      callback();
    }, SWITCH_DELAY);
    /* 动画结束后移除 active */
    levelTransitionEl.addEventListener('animationend', function handler() {
      levelTransitionEl.classList.remove('active');
      levelTransitionEl.removeEventListener('animationend', handler);
    });
  }

  function isTutorialActive() {
    return tutorialActive && tutorialController.isActive();
  }

  function isTutorialSpiderLocked() {
    if (!isTutorialActive()) return false;
    var phase = tutorialController.getPhase();
    return phase === 'intro_wait' || phase === 'breakers';
  }

  function clearPoopDragState() {
    if (_draggingPoop && _draggingPoop.obj) {
      _draggingPoop.obj.playerDragging = false;
      _draggingPoop.obj.dragStrain = 0;
    }
    _draggingPoop = null;
    _poopPointerDown = null;
  }

  function setTutorialFlyVisibility(visible) {
    var invBug = document.getElementById('inv-bug');
    if (invBug) invBug.style.display = visible ? '' : 'none';
    var btnBug = document.getElementById('btn-bug');
    if (btnBug) btnBug.style.display = visible ? '' : 'none';
  }

  function showTutorialHint(text) {
    if (!tutorialHintEl) return;
    if (!text) {
      tutorialHintEl.style.display = 'none';
      tutorialHintEl.textContent = '';
      return;
    }
    tutorialHintEl.textContent = text;
    tutorialHintEl.style.display = 'block';
  }

  function hideTutorialHint() {
    showTutorialHint('');
  }

  function getTutorialStubFocusPoint() {
    if (brokenEnds && brokenEnds.length > 0 && brokenEnds[0] && brokenEnds[0].pos) {
      return { x: brokenEnds[0].pos.x, y: brokenEnds[0].pos.y, r: 78 };
    }
    if (!spiderweb) return null;
    for (var i = 0; i < spiderweb.particles.length; i++) {
      var pt = spiderweb.particles[i];
      if (pt && pt.__isStub && pt.pos) return { x: pt.pos.x, y: pt.pos.y, r: 78 };
    }
    return null;
  }

  function getTutorialPreyFocusPoint() {
    for (var i = 0; i < thrownObjects.length; i++) {
      var obj = thrownObjects[i];
      if (!obj || !obj.particle || !isTutorialInsectKind(obj.kind)) continue;
      if (obj.state !== 'wrapped') continue;
      return {
        x: obj.particle.pos.x,
        y: obj.particle.pos.y,
        r: Math.max(62, (obj.def ? obj.def.r : 12) * 5.4)
      };
    }
    return null;
  }

  function getTutorialInventoryFocusPoint() {
    var slot = document.getElementById('inv-boulder');
    if (!slot) return null;
    var rect = slot.getBoundingClientRect();
    var stageRect = screenShellEl.getBoundingClientRect();
    return {
      x: rect.left + rect.width * 0.5 - stageRect.left,
      y: rect.top + rect.height * 0.5 - stageRect.top,
      r: Math.max(rect.width, rect.height) * 0.72
    };
  }

  function updateTutorialFocusPrompt() {
    if (!tutorialFocusActive) return;
    var focus = tutorialFocusTarget === 'prey'
      ? getTutorialPreyFocusPoint()
      : tutorialFocusTarget === 'inventory'
        ? getTutorialInventoryFocusPoint()
        : getTutorialStubFocusPoint();
    if (!focus) return;
    tutorialFocusEl.style.setProperty('--focus-x', focus.x + 'px');
    tutorialFocusEl.style.setProperty('--focus-y', focus.y + 'px');
    tutorialFocusEl.style.setProperty('--focus-r', focus.r + 'px');
    tutorialHintEl.style.setProperty('--hint-x', focus.x + 'px');
    tutorialHintEl.style.setProperty('--hint-y', (focus.y + focus.r + 18) + 'px');
    tutorialFocusRingEl.style.display = tutorialFocusTarget === 'stub' ? 'block' : 'none';
    tutorialFocusIconEl.style.display = tutorialFocusTarget === 'inventory' ? 'none' : 'block';
  }

  function showTutorialFocusPrompt(text, target, showHint) {
    tutorialFocusActive = true;
    tutorialFocusTarget = target || 'stub';
    tutorialFocusEl.style.display = 'block';
    tutorialHintEl.classList.add('tutorial-hint-focused');
    updateTutorialFocusPrompt();
    audioEngine.playSfxTutorialPrompt();
    if (showHint === false) hideTutorialHint();
    else showTutorialHint(text || (tutorialFocusTarget === 'prey' ? '拖拽摘走你的猎物' : '拖拽连网修复'));
  }

  function hideTutorialFocusPrompt() {
    tutorialFocusActive = false;
    tutorialFocusEl.style.display = 'none';
    tutorialHintEl.classList.remove('tutorial-hint-focused');
  }

  function showTutorialBlackoutMessage(text) {
    audioEngine.playSfxTutorialPrompt();
    tutorialBlackoutEl.textContent = text || '';
    tutorialBlackoutEl.style.display = 'flex';
  }

  function hideTutorialBlackoutMessage() {
    tutorialBlackoutEl.textContent = '';
    tutorialBlackoutEl.style.display = 'none';
  }

  function clearPoopStun() {
    poopStunTimer = 0;
    if (!isTutorialActive() && blinkState.mood === 'shock') setSpiderMood('calm');
  }

  function setSpiderMood(mood) {
    blinkState.mood = mood || 'calm';
    if (mood === 'crying') {
      blinkState.headShake = 150;
      blinkState.headShakeAmp = 3.4;
      blinkState.faceAnimT = 0;
      blinkState.crySfxCooldown = 8;
    } else if (mood === 'shock') {
      blinkState.headShake = 95;
      blinkState.headShakeAmp = 3.2;
      blinkState.faceAnimT = 0;
      blinkState.crySfxCooldown = 0;
    } else if (mood === 'curious') {
      blinkState.headShake = Math.max(blinkState.headShake, 18);
      blinkState.headShakeAmp = Math.max(blinkState.headShakeAmp, 0.8);
      blinkState.crySfxCooldown = 0;
    } else {
      blinkState.headShake = Math.min(blinkState.headShake, 12);
      blinkState.crySfxCooldown = 0;
    }
  }

  function playTutorialStoneFallSound() {
    if (!isTutorialActive()) return;
    audioEngine.playSfxStoneFall();
  }

  function playTutorialWebBreakSound() {
    if (!tutorialActive) return;
    audioEngine.playSfxWebBreak();
  }

  function notifyTutorialStubIfNeeded() {
    if (!isTutorialActive() || _tutorialStubNotified || !spiderweb) return;
    for (var si = 0; si < spiderweb.particles.length; si++) {
      if (spiderweb.particles[si].__isStub) {
        _tutorialStubNotified = true;
        tutorialController.handleEvent('stub_available');
        processTutorialActions();
        return;
      }
    }
  }

  function notifyTutorialRepairFinishedIfNeeded() {
    if (!isTutorialActive() || !_tutorialRepairDragDone || !_tutorialRepairPending) return;
    if (repairQueue.length > 0) return;
    _tutorialRepairPending = false;
    tutorialController.handleEvent('repair_finished');
    processTutorialActions();
  }

  function processTutorialActions() {
    var actions = tutorialController.drainActions();
    for (var ai = 0; ai < actions.length; ai++) {
      var action = actions[ai];
      if (action.type === 'show_message') {
        showTutorialHint(action.text || '');
      } else if (action.type === 'show_focus_prompt') {
        showTutorialFocusPrompt(action.text || '拖拽连网修复', action.target || 'stub', action.showHint);
      } else if (action.type === 'hide_focus_prompt') {
        hideTutorialFocusPrompt();
      } else if (action.type === 'set_spider_mood') {
        setSpiderMood(action.mood);
      } else if (action.type === 'show_blackout_message') {
        hideTutorialHint();
        showTutorialBlackoutMessage(action.text || '开始工作吧！');
      } else if (action.type === 'spawn_batch' && action.batch) {
        for (var bi = 0; bi < action.batch.length; bi++) {
          var spec = action.batch[bi];
          if ((spec.delayFrames || 0) > 0) tutorialSpawnQueue.push(Object.assign({}, spec));
          else launchObjectSpec(spec);
        }
      } else if (action.type === 'set_insect_target') {
        tutorialTargets = cloneJson(action.targets || TUTORIAL_TARGETS);
        refreshLevelTargetHUD();
      } else if (action.type === 'clear_breakers') {
        for (var oi = thrownObjects.length - 1; oi >= 0; oi--) {
          var breaker = thrownObjects[oi];
          if (!breaker || breaker._tutorialTag !== 'breaker') continue;
          breaker.destroy(sim);
          thrownObjects.splice(oi, 1);
          updateBadge(breaker.kind, -1);
        }
      } else if (action.type === 'mark_completed') {
        try { localStorage.setItem('spiderTutorialCompleted', '1'); } catch (e) { }
      } else if (action.type === 'handoff_to_level_1') {
        completeTutorialAndStartLevelOne();
      }
    }
  }

  function launchObjectSpec(spec) {
    var kind = spec.kind || 'boulder';
    var obj = new ThrownObj(kind, W, H, sim, P, gameState, getWaveCfgAt, currentLevelIndex, currentWaveIndex);
    obj._W = W; obj._H = H;
    if (spec.x != null && spec.y != null) {
      obj.particle.pos.x = spec.x;
      obj.particle.pos.y = spec.y;
      obj.particle.lastPos.x = spec.x - (spec.vx || 0);
      obj.particle.lastPos.y = spec.y - (spec.vy || 0);
      obj.prevX = spec.x;
      obj.prevY = spec.y;
    }
    if (spec.vx != null) obj.spawnVx = spec.vx;
    if (spec.vy != null) obj.spawnVy = spec.vy;
    if (spec.defOverrides) {
      Object.assign(obj.def, spec.defOverrides);
      if (spec.defOverrides.stayFrames != null) obj.stayFrames = spec.defOverrides.stayFrames;
      if (spec.defOverrides.gravity != null) obj.grav = spec.defOverrides.gravity;
    }
    if (spec._tutorialTag) obj._tutorialTag = spec._tutorialTag;
    if (spec.breakScale != null) obj._tutorialBreakScale = spec.breakScale;
    if (spec.forcedStubCount != null) obj._tutorialForcedStubCount = spec.forcedStubCount;
    if (kind === 'stone') obj._disableRestick = true;
    thrownObjects.push(obj);
    updateBadge(kind, 1);
    if (kind === 'stone' && spec._tutorialTag === 'breaker') playTutorialStoneFallSound();
    return obj;
  }

  function tickTutorialSpawnQueue(dt) {
    if (!tutorialSpawnQueue.length) return;
    for (var i = tutorialSpawnQueue.length - 1; i >= 0; i--) {
      var spec = tutorialSpawnQueue[i];
      spec.delayFrames = Math.max(0, (spec.delayFrames || 0) - (dt || 1));
      if (spec.delayFrames > 0) continue;
      tutorialSpawnQueue.splice(i, 1);
      launchObjectSpec(spec);
    }
  }

  function resetTutorialState() {
    tutorialActive = false;
    tutorialSpawnQueue = [];
    _tutorialRepairDragDone = false;
    _tutorialRepairPending = false;
    _tutorialStubNotified = false;
    tutorialStoneImpact = null;
    tutorialTargets = cloneJson(TUTORIAL_TARGETS);
    hideTutorialFocusPrompt();
    hideTutorialBlackoutMessage();
    setSpiderMood('calm');
    setTutorialFlyVisibility(true);
    hideTutorialHint();
  }

  function startTutorial() {
    isGameplayTestMode = false;
    difficultyLevel = 1;
    resetTutorialState();
    wrappingTarget = null;
    repairQueue = [];
    target = null;
    autoChaseTarget = null;
    clearPriorityTarget();
    clearPoopDragState();
    silkCount = 0;
    refreshSilkHUD();
    totalSilkCount = 0;
    clearPoopStun();
    currentLevelIndex = 0;
    currentWaveIndex = 0;
    gameFrames = 0;
    levelScored = false;
    levelCollected = { boulder: 0, bug: 0, drop: 0 };
    inventoryCounts = { boulder: 0, bug: 0, drop: 0 };
    clearAllObjects();
    var phaseBarEl = document.getElementById('phase-bar');
    if (phaseBarEl) phaseBarEl.style.display = 'none';
    webOverride = createWebOverrideForLevel(0);
    buildWeb();
    buildSpider();
    tutorialActive = true;
    setTutorialFlyVisibility(false);
    tutorialController = createTutorialController(W, H, cx, cy);
    tutorialController.start();
    processTutorialActions();
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
    autoPlay = true;
    levelStartLockTimer = 0;
    _levelStartStonePending = false;
    P.bgTheme = 0;
    switchSylvanTheme(0);
    document.querySelectorAll('.bg-theme-dot').forEach(function (d, idx) {
      d.classList.toggle('active', idx === 0);
    });
    if (P.bgMusicOn) audioEngine.playLevelBGM(0);
    refreshLevelTargetHUD();
    refreshWavePhaseHUD();
  }

  function restartFromTutorial() {
    try { localStorage.removeItem('spiderTutorialCompleted'); } catch (e) { }
    startTutorial();
  }

  if (typeof window !== 'undefined') window.startTutorial = startTutorial;

  function completeTutorialAndStartLevelOne() {
    resetTutorialState();
    gameFrames = 0;
    webOverride = createWebOverrideForLevel(0);
    buildWeb();
    buildSpider();
    startLevel(0);
  }

  /* helper: get level/wave cfg with current difficulty */
  function getLevelCfgAt(n) {
    if (tutorialActive) {
      return { targets: cloneJson(tutorialTargets), waves: [] };
    }
    return getLevelCfg(n, difficultyLevel);
  }
  function getWaveCfgAt(levelIndex, waveIndex) { return getWaveCfg(levelIndex, waveIndex, difficultyLevel); }

  function refreshWavePhaseHUD() {
    var el = document.getElementById('phase-bar');
    if (!el) return;
    if (gameState !== 'LEVEL_ACTIVE') {
      el.style.display = 'none';
      return;
    }
    if (tutorialActive && tutorialController.isActive()) {
      el.style.display = 'block';
      el.textContent = 'TUTORIAL';
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

  /* ── show IDLE start screen (or auto-launch tutorial via ?tutorial=1) ── */
  if (_urlSearchParams.get('tutorial') === '1') {
    startTutorial();
  } else {
    showOverlay(
      '<div class="overlay-title">SPIDER WEB</div>'
      + '<div class="overlay-subtitle" style="margin-bottom:6px">Collect prey caught in the web</div>'
      + '<div class="overlay-subtitle" style="margin-bottom:22px;opacity:0.6">Keep the web intact. If it breaks, you lose.</div>'
      + '<button class="overlay-btn" id="btn-continue" style="margin-bottom:8px">继续</button>'
      + '<br><button class="overlay-btn" style="background:#555;margin-top:4px" id="btn-restart-start">重新开始</button>'
    );
    document.getElementById('btn-continue').onclick = continueGame;
    document.getElementById('btn-restart-start').onclick = restartFromTutorial;
  }

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

  function pickSelectableWrappedPreyAt(x, y) {
    var obj = _pickPreyAt(x, y, ['wrapped']);
    return (obj && isTutorialInsectKind(obj.kind)) ? obj : null;
  }

  function setSelectedWrappedPrey(obj) {
    selectedWrappedPrey = (obj && obj.state === 'wrapped' && isTutorialInsectKind(obj.kind)) ? obj : null;
  }

  function clearSelectedWrappedPrey(obj) {
    if (!obj || selectedWrappedPrey === obj) selectedWrappedPrey = null;
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
    fs.emergencyFrames = 0;
    if (_tryReanchorFoot(fs)) return;
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

    obj._disableRestick = true;
    if (obj.kind === 'drop' || obj.kind === 'poop') {
      obj.vx = currentVx;
      obj.vy = currentVy + detachKick;
    } else if (obj.kind === 'boulder' || obj.kind === 'bug') {
      var outwardX = p.pos.x - W * 0.5;
      var outwardY = p.pos.y - H * 0.5;
      var outwardLen = Math.sqrt(outwardX * outwardX + outwardY * outwardY) || 1;
      var outwardKick = obj.kind === 'bug' ? 3.4 : 4.0;
      obj.vx = (outwardX / outwardLen) * outwardKick + currentVx * 0.45;
      obj.vy = (outwardY / outwardLen) * outwardKick + currentVy * 0.45 + detachKick;
    }
    p.lastPos.x = p.pos.x - (obj.vx != null ? obj.vx : currentVx);
    p.lastPos.y = p.pos.y - (obj.vy != null ? obj.vy : (currentVy + detachKick));
    return true;
  }

  function spawnWrapSplashParticles(obj) {
    if (!obj || !obj.particle || !obj.def) return;
    var px = obj.particle.pos.x;
    var py = obj.particle.pos.y;
    var bodyR = obj.def.r * 0.9;
    var burstCount = 2 + (Math.random() < 0.35 ? 1 : 0);
    for (var bi = 0; bi < burstCount; bi++) {
      /* 身体区域内随机取点，每组同时四散 */
      var spawnAng = Math.random() * Math.PI * 2;
      var spawnDist = bodyR * Math.sqrt(Math.random());
      var sx = px + Math.cos(spawnAng) * spawnDist;
      var sy = py + Math.sin(spawnAng) * spawnDist;
      var scatterAng = Math.atan2(sy - py, sx - px) + (Math.random() - 0.5) * 1.5;
      var spd = 0.72 + Math.random() * 0.72;
      var vx = Math.cos(scatterAng) * spd + (Math.random() - 0.5) * 0.28;
      var vy = Math.sin(scatterAng) * spd * 0.58 - (0.52 + Math.random() * 0.48);
      _wrapSplashParticles.push({
        x: sx,
        y: sy,
        prevX: sx - vx * 0.55,
        prevY: sy - vy * 0.55,
        vx: vx,
        vy: vy,
        life: 0.82 + Math.random() * 0.16,
        decay: 0.015 + Math.random() * 0.007,
        len: 4.2 + Math.random() * 3.6,
        width: 1.35 + Math.random() * 0.7,
        grav: 0.02 + Math.random() * 0.018,
        drag: 0.978 + Math.random() * 0.008,
        color: '#ffffff'
      });
    }
  }

  function updateAndDrawWrapSplashParticles(ctx, dt) {
    if (_wrapSplashParticles.length === 0) return;
    for (var i = _wrapSplashParticles.length - 1; i >= 0; i--) {
      var p = _wrapSplashParticles[i];
      p.vy += p.grav * dt;
      var dragScale = Math.pow(p.drag, dt);
      p.vx *= dragScale;
      p.vy *= dragScale;
      var nx = p.x + p.vx * dt;
      var ny = p.y + p.vy * dt;
      p.life -= p.decay * dt;
      if (p.life <= 0) {
        _wrapSplashParticles.splice(i, 1);
        continue;
      }
      var tdx = nx - p.prevX;
      var tdy = ny - p.prevY;
      var tLen = Math.sqrt(tdx * tdx + tdy * tdy);
      var drawLen = p.len * (0.72 + p.life * 0.28);
      var ux = tLen > 0.001 ? tdx / tLen : 0;
      var uy = tLen > 0.001 ? tdy / tLen : 1;
      if (tLen < drawLen) {
        ux = p.vx;
        uy = p.vy;
        var vLen = Math.sqrt(ux * ux + uy * uy) || 1;
        ux /= vLen;
        uy /= vLen;
      }
      var alpha = Math.min(0.62, 0.22 + p.life * 0.34);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.width * (0.88 + p.life * 0.22);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(nx - ux * drawLen, ny - uy * drawLen);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      ctx.globalAlpha = alpha * 0.72;
      ctx.beginPath();
      ctx.arc(nx, ny, 1.55, 0, 2 * Math.PI);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.restore();
      p.prevX = nx;
      p.prevY = ny;
      p.x = nx;
      p.y = ny;
    }
  }

  function spawnPoopBurst(x, y) {
    _pushBurstParticle({
      x: x, y: y,
      vx: 0, vy: 0,
      life: 1.0,
      decay: 0.11,
      r: 9,
      grow: 0.42,
      drag: 1,
      speedScale: 1.5,
      flash: true,
      color: 'rgba(214,228,72,0.92)'
    });

    _burstParticles.push({
      x: x, y: y,
      vx: 0, vy: 0,
      life: 1.0,
      decay: 0.052,
      r: 7,
      grow: 3.1,
      drag: 1,
      speedScale: 1.5,
      ring: true,
      lineWidth: 3.2,
      color: 'rgba(176,196,58,0.78)'
    });
    _burstParticles.push({
      x: x, y: y,
      vx: 0, vy: 0,
      life: 1.0,
      decay: 0.068,
      r: 4,
      grow: 4.4,
      drag: 1,
      speedScale: 1.5,
      ring: true,
      lineWidth: 2.1,
      color: 'rgba(108,82,34,0.58)'
    });

    _burstParticles.push({
      x: x, y: y,
      vx: 0, vy: 0,
      life: 1.0,
      decay: 0.018,
      r: 14,
      grow: 0.18,
      drag: 0.904,
      speedScale: 1.5,
      smoke: true,
      occlude: 0.9,
      color: '#1a140f'
    });

    for (var i = 0; i < 40; i++) {
      var ang = (i / 40) * Math.PI * 2 + Math.random() * 0.7;
      var spd = 2.4 + Math.random() * 4.0;
      _pushBurstParticle({
        x: x, y: y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd * 0.82,
        life: 1.0,
        decay: 0.022 + Math.random() * 0.014,
        r: 7.2 + Math.random() * 8.4,
        grow: 0.098 + Math.random() * 0.072,
        drag: 0.848 + Math.random() * 0.034,
        speedScale: 1.5,
        smoke: true,
        occlude: 0.76 + Math.random() * 0.1,
        color: ['#17120e', '#2a2218', '#3a3124', '#4d4328', '#5c5530', '#6a5f2e'][Math.floor(Math.random() * 6)]
      });
    }

    for (var j = 0; j < 14; j++) {
      var ang2 = (j / 14) * Math.PI * 2 + Math.random() * 0.45;
      var spd2 = 5.2 + Math.random() * 3.4;
      _pushBurstParticle({
        x: x, y: y,
        vx: Math.cos(ang2) * spd2,
        vy: Math.sin(ang2) * spd2 * 0.76,
        life: 1.0,
        decay: 0.038 + Math.random() * 0.018,
        r: 4.4 + Math.random() * 3.6,
        grow: 0.058 + Math.random() * 0.042,
        drag: 0.804 + Math.random() * 0.038,
        speedScale: 1.5,
        smoke: true,
        occlude: 0.84,
        color: '#241a14'
      });
    }

    for (var c = 0; c < 10; c++) {
      var ang3 = Math.random() * Math.PI * 2;
      var spd3 = 5.6 + Math.random() * 4.8;
      _burstParticles.push({
        x: x, y: y,
        vx: Math.cos(ang3) * spd3,
        vy: Math.sin(ang3) * spd3 * 0.68,
        life: 1.0,
        decay: 0.048 + Math.random() * 0.028,
        r: 1.8 + Math.random() * 2.8,
        drag: 0.872 + Math.random() * 0.04,
        speedScale: 1.5,
        smoke: false,
        color: ['#4a3520', '#6b4e28', '#3d2a18', '#7a5a2c'][Math.floor(Math.random() * 4)]
      });
    }
  }

  function handlePoopCapture(obj) {
    var idx = thrownObjects.indexOf(obj);
    if (idx === -1) return;
    clearObjectConstraints(obj);
    obj.stuckOnConstraint = null;
    spawnPoopBurst(obj.particle.pos.x, obj.particle.pos.y);
    audioEngine.playSfxPoopBurst();
    if (userPriorityTarget && userPriorityTarget.type === 'object' && userPriorityTarget.obj === obj) {
      clearPriorityTarget();
    }
    if (autoChaseTarget === obj) autoChaseTarget = null;
    obj.destroy(sim);
    thrownObjects.splice(idx, 1);
    updateBadge(obj.kind, -1);
    target = null;
    poopStunTimer = POOP_STUN_FRAMES;
    setSpiderMood('shock');
    pauseAndClearCurrentTarget();
  }

  function _tryReanchorFoot(fs) {
    if (!fs || !spider || !spiderweb) return false;
    var pt = findWrappedReanchorPoint(fs.current.x, fs.current.y, null, spiderweb, _spatialOpts());
    if (!pt) return false;
    liftFoot(fs, spider);
    fs.current.x = pt.x;
    fs.current.y = pt.y;
    fs.particle.pos.mutableSet(fs.current);
    fs.particle.lastPos.mutableSet(fs.current);
    fs.targetStepPoint = {
      type: 'segment', pa: pt.c.a, pb: pt.c.b, t: pt.t, x: pt.x, y: pt.y
    };
    landFoot(fs, spider, spiderweb, footState);
    return !!(fs.landedNode || fs.landedSeg);
  }

  function _countSupportedFeet() {
    var n = 0;
    for (var fi = 0; fi < footState.length; fi++) {
      var fs = footState[fi];
      if (fs && (fs.stepping || fs.landedNode || fs.landedSeg)) n++;
    }
    return n;
  }

  function _getFootSearchTier() {
    var tier = 0;
    if (_locomotion.noStepFrames > 30) tier = 1;
    if (_locomotion.noStepFrames > 60 || _locomotion.stallFrames > 50) tier = 2;
    if (_locomotion.noStepFrames > 90) tier = 3;
    for (var fi = 0; fi < footState.length; fi++) {
      if (footState[fi] && footState[fi].needsEmergencyStep) tier = Math.max(tier, 2);
    }
    return tier;
  }

  function _refreshNavSteerIfStalled(goalX, goalY) {
    if (_locomotion.stallFrames <= 18 && _locomotion.noStepFrames <= 20) return;
    var tx = spider.thorax.pos;
    _navSteerPath = findNavPath(
      tx.x, tx.y, goalX, goalY, spiderweb, _spatialOpts()
    );
  }

  var PRIORITY_NAV_GIVEUP_STALL = 100;
  var PRIORITY_NAV_GIVEUP_NOSTEP = 90;

  function _shouldAbandonPriorityNav() {
    if (!userPriorityTarget || !spider || !spiderweb) return false;
    if (_locomotion.noStepFrames >= PRIORITY_NAV_GIVEUP_NOSTEP) return true;
    if (_locomotion.stallFrames >= PRIORITY_NAV_GIVEUP_STALL) return true;
    var tx = spider.thorax.pos;
    var spatialOpts = _spatialOpts();
    if (userPriorityTarget.type === 'point') {
      var pt = userPriorityTarget.point;
      if (!isNavReachable(tx.x, tx.y, pt.x, pt.y, spiderweb, spatialOpts)) return true;
    } else if (userPriorityTarget.type === 'object') {
      var obj = getActivePriorityObject();
      if (!obj) return true;
      var op = obj.particle.pos;
      if (!isNavReachable(tx.x, tx.y, op.x, op.y, spiderweb, spatialOpts)) return true;
    }
    return false;
  }

  function _abandonPriorityNavIfStuck() {
    if (!_shouldAbandonPriorityNav()) return;
    clearPriorityTarget();
    pauseAndClearCurrentTarget();
  }

  /**
   * 躯干移动方向：默认直线朝最终目标。
   * 仅当脚长时间迈不出去时，才用路网路径做轻微转向提示（头仍朝目标，不逐点折线寻路）。
   */
  function _resolveBodyMoveDir(tx, ty, goalX, goalY, baseDirX, baseDirY) {
    if (!_navSteerPath || _navSteerPath.length < 2) {
      return { x: baseDirX, y: baseDirY };
    }
    var stall = _locomotion.stallFrames;
    var noStep = _locomotion.noStepFrames;
    if (stall < 25 && noStep < 30) {
      return { x: baseDirX, y: baseDirY };
    }

    var hintPt = getNavSteerHint(tx, ty, goalX, goalY, _navSteerPath);
    if (!hintPt) return { x: baseDirX, y: baseDirY };

    var hdx = hintPt.x - tx, hdy = hintPt.y - ty;
    var hl = Math.sqrt(hdx * hdx + hdy * hdy) || 1;
    hdx /= hl; hdy /= hl;

    var blend = 0.22;
    if (stall >= 25) blend = 0.30;
    if (stall >= 40 || noStep >= 45) blend = 0.38;
    if (stall >= 55 || noStep >= 70) blend = 0.48;

    var mx = baseDirX * (1 - blend) + hdx * blend;
    var my = baseDirY * (1 - blend) + hdy * blend;
    var ml = Math.sqrt(mx * mx + my * my) || 1;
    return { x: mx / ml, y: my / ml };
  }

  function setPriorityTarget(x, y) {
    if (isTutorialSpiderLocked() || !spider) return;
    var wrappedPrey = pickSelectableWrappedPreyAt(x, y);
    if (wrappedPrey) {
      setSelectedWrappedPrey(wrappedPrey);
      userPriorityTarget = null;
      _navSteerPath = null;
      return;
    }
    clearSelectedWrappedPrey();
    var fromX = spider.thorax.pos.x, fromY = spider.thorax.pos.y;
    var spatialOpts = _spatialOpts();
    var picked = pickObjectAt(x, y);
    if (picked) {
      if (!isNavReachable(
        fromX, fromY, picked.particle.pos.x, picked.particle.pos.y, spiderweb, spatialOpts
      )) return;
      var objNav = resolveNavigation(
        fromX, fromY, picked.particle.pos.x, picked.particle.pos.y, spiderweb, spatialOpts
      );
      if (!objNav) return;
      userPriorityTarget = { type: 'object', obj: picked };
      _navSteerPath = objNav.path;
      _locomotion.noStepFrames = 0;
      _locomotion.stallFrames = 0;
      return;
    }
    if (!spiderweb || !cellCovered(x, y, spiderweb, webGridCoverD)) return;
    if (!isNavReachable(fromX, fromY, x, y, spiderweb, spatialOpts)) return;
    var path = findNavPath(fromX, fromY, x, y, spiderweb, spatialOpts);
    if (!path || !path.length) return;
    var snap = findNearestNavPoint(x, y, spiderweb, spatialOpts);
    userPriorityTarget = {
      type: 'point',
      point: new Vec2(snap ? snap.x : x, snap ? snap.y : y)
    };
    _navSteerPath = path;
    _locomotion.noStepFrames = 0;
    _locomotion.stallFrames = 0;
  }

  function setPriorityTargetFromClient(clientX, clientY) {
    var r = canvas.getBoundingClientRect();
    setPriorityTarget((clientX - r.left) * (W / r.width), (clientY - r.top) * (H / r.height));
  }

  function clearPriorityTarget() {
    userPriorityTarget = null;
    _navSteerPath = null;
    selectedWrappedPrey = null;
  }

  function isTargetObjectChaseable(obj) {
    if (isTutorialActive() && (obj.kind === 'poop' || obj.kind === 'stone')) return false;
    return !!(
      obj
      && thrownObjects.indexOf(obj) !== -1
      && obj.state === 'stuck'
      && !obj.playerDragging
    );
  }

  function pauseAndClearCurrentTarget() {
    target = null;
    idleTarget = null;
    autoChaseTarget = null;
    _navSteerPath = null;
    _locomotion.noStepFrames = 0;
    _locomotion.stallFrames = 0;
    _autoPlayPause = 30; /* 0.5秒停顿 */
  }

  function getActivePriorityObject() {
    if (!userPriorityTarget || userPriorityTarget.type !== 'object') return null;
    var obj = userPriorityTarget.obj;
    return isTargetObjectChaseable(obj) ? obj : null;
  }

  function _shouldBlockPriorityClick() {
    return _suppressPriorityClick
      || (_suppressMoveCommand && _pointerMoved)
      || (sim.suppressClick && _pointerMoved);
  }

  /* click to move (desktop) */
  canvas.addEventListener('click', function (e) {
    e.stopPropagation();
    if (_shouldBlockPriorityClick()) {
      _suppressPriorityClick = false;
      sim.suppressClick = false;
      _suppressMoveCommand = false;
      _pointerMoved = false;
      return;
    }
    _pointerMoved = false;
    setPriorityTargetFromClient(e.clientX, e.clientY);
  });
  /* screen-shell 兜底：点击网外空白区域也能设置点目标 */
  screenShellEl.addEventListener('click', function (e) {
    if (e.target === canvas) return;
    if (e.target.closest('#inventory-bar') || e.target.closest('#dbg-web') || e.target.closest('#game-overlay')) return;
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
      var ddx = t.clientX - _touchStartX;
      var ddy = t.clientY - _touchStartY;
      var isTap = !_pointerMoved && Math.sqrt(ddx * ddx + ddy * ddy) < TAP_MOVE_THRESHOLD;
      _touchWasSwipe = !isTap;
      if (!_shouldBlockPriorityClick() && isTap) {
        setPriorityTargetFromClient(t.clientX, t.clientY);
      }
      _suppressPriorityClick = false;
      sim.suppressClick = false;
      _suppressMoveCommand = false;
      _pointerMoved = false;
    }
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
    resetTutorialState();
    wrappingTarget = null;
    repairQueue = [];
    repairCompleteFlashes = [];
    target = null;
    autoChaseTarget = null;
    clearPriorityTarget();
    _endWrappedPickup();
    silkCount = 0;
    refreshSilkHUD();
    totalSilkCount = 0;
    clearPoopStun();
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

  function continueGame() {
    isGameplayTestMode = false;
    gameFrames = 0;
    silkCount = 0;
    refreshSilkHUD();
    clearPoopStun();
    webOverride = createWebOverrideForLevel(currentLevelIndex);
    buildWeb();
    buildSpider();
    startLevel(currentLevelIndex);
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
    if (!tutorialActive) resetTutorialState();
    wrappingTarget = null;
    repairQueue = [];
    repairCompleteFlashes = [];
    target = null;
    idleTarget = null;
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
    clearPoopStun();
    levelCollected = { boulder: 0, bug: 0, drop: 0 };
    inventoryCounts = { boulder: 0, bug: 0, drop: 0 };
    clearAllObjects();
    var cfg = getLevelCfgAt(n);
    ['boulder', 'bug'].forEach(function (k) {
      var el = document.getElementById('inv-' + k + '-count');
      if (el) el.textContent = '0/' + cfg.targets[k];
    });
    gameState = 'LEVEL_ACTIVE';
    spiderAI.reset(spiderweb);
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

    /* ── 每关开始：2秒蜘蛛冻结 + 1秒后掉中型石头破网 ── */
    levelStartLockTimer = LEVEL_START_LOCK_FRAMES;
    _levelStartStoneTimer = LEVEL_START_STONE_DELAY;
    _levelStartStonePending = true;

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
    doLevelTransition(function () {
      gameFrames = 0;
      webOverride = createWebOverrideForLevel(currentLevelIndex + 1);
      buildWeb(); buildSpider();
      startLevel(currentLevelIndex + 1);
    });
  }

  function retryCurrentLevel() {
    gameFrames = 0;
    silkCount = 0;
    refreshSilkHUD();
    clearPoopStun();
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
      + '<button class="overlay-btn" id="btn-retry" style="margin-bottom:8px">继续</button>'
      + '<br><button class="overlay-btn" style="background:#555;margin-top:4px" id="btn-restart-f">重新开始</button>'
    );
    document.getElementById('btn-retry').onclick = retryCurrentLevel;
    document.getElementById('btn-restart-f').onclick = restartFromTutorial;
  }

  function checkLevelComplete() {
    if (tutorialActive) return;
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

  function _isWebIntegrityBaselineReady() {
    return webWarmupFrames <= 0
      && webGridList
      && webGridBuildIdx >= webGridList.length
      && webInitCells > 0;
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
    invalidateNavCache();
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

  var _webScanIsRepair = false; /* 当前扫描是否由修复触发 */
  function _applyWebCover(covered) {
    if (!webInitCells) return;
    var loss = 1 - covered / webInitCells;
    if (loss < 0) loss = 0;
    var pct = Math.round(loss * 100);
    if (_webScanIsRepair && pct > webLossPct) {
      /* 修复触发的扫描：不允许损失增大（物理收缩导致的覆盖减少不计入） */
      pct = webLossPct;
    }
    webLossPct = pct;
    _webScanIsRepair = false;
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
    notifyTutorialStubIfNeeded();
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

    /* 建邻接表（排除已死边和 stubAnchor） */
    var adj = {};
    for (var i = 0; i < spiderweb.constraints.length; i++) {
      var c = spiderweb.constraints[i];
      if (!(c instanceof DistanceConstraint)) continue;
      if (c.__isStubAnchor) continue;
      if (!_constraintAlive(c)) continue;
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

  function addRepairEdge(a, b, spiderweb, animated) {
    var d = a.pos.dist(b.pos) * REPAIR_TENSOR;
    var edge = new DistanceConstraint(a, b, 0.6, d);
    if (animated) {
      edge.__isRepairEdge = true;
      edge.__growT = 0;       /* 0→1 grow progress */
      edge.__growDur = 12;    /* ~0.2s at 60fps */
      edge.__flashT = 0;     /* 0→1 flash progress (bright→normal) */
      edge.__flashDur = 66;  /* ~1.1s at 60fps */
    }
    spiderweb.constraints.push(edge);
    /* 注册到 spatialIndex，让碰撞检测能发现修复边 */
    if (!USE_LEGACY_COLLISION) assignWebConstraintIds(spiderweb);
    return edge;
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
      addRepairEdge(mp1, ringA, spiderweb, true);
      addRepairEdge(mp1, ringB, spiderweb, true);
      addRepairEdge(mp1, midNode, spiderweb, true);
    } else if (patchCount === 2) {
      /* 补2个点 P Q */
      var P = newParticles[0], Q = newParticles[1];
      var idxOneThird = Math.max(1, Math.floor(len / 3));
      var idxTwoThird = Math.min(len - 2, Math.floor(len * 2 / 3));
      var nodeNearA = ring[idxOneThird];
      var nodeNearB = ring[idxTwoThird];
      /* P 连 A、Q、路径1/3处 */
      addRepairEdge(P, ringA, spiderweb, true);
      addRepairEdge(P, Q, spiderweb, true);
      addRepairEdge(P, nodeNearA, spiderweb, true);
      /* Q 连 B、路径2/3处（P—Q 已建） */
      addRepairEdge(Q, ringB, spiderweb, true);
      addRepairEdge(Q, nodeNearB, spiderweb, true);
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
      addRepairEdge(P3, ringA, spiderweb, true);
      addRepairEdge(P3, Q3, spiderweb, true);
      addRepairEdge(P3, nodeQuarterA, spiderweb, true);
      /* Q 连 R、路径中间点（P—Q 已建） */
      addRepairEdge(Q3, R3, spiderweb, true);
      addRepairEdge(Q3, nodeMid3, spiderweb, true);
      /* R 连 B、路径3/4处（Q—R 已建） */
      addRepairEdge(R3, ringB, spiderweb, true);
      addRepairEdge(R3, nodeQuarterB, spiderweb, true);
    }
  }

  /**
   * 在连接点喷出丝线粒子，方向朝对端散开
   */
  function _ringAreaCentroid(ring) {
    var cx = 0;
    var cy = 0;
    for (var i = 0; i < ring.length; i++) {
      cx += ring[i].pos.x;
      cy += ring[i].pos.y;
    }
    return { x: cx / ring.length, y: cy / ring.length };
  }

  function _ringAreaPoint(ring, seed) {
    var len = ring.length;
    var i = seed % len;
    var j = (i + 1) % len;
    var edgeT = 0.12 + ((seed * 0.37) % 0.76);
    var inward = 0.05 + ((seed * 0.23) % 0.9);
    var ax = ring[i].pos.x;
    var ay = ring[i].pos.y;
    var bx = ring[j].pos.x;
    var by = ring[j].pos.y;
    var ex = ax + (bx - ax) * edgeT;
    var ey = ay + (by - ay) * edgeT;
    var cen = _ringAreaCentroid(ring);
    return {
      x: ex + (cen.x - ex) * inward,
      y: ey + (cen.y - ey) * inward
    };
  }

  function _pushSparkleParticle(x, y, vx, vy) {
    _pushBurstParticle({
      x: x,
      y: y,
      vx: vx,
      vy: vy,
      life: 1.0,
      decay: 0.028 + Math.random() * 0.018,
      r: 1.0 + Math.random() * 1.6,
      drag: 0.96,
      speedScale: 1,
      smoke: false,
      sparkle: true,
      phase: Math.random() * Math.PI * 2,
      color: ['#ffffff', '#e8f8ff', '#cceeff'][Math.floor(Math.random() * 3)]
    });
  }

  function _spawnRepairCompleteFX(x, y, ring) {
    playFloatingText(x, y, collectLayer, '补网！', 'repair');
    if (!ring || ring.length < 2) return;

    for (var i = 0; i < 16; i++) {
      var pt = _ringAreaPoint(ring, i * 4 + 1);
      _pushSparkleParticle(
        pt.x + (Math.random() - 0.5) * 5,
        pt.y + (Math.random() - 0.5) * 5,
        (Math.random() - 0.5) * 0.55,
        (Math.random() - 0.5) * 0.55 - 0.12
      );
    }
  }

  function _spawnRepairSilk(x, y, toX, toY) {
    var dx = toX - x, dy = toY - y;
    var baseAng = Math.atan2(dy, dx);
    /* 中心闪光 */
    _pushBurstParticle({
      x: x, y: y,
      vx: 0, vy: 0,
      life: 1.0,
      decay: 0.04,
      r: 6,
      grow: 0.3,
      drag: 1,
      speedScale: 1,
      smoke: true,
      occlude: 0.6,
      color: '#ddeeff'
    });
    /* 散射丝线粒子 */
    for (var i = 0; i < 10; i++) {
      var ang = baseAng + (Math.random() - 0.5) * 2.2;
      var spd = 2.0 + Math.random() * 3.0;
      _pushBurstParticle({
        x: x + (Math.random() - 0.5) * 4,
        y: y + (Math.random() - 0.5) * 4,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life: 1.0,
        decay: 0.035 + Math.random() * 0.02,
        r: 2.0 + Math.random() * 2.0,
        drag: 0.92,
        speedScale: 1,
        smoke: false,
        color: '#e8e8f0'
      });
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
      audioEngine.playSfxRepairConnect();
      if (P.repairPatch) {
        /* 先 BFS 找最小环（在建新边之前，否则 BFS 会直接走新边） */
        var path = bfsPath(anchorPt, snapTarget, spiderweb);

        /* 建 A—B 主线（带生长动画） */
        addRepairEdge(anchorPt, snapTarget, spiderweb, true);

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
          /* 补点数决定修复时长：1/2/3个点 → 1/2/3秒（60/120/180帧） */
          var _pc = path.length <= 6 ? 1 : path.length <= 9 ? 2 : 3;
          var _dur = _pc * 60;
          repairQueue.push({
            ring: path,
            pos: new Vec2(rcx, rcy),
            state: 'pending',
            timer: _dur,
            duration: _dur
          });
        }
      } else {
        /* 只修一根（带生长动画） */
        addRepairEdge(anchorPt, snapTarget, spiderweb, true);
      }
      /* 修复粒子效果：两个连接点各喷丝线粒子 */
      _spawnRepairSilk(anchorPt.pos.x, anchorPt.pos.y, snapTarget.pos.x, snapTarget.pos.y);
      _spawnRepairSilk(snapTarget.pos.x, snapTarget.pos.y, anchorPt.pos.x, anchorPt.pos.y);
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
    _webScanIsRepair = true;
    if (isTutorialActive()) {
      _tutorialRepairDragDone = true;
      _tutorialRepairPending = true;
      tutorialController.handleEvent('repair_drag_completed');
      processTutorialActions();
    }
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
  sim.onDragStart = function (entity) {
    if (!isTutorialActive() || !entity || !entity.__isStub) return;
    tutorialController.handleEvent('repair_drag_started');
    processTutorialActions();
  };

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
    if (webLossPct >= 50 && !tutorialActive) showGameOver();
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
    if (gameState !== 'LEVEL_ACTIVE' || tutorialActive) return;
    if (!debugSpawnEnabled) return;
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
    objCounts[kind] = Math.max(0, (objCounts[kind] || 0) + delta);
    var badgeEl = document.getElementById('cnt-' + kind);
    if (badgeEl) badgeEl.textContent = objCounts[kind];
  }

  function debugBugBreakWeb() {
    if (!spiderweb) return;
    if (!USE_LEGACY_COLLISION) rebuildSpatialIndex();
    var seg = findNearestWebSegment(webCx, webCy, spiderweb, _spatialOpts(), null);
    if (!seg) return;
    if (!breakWebSegmentAsBug(seg, spiderweb, webBreakFlashes, _breakFrame, _onWebSegmentBroken, _spatialOpts())) return;
    spiderweb._topologyVersion = (spiderweb._topologyVersion || 0) + 1;
    if (_webDrawApi) {
      for (var i = 0; i < webBreakFlashes.length; i++) {
        if (!webBreakFlashes[i].affectedCI) _webDrawApi.annotateFlash(webBreakFlashes[i]);
      }
    }
    _refreshBrokenEnds();
    webScanPending = 12;
  }

  /**
   * 每关开始的开场破网石头。
   * 大小参考教程中型石头（TUTORIAL_STONE_RADIUS * 0.5 * 1.3 ≈ 41px）。
   * 落点在网内圈随机15%扇区（径向 0.20~0.40 * webRad），偏上半，不砸中心。
   */
  function launchLevelStartStone() {
    if (!spiderweb || !webRad) return;

    var STONE_R = 41; /* 与教程中型石头等大 */
    var BREAK_R = STONE_R * 1.18; /* 破网半径，与教程 breakScale 对应 */

    /* 随机选取内圈15%扇区的落点：
       - 角度：上半圆随机（-135° ~ -45°，即正上方±45°以外到左右两侧），
                但总体均匀，再乘15%随机偏移
       - 径向：0.20 ~ 0.40 * webRad，避开中心也避开外圈 */
    var angleBase = Math.PI * (0.15 + Math.random() * 0.70); /* 0.15π~0.85π → 偏上半 */
    if (Math.random() < 0.5) angleBase = -angleBase;         /* 左右对称随机 */
    var radialFrac = 0.20 + Math.random() * 0.20;            /* 0.20~0.40 倍半径 */
    var impactX = webCx + Math.cos(angleBase) * webRad * radialFrac;
    var impactY = webCy + Math.sin(angleBase) * webRad * radialFrac;

    /* 石头从屏幕上方对应X轴位置落下 */
    var obj = new ThrownObj('stone', W, H, sim, P, gameState, getWaveCfgAt, currentLevelIndex, currentWaveIndex);
    obj._W = W; obj._H = H;
    obj.def.r = STONE_R;
    obj.particle.pos.x = impactX;
    obj.particle.pos.y = -STONE_R * 0.45;
    obj.particle.lastPos.x = impactX;
    obj.particle.lastPos.y = -STONE_R * 0.45 - 6.0;
    obj.spawnVx = 0;
    obj.spawnVy = 6.0;
    obj._holePunched = false;
    obj._levelStartBreaker = true;
    obj._levelStartBreakR = BREAK_R;
    obj._levelStartImpactX = impactX;
    obj._levelStartImpactY = impactY;
    obj._disableRestick = true;
    thrownObjects.push(obj);
    updateBadge('stone', 1);
    audioEngine.playSfxStoneFall();
  }

  function directWebBreakAt(x, y, breakR, forcedStubCount) {
    if (!spiderweb || !(breakR > 0)) return 0;
    if (!USE_LEGACY_COLLISION) rebuildSpatialIndex();
    var breakFlashes = tutorialActive ? [] : webBreakFlashes;
    var broke = breakWebInRadius(
      x, y, breakR,
      spiderweb, breakFlashes, _breakFrame, _onWebSegmentBroken, _spatialOpts(), true,
      forcedStubCount != null ? forcedStubCount : (tutorialActive ? 1 : undefined)
    );
    if (broke === 0 && tutorialActive) {
      broke = breakWebInRadius(
        x, y, breakR * 1.45,
        spiderweb, breakFlashes, _breakFrame, _onWebSegmentBroken, _spatialOpts(), false,
        forcedStubCount != null ? forcedStubCount : 1
      );
    }
    if (broke > 0) {
      if (tutorialActive) playTutorialWebBreakSound();
      if (tutorialActive) {
        applyWebImpactKick(spiderweb.particles, x, y, breakR * 1.18, Math.max(2.4, breakR * 0.08));
      }
      spiderweb._topologyVersion = (spiderweb._topologyVersion || 0) + 1;
      webScanPending = Math.max(webScanPending, 12);
      _webScanIsRepair = false;
      if (_webDrawApi && !tutorialActive) {
        for (var fi = 0; fi < webBreakFlashes.length; fi++) {
          if (!webBreakFlashes[fi].affectedCI) _webDrawApi.annotateFlash(webBreakFlashes[fi]);
        }
      }
      _refreshBrokenEnds();
      notifyTutorialStubIfNeeded();
    }
    return broke;
  }

  function beginTutorialStoneImpact(obj, x, y, stoneR) {
    tutorialStoneImpact = createTutorialStoneImpact(x, y, stoneR);
    tutorialStoneImpact.stoneObj = obj;
    tutorialStoneImpact.breakScale = obj._tutorialBreakScale || 1.18;
    tutorialStoneImpact.forcedStubCount = obj._tutorialForcedStubCount;
    obj._tutorialPullTension = 0.01;
  }

  function updateTutorialStoneImpactFollow(dt) {
    if (!tutorialStoneImpact || tutorialStoneImpact.phase !== 'pull') return;
    var stone = tutorialStoneImpact.stoneObj;
    if (!stone || !stone.particle) return;
    tutorialStoneImpact.x = tutorialStoneImpact.anchorX;
    tutorialStoneImpact.y = tutorialStoneImpact.anchorY;
    var progress = tutorialStoneImpact.timer / TUTORIAL_STONE_PULL_FRAMES;
    stone._tutorialPullTension = Math.min(1, 0.15 + progress * 0.95);
    applyWebPullTowardPoint(
      spiderweb.particles,
      tutorialStoneImpact.x,
      tutorialStoneImpact.y,
      tutorialStoneImpact.r * (tutorialStoneImpact.breakScale || 1.18),
      progress,
      dt || 1
    );
    var tick = tickTutorialStoneImpact(tutorialStoneImpact, dt || 1);
    tutorialStoneImpact = tick.impact;
    if (tick.shouldBreak) {
      directWebBreakAt(
        tutorialStoneImpact.x,
        tutorialStoneImpact.y,
        tutorialStoneImpact.r * (tutorialStoneImpact.breakScale || 1.18),
        tutorialStoneImpact.forcedStubCount
      );
      if (stone) {
        stone._holePunched = true;
        stone._tutorialPullTension = 0;
        stone.state = 'falling2';
        stone.alpha = 1;
        stone.grav = Math.max(stone.grav || 0, 5.6);
        stone.spawnVx = 0;
        stone.spawnVy = 14.5;
        stone.particle.lastPos.x = stone.particle.pos.x;
        stone.particle.lastPos.y = stone.particle.pos.y - stone.spawnVy;
      }
      tutorialStoneImpact = null;
    }
  }

  /**
   * 教学关：石头进入网区后先拉扯网线，再在石头半径内真实破网。
   */
  function tryBeginTutorialStoneImpact(obj, prevX, prevY, nextX, nextY) {
    if (!tutorialActive || !obj || obj.kind !== 'stone' || obj._tutorialTag !== 'breaker') return;
    if (obj.state !== 'falling' || obj._holePunched || (tutorialStoneImpact && tutorialStoneImpact.phase !== 'done') || !spiderweb) return;
    var stoneR = obj.def && obj.def.r > 0 ? obj.def.r : 80;
    var reachedWebBand = nextY >= (webCy - webRad * 0.06);
    var withinWebWidth = Math.abs(nextX - webCx) <= (webRad * 0.78 + stoneR * 0.2);
    if (!(reachedWebBand && withinWebWidth)) return;
    var impactPoint = resolveTutorialStoneImpactPoint((prevX + nextX) * 0.5, (prevY + nextY) * 0.5, webCx, webCy, webRad);
    beginTutorialStoneImpact(obj, impactPoint.x, impactPoint.y, stoneR);
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
      if (isTutorialActive() && kind === 'boulder') {
        tutorialController.handleEvent('object_collected', { kind: kind });
        processTutorialActions();
      }
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
    clearSelectedWrappedPrey(obj);
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
  }

  function beginCollectObject(obj) {
    if (obj._manualPullOff) {
      obj.state = obj.kind === 'drop' ? 'falling' : 'falling2';
      return false;
    }
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
    return true;
  }

  function beginWrapping(obj) {
    if (obj.kind === 'poop') {
      handlePoopCapture(obj);
      return;
    }
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
    _wrapSplashTimer = 0;
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
    var scatterAngle = Math.atan2(_by - spider.thorax.pos.y, _bx - spider.thorax.pos.x);
    spawnLeafShards(_bx, _by, obj.def.r, obj.angle + (obj._wrapAngle || 0), scatterAngle);
    clearSelectedWrappedPrey(obj);
    obj.destroy(sim);
    var idx = thrownObjects.indexOf(obj);
    if (idx !== -1) thrownObjects.splice(idx, 1);
    updateBadge(obj.kind, -1);
    if (isTutorialActive() && obj._tutorialTag === 'prey') {
      tutorialController.handleEvent('object_resolved', { kind: obj.kind });
      processTutorialActions();
    }
  }

  function tryCollectObjects() {
    if (wrappingTarget !== null || poopStunTimer > 0 || isTutorialSpiderLocked()) return;
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
      if (isTutorialActive() && (obj.kind === 'poop' || obj.kind === 'stone')) continue;
      if (obj.playerDragging) continue;
      if (obj.state !== 'stuck') continue;
      var p = obj.particle.pos;
      if (!circlesOverlap(thorax.x, thorax.y, 11, p.x, p.y, obj.def.collectRadius)
        && !circlesOverlap(abdomen.x, abdomen.y, 19, p.x, p.y, obj.def.collectRadius)) continue;
      if (obj.state === 'stuck') {
        if (obj.kind === 'poop') {
          handlePoopCapture(obj);
        } else {
          beginWrapping(obj);
        }
        return;
      }
    }
  }

  /* ── Stick system helper closures ── */
  function _isThrownObjectOffScreen(x, y, kind) {
    if (kind === 'stone') return y > H + 520 || x < -220 || x > W + 220;
    if (kind === 'poop') return y > H + 400 || y < -200 || x < -200 || x > W + 200;
    return y > H + 400 || y < -200 || x < -200 || x > W + 200;
  }

  function _removeThrownObjectAt(oi, obj) {
    clearSelectedWrappedPrey(obj);
    if (obj.kind === 'bug') audioEngine.stopBugBuzz(oi);
    obj.destroy(sim);
    thrownObjects.splice(oi, 1);
    updateBadge(obj.kind, -1);
  }

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
        if (obj.kind === 'boulder' || obj.kind === 'poop' || obj.kind === 'stone') {
          var stonePrevX = p.pos.x;
          var stonePrevY = p.pos.y;
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
          if (obj.kind === 'stone' && !obj._holePunched && obj._tutorialTag === 'breaker' && tutorialActive) {
            tryBeginTutorialStoneImpact(obj, stonePrevX, stonePrevY, p.pos.x, p.pos.y);
          }
          /* ── 每关开场石头：到达冲击Y位置时立即破网 ── */
          if (obj.kind === 'stone' && !obj._holePunched && obj._levelStartBreaker) {
            if (p.pos.y >= obj._levelStartImpactY) {
              obj._holePunched = true;
              directWebBreakAt(obj._levelStartImpactX, obj._levelStartImpactY, obj._levelStartBreakR, 2);
              applyWebImpactKick(spiderweb.particles, obj._levelStartImpactX, obj._levelStartImpactY, obj._levelStartBreakR * 1.3, Math.max(2.4, obj._levelStartBreakR * 0.08));
              audioEngine.playSfxWebBreak();
              obj.state = 'falling2';
              obj.grav = Math.max(obj.grav || 0, 5.6);
              obj.spawnVx = 0;
              obj.spawnVy = 14.5;
              obj.particle.lastPos.x = p.pos.x;
              obj.particle.lastPos.y = p.pos.y - obj.spawnVy;
            }
          }
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
          /* 俯仰角：用 vy 分量限制在 ±15°，向上飞为负，向下飞为正 */
          var MAX_TILT = 15 * Math.PI / 180;
          var _spd = Math.sqrt(_bxs * _bxs + _bys * _bys) || 1;
          var _tiltRaw = Math.asin(Math.max(-1, Math.min(1, _bys / _spd)));
          obj._tiltAngle = Math.max(-MAX_TILT, Math.min(MAX_TILT, _tiltRaw));
          /* 向右飞(bxs>0)时镜像，让头始终朝向飞行方向 */
          if (Math.abs(_bxs) > 0.01) obj._flyMirror = _bxs > 0;
          obj.wingT += 0.55 * _currentTimeScale;
          if (!obj._buzzStarted) { obj._buzzStarted = true; audioEngine.startBugBuzz(oi); }

          /* 环绕穿越：飞出一侧从对面出现，轨迹不被阻挡 */
          var _wrap = 100;
          if (p.pos.x < -_wrap)   { p.pos.x += W + _wrap * 2; p.lastPos.x = p.pos.x - bx; }
          if (p.pos.x > W + _wrap) { p.pos.x -= W + _wrap * 2; p.lastPos.x = p.pos.x - bx; }
          if (p.pos.y < -_wrap)   { p.pos.y += H + _wrap * 2; p.lastPos.y = p.pos.y - by; }
          if (p.pos.y > H + _wrap) { p.pos.y -= H + _wrap * 2; p.lastPos.y = p.pos.y - by; }
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
          /* 接近底边时解除边界约束，让树叶能继续下落到离屏销毁 */
          if (p.pos.y >= H - 2) p.__ignoreBounds = true;
          if (p.pos.y > H + 400) { obj.destroy(sim); thrownObjects.splice(oi, 1); updateBadge(obj.kind, -1); continue; }
        }

        /* ── falling 状态离屏销毁（苍蝇穿越边界不在此处理） ── */
        if (obj.kind !== 'bug' && _isThrownObjectOffScreen(p.pos.x, p.pos.y, obj.kind)) {
          _removeThrownObjectAt(oi, obj);
        }

      } else if (obj.state === 'sticking') {
        obj.stickT = Math.min(1, obj.stickT + 0.078 * _currentTimeScale);
        var ease = obj.stickT < 0.5 ? 2 * obj.stickT * obj.stickT : -1 + (4 - 2 * obj.stickT) * obj.stickT;
        if (obj.cA) obj.cA.distance = obj.stickyFromA + (obj.stickyToA - obj.stickyFromA) * ease;
        if (obj.cB) obj.cB.distance = obj.stickyFromB + (obj.stickyToB - obj.stickyFromB) * ease;
        if (obj.stickT >= 1) {
          if (obj.cA) obj.cA.distance = obj.stickyToA;
          if (obj.cB) obj.cB.distance = obj.stickyToB;
          if (obj.kind === 'bug') {
            audioEngine.stopBugBuzz(thrownObjects.indexOf(obj));
            /* 锁定粘网瞬间的俯仰角和镜像，stuck 状态渲染时继续使用 */
            if (obj._tiltAngle != null) obj._stuckTiltAngle = obj._tiltAngle;
            obj._stuckFlyMirror = obj._flyMirror || false;
          }
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
            if (obj.kind === 'poop') obj.wobbleAmp = 0.10;
          }
        }

      } else if (obj.state === 'stuck') {
        if (_pickupDrag && _pickupDrag.obj === obj) {
          if (_pickupDrag.mode === 'web-drag' && (obj.kind === 'boulder' || obj.kind === 'bug' || obj.kind === 'drop')) {
            var wTargetGripX = _pickupDrag.pointerX - _pickupDrag.gripDX;
            var wTargetGripY = _pickupDrag.pointerY - _pickupDrag.gripDY;
            var wPullDx = wTargetGripX - p.pos.x;
            var wPullDy = wTargetGripY - p.pos.y;
            p.pos.x += wPullDx * PICKUP_PULL_STRENGTH;
            p.pos.y += wPullDy * PICKUP_PULL_STRENGTH;
            if (obj.cA && obj.cB) {
              var wAnchorA2 = obj.cA.a === p ? obj.cA.b : obj.cA.a;
              var wAnchorB2 = obj.cB.a === p ? obj.cB.b : obj.cB.a;
              var wMidX = (wAnchorA2.pos.x + wAnchorB2.pos.x) * 0.5;
              var wMidY = (wAnchorA2.pos.y + wAnchorB2.pos.y) * 0.5;
              var wOffX = p.pos.x - wMidX;
              var wOffY = p.pos.y - wMidY;
              var wOffLen = Math.sqrt(wOffX * wOffX + wOffY * wOffY) || 1;
              var wMaxDrift = obj.kind === 'boulder'
                ? obj.def.r * 1.9
                : obj.kind === 'bug'
                  ? obj.def.r * 2.2
                  : obj.def.r * 1.45;
              if (wOffLen > wMaxDrift) {
                p.pos.x = wMidX + (wOffX / wOffLen) * wMaxDrift;
                p.pos.y = wMidY + (wOffY / wOffLen) * wMaxDrift;
              }
              p.lastPos.x = p.pos.x;
              p.lastPos.y = p.pos.y;
            }
            obj._pickupPullAngle = Math.atan2(wPullDy, wPullDx);
            var wTensionA = 0, wTensionB = 0;
            if (obj.cA) {
              var wAnchorA = obj.cA.a === p ? obj.cA.b : obj.cA.a;
              var wStretchA = p.pos.dist(wAnchorA.pos);
              wTensionA = Math.max(0, wStretchA / Math.max(1, obj.cA.distance) - 1);
            }
            if (obj.cB) {
              var wAnchorB = obj.cB.a === p ? obj.cB.b : obj.cB.a;
              var wStretchB = p.pos.dist(wAnchorB.pos);
              wTensionB = Math.max(0, wStretchB / Math.max(1, obj.cB.distance) - 1);
            }
            obj._pickupTension = wTensionA + wTensionB;
            obj._pickupCharge = Math.min(1, obj._pickupTension / Math.max(0.001, PICKUP_TENSION_THRESHOLD));
            continue;
          }
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
          if (!_isStuckDragOnly(obj)) {
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
        p.__ignoreBounds = true;
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
          _webScanIsRepair = false; /* 破坏触发的扫描，允许损失增大 */
        }

      } else if (obj.state === 'falling2') {
        p.__ignoreBounds = true; /* 所有 falling2 状态解除边界约束 */
        if (obj.kind === 'drop') {
          obj.angleVel += (Math.random() - 0.5) * obj.angleTurb * _currentTimeScale;
          obj.angleVel *= Math.pow(obj.angleDrag, _currentTimeScale);
          obj.angle += obj.angleVel * _currentTimeScale;
          obj.vx += Math.sin(obj.angle) * obj.glideForce * _currentTimeScale;
          obj.vy += obj.grav * _currentTimeScale;
          var dragScale = Math.pow(obj.drag, _currentTimeScale);
          obj.vx *= dragScale; obj.vy *= dragScale;
          /* falling2 不限速，让树叶能快速飞出屏幕 */
          p.pos.x += obj.vx * _currentTimeScale; p.pos.y += obj.vy * _currentTimeScale;
        } else if (obj.kind === 'poop') {
          var peelDragScale = Math.pow(obj.def.peelDrag, _currentTimeScale);
          obj.vx *= peelDragScale;
          obj.vy *= peelDragScale;
          obj.vy += obj.grav * 0.55 * _currentTimeScale;
          p.pos.x += obj.vx * _currentTimeScale;
          p.pos.y += obj.vy * _currentTimeScale;
        } else if (obj.kind === 'stone') {
          p.pos.y += (obj.spawnVy || obj.grav || 0) * _currentTimeScale;
          obj.spawnVy = (obj.spawnVy || obj.grav || 0) + 0.24 * _currentTimeScale;
        } else if (obj.kind === 'bug' || obj.kind === 'boulder') {
          /* 脱网后解除边界约束，让粒子能飞出屏幕范围 */
          p.__ignoreBounds = true;
          /* 脱网后统一施加向下重力，确保能飞出屏幕底部，不卡边缘 */
          var _fallGrav = Math.max(obj.grav != null ? obj.grav : 0, 0.35);
          obj.vy += _fallGrav * _currentTimeScale;
          /* 保底向下速度，防止横向速度主导导致卡边缘 */
          if (obj.vy < 1.5) obj.vy += 0.25 * _currentTimeScale;
          var fallVx = obj.vx || 0;
          var fallVy = obj.vy || 0;
          p.pos.x += fallVx * _currentTimeScale;
          p.pos.y += fallVy * _currentTimeScale;
          var fallDrag = Math.pow(obj.kind === 'bug' ? 0.97 : 0.99, _currentTimeScale);
          obj.vx = fallVx * fallDrag;
          obj.vy = fallVy * fallDrag;
          if (obj.kind === 'bug') obj.wingT += 0.55 * _currentTimeScale;
        } else {
          obj.vy = (obj.vy || 0) + obj.grav * _currentTimeScale;
          p.pos.x += (obj.vx || 0) * _currentTimeScale;
          p.pos.y += obj.vy * _currentTimeScale;
        }
        if (_isThrownObjectOffScreen(p.pos.x, p.pos.y, obj.kind)) {
          _removeThrownObjectAt(oi, obj);
          continue;
        }

      } else if (obj.state === 'wrapping') {
        p.lastPos.mutableSet(p.pos);
        ensureSilkSpiral(obj);
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
          if (isTutorialActive() && isTutorialInsectKind(obj.kind)) {
            tutorialController.handleEvent('object_wrapped', { kind: obj.kind });
            processTutorialActions();
          }
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
        if (obj._manualPullOff) {
          obj.state = obj.kind === 'drop' ? 'falling' : 'falling2';
          continue;
        }
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
          if (obj._manualPullOff) {
            obj.state = obj.kind === 'bug' ? 'falling2' : obj.state;
            continue;
          }
          if (autoPlay) _autoPlayPause = 24;
          audioEngine.playCollectSound(obj.kind);
          var collectFxPos = getCanvasPointOnStage(p.pos.x, p.pos.y);
          if (!obj._manualPullOff) playCollectFX(collectFxPos.x, collectFxPos.y, collectLayer, obj.kind, 'Collected');
          beginCollectObject(obj);
        }

      } else if (obj.state === 'collecting') {
        if (obj._manualPullOff) {
          if (obj.collectEl && obj.collectEl.parentNode) obj.collectEl.parentNode.removeChild(obj.collectEl);
          obj.collectEl = null;
          obj.collectCanvas = null;
          obj.state = obj.kind === 'drop' ? 'falling' : 'falling2';
          continue;
        }
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

      /* ── 兜底离屏销毁：覆盖 stuck/freeing/wrapped 等所有状态，苍蝇除外 ── */
      if (obj.kind !== 'bug' && thrownObjects[oi] === obj) {
        var _bp = obj.particle;
        if (_bp && (_bp.pos.y > H + 500 || _bp.pos.y < -500 || _bp.pos.x < -500 || _bp.pos.x > W + 500)) {
          if (wrappingTarget === obj) wrappingTarget = null;
          if (obj.collectEl && obj.collectEl.parentNode) obj.collectEl.parentNode.removeChild(obj.collectEl);
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
      if (!obj || !obj.def || obj.state !== 'falling' || obj.released || obj._disableRestick) continue;
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
          /* 苍蝇粘网瞬间锁定俯仰角和镜像，sticking/stuck 渲染时保持 */
          if (obj.kind === 'bug' && obj._tiltAngle != null) {
            obj._stuckTiltAngle = obj._tiltAngle;
            obj._stuckFlyMirror = obj._flyMirror || false;
          }
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

  function updateIdlePauseFootTwitch() {
    if (!idleWanderSession || !spiderAI.isIdlePaused()) {
      _idlePauseFootCooldown = 0;
      return;
    }
    if (_idlePauseFootCooldown > 0) {
      _idlePauseFootCooldown--;
      return;
    }
    _idlePauseFootCooldown = 18 + Math.floor(Math.random() * 34);
    if (Math.random() > 0.42) return;
    var twitchLegs = [];
    for (var ti = 0; ti < footState.length; ti++) {
      var tfs = footState[ti];
      if (!tfs.stepping && tfs.cooldown <= 0) twitchLegs.push(ti);
    }
    if (!twitchLegs.length) return;
    var twitchLeg = twitchLegs[Math.floor(Math.random() * twitchLegs.length)];
    var twitchCooldown = P.idleStepCooldown != null ? P.idleStepCooldown : 11;
    var twitchReach = P.idleStepReach != null ? P.idleStepReach : 34;
    triggerStep(
      twitchLeg, null, footState, spiderweb, spider, samplePoints, null,
      twitchCooldown, twitchReach, true, _spatialOpts()
    );
    _idlePauseFootCooldown = 42 + Math.floor(Math.random() * 72);
  }

  function updateFootTriggers() {
    if (poopStunTimer > 0) return;
    updateIdlePauseFootTwitch();
    var spatialOpts = _spatialOpts();
    var gaitTarget = target || idleTarget;
    var isIdleGait = !target && !!idleTarget;
    var idleStepThresh = P.idleStepThresh != null ? P.idleStepThresh : 20;
    var stepThreshSq = isIdleGait ? idleStepThresh * idleStepThresh : STEP_THRESH * STEP_THRESH;
    var footTier = _getFootSearchTier();
    if (!isIdleGait && footTier >= 1) {
      var effThresh = STEP_THRESH * (footTier >= 2 ? 0.72 : 0.85);
      stepThreshSq = effThresh * effThresh;
    }
    var stepCooldown = isIdleGait
      ? (P.idleStepCooldown != null ? P.idleStepCooldown : 11)
      : STEP_COOLDOWN;
    var baseReach = isIdleGait ? (P.idleStepReach != null ? P.idleStepReach : 34) : 42;
    var stepReach = Math.max(baseReach, getFootSearchRadiusForTier(footTier));
    var anyStepped = false;
    for (var fi = 0; fi < footState.length; fi++) {
      var fs = footState[fi];
      if (fs.stepping || fs.cooldown > 0) continue;
      var drift2 = fs.current.dist2(spider.thorax.pos);
      var partner = footState[fi % 2 === 0 ? fi + 1 : fi - 1];
      var ps = partner && partner.stepping;
      if (ps && footTier < 2) continue;
      if (fs.needsEmergencyStep) {
        fs.emergencyFrames = (fs.emergencyFrames || 0) + 1;
        var emergencyReach = getFootSearchRadiusForTier(Math.max(2, footTier));
        if (gaitTarget) {
          triggerStep(fi, moveDir, footState, spiderweb, spider, samplePoints, moveDir, stepCooldown, emergencyReach, isIdleGait, spatialOpts, footTier);
        } else {
          triggerStep(fi, null, footState, spiderweb, spider, samplePoints, moveDir, stepCooldown, emergencyReach, true, spatialOpts, footTier);
        }
        if (fs.stepping) {
          fs.needsEmergencyStep = false;
          fs.emergencyFrames = 0;
          anyStepped = true;
        } else if (fs.emergencyFrames > EMERGENCY_STEP_MAX_FRAMES) {
          if (_tryReanchorFoot(fs)) {
            fs.needsEmergencyStep = false;
            fs.emergencyFrames = 0;
            anyStepped = true;
          } else {
            fs.needsEmergencyStep = false;
            fs.emergencyFrames = 0;
          }
        }
        continue;
      }
      if (gaitTarget && drift2 > stepThreshSq) {
        triggerStep(fi, moveDir, footState, spiderweb, spider, samplePoints, moveDir, stepCooldown, stepReach, isIdleGait, spatialOpts, footTier);
        if (fs.stepping) anyStepped = true;
      } else if (!gaitTarget && drift2 > REST_THRESH * REST_THRESH) {
        triggerStep(fi, null, footState, spiderweb, spider, samplePoints, moveDir, stepCooldown, stepReach, true, spatialOpts, footTier);
        if (fs.stepping) anyStepped = true;
      }
    }
    if (anyStepped) _locomotion.noStepFrames = 0;
    else if (gaitTarget) _locomotion.noStepFrames++;
  }

  /* ── Panel init ── */
  initPanel(P, DEFAULTS, {
    buildWeb: buildWeb,
    buildSpider: buildSpider,
    getSharedDefaultsJson: function () {
      return JSON.stringify(buildSharedDefaultsPayload(P), null, 2);
    },
    promoteSharedDefaults: async function () {
      var response = await fetch('/__shared-defaults', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSharedDefaultsPayload(P))
      });
      if (!response.ok) throw new Error('failed to write shared defaults');
      return response.json();
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
    isSpawnEnabled: function () {
      return debugSpawnEnabled;
    },
    toggleSpawnEnabled: function () {
      debugSpawnEnabled = !debugSpawnEnabled;
      return debugSpawnEnabled;
    },
    debugBugBreakWeb: debugBugBreakWeb,
    isPerfDiagOn: function () {
      return statsGetDiagnosticMode();
    },
    togglePerfDiag: function () {
      var on = !statsGetDiagnosticMode();
      statsSetDiagnosticMode(on);
      return on;
    },
    isPerfRecording: function () {
      return statsIsRecording();
    },
    togglePerfRecording: function () {
      if (statsIsRecording()) {
        statsStopRecording();
        return false;
      }
      statsStartRecording();
      return true;
    },
    getPerfRecordedSeconds: function () {
      return statsGetRecordedSecondCount();
    },
    clearPerfRecording: function () {
      statsClearRecording();
    },
    exportPerfLog: function () {
      return statsDownloadExportPackage();
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
    },
    startTutorial: startTutorial
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
    var themeColors = ['#3da86c', '#3b82f6', '#8b5cf6', '#b46e34', '#ff8da1'];
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
    var startVisible = forceShow;

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
    panel.style.display = startVisible ? 'block' : 'none';
    panel.style.background = 'rgba(10,12,18,0.86)';
    panel.style.border = '1px solid rgba(255,255,255,0.2)';
    panel.style.borderRadius = '10px';
    panel.style.padding = '10px';
    panel.style.color = '#e8eefc';
    panel.style.font = '12px/1.3 system-ui,-apple-system,Segoe UI,Roboto,sans-serif';

    var title = document.createElement('div');
    title.textContent = 'Gait Tune (Dev) — press ` to toggle';
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
  var LOGIC_FPS = 60;
  var FIXED_STEP_MS = 1000 / LOGIC_FPS;
  var MAX_CATCHUP_STEPS = IS_MOBILE ? 2 : 4;
  var _lastTimestamp = 0;
  var _fixedAccumulatorMs = 0;
  var _bgFrame = 0;
  var _wasBulletTime = false;
  function fixedUpdate() {
    /* ── 子弹时间检测：仅拖拽断线头 stub 时进入 ── */
    var _isBulletTime = !!(sim.draggedEntity && sim.draggedEntity.__isStub);
    /* Gameplay and physics are fixed 60Hz. Do not pass RAF delta into this function. */
    var timeScale = _isBulletTime ? 0.0 : 1.0;
    _currentTimeScale = timeScale;

    /* ── 背景变暗切换（只在状态变化时调用一次） ── */
    if (_isBulletTime !== _wasBulletTime) {
      _wasBulletTime = _isBulletTime;
      bgConfig.darken = _isBulletTime ? 0.72 : P.bgDarken / 100;
      applyBgPresentation();
      applyBgVignette(_isBulletTime);
    }

    /* ── 拖拽 stub 时实时预览 BFS 环路 ── */
    if (_isBulletTime && sim.snapTarget && sim.draggedEntity && sim.draggedEntity.__isStub) {
      if (sim.snapTarget !== _previewSnapTarget) {
        _previewSnapTarget = sim.snapTarget;
        /* 找 stub 的锚点 */
        var _pvAnchor = null;
        for (var _pvi = 0; _pvi < spiderweb.constraints.length; _pvi++) {
          var _pvc = spiderweb.constraints[_pvi];
          if (!_pvc.__isStubAnchor) continue;
          if (_pvc.a === sim.draggedEntity) { _pvAnchor = _pvc.b; break; }
          if (_pvc.b === sim.draggedEntity) { _pvAnchor = _pvc.a; break; }
        }
        if (_pvAnchor && _pvAnchor !== sim.snapTarget) {
          _previewRing = bfsPath(_pvAnchor, sim.snapTarget, spiderweb);
        } else {
          _previewRing = null;
        }
      }
    } else {
      _previewRing = null;
      _previewSnapTarget = null;
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
      return timeScale;
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
        }
        if (rTask.state === 'walking') {
          /* 动态找 ring 上离蜘蛛最近的存活节点作为目标 */
          var _bestRN = null, _bestRD2 = Infinity;
          for (var _rni = 0; _rni < rTask.ring.length; _rni++) {
            var _rn = rTask.ring[_rni];
            if (spiderweb.particles.indexOf(_rn) === -1) continue;
            var _rd2 = spider.thorax.pos.dist2(_rn.pos);
            if (_rd2 < _bestRD2) { _bestRD2 = _rd2; _bestRN = _rn; }
          }
          if (_bestRN) {
            _autoTarget.x = _bestRN.pos.x;
            _autoTarget.y = _bestRN.pos.y;
            target = _autoTarget;
            isRepairing = true;
            if (_bestRD2 <= 14 * 14) {
              rTask.state = 'repairing';
              target = null;
              _repairAnimProxy.animT = 0;
            }
          } else {
            /* ring 上没有存活节点，放弃任务 */
            repairQueue.shift();
          }
        } else if (rTask.state === 'repairing') {
          target = null;
          isRepairing = true;
          rTask.timer -= _currentTimeScale;
          var _rDur = rTask.duration || 60;
          _repairAnimProxy.particle.pos.x = rTask.pos.x;
          _repairAnimProxy.particle.pos.y = rTask.pos.y;
          _repairAnimProxy.wrapT = 1 - rTask.timer / _rDur;
          _repairAnimProxy.wrapDur = _rDur;
          if (_currentTimeScale > 0) _repairAnimProxy.animT += _currentTimeScale;
          var _repairBeat = Math.floor(rTask.timer / 10);
          if (rTask._repairBeat !== _repairBeat) {
            rTask._repairBeat = _repairBeat;
            audioEngine.playSfxRepairWeave();
          }

          /* 持续喷丝线粒子：数量少但范围大 */
          var sx = spider.thorax.pos.x;
          var sy = spider.thorax.pos.y;
          var _repairDir = Math.atan2(rTask.pos.y - sy, rTask.pos.x - sx);
          if (Math.floor(rTask.timer) % 2 === 0) {
            var sAng = Math.random() * Math.PI * 2;
            var sSpd = 2.5 + Math.random() * 4.0;
            _pushBurstParticle({
              x: sx + (Math.random() - 0.5) * 16,
              y: sy + (Math.random() - 0.5) * 16,
              vx: Math.cos(sAng) * sSpd,
              vy: Math.sin(sAng) * sSpd,
              life: 1.0,
              decay: 0.018 + Math.random() * 0.012,
              r: 1.5 + Math.random() * 1.5,
              drag: 0.95,
              speedScale: 1,
              smoke: false,
              color: ['#e8e8f0', '#d0d8e8', '#ffffff'][Math.floor(Math.random() * 3)]
            });
          }
          /* 偶尔喷一个带 glow 的大粒子 */
          if (Math.floor(rTask.timer) % 10 === 0) {
            _pushBurstParticle({
              x: sx + (Math.random() - 0.5) * 20,
              y: sy + (Math.random() - 0.5) * 20,
              vx: (Math.random() - 0.5) * 1.5,
              vy: (Math.random() - 0.5) * 1.5,
              life: 1.0,
              decay: 0.025,
              r: 4,
              grow: 0.2,
              drag: 0.97,
              speedScale: 1,
              smoke: true,
              occlude: 0.45,
              color: '#ddeeff'
            });
          }

          if (rTask.timer <= 0) {
            patchHole(rTask.ring, spiderweb);
            repairCompleteFlashes.push({
              ring: rTask.ring,
              t: _breakFrame,
              duration: 54,
              cx: rTask.pos.x,
              cy: rTask.pos.y
            });
            _spawnRepairCompleteFX(rTask.pos.x, rTask.pos.y, rTask.ring);
            audioEngine.playSfxRepairComplete();
            repairQueue.shift();
            _refreshBrokenEnds();
            webScanPending = 3;
            _webScanIsRepair = true;
            isRepairing = false;
          }
        }
      }
    }

    /* ── 玩家优先目标：完成当前工作后优先去用户点选的位置/物体 ── */
    if (!isPoopStunned && !wrappingTarget && !isRepairing && userPriorityTarget) {
      _abandonPriorityNavIfStuck();
    }
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
        if (hasReachedNavGoal(
          spider.thorax.pos.x, spider.thorax.pos.y,
          _autoTarget.x, _autoTarget.y, spiderweb, _spatialOpts(), 16
        )) {
          clearPriorityTarget();
          pauseAndClearCurrentTarget();
        }
      }
    }

    /* ── autoPlay：自动选取最近 stuck 物体为目标 ── */
    if (_autoPlayPause > 0) { _autoPlayPause--; }
    if (!isPoopStunned && !autoPlay && !wrappingTarget && !isRepairing && !userPriorityTarget) {
      target = null;
      autoChaseTarget = null;
    }
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
            if (!isNavReachable(
              _tx.x, _tx.y, _o.particle.pos.x, _o.particle.pos.y, spiderweb, _spatialOpts()
            )) continue;
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
          if (!_navSteerPath || _locomotion.frameTick % 40 === 0
              || _locomotion.stallFrames > 18 || _locomotion.noStepFrames > 20) {
            _navSteerPath = findNavPath(
              spider.thorax.pos.x, spider.thorax.pos.y,
              _autoTarget.x, _autoTarget.y, spiderweb, _spatialOpts()
            );
          }
        } else {
          target = null;
        }
      }
    }

    /* ── idle wander：无任务目标时走一段、停一下，再换方向（独立导航，不占用 task target） ── */
    idleTarget = null;
    idleWanderActive = false;
    idleWanderSession = false;
    if (!isTutorialActive() && !isPoopStunned && !wrappingTarget && !isRepairing && !userPriorityTarget
        && gameState === 'LEVEL_ACTIVE' && !target && !_isBulletTime
        && _autoPlayPause <= 0 && !_spawnAnim.active) {
      idleWanderSession = true;
      var _idleAiTarget = spiderAI.update(spider, spiderweb, thrownObjects, false, { idleMode: true }); /* 闲逛：头朝随机点，脚贴网 */
      if (_idleAiTarget) {
        _autoTarget.x = _idleAiTarget.x;
        _autoTarget.y = _idleAiTarget.y;
        idleTarget = _autoTarget;
        idleWanderActive = true;
      }
      blinkState.mood = tickIdleBoredCycle(timeScale) ? 'bored' : spiderAI.mood;
    } else {
      resetIdleBoredCycle();
      if (blinkState.mood === 'bored') blinkState.mood = 'calm';
    }

    /* body movement */
    var isWrapping = (wrappingTarget !== null);
    var moving = false; moveDir = null;
    var bodyTarget = target || idleTarget;
    var isIdleBodyMove = !target && !!idleTarget;
    /* ── 每关开始冻结倒计时 ── */
    if (levelStartLockTimer > 0) levelStartLockTimer -= _currentTimeScale;
    var isLevelStartLocked = levelStartLockTimer > 0;

    /* ── 每关开始石头延迟倒计时（须等完整度基准建立后再计时/落石，否则破口会被算进初始 100%） ── */
    if (_levelStartStonePending && _isWebIntegrityBaselineReady()) {
      _levelStartStoneTimer -= _currentTimeScale;
      if (_levelStartStoneTimer <= 0) {
        _levelStartStonePending = false;
        launchLevelStartStone();
      }
    }

    if (isPoopStunned || isLevelStartLocked) {
      target = null;
      idleTarget = null;
    } else if (isTutorialSpiderLocked()) {
      target = null;
      idleTarget = null;
    } else if (isWrapping) {
      target = null;
      idleTarget = null;
    } else if (bodyTarget) {
      var tx = spider.thorax.pos;
      var dx = bodyTarget.x - tx.x, dy = bodyTarget.y - tx.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var supportRatio = _countSupportedFeet() / Math.max(1, footState.length);
      var spatialOptsBody = _spatialOpts();
      var reachedGoal = false;
      if (userPriorityTarget && userPriorityTarget.type === 'point') {
        reachedGoal = hasReachedNavGoal(
          tx.x, tx.y, bodyTarget.x, bodyTarget.y, spiderweb, spatialOptsBody, 16
        );
      } else {
        reachedGoal = dist <= arriveThreshold;
      }
      if (!reachedGoal && !_isBulletTime && (isIdleBodyMove || supportRatio > 0)) {
        moving = true;
        var scaledSpeed = isIdleBodyMove
          ? moveSpeed * (P.idleMoveRatio != null ? P.idleMoveRatio : 0.06)
          : moveSpeed;
        if (isIdleBodyMove) scaledSpeed *= timeScale;
        else if (supportRatio < 1) scaledSpeed *= Math.max(0.25, 0.4 + supportRatio * 0.6);
        if (userPriorityTarget && dist < 50) {
          scaledSpeed *= Math.max(0.4, dist / 50);
        }
        if (_navSteerPath && _navSteerPath.length >= 2
            && (userPriorityTarget || (autoPlay && target))) {
          _refreshNavSteerIfStalled(bodyTarget.x, bodyTarget.y);
        }
        var dirX = dx / dist, dirY = dy / dist;
        var steer = _resolveBodyMoveDir(tx.x, tx.y, bodyTarget.x, bodyTarget.y, dirX, dirY);
        dirX = steer.x;
        dirY = steer.y;

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
      } else if (target) {
        if (userPriorityTarget && userPriorityTarget.type === 'point'
            && hasReachedNavGoal(
              spider.thorax.pos.x, spider.thorax.pos.y,
              bodyTarget.x, bodyTarget.y, spiderweb, spatialOptsBody, 16
            )) {
          clearPriorityTarget();
        }
        target = null;
      } else {
        idleTarget = null;
      }
    }

    _locomotion.frameTick++;
    if (bodyTarget && (target || userPriorityTarget)) {
      var gdx = bodyTarget.x - spider.thorax.pos.x;
      var gdy = bodyTarget.y - spider.thorax.pos.y;
      var goalDist = Math.sqrt(gdx * gdx + gdy * gdy);
      if (goalDist >= _locomotion.lastGoalDist - 0.35) _locomotion.stallFrames++;
      else _locomotion.stallFrames = Math.max(0, _locomotion.stallFrames - 2);
      _locomotion.lastGoalDist = goalDist;
    } else {
      _locomotion.stallFrames = 0;
      _locomotion.lastGoalDist = Infinity;
    }

    /* feet */
    for (var fi = 0; fi < footState.length; fi++) {
      var fs = footState[fi];
      if (fs.cooldown > 0) fs.cooldown--;
      if (fs.stepping) {
        var legStepSpeed = (idleWanderActive && !target)
          ? (P.idleStepSpeed != null ? P.idleStepSpeed : 0.09)
          : STEP_SPEED;
        fs.t = Math.min(1, fs.t + legStepSpeed * ((_isBulletTime || isPoopStunned) ? 0 : 1));
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
      if (tutorialStoneImpact && tutorialStoneImpact.phase === 'pull') {
        updateTutorialStoneImpactFollow(timeScale);
      }
    }
    statsTimeEnd();

    /* Phase C：physics → build → query（单步 11 iter，仅蛛网受重力） */
    statsTimeStart('phys');
    var physicsIters = 11;
    var physicsSteps = 1;
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
    if (!_isBulletTime) queryThrownStick();

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
      if (repairCompleteFlashes.length > 0) {
        var repairFlashWrite = 0;
        for (var rfi = 0; rfi < repairCompleteFlashes.length; rfi++) {
          var rf = repairCompleteFlashes[rfi];
          if (_breakFrame - rf.t < (rf.duration || 54)) repairCompleteFlashes[repairFlashWrite++] = rf;
        }
        repairCompleteFlashes.length = repairFlashWrite;
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
      if (isTutorialActive()) {
        tutorialController.tick(timeScale);
        processTutorialActions();
        tickTutorialSpawnQueue(timeScale);
        updateTutorialFocusPrompt();
        notifyTutorialRepairFinishedIfNeeded();
      }
      updateLevelTimer();
      updateLevelSpawner();
      checkWebIntegrity();
      if (poopStunTimer > 0) {
        poopStunTimer = Math.max(0, poopStunTimer - timeScale);
        if (poopStunTimer > 0) blinkState.mood = 'shock';
        else clearPoopStun();
      }
      tryCollectObjects();
      if (pendingLevelCheck) { pendingLevelCheck = false; checkLevelComplete(); }
    }
    statsTimeEnd();

    statsTimeStart('other');
    updateBlink();
    statsTimeEnd();

    return timeScale;
  }

  function renderFrame(timestamp, updateScale) {
    var _isBulletTime = !!(sim.draggedEntity && sim.draggedEntity.__isStub);
    var timeScale = _isBulletTime ? 0 : (updateScale || _currentTimeScale || 1);

    statsTimeStart('webRnd');
    sim.draw();
    statsTimeEnd();
    statsTimeStart('preyRnd');
    if (selectedWrappedPrey) {
      if (thrownObjects.indexOf(selectedWrappedPrey) === -1 || selectedWrappedPrey.state !== 'wrapped') {
        selectedWrappedPrey = null;
      }
    }
    drawThrownObjects(sim.ctx, thrownObjects, userPriorityTarget, selectedWrappedPrey);
    statsTimeEnd();
    statsTimeStart('spiderRnd');
    if (spider && spider.drawConstraints) spider.drawConstraints(sim.ctx, spider);
    drawWrappingOverlay(sim.ctx, thrownObjects); /* 打包圆圈 */

    /* 打包飞溅：绘制在猎物/蜘蛛/打包圈之上（叶子收集不显示白色粒子） */
    if (!_isBulletTime && wrappingTarget && wrappingTarget.kind !== 'drop') {
      _wrapSplashTimer -= timeScale;
      if (_wrapSplashTimer <= 0) {
        _wrapSplashTimer = _wrapSplashInterval;
        spawnWrapSplashParticles(wrappingTarget);
      }
    }
    updateAndDrawWrapSplashParticles(sim.ctx, timeScale);
    updateAndDrawLeafShards(sim.ctx, timeScale);

    /* ── 补网修复进度圈 ── */
    if (repairQueue.length > 0 && repairQueue[0].state === 'repairing') {
      var rt = repairQueue[0];
      var progress = 1 - rt.timer / (rt.duration || 60);
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
        var _speedScale = (_bp.speedScale || 1) * updateScale;
        _bp.x += _bp.vx * _speedScale; _bp.y += _bp.vy * _speedScale;
        var _drag = _bp.drag || 0.92;
        var _dragScale = Math.pow(_drag, updateScale);
        _bp.vx *= _dragScale;
        _bp.vy *= _dragScale;
        if (_bp.smoke || _bp.ring || _bp.flash) {
          _bp.r += (_bp.grow || 0.1) * _speedScale;
        }
        _bp.life -= _bp.decay * _speedScale;
        if (_bp.life <= 0) {
          _recycleBurstParticle(_bp);
          _burstParticles.splice(_bpi, 1);
          continue;
        }
        _ctx.save();
        if (_bp.ring) {
          _ctx.globalAlpha = _bp.life * 0.82;
          _ctx.strokeStyle = _bp.color;
          _ctx.lineWidth = _bp.lineWidth || 2.4;
          _ctx.beginPath();
          _ctx.arc(_bp.x, _bp.y, _bp.r, 0, 2 * Math.PI);
          _ctx.stroke();
        } else if (_bp.flash) {
          var flashAlpha = _bp.life * _bp.life;
          _ctx.globalAlpha = flashAlpha;
          _ctx.shadowBlur = 18;
          _ctx.shadowColor = 'rgba(214,228,72,' + (flashAlpha * 0.75).toFixed(2) + ')';
          _ctx.beginPath();
          _ctx.arc(_bp.x, _bp.y, _bp.r, 0, 2 * Math.PI);
          _ctx.fillStyle = _bp.color;
          _ctx.fill();
        } else if (_bp.sparkle) {
          var twinkle = 0.25 + 0.75 * Math.abs(Math.sin(timestamp * 0.028 + (_bp.phase || 0)));
          var sparkleAlpha = _bp.life * twinkle;
          var sparkleSize = _bp.r * (0.55 + twinkle * 0.65);
          _ctx.globalAlpha = sparkleAlpha;
          _ctx.shadowBlur = 5 + twinkle * 4;
          _ctx.shadowColor = 'rgba(200,235,255,' + (sparkleAlpha * 0.7).toFixed(2) + ')';
          _ctx.strokeStyle = _bp.color;
          _ctx.lineWidth = 1;
          _ctx.lineCap = 'round';
          _ctx.beginPath();
          _ctx.moveTo(_bp.x - sparkleSize, _bp.y);
          _ctx.lineTo(_bp.x + sparkleSize, _bp.y);
          _ctx.moveTo(_bp.x, _bp.y - sparkleSize);
          _ctx.lineTo(_bp.x, _bp.y + sparkleSize);
          _ctx.stroke();
          _ctx.beginPath();
          _ctx.arc(_bp.x, _bp.y, sparkleSize * 0.25, 0, 2 * Math.PI);
          _ctx.fillStyle = _bp.color;
          _ctx.fill();
        } else {
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

  }

  var loop = function (timestamp) {
    statsBeginFrame();
    var workT0 = performance.now();

    var elapsedMs = _lastTimestamp ? Math.min(timestamp - _lastTimestamp, 250) : FIXED_STEP_MS;
    _lastTimestamp = timestamp;
    _fixedAccumulatorMs += elapsedMs;

    var steps = 0;
    var updateScale = 0;
    while (_fixedAccumulatorMs >= FIXED_STEP_MS && steps < MAX_CATCHUP_STEPS) {
      updateScale += fixedUpdate();
      _fixedAccumulatorMs -= FIXED_STEP_MS;
      steps++;
    }
    var droppedCatchup = false;
    if (steps >= MAX_CATCHUP_STEPS && _fixedAccumulatorMs >= FIXED_STEP_MS) {
      _fixedAccumulatorMs = 0;
      droppedCatchup = true;
    }

    statsRecordFrameMeta({
      logicSteps: steps,
      backlogMs: _fixedAccumulatorMs,
      droppedCatchup: droppedCatchup
    });

    if (gameState !== 'IDLE' && gameState !== 'GAME_OVER') {
      renderFrame(timestamp, updateScale);
    }

    statsEndFrame(timestamp, performance.now() - workT0);
    updateStatsPanel();
    syncPerfRecordBtnLabel();
    requestAnimFrame(loop);
  };
  requestAnimFrame(loop);
};
