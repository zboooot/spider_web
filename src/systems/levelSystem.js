/**
 * 关卡系统 — 配置、计分、难度缩放
 */

export var LEVEL_CONFIGS = [
  /* 第1关 — 轻松热身 */
  { targets: { boulder: 5, bug: 0, drop: 20 }, flyR: 4.0, catR: 6.0,
    burstMin: 3, burstMax: 5, burstInterval: 55, cooldownDuration: 160, firstBurstDelay: 60 },
  /* 第2关 — 引入苍蝇 */
  { targets: { boulder: 10, bug: 10, drop: 30 }, flyR: 3.0, catR: 5.0,
    burstMin: 3, burstMax: 6, burstInterval: 45, cooldownDuration: 130, firstBurstDelay: 45 },
  /* 第3关 — 苍蝇加倍 */
  { targets: { boulder: 10, bug: 20, drop: 30 }, flyR: 2.5, catR: 4.0,
    burstMin: 4, burstMax: 7, burstInterval: 38, cooldownDuration: 110, firstBurstDelay: 35 },
  /* 第4关 — 全面提速 */
  { targets: { boulder: 10, bug: 20, drop: 35 }, flyR: 2.0, catR: 3.5,
    burstMin: 4, burstMax: 8, burstInterval: 32, cooldownDuration: 90, firstBurstDelay: 25 },
  /* 第5关 — 极限冲刺 */
  { targets: { boulder: 15, bug: 25, drop: 35 }, flyR: 1.5, catR: 3.0,
    burstMin: 5, burstMax: 9, burstInterval: 26, cooldownDuration: 70, firstBurstDelay: 15 }
];

export var GAME_DURATION = 10800; /* 3分钟 = 180s × 60fps */

export var SCORE_MULT = { boulder: 3, bug: 2, drop: 1 };

/**
 * 三角计分
 */
export function triangleScore(n) {
  return n * (n + 1) / 2;
}

/**
 * 计算波次得分
 */
export function calcWaveScore(collected, targets) {
  var s = 0;
  ['boulder', 'bug', 'drop'].forEach(function (k) {
    var got = collected[k] || 0;
    var tgt = targets[k] || 0;
    var inTarget = Math.min(got, tgt);
    s += triangleScore(inTarget) * SCORE_MULT[k];
    if (got > tgt) s += (got - tgt);
  });
  return s;
}

/**
 * 根据难度等级缩放关卡参数
 */
export function getLevelCfg(n, difficultyLevel) {
  var base = LEVEL_CONFIGS[n];
  var d = difficultyLevel - 1;
  var tScale = Math.pow(0.85, d);
  var iScale = Math.pow(0.88, d);
  var cScale = Math.pow(0.90, d);
  return {
    targets: base.targets,
    flyR: Math.max(0.6, base.flyR * tScale),
    catR: Math.max(1.0, base.catR * tScale),
    totalBursts: 99,
    burstMin: base.burstMin,
    burstMax: base.burstMax + Math.floor(d * 0.5),
    burstInterval: Math.max(20, Math.round(base.burstInterval * iScale)),
    cooldownDuration: Math.max(60, Math.round(base.cooldownDuration * cScale)),
    firstBurstDelay: Math.max(10, Math.round(base.firstBurstDelay * cScale))
  };
}

/**
 * 格式化帧数为 m:ss
 */
export function framesToTime(f) {
  var s = Math.floor(f / 60);
  var m = Math.floor(s / 60);
  var ss = s % 60;
  return m + ':' + (ss < 10 ? '0' : '') + ss;
}
