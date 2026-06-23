/**
 * 独立教学关状态机 — 与关卡波次生成器解耦
 */

export var TUTORIAL_TARGETS = { boulder: 2, bug: 0, drop: 0 };
var FPS = 60;
var INTRO_DELAY_FRAMES = 3 * FPS;
var REPAIR_SHOCK_FRAMES = Math.round(1.5 * FPS);
var REPAIR_CRY_FRAMES = Math.round(2.5 * FPS);
var HANDOFF_BLACKOUT_FRAMES = 90;

var PHASE = {
  IDLE: 'idle',
  INTRO_WAIT: 'intro_wait',
  BREAKERS: 'breakers',
  WAIT_REPAIR_SHOCK: 'wait_repair_shock',
  WAIT_REPAIR_CRY: 'wait_repair_cry',
  WAIT_REPAIR_DRAG: 'wait_repair_drag',
  WAIT_REPAIR_DROP: 'wait_repair_drop',
  WAIT_REPAIR_FINISH: 'wait_repair_finish',
  WAVE_ONE: 'wave_one',
  WAIT_COLLECT_ONE: 'wait_collect_one',
  WAIT_COLLECT_ONE_DRAG: 'wait_collect_one_drag',
  WAVE_TWO: 'wave_two',
  WAIT_COLLECT_TWO: 'wait_collect_two',
  WAIT_COLLECT_TWO_DRAG: 'wait_collect_two_drag',
  WAIT_HANDOFF_TAP: 'wait_handoff_tap',
  WAIT_HANDOFF_BLACKOUT: 'wait_handoff_blackout',
  DONE: 'done'
};

export function shouldStartTutorial(searchParams, completedFlag) {
  if (searchParams && searchParams.tutorial === '1') return true;
  if (searchParams && searchParams.skipTutorial === '1') return false;
  return completedFlag !== '1';
}

export function isTutorialInsectKind(kind) {
  return kind === 'boulder' || kind === 'bug';
}

export var TUTORIAL_STONE_RADIUS = 63;

/** 石头圆盘是否与蛛网圆盘相交（用于判定“进入网区”，非物理碰撞） */
export function stoneOverlapsWebAt(x, y, stoneR, webCx, webCy, webRad) {
  var dx = x - webCx, dy = y - webCy;
  var reach = webRad + stoneR;
  return dx * dx + dy * dy <= reach * reach;
}

export var TUTORIAL_STONE_PULL_FRAMES = 6;

/** 石头底沿是否进入蛛网上缘线程带 */
export function stoneCrossesWebTopBand(prevY, nextY, stoneR, webCy, webRad) {
  var webTop = webCy - webRad * 0.88;
  return (prevY + stoneR) < webTop && (nextY + stoneR) >= webTop;
}

/**
 * 判定是否应启动教学石头的拉扯破网（比单纯圆盘重叠更可靠）
 */
export function shouldTriggerTutorialStoneImpact(prevX, prevY, nextX, nextY, stoneR, webCx, webCy, webRad) {
  var enteredDisc = stoneOverlapsWebAt(nextX, nextY, stoneR, webCx, webCy, webRad)
    && !stoneOverlapsWebAt(prevX, prevY, stoneR, webCx, webCy, webRad);
  if (enteredDisc) return true;

  if (!stoneCrossesWebTopBand(prevY, nextY, stoneR, webCy, webRad)) return false;
  var dx = Math.abs(nextX - webCx);
  return dx <= webRad * 0.55 + stoneR * 0.35;
}

/**
 * 将石头落点映射为蛛网上一个稳定的破洞锚点。
 * 破洞固定在蛛网上半部，不跟随石头继续下坠。
 */
export function resolveTutorialStoneImpactPoint(x, y, webCx, webCy, webRad) {
  var dx = x - webCx;
  var dy = y - webCy;
  var len = Math.sqrt(dx * dx + dy * dy) || 1;
  var nx = dx / len;
  var ny = dy / len;
  /* 破洞需要沿石头的横向位置分布，并整体略偏下。 */
  if (nx < -0.32) nx = -0.32;
  if (nx > 0.32) nx = 0.32;
  if (ny < 0.10) ny = 0.10;
  if (ny > 0.22) ny = 0.22;
  var norm = Math.sqrt(nx * nx + ny * ny) || 1;
  nx /= norm;
  ny /= norm;
  var anchorDist = webRad * 0.36;
  return {
    x: webCx + nx * anchorDist,
    y: webCy + ny * anchorDist
  };
}

export function createTutorialStoneImpact(x, y, r) {
  return { x: x, y: y, r: r, phase: 'pull', timer: 0, anchorX: x, anchorY: y };
}

export function tickTutorialStoneImpact(impact, dt) {
  if (!impact || impact.phase === 'done') {
    return { impact: impact, shouldBreak: false };
  }
  impact.timer += dt || 1;
  if (impact.phase === 'pull' && impact.timer >= TUTORIAL_STONE_PULL_FRAMES) {
    impact.phase = 'done';
    return { impact: impact, shouldBreak: true };
  }
  return { impact: impact, shouldBreak: false };
}

/**
 * 将网粒子朝石头中心拉扯，制造可见张力（Verlet 安全）
 */
export function applyWebPullTowardPoint(particles, cx, cy, pullR, progress, dt) {
  if (!particles || !(pullR > 0)) return 0;
  var strength = (0.06 + 0.34 * Math.min(1, progress)) * (dt || 1);
  var pullR2 = pullR * pullR;
  var moved = 0;
  for (var i = 0; i < particles.length; i++) {
    var pt = particles[i];
    if (!pt || !pt.pos) continue;
    var dx = cx - pt.pos.x, dy = cy - pt.pos.y;
    var d2 = dx * dx + dy * dy;
    if (d2 > pullR2 || d2 < 0.5) continue;
    var d = Math.sqrt(d2);
    var falloff = 1 - d / pullR;
    var pull = strength * falloff * falloff;
    var nx = dx / d, ny = dy / d;
    pt.pos.x += nx * pull;
    pt.pos.y += ny * pull;
    if (pt.lastPos) {
      pt.lastPos.x -= nx * pull * 0.42;
      pt.lastPos.y -= ny * pull * 0.42;
    }
    moved++;
  }
  return moved;
}

export function applyWebImpactKick(particles, cx, cy, kickR, strength) {
  if (!particles || !(kickR > 0) || !(strength > 0)) return 0;
  var kickR2 = kickR * kickR;
  var moved = 0;
  for (var i = 0; i < particles.length; i++) {
    var pt = particles[i];
    if (!pt || !pt.pos) continue;
    var dx = pt.pos.x - cx;
    var dy = pt.pos.y - cy;
    var d2 = dx * dx + dy * dy;
    if (d2 > kickR2 || d2 < 0.5) continue;
    var d = Math.sqrt(d2);
    var nx = dx / d;
    var ny = dy / d;
    var falloff = 1 - d / kickR;
    var kick = strength * falloff * falloff;
    pt.pos.x += nx * kick;
    pt.pos.y += ny * kick;
    if (pt.lastPos) {
      pt.lastPos.x -= nx * kick * 0.55;
      pt.lastPos.y -= ny * kick * 0.55;
    }
    moved++;
  }
  return moved;
}

export function buildBreakersBatch(W, H, cx, cy) {
  return [
    {
      kind: 'stone',
      x: cx - W * 0.12,
      y: -TUTORIAL_STONE_RADIUS * 0.45,
      vx: 0,
      vy: 6.2,
      defOverrides: { r: TUTORIAL_STONE_RADIUS },
      delayFrames: 0,
      breakScale: 1.18,
      forcedStubCount: 2,
      _tutorialTag: 'breaker'
    },
    {
      kind: 'stone',
      x: cx + W * 0.1,
      y: -(TUTORIAL_STONE_RADIUS * 0.5) * 0.45,
      vx: 0,
      vy: 6.0,
      defOverrides: { r: TUTORIAL_STONE_RADIUS * 0.5 * 1.3 },
      delayFrames: Math.round(0.5 * FPS),
      breakScale: 1.003,
      forcedStubCount: 1,
      _tutorialTag: 'breaker'
    },
    {
      kind: 'stone',
      x: cx + W * 0.32,
      y: -(TUTORIAL_STONE_RADIUS * 0.4) * 0.45,
      vx: 0,
      vy: 5.8,
      defOverrides: { r: TUTORIAL_STONE_RADIUS * 0.4 * 1.3 * 1.4 },
      delayFrames: Math.round(0.75 * FPS),
      breakScale: 1.003,
      forcedStubCount: 1,
      _tutorialTag: 'breaker'
    }
  ];
}

export function buildDemoWave(W, H, cx, cy, waveIndex) {
  return [
    {
      kind: 'drop',
      x: cx - 64,
      y: -18,
      vx: 0.18,
      vy: 1.3,
      _tutorialTag: 'prey'
    },
    {
      kind: 'drop',
      x: cx + 52,
      y: -14,
      vx: -0.12,
      vy: 1.15,
      _tutorialTag: 'prey'
    },
    {
      kind: 'boulder',
      x: cx + (waveIndex === 1 ? -12 : 18),
      y: -6,
      vx: (waveIndex === 1 ? 0.4 : -0.3),
      vy: 2.4,
      defOverrides: { stayFrames: 420 },
      _tutorialTag: 'prey'
    }
  ];
}

export function createTutorialController(W, H, cx, cy) {
  var phase = PHASE.IDLE;
  var frame = 0;
  var actions = [];
  var insectTarget = TUTORIAL_TARGETS.boulder;
  var collected = 0;
  var repairDragDone = false;
  var waveDropCleared = 0;
  var waveWrappedReady = false;

  function pushAction(type, payload) {
    var action = { type: type };
    if (payload) {
      Object.keys(payload).forEach(function (key) {
        action[key] = payload[key];
      });
    }
    actions.push(action);
  }

  function showMessage(text) {
    pushAction('show_message', { text: text });
  }

  function resetWaveReadiness() {
    waveDropCleared = 0;
    waveWrappedReady = false;
  }

  function maybePromptCollect() {
    if (waveDropCleared < 2 || !waveWrappedReady) return;
    if (phase === PHASE.WAVE_ONE) {
      phase = PHASE.WAIT_COLLECT_ONE;
      pushAction('show_focus_prompt', { text: '拖拽摘走你的猎物', target: 'prey' });
      showMessage('拖拽摘走你的猎物');
      return;
    }
    if (phase === PHASE.WAVE_TWO) {
      phase = PHASE.WAIT_COLLECT_TWO;
      pushAction('show_focus_prompt', { text: '拖拽摘走你的猎物', target: 'prey' });
      showMessage('拖拽摘走你的猎物');
    }
  }

  return {
    start: function () {
      phase = PHASE.INTRO_WAIT;
      frame = 0;
      collected = 0;
      repairDragDone = false;
      insectTarget = TUTORIAL_TARGETS.boulder;
      resetWaveReadiness();
      actions = [];
      showMessage('教学关：观察蛛网，稍后会有石头砸破网线并穿过去。');
    },

    tick: function (dt) {
      if (phase === PHASE.IDLE || phase === PHASE.DONE) return;
      frame += dt || 1;
      if (phase === PHASE.INTRO_WAIT && frame >= INTRO_DELAY_FRAMES) {
        phase = PHASE.BREAKERS;
        pushAction('spawn_batch', { batch: buildBreakersBatch(W, H, cx, cy), label: 'breakers' });
        showMessage('石头正在砸向蛛网。');
        return;
      }
      if (phase === PHASE.WAIT_REPAIR_SHOCK && frame >= REPAIR_SHOCK_FRAMES) {
        phase = PHASE.WAIT_REPAIR_CRY;
        frame = 0;
        pushAction('set_spider_mood', { mood: 'crying' });
        return;
      }
      if (phase === PHASE.WAIT_REPAIR_CRY && frame >= REPAIR_CRY_FRAMES) {
        phase = PHASE.WAIT_REPAIR_DRAG;
        pushAction('show_focus_prompt', { text: '拖拽连网修复', target: 'stub', showHint: true });
        return;
      }
      if (phase === PHASE.WAIT_HANDOFF_BLACKOUT && frame >= HANDOFF_BLACKOUT_FRAMES) {
        phase = PHASE.DONE;
        pushAction('mark_completed');
        pushAction('handoff_to_level_1');
      }
    },

    handleEvent: function (name, data) {
      data = data || {};
      if (phase === PHASE.IDLE || phase === PHASE.DONE) return;

      if (name === 'stub_available' && (phase === PHASE.BREAKERS || phase === PHASE.INTRO_WAIT)) {
        phase = PHASE.WAIT_REPAIR_SHOCK;
        frame = 0;
        pushAction('set_spider_mood', { mood: 'shock' });
        return;
      }

      if (name === 'repair_drag_started' && phase === PHASE.WAIT_REPAIR_DRAG) {
        phase = PHASE.WAIT_REPAIR_DROP;
        pushAction('hide_focus_prompt');
        pushAction('set_spider_mood', { mood: 'calm' });
        return;
      }

      if (name === 'repair_drag_completed' && (phase === PHASE.WAIT_REPAIR_DRAG || phase === PHASE.WAIT_REPAIR_DROP)) {
        repairDragDone = true;
        phase = PHASE.WAIT_REPAIR_FINISH;
        showMessage('蜘蛛正在补网，请稍候…');
        return;
      }

      if (name === 'repair_finished' && phase === PHASE.WAIT_REPAIR_FINISH) {
        phase = PHASE.WAVE_ONE;
        resetWaveReadiness();
        pushAction('clear_breakers');
        pushAction('set_insect_target', { targets: TUTORIAL_TARGETS });
        pushAction('set_spider_mood', { mood: 'curious' });
        pushAction('spawn_batch', {
          batch: buildDemoWave(W, H, cx, cy, 1),
          label: 'wave_one'
        });
        showMessage('毛毛虫来了！蜘蛛会自动前往打包。');
        return;
      }

      if (name === 'object_resolved' && data.kind === 'drop') {
        if (phase === PHASE.WAVE_ONE || phase === PHASE.WAVE_TWO) {
          waveDropCleared++;
          maybePromptCollect();
        }
        return;
      }

      if (name === 'object_wrapped' && isTutorialInsectKind(data.kind)) {
        if (phase === PHASE.WAVE_ONE) {
          waveWrappedReady = true;
          maybePromptCollect();
        } else if (phase === PHASE.WAVE_TWO) {
          waveWrappedReady = true;
          maybePromptCollect();
        }
        return;
      }

      if (name === 'prey_drag_started') {
        if (phase === PHASE.WAIT_COLLECT_ONE) {
          phase = PHASE.WAIT_COLLECT_ONE_DRAG;
          pushAction('hide_focus_prompt');
          return;
        }
        if (phase === PHASE.WAIT_COLLECT_TWO) {
          phase = PHASE.WAIT_COLLECT_TWO_DRAG;
          pushAction('hide_focus_prompt');
          return;
        }
      }

      if (name === 'object_collected' && data.kind === 'boulder') {
        collected++;
        if (collected === 1 && (phase === PHASE.WAIT_COLLECT_ONE || phase === PHASE.WAIT_COLLECT_ONE_DRAG)) {
          phase = PHASE.WAVE_TWO;
          resetWaveReadiness();
          pushAction('spawn_batch', {
            batch: buildDemoWave(W, H, cx, cy, 2),
            label: 'wave_two'
          });
          showMessage('很好！再来一只毛毛虫。');
          return;
        }
        if (collected >= TUTORIAL_TARGETS.boulder && (phase === PHASE.WAIT_COLLECT_TWO || phase === PHASE.WAIT_COLLECT_TWO_DRAG)) {
          phase = PHASE.WAIT_HANDOFF_TAP;
          pushAction('show_focus_prompt', { text: '收集目标达成', target: 'inventory', showHint: true });
          return;
        }
      }

      if (name === 'handoff_confirmed' && phase === PHASE.WAIT_HANDOFF_TAP) {
        phase = PHASE.WAIT_HANDOFF_BLACKOUT;
        frame = 0;
        pushAction('hide_focus_prompt');
        pushAction('show_blackout_message', { text: '开始工作吧！' });
      }
    },

    drainActions: function () {
      var out = actions.slice();
      actions = [];
      return out;
    },

    isActive: function () {
      return phase !== PHASE.IDLE && phase !== PHASE.DONE;
    },

    getPhase: function () {
      return phase;
    },

    getInsectTarget: function () {
      return insectTarget;
    },

    getCollected: function () {
      return collected;
    }
  };
}
