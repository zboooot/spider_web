import { Vec2 } from '../engine/Vec2.js';

/**
 * Spider AI — autonomous locomotion state machine
 *
 * States:
 *   WANDER   — pick a random web node and walk toward it
 *   PAUSE    — sit still for a short while, twitch occasionally
 *   EXPLORE  — slowly drift to the web edge or center
 *   STARTLED — brief reactive freeze + fast dash when an object lands nearby
 *
 * Usage:
 *   const ai = createSpiderAI();
 *   // each frame:
 *   const aiTarget = ai.update(spider, spiderweb, thrownObjects, playerHasInput);
 *   // aiTarget is Vec2 | null  (null = stay put)
 */

export function createSpiderAI() {

  /* ── internal state ── */
  var _state       = 'WANDER';
  var _stateTimer  = 240;        // frames remaining in current state
  var _aiTarget    = null;       // Vec2 current navigation target
  var _lastInput   = 9999;       // frames since last player click
  var _idleFrames  = 0;          // frames without player input
  var _startledCooldown = 0;

  /* tuning */
  var IDLE_BEFORE_AI   = 180;    // wait 3 s after last input before AI wakes
  var WANDER_DUR_MIN   = 180;
  var WANDER_DUR_MAX   = 420;
  var PAUSE_DUR_MIN    = 90;
  var PAUSE_DUR_MAX    = 300;
  var EXPLORE_DUR_MIN  = 240;
  var EXPLORE_DUR_MAX  = 480;
  var STARTLED_DUR     = 90;
  var STARTLED_RANGE   = 180;    // px — object landing within this range triggers startled
  var IDLE_WALK_MIN    = 48;     // idle session: short walk burst (~0.8s)
  var IDLE_WALK_MAX    = 138;    // idle session: up to ~2.3s
  var IDLE_PAUSE_MIN   = 34;     // idle session: brief stop (~0.55s)
  var IDLE_PAUSE_MAX   = 126;    // idle session: up to ~2.1s
  var IDLE_ARRIVE_R    = 22;     // px — treat as arrived for a short idle step

  /* mood output — read by main.js to drive blinkState */
  var mood = 'calm';   // 'calm' | 'curious' | 'startled' | 'happy'

  /* ── helpers ── */
  function rnd(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }

  function pickRandomNode(spiderweb) {
    var pts = spiderweb.particles;
    if (!pts || pts.length === 0) return null;
    /* prefer mid-ring particles (not the very outer edge pinned ones) */
    var tries = 0, p;
    do {
      p = pts[Math.floor(Math.random() * pts.length)];
      tries++;
    } while (tries < 12 && p.pinned);
    return new Vec2(p.pos.x, p.pos.y);
  }

  function pickEdgeOrCenterNode(spiderweb, towardCenter) {
    var pts = spiderweb.particles;
    if (!pts || pts.length === 0) return null;
    /* find centroid */
    var cx = 0, cy = 0;
    for (var i = 0; i < pts.length; i++) { cx += pts[i].pos.x; cy += pts[i].pos.y; }
    cx /= pts.length; cy /= pts.length;

    var best = null, bestScore = -Infinity;
    for (var j = 0; j < pts.length; j++) {
      var p = pts[j];
      if (p.pinned) continue;
      var dx = p.pos.x - cx, dy = p.pos.y - cy;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var score = towardCenter ? -dist : dist;
      score += (Math.random() - 0.5) * 40; // jitter
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return best ? new Vec2(best.pos.x, best.pos.y) : pickRandomNode(spiderweb);
  }

  function pickIdleWalkTarget(spiderweb, spider) {
    if (!spider || !spider.thorax) return pickRandomNode(spiderweb);
    var tx = spider.thorax.pos.x, ty = spider.thorax.pos.y;
    var pts = spiderweb.particles;
    if (!pts || !pts.length) return pickRandomNode(spiderweb);
    var pool = [];
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (p.pinned) continue;
      var dx = p.pos.x - tx, dy = p.pos.y - ty;
      var d2 = dx * dx + dy * dy;
      if (d2 < 28 * 28 || d2 > 150 * 150) continue;
      pool.push(p);
    }
    if (!pool.length) return pickRandomNode(spiderweb);
    var pick = pool[Math.floor(Math.random() * pool.length)];
    return new Vec2(pick.pos.x, pick.pos.y);
  }

  function enterIdleWalk(spiderweb, spider) {
    _state = 'WANDER';
    _stateTimer = rnd(IDLE_WALK_MIN, IDLE_WALK_MAX);
    _aiTarget = pickIdleWalkTarget(spiderweb, spider);
    mood = Math.random() < 0.22 ? 'curious' : 'calm';
  }

  function enterIdlePause() {
    _state = 'PAUSE';
    _stateTimer = rnd(IDLE_PAUSE_MIN, IDLE_PAUSE_MAX);
    _aiTarget = null;
    mood = 'calm';
  }

  function pickAwayFrom(spiderweb, fromX, fromY) {
    var pts = spiderweb.particles;
    if (!pts || pts.length === 0) return null;
    var best = null, bestDist = -1;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (p.pinned) continue;
      var dx = p.pos.x - fromX, dy = p.pos.y - fromY;
      var d = dx * dx + dy * dy;
      d += (Math.random() - 0.5) * 3000;
      if (d > bestDist) { bestDist = d; best = p; }
    }
    return best ? new Vec2(best.pos.x, best.pos.y) : null;
  }

  function enterState(newState, spiderweb) {
    _state = newState;
    if (newState === 'WANDER') {
      _stateTimer = rnd(WANDER_DUR_MIN, WANDER_DUR_MAX);
      _aiTarget   = pickRandomNode(spiderweb);
      mood = Math.random() < 0.3 ? 'curious' : 'calm';
    } else if (newState === 'PAUSE') {
      _stateTimer = rnd(PAUSE_DUR_MIN, PAUSE_DUR_MAX);
      _aiTarget   = null;
      mood = 'calm';
    } else if (newState === 'EXPLORE') {
      _stateTimer = rnd(EXPLORE_DUR_MIN, EXPLORE_DUR_MAX);
      var toCenter = Math.random() < 0.5;
      _aiTarget   = pickEdgeOrCenterNode(spiderweb, toCenter);
      mood = 'curious';
    } else if (newState === 'STARTLED') {
      _stateTimer = STARTLED_DUR;
      _aiTarget   = null;  // freeze first half, then flee
      mood = 'startled';
      _startledCooldown = 240;
    }
  }

  function nextRandomState(spiderweb, idleMode, spider) {
    var r = Math.random();
    if (idleMode) {
      if (_state === 'PAUSE') enterIdleWalk(spiderweb, spider);
      else enterIdlePause();
      return;
    }
    if      (r < 0.55) enterState('WANDER',  spiderweb);
    else if (r < 0.72) enterState('PAUSE',   spiderweb);
    else               enterState('EXPLORE', spiderweb);
  }

  /* ── public API ── */
  var api = {

    mood: 'calm',

    /**
     * Call once per frame from main loop.
     * @param {object} spider        — spider composite (spider.thorax.pos)
     * @param {object} spiderweb     — web composite
     * @param {Array}  thrownObjects — active objects on web
     * @param {boolean} playerHasInput — true if player just clicked this frame
     * @param {object} [opts]
     * @param {boolean} [opts.idleMode] — game idle wander: skip input gate, activate immediately
     * @returns {Vec2|null}  target position, or null to stay still
     */
    update: function (spider, spiderweb, thrownObjects, playerHasInput, opts) {
      opts = opts || {};
      var idleMode = !!opts.idleMode;

      /* ── track player input ── */
      if (playerHasInput && !idleMode) {
        _lastInput  = 0;
        _idleFrames = 0;
        /* player took over — reset AI to pause so it doesn't fight */
        _state      = 'PAUSE';
        _stateTimer = rnd(PAUSE_DUR_MIN, PAUSE_DUR_MAX);
        _aiTarget   = null;
        mood = 'calm';
        api.mood = mood;
        return null;
      }
      _lastInput++;
      _idleFrames++;

      /* don't activate until player has been idle long enough */
      if (!idleMode && _idleFrames < IDLE_BEFORE_AI) {
        api.mood = 'calm';
        return null;
      }

      /* ── startled detection ── */
      if (_startledCooldown > 0) _startledCooldown--;
      if (_state !== 'STARTLED' && _startledCooldown === 0 && thrownObjects) {
        var tx = spider.thorax.pos.x, ty = spider.thorax.pos.y;
        for (var oi = 0; oi < thrownObjects.length; oi++) {
          var obj = thrownObjects[oi];
          if (obj.state === 'stuck' && obj.stayTimer >= 1 && obj.stayTimer <= 3) {
            var ox = obj.particle ? obj.particle.pos.x : 0;
            var oy = obj.particle ? obj.particle.pos.y : 0;
            var ddx = ox - tx, ddy = oy - ty;
            if (ddx * ddx + ddy * ddy < STARTLED_RANGE * STARTLED_RANGE) {
              enterState('STARTLED', spiderweb);
              break;
            }
          }
        }
      }

      /* ── state machine tick ── */
      _stateTimer--;

      if (_state === 'STARTLED') {
        if (_stateTimer <= 0) {
          /* flee away from the last threat */
          var fleePt = null;
          if (thrownObjects && thrownObjects.length > 0) {
            var nearestObj = thrownObjects[0];
            var nearestD2  = Infinity;
            for (var ni = 0; ni < thrownObjects.length; ni++) {
              var no = thrownObjects[ni];
              if (!no.particle) continue;
              var ndx = no.particle.pos.x - spider.thorax.pos.x;
              var ndy = no.particle.pos.y - spider.thorax.pos.y;
              var nd2 = ndx * ndx + ndy * ndy;
              if (nd2 < nearestD2) { nearestD2 = nd2; nearestObj = no; }
            }
            if (nearestObj && nearestObj.particle) {
              fleePt = pickAwayFrom(spiderweb, nearestObj.particle.pos.x, nearestObj.particle.pos.y);
            }
          }
          _state = 'WANDER';
          _stateTimer = rnd(120, 220);
          _aiTarget   = fleePt || pickRandomNode(spiderweb);
          mood = 'calm';
        }
        /* during startled freeze, output null (don't move) */
        api.mood = mood;
        return null;
      }

      if (_state === 'WANDER') {
        /* if we've arrived near the target, pick a new one or transition */
        if (_aiTarget && spider.thorax) {
          var dx2 = _aiTarget.x - spider.thorax.pos.x;
          var dy2 = _aiTarget.y - spider.thorax.pos.y;
          var arriveR = idleMode ? IDLE_ARRIVE_R : 30;
          var arrived = (dx2 * dx2 + dy2 * dy2) < arriveR * arriveR;
          if (arrived || _stateTimer <= 0) {
            nextRandomState(spiderweb, idleMode, spider);
          }
        } else if (_stateTimer <= 0) {
          nextRandomState(spiderweb, idleMode, spider);
        }
      } else if (_state === 'EXPLORE') {
        if (_aiTarget && spider.thorax) {
          var ex = _aiTarget.x - spider.thorax.pos.x;
          var ey = _aiTarget.y - spider.thorax.pos.y;
          var earrived = (ex * ex + ey * ey) < 40 * 40;
          if (earrived || _stateTimer <= 0) {
            nextRandomState(spiderweb, idleMode, spider);
          }
        } else if (_stateTimer <= 0) {
          nextRandomState(spiderweb, idleMode, spider);
        }
      } else if (_state === 'PAUSE') {
        if (_stateTimer <= 0) {
          nextRandomState(spiderweb, idleMode, spider);
        }
        /* occasional mid-pause curiosity twitch: briefly look at a nearby spot */
        if (!idleMode && _stateTimer > 0 && _stateTimer % rnd(60, 90) === 0) {
          mood = Math.random() < 0.4 ? 'curious' : 'calm';
        }
        api.mood = mood;
        return null;   // stay still during pause
      }

      api.mood = mood;
      return _aiTarget;
    },

    /* allow main.js to read current state name for debug / HUD */
    getState: function () { return _state; },

    /** True when idle wander session is in a stationary beat. */
    isIdlePaused: function () { return _state === 'PAUSE'; },

    /** Reset state machine (e.g. on level start). */
    reset: function (spiderweb, spider) {
      _state = 'PAUSE';
      _stateTimer = rnd(IDLE_PAUSE_MIN, IDLE_PAUSE_MAX);
      _aiTarget = null;
      _lastInput = 9999;
      _idleFrames = IDLE_BEFORE_AI;
      _startledCooldown = 0;
      mood = 'calm';
      api.mood = mood;
    }
  };

  return api;
}
