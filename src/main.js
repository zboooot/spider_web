/* Version: V3.2 — Sylvan Background + Procedural BGM */
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
  buildWebGridList, cellCovered, scanWebCells, createBudgetScanner
} from './systems/webIntegrity.js';

import {
  LEVEL_CONFIGS, GAME_DURATION,
  calcWaveScore, getLevelCfg, framesToTime
} from './systems/levelSystem.js';

import { audioEngine } from './audio/audioEngine.js';

import { setupWebDraw } from './render/webRenderer.js';
import { setupSpiderDraw } from './render/spiderRenderer.js';
import { drawThrownObjects, buildSilkSpiral, buildCollectSnapshot } from './render/objectRenderer.js';
import { createSpiderAI } from './systems/spiderAI.js';
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
    radialWobbleScale: 0.55, spiralWobbleScale: 1.0,
    moveSpeed: 2.4, stepSpeed: 0.22, stepThresh: 20, restThresh: 50,
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
  var _pointerStartClient = { x: 0, y: 0 };
  var _pointerMoved = false;
  var TAP_MOVE_THRESHOLD = 12;
  var PICKUP_PULL_STRENGTH = 0.26;
  var PICKUP_TENSION_THRESHOLD = 0.42;
  var PICKUP_TENSION_RELEASE_RATE = 0.05;
  var STUCK_PLUCK_THRESHOLD = 0.65;
  var STUCK_BREAK_THRESHOLD = 1.1;
  var STUCK_FORCE_THRESHOLD_BOULDER = 14;
  var STUCK_FORCE_THRESHOLD_BUG = 10;
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
    var hit = _findWrappedPreyAt(clientX, clientY);
    if (!hit) return false;
    _pickupDrag = {
      obj: hit.obj,
      startX: hit.pos.x,
      startY: hit.pos.y,
      pointerX: hit.pos.x,
      pointerY: hit.pos.y,
      gripDX: hit.pos.x - hit.obj.particle.pos.x,
      gripDY: hit.pos.y - hit.obj.particle.pos.y,
      active: true
    };
    hit.obj._pickupTension = 0;
    hit.obj._pickupCharge = 0;
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
      }
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
  var _webDrawApi = null;
  var spiderweb, spider, legConstraintCount, samplePoints = [], footState = [];
  var STEP_SPEED, STEP_THRESH, REST_THRESH, STEP_COOLDOWN = 6;
  var target = null, moveDir = null, moveSpeed = P.moveSpeed, arriveThreshold = 22;
  var _targetMarker = { x: 0, y: 0, age: 0, active: false };
  var _spawnAnim = { active: false, t: 0, fromY: 0, toY: 0, duration: 52 };
  var _locomotionState = 'ACTIVE';
  var _lockedTopologyVersion = 0;
  var _gaitCursor = 0;
  var _gaitOrderIdle = [0, 2, 1, 3];
  var _gaitOrderMove = [0, 3, 1, 2];

  /* ── blink + mood ── */
  var blinkState = { scale: 1, blinking: false, t: 0, nextBlink: 180 + Math.floor(Math.random() * 240), mood: 'calm', headShake: 0, headShakeAmp: 0 };
  var _spiderAI = createSpiderAI();
  var _aiPlayerInputThisFrame = false;
  var _aiOwnsTarget = false;

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
    spiderweb = createSpiderweb(sim, new Vec2(ocx, ocy), rad, segs, depth, P.webStiff, pStep, {
      radialStiffnessMul: 1.4,
      spiralStiffnessMul: 0.85,
      radialTensorMul: 0.85,
      spiralTensorMul: 1.0,
      centerTensionBoost: 0.08
    });
    webCx = ocx; webCy = ocy; webRad = rad;
    var wi = sim.composites.indexOf(spiderweb);
    if (wi !== 0) { sim.composites.splice(wi, 1); sim.composites.unshift(spiderweb); }
    samplePoints = getWebSamplePoints(spiderweb, 4);
    _webDrawApi = setupWebDraw(spiderweb, function () { return thrownObjects; }, function () { return webBreakFlashes; }, function () { return _breakFrame; }, function () { return _logicalTimeMs; });
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
        stepping: false, t: 1, cooldown: 999, holdFrames: 0, phase: [0, 0.5, 0.5, 0][idx] || 0
      };
    });
    _spawnAnim.active = true;
    _spawnAnim.t = 0;
    _spawnAnim.fromY = spawnFromY;
    _spawnAnim.toY = cy;
    _spawnAnim.duration = 52;
    _locomotionState = 'SPAWNING';
    _lockedTopologyVersion = 0;
    _gaitCursor = 0;
    setupSpiderDraw(spider, legConstraintCount, footState, blinkState, function () { return wrappingTarget; });
  }

  function _isFootFootholdValid(fs) {
    if (!spiderweb) return false;
    var wcs = spiderweb.constraints;
    if (fs.landedNode) {
      for (var wi = 0; wi < wcs.length; wi++) {
        var wc = wcs[wi];
        if (!(wc instanceof DistanceConstraint)) continue;
        if (wc.a === fs.landedNode || wc.b === fs.landedNode) return true;
      }
      return false;
    }
    if (fs.landedSeg) {
      var pa = fs.landedSeg.pa, pb = fs.landedSeg.pb;
      if (!pa || !pb) return false;
      var paAlive = false, pbAlive = false;
      for (var wi2 = 0; wi2 < wcs.length; wi2++) {
        var wc2 = wcs[wi2];
        if (!(wc2 instanceof DistanceConstraint)) continue;
        if (wc2.a === pa || wc2.b === pa) paAlive = true;
        if (wc2.a === pb || wc2.b === pb) pbAlive = true;
        if (paAlive && pbAlive) return true;
      }
    }
    return false;
  }

  function _shouldLockIdle() {
    if (_spawnAnim.active || target || wrappingTarget || !spider || !footState.length) return false;
    var lockR2 = Math.max(18, REST_THRESH - 8);
    lockR2 *= lockR2;
    for (var fi = 0; fi < footState.length; fi++) {
      var fs = footState[fi];
      if (fs.stepping || fs.cooldown > 0 || fs.holdFrames > 0) return false;
      if (!(fs.landedNode || fs.landedSeg)) return false;
      if (!_isFootFootholdValid(fs)) return false;
      if (fs.current.dist2(spider.thorax.pos) > lockR2) return false;
    }
    return true;
  }

  function _shouldUnlockIdle() {
    if (_spawnAnim.active || target || wrappingTarget || !spider) return true;
    if ((spiderweb._topologyVersion || 0) !== _lockedTopologyVersion) return true;
    var unlockR2 = (REST_THRESH + 8) * (REST_THRESH + 8);
    for (var fi = 0; fi < footState.length; fi++) {
      var fs = footState[fi];
      if (fs.stepping) return true;
      if (!_isFootFootholdValid(fs)) return true;
      if (fs.current.dist2(spider.thorax.pos) > unlockR2) return true;
    }
    return false;
  }

  function _drawTargetMarker(ctx) {
    if (!_targetMarker.active) return;
    var ARRIVE_AGE = 18;
    var ALIVE_AGE = 72;
    _targetMarker.age++;
    if (!target && _targetMarker.age > ARRIVE_AGE) { _targetMarker.active = false; return; }
    var mx = _targetMarker.x, my = _targetMarker.y;
    var age = _targetMarker.age;
    var alpha, r;
    if (target) {
      var inT = Math.min(1, age / 10);
      var ease = 1 - Math.pow(1 - inT, 3);
      r = 6 + (1 - ease) * 10;
      alpha = 0.55 * ease;
    } else {
      var outT = Math.max(0, Math.min(1, (age - ARRIVE_AGE) / 14));
      r = 6 + outT * 8;
      alpha = 0.55 * (1 - outT * outT);
      if (alpha <= 0) { _targetMarker.active = false; return; }
    }
    var pulse = Math.sin(age * 0.32) * 0.18 + 0.82;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(mx, my, r * pulse, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mx, my, r * pulse * 0.36, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fill();
    ctx.restore();
  }

  function _slotDistanceInOrder(legIndex, order, cursor) {
    for (var oi = 0; oi < order.length; oi++) {
      if (order[(cursor + oi) % order.length] === legIndex) return oi;
    }
    return order.length;
  }

  function _isPhaseEligible(legIndex, fs, moving, swingCount, emergencyStep) {
    if (emergencyStep) return true;
    var order = moving ? _gaitOrderMove : _gaitOrderIdle;
    var slotDist = _slotDistanceInOrder(legIndex, order, _gaitCursor);
    if (slotDist === 0) return true;
    if (moving) {
      if (slotDist <= 1) return true;
      if (swingCount === 0 && slotDist <= 2) return true;
    }
    if ((fs.phase || 0) >= 0.9) return true;
    return false;
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

  var gameState = 'IDLE';
  var isGameplayTestMode = false;
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
  var _budgetScanner = createBudgetScanner(30);

  /* helper: getLevelCfg with current difficulty */
  function getCfg(n) { return getLevelCfg(n, difficultyLevel); }

  /* ── show IDLE start screen ── */
  showOverlay(
    '<div class="overlay-title">SPIDER WEB</div>'
    + '<div class="overlay-subtitle" style="margin-bottom:6px">Collect prey caught in the web</div>'
    + '<div class="overlay-subtitle" style="margin-bottom:22px;opacity:0.6">Survive for 3 minutes. If the web breaks, you lose.</div>'
    + '<button class="overlay-btn" id="btn-start-game">Start Game</button>'
    + '<br><button class="overlay-btn" style="background:#3b5f8a;margin-top:8px" id="btn-gameplay-test">Gameplay Test</button>'
  );
  document.getElementById('btn-start-game').onclick = startGameFromBeginning;
  document.getElementById('btn-gameplay-test').onclick = startGameplayTest;

  /* click to move (desktop) */
  canvas.addEventListener('click', function (e) {
    if (_suppressMoveCommand) { _suppressMoveCommand = false; return; }
    if (wrappingTarget !== null) return;
    if (_pointerMoved) return;
    var r = canvas.getBoundingClientRect();
    var rawTarget = new Vec2((e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height));
    target = _snapPointToWeb(rawTarget.x, rawTarget.y) || rawTarget;
    _targetMarker.x = target.x; _targetMarker.y = target.y; _targetMarker.age = 0; _targetMarker.active = true;
    _aiPlayerInputThisFrame = true;
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
    if (_suppressMoveCommand) { _suppressMoveCommand = false; return; }
    if (wrappingTarget !== null) return;
    if (e.changedTouches.length === 1) {
      var t = e.changedTouches[0];
      var ddx = t.clientX - _touchStartX;
      var ddy = t.clientY - _touchStartY;
      if (!_pointerMoved && Math.sqrt(ddx * ddx + ddy * ddy) < TAP_MOVE_THRESHOLD) {
        var r = canvas.getBoundingClientRect();
        var rawTarget = new Vec2((t.clientX - r.left) * (W / r.width), (t.clientY - r.top) * (H / r.height));
        target = _snapPointToWeb(rawTarget.x, rawTarget.y) || rawTarget;
        _targetMarker.x = target.x; _targetMarker.y = target.y; _targetMarker.age = 0; _targetMarker.active = true;
        _aiPlayerInputThisFrame = true;
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
    webGridList = null; webInitCells = 1; webScanPending = 0; webLossPct = 0;
    webGridBuildIdx = 0; webGridInitCover = 0;
    _budgetScanner.reset();

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
    _budgetScanner.reset();
    var loss = 1 - covered / webInitCells;
    if (loss < 0) loss = 0;
    var pct = Math.round(loss * 100);
    if (pct > webLossPct) webLossPct = pct;
  }

  function _tickBudgetScan() {
    if (!webGridList || webGridList.length === 0) return;
    var covered = _budgetScanner.tick(webGridList, spiderweb, webGridCoverD);
    if (covered === 0) return;
    var loss = 1 - covered / webInitCells;
    if (loss < 0) loss = 0;
    var pct = Math.round(loss * 100);
    if (pct > webLossPct) webLossPct = pct;
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
    if (webGridBuildIdx < (webGridList ? webGridList.length : 0)) continueWebGridBuild();
    if (webScanPending > 0) {
      webScanPending--;
      if (webScanPending === 0) _scanWebCells();
    } else {
      _tickBudgetScan();
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
    var kinds = isGameplayTestMode ? [] : ['boulder', 'bug', 'drop'];
    if (kinds.length === 0) return;
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

  function beginPlucking(obj) {
    if (_pickupDrag && _pickupDrag.obj === obj) _pickupDrag = null;
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
    playCollectFX(pluckPos.x, pluckPos.y, collectLayer, obj.kind);
  }

  function beginCollectObject(obj) {
    var p = obj.particle;
    var startPos = getCanvasPointOnStage(p.pos.x, p.pos.y);
    var targetPos = getInventoryTarget(obj.kind);
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
    target = null;

    obj._silkLines = null;
    obj._silkSpiral = buildSilkSpiral(obj);
  }

  function tryCollectObjects() {
    if (wrappingTarget !== null) return;
    var thorax = spider.thorax.pos;
    var abdomen = spider.abdomen.pos;
    for (var oi = 0; oi < thrownObjects.length; oi++) {
      var obj = thrownObjects[oi];
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
            obj.stickDelay = minDelay + Math.random() * (maxDelay - minDelay);
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
            var occupiedStickPoints = [];
            for (var oj = 0; oj < thrownObjects.length; oj++) {
              var otherObj = thrownObjects[oj];
              if (otherObj === obj || !otherObj.particle) continue;
              if (otherObj.state !== 'stuck' && otherObj.state !== 'sticking') continue;
              occupiedStickPoints.push({
                x: otherObj.particle.pos.x,
                y: otherObj.particle.pos.y,
                r: otherObj.def ? otherObj.def.r : 0
              });
            }
            var chosen = chooseStickCandidate(
              obj.hitHistory,
              spiderweb,
              P.stickMidBias,
              occupiedStickPoints,
              (obj.def ? obj.def.r : 0) + 10
            );
            if (chosen) {
              var cdx = chosen.x - p.pos.x, cdy = chosen.y - p.pos.y;
              var maxStickDist = P.stickCatchRadius * 1.35;
              if (cdx * cdx + cdy * cdy <= maxStickDist * maxStickDist) {
                obj.stickToPoint(chosen, spiderweb);
              } else {
                obj.enteredWebZone = false;
                obj.penetrationDist = 0;
                obj.hitHistory = [];
              }
            }
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
        obj.stickT = Math.min(1, obj.stickT + 0.06);
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
            obj.state = 'wrapped';
            obj._popT = 0;
            obj.particle._noSimDrag = true;
          } else {
            obj.state = 'stuck'; obj.stayTimer = 0;
            if (obj.kind === 'boulder') obj.wobbleAmp = 0.10 * _ws;
            if (obj.kind === 'bug') obj.wobbleAmp = 0.28 * _ws;
          }
        }

      } else if (obj.state === 'stuck') {
        if (_pickupDrag && _pickupDrag.obj === obj) {
          var sTargetGripX = _pickupDrag.pointerX - _pickupDrag.gripDX;
          var sTargetGripY = _pickupDrag.pointerY - _pickupDrag.gripDY;
          var sPullDx = sTargetGripX - p.pos.x;
          var sPullDy = sTargetGripY - p.pos.y;
          var sAppliedForce = Math.sqrt(sPullDx * sPullDx + sPullDy * sPullDy) * PICKUP_PULL_STRENGTH / Math.max(1, obj.def.r);
          var sForceThresh = obj.kind === 'boulder' ? STUCK_FORCE_THRESHOLD_BOULDER : STUCK_FORCE_THRESHOLD_BUG;
          p.pos.x += sPullDx * PICKUP_PULL_STRENGTH;
          p.pos.y += sPullDy * PICKUP_PULL_STRENGTH;
          obj._pickupPullAngle = Math.atan2(sPullDy, sPullDx);
          var sTensionA = 0, sTensionB = 0;
          if (obj.cA) { var sAnchorA = obj.cA.a === p ? obj.cA.b : obj.cA.a; sTensionA = Math.max(0, p.pos.dist(sAnchorA.pos) / Math.max(1, obj.cA.distance) - 1); }
          if (obj.cB) { var sAnchorB = obj.cB.a === p ? obj.cB.b : obj.cB.a; sTensionB = Math.max(0, p.pos.dist(sAnchorB.pos) / Math.max(1, obj.cB.distance) - 1); }
          var sTension = sTensionA + sTensionB;
          obj._pickupTension = sTension;
          obj._pickupCharge = Math.min(1, sTension / Math.max(0.001, STUCK_PLUCK_THRESHOLD));
          if (sAppliedForce >= sForceThresh) {
            if (sTension >= STUCK_BREAK_THRESHOLD) {
              _pickupDrag = null;
              sim.draggedEntity = null;
              obj._pickupTension = 0; obj._pickupCharge = 0;
              obj.state = 'freeing'; obj.freeTimer = 0;
              continue;
            } else if (sTension >= STUCK_PLUCK_THRESHOLD) {
              _pickupDrag = null;
              sim.draggedEntity = null;
              beginPlucking(obj);
              continue;
            }
          }
        } else {
          obj._pickupTension = Math.max(0, (obj._pickupTension || 0) * 0.82 - 0.01);
          obj._pickupCharge = Math.max(0, (obj._pickupCharge || 0) - PICKUP_TENSION_RELEASE_RATE);
        }
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
            var _wm = obj._stickIsRadial ? P.radialWobbleScale : P.spiralWobbleScale;
            var wobbleMax = (obj.kind === 'boulder' ? 12.0 : obj.kind === 'bug' ? 9.0 : 1.5) * _wm;
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
          obj.state = 'wrapped';
          obj._popT = 0;
          audioEngine.playCollectSound(obj.kind);
        }

      } else if (obj.state === 'wrapped') {
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
          if (obj._pickupTension >= PICKUP_TENSION_THRESHOLD && appliedPullForce >= _getPickupForceThreshold(obj)) {
            beginPlucking(obj);
            continue;
          }
        } else {
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
          audioEngine.playCollectSound(obj.kind);
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
          var holdT = 1 - obj.collectPause / 10;
          drawX += Math.sin(obj.collectFlash * 0.9) * 1.6;
          drawY += Math.cos(obj.collectFlash * 0.8) * 1.0;
          scale = obj._collectStartScale + (Math.max(1.08, obj._collectStartScale * 1.08) - obj._collectStartScale) * holdT;
          opacity = 0.9 + Math.sin(holdT * Math.PI) * 0.1;
        } else {
          obj.travelT = Math.min(1, obj.travelT + 1 / obj.collectDur);
          var easeIn = 1 - Math.pow(1 - obj.travelT, 3);
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
  var _logicalTimeMs = 0;
  var _adaptIter = 16;
  var loop = function (timestamp) {
    /* ── 时间差：计算帧缩放比，用于游戏逻辑速度补偿 ── */
    var delta = _lastTimestamp ? Math.min(timestamp - _lastTimestamp, 50) : 16.67;
    _lastTimestamp = timestamp;
    _logicalTimeMs += delta;
    /* timeScale: 60fps=1.0, 30fps=2.0, 120fps=0.5 — 让游戏逻辑速度与帧率解耦 */
    var timeScale = delta / 16.67;
    var targetIter = delta <= 20 ? 16 : delta <= 33 ? 12 : 8;
    _adaptIter = _adaptIter > targetIter ? _adaptIter - 1 : targetIter;

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
        _locomotionState = 'ACTIVE';
        for (var sfi2 = 0; sfi2 < footState.length; sfi2++) footState[sfi2].cooldown = sfi2 * 5;
        triggerStep(0, null, footState, spiderweb, spider, samplePoints, null, STEP_COOLDOWN);
        triggerStep(2, null, footState, spiderweb, spider, samplePoints, null, STEP_COOLDOWN);
        setTimeout(function () {
          if (footState) {
            triggerStep(1, null, footState, spiderweb, spider, samplePoints, null, STEP_COOLDOWN);
            triggerStep(3, null, footState, spiderweb, spider, samplePoints, null, STEP_COOLDOWN);
          }
        }, 180);
      }
    }

    /* AI locomotion — runs only when no player target is active */
    if (!wrappingTarget && !_spawnAnim.active && spider) {
      var _aiResult = _spiderAI.update(spider, spiderweb, thrownObjects, _aiPlayerInputThisFrame);
      if (_aiResult && !target) {
        target = _snapPointToWeb(_aiResult.x, _aiResult.y) || _aiResult;
        _aiOwnsTarget = true;
      }
      if (!target) _aiOwnsTarget = false;
      blinkState.mood = _spiderAI.mood;
      if (_spiderAI.mood === 'startled' && blinkState.headShake === 0) {
        blinkState.headShake = 18;
        blinkState.headShakeAmp = 3.5;
      }
    }
    if (_aiPlayerInputThisFrame) _aiOwnsTarget = false;
    _aiPlayerInputThisFrame = false;

    /* body movement */
    var isWrapping = (wrappingTarget !== null);
    var moving = false; moveDir = null;
    if (isWrapping) {
      target = null;
    } else if (target) {
      _locomotionState = 'ACTIVE';
      var tx = spider.thorax.pos;
      var desiredDx = target.x - tx.x, desiredDy = target.y - tx.y;
      var desiredDist = Math.sqrt(desiredDx * desiredDx + desiredDy * desiredDy);
      var desiredDir = desiredDist > 0.001 ? new Vec2(desiredDx / desiredDist, desiredDy / desiredDist) : null;
      var moveAnchor = _snapPointToWeb(target.x, target.y, tx, _aiOwnsTarget ? 28 : 42, desiredDir);
      if (!moveAnchor) {
        target = null;
      } else {
        var dx = moveAnchor.x - tx.x, dy = moveAnchor.y - tx.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > arriveThreshold) {
        moving = true;
        var scaledSpeed = (_aiOwnsTarget ? 0.6 : moveSpeed) * timeScale;
        var nx = (dx / dist) * scaledSpeed, ny = (dy / dist) * scaledSpeed;
        moveDir = new Vec2(dx / dist, dy / dist);
        for (var p = 0; p < spider.particles.length; p++) {
          spider.particles[p].pos.x += nx; spider.particles[p].pos.y += ny;
          spider.particles[p].lastPos.x += nx; spider.particles[p].lastPos.y += ny;
        }
      } else target = null;
      }
    }

    if (_locomotionState === 'IDLE_LOCKED' && _shouldUnlockIdle()) {
      _locomotionState = 'ACTIVE';
    }

    /* 断网红闪帧计数 */
    _breakFrame++;
    if (webBreakFlashes.length > 0) {
      for (var _wfi = webBreakFlashes.length - 1; _wfi >= 0; _wfi--) {
        if (_breakFrame - webBreakFlashes[_wfi].t >= 20) webBreakFlashes.splice(_wfi, 1);
      }
    }

    /* wave system */
    updateLevelTimer();
    updateLevelSpawner();
    checkWebIntegrity();

    /* thrown objects */
    tryCollectObjects();
    updateThrownObjects();
    if (pendingLevelCheck) { pendingLevelCheck = false; checkLevelComplete(); }

    updateBlink();
    sim.frame(_adaptIter);

    /* ── 物理帧结束后，用最新网形态刷新采样点再做步态决策 ── */
    updateSamplePoints(samplePoints);

    /* feet */
    var swingCount = 0;
    for (var _si = 0; _si < footState.length; _si++) if (footState[_si].stepping) swingCount++;
    var maxSwing = target ? 2 : 1;
    var _curStepSpeed = _aiOwnsTarget ? 0.06 : STEP_SPEED;
    var _segMaxJump2 = 36 * 36;
    for (var fi = 0; fi < footState.length; fi++) {
      var fs = footState[fi];
      if (fs.cooldown > 0) fs.cooldown--;
      if (fs.holdFrames > 0) fs.holdFrames--;
      if (!fs.stepping && _locomotionState !== 'IDLE_LOCKED' && !_spawnAnim.active) {
        var phaseRate = target ? 0.18 : 0.08;
        fs.phase = Math.min(1.4, (fs.phase || 0) + phaseRate * timeScale);
      }
      if (fs.stepping) {
        fs.t = Math.min(1, fs.t + _curStepSpeed);
        var ease = fs.t < 0.5 ? 2 * fs.t * fs.t : -1 + (4 - 2 * fs.t) * fs.t;
        fs.current.x = fs.from.x + (fs.targetPos.x - fs.from.x) * ease;
        fs.current.y = fs.from.y + (fs.targetPos.y - fs.from.y) * ease;
        fs.particle.pos.mutableSet(fs.current); fs.particle.lastPos.mutableSet(fs.current);
        if (fs.t >= 1) {
          fs.current.x = fs.targetPos.x; fs.current.y = fs.targetPos.y;
          fs.particle.pos.mutableSet(fs.current); fs.particle.lastPos.mutableSet(fs.current);
          fs.stepping = false;
          landFoot(fs, spider, spiderweb, footState);
        }
      } else {
        if (fs.landedNode) {
          fs.current.x = fs.landedNode.pos.x;
          fs.current.y = fs.landedNode.pos.y;
        } else if (fs.landedSeg) {
          var sp = fs.landedSeg;
          var newSegX = sp.pa.pos.x + (sp.pb.pos.x - sp.pa.pos.x) * sp.t;
          var newSegY = sp.pa.pos.y + (sp.pb.pos.y - sp.pa.pos.y) * sp.t;
          var jdx = newSegX - fs.current.x, jdy = newSegY - fs.current.y;
          if (jdx * jdx + jdy * jdy > _segMaxJump2) {
            fs.current.x += jdx * 0.35;
            fs.current.y += jdy * 0.35;
          } else {
            fs.current.x = newSegX;
            fs.current.y = newSegY;
          }
        }
        if (fs.landedNode || fs.landedSeg) { fs.particle.pos.mutableSet(fs.current); fs.particle.lastPos.mutableSet(fs.current); }
        var drift2 = fs.current.dist2(spider.thorax.pos);
        var partner = footState[fi % 2 === 0 ? fi + 1 : fi - 1];
        var ps = partner && partner.stepping;
        if (!ps && swingCount < maxSwing && !_spawnAnim.active && fs.holdFrames <= 0 && _locomotionState !== 'IDLE_LOCKED') {
          var _stepThresh = _aiOwnsTarget ? 9  : STEP_THRESH;
          var _restThresh = _aiOwnsTarget ? 64 : REST_THRESH;
          var _maxStepR   = _aiOwnsTarget ? 24 : undefined;
          var movingNeedStep = target && drift2 > _stepThresh * _stepThresh;
          var idleNeedStep = !target && drift2 > _restThresh * _restThresh;
          var needStep = movingNeedStep || idleNeedStep;
          if (needStep) {
            var emergencyStep = drift2 > (target ? _stepThresh * _stepThresh * 1.8 : _restThresh * _restThresh * 1.35);
            var phaseOk = _isPhaseEligible(fi, fs, !!target, swingCount, emergencyStep);
            if (phaseOk) {
              if (movingNeedStep) triggerStep(fi, moveDir, footState, spiderweb, spider, samplePoints, moveDir, STEP_COOLDOWN, _maxStepR);
              else triggerStep(fi, null, footState, spiderweb, spider, samplePoints, moveDir, STEP_COOLDOWN, Math.max(18, _restThresh - 6), true);
              if (fs.stepping) {
                fs.phase = 0;
                _gaitCursor = (_gaitCursor + 1) % _gaitOrderIdle.length;
                swingCount++;
              }
            }
          }
        }
      }
    }

    if (_locomotionState !== 'IDLE_LOCKED' && _shouldLockIdle()) {
      _locomotionState = 'IDLE_LOCKED';
      _lockedTopologyVersion = spiderweb._topologyVersion || 0;
    }

    sim.draw();
    _drawTargetMarker(sim.ctx);
    drawThrownObjects(sim.ctx, thrownObjects);
    if (spider && spider.drawConstraints) spider.drawConstraints(sim.ctx, spider);
    requestAnimFrame(loop);
  };
  requestAnimFrame(loop);
};
