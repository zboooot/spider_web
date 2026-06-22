/**
 * 关卡系统 — 关卡/波次配置、计分、难度缩放
 */

export var LEVEL_CONFIGS = [
  {
    durationBand: '4-5m',
    targets: { boulder: 5, bug: 0, drop: 20 },
    waves: [
      { catR: 6.3, flyR: 4.2, burstMin: 2, burstMax: 4, burstInterval: 58, cooldownDuration: 66, firstBurstDelay: 48, fallingDuration: 360, pauseDuration: 110 },
      { catR: 6.0, flyR: 4.0, burstMin: 3, burstMax: 5, burstInterval: 55, cooldownDuration: 56, firstBurstDelay: 24, fallingDuration: 380, pauseDuration: 100 },
      { catR: 5.7, flyR: 3.9, burstMin: 3, burstMax: 5, burstInterval: 50, cooldownDuration: 50, firstBurstDelay: 18, fallingDuration: 420, pauseDuration: 90 }
    ]
  },
  {
    durationBand: '5-6m',
    targets: { boulder: 10, bug: 10, drop: 30 },
    waves: [
      { catR: 5.5, flyR: 3.2, burstMin: 3, burstMax: 5, burstInterval: 50, cooldownDuration: 58, firstBurstDelay: 40, fallingDuration: 380, pauseDuration: 100 },
      { catR: 5.2, flyR: 3.0, burstMin: 3, burstMax: 6, burstInterval: 46, cooldownDuration: 48, firstBurstDelay: 18, fallingDuration: 420, pauseDuration: 90 },
      { catR: 5.0, flyR: 2.8, burstMin: 4, burstMax: 6, burstInterval: 43, cooldownDuration: 44, firstBurstDelay: 12, fallingDuration: 440, pauseDuration: 84 },
      { catR: 4.8, flyR: 2.7, burstMin: 4, burstMax: 6, burstInterval: 40, cooldownDuration: 40, firstBurstDelay: 10, fallingDuration: 470, pauseDuration: 78 }
    ]
  },
  {
    durationBand: '6-7m',
    targets: { boulder: 10, bug: 20, drop: 30 },
    waves: [
      { catR: 4.6, flyR: 2.7, burstMin: 4, burstMax: 6, burstInterval: 42, cooldownDuration: 46, firstBurstDelay: 34, fallingDuration: 400, pauseDuration: 96 },
      { catR: 4.3, flyR: 2.5, burstMin: 4, burstMax: 7, burstInterval: 39, cooldownDuration: 40, firstBurstDelay: 14, fallingDuration: 430, pauseDuration: 88 },
      { catR: 4.1, flyR: 2.3, burstMin: 4, burstMax: 7, burstInterval: 36, cooldownDuration: 36, firstBurstDelay: 10, fallingDuration: 470, pauseDuration: 82 },
      { catR: 4.0, flyR: 2.2, burstMin: 5, burstMax: 7, burstInterval: 34, cooldownDuration: 34, firstBurstDelay: 8, fallingDuration: 500, pauseDuration: 76 }
    ]
  },
  {
    durationBand: '7-8m',
    targets: { boulder: 10, bug: 20, drop: 35 },
    waves: [
      { catR: 3.9, flyR: 2.2, burstMin: 4, burstMax: 7, burstInterval: 36, cooldownDuration: 40, firstBurstDelay: 28, fallingDuration: 420, pauseDuration: 92 },
      { catR: 3.7, flyR: 2.0, burstMin: 4, burstMax: 8, burstInterval: 33, cooldownDuration: 35, firstBurstDelay: 12, fallingDuration: 460, pauseDuration: 84 },
      { catR: 3.5, flyR: 1.9, burstMin: 5, burstMax: 8, burstInterval: 31, cooldownDuration: 31, firstBurstDelay: 8, fallingDuration: 500, pauseDuration: 78 },
      { catR: 3.4, flyR: 1.8, burstMin: 5, burstMax: 8, burstInterval: 29, cooldownDuration: 28, firstBurstDelay: 6, fallingDuration: 520, pauseDuration: 72 },
      { catR: 3.3, flyR: 1.7, burstMin: 5, burstMax: 9, burstInterval: 28, cooldownDuration: 26, firstBurstDelay: 4, fallingDuration: 540, pauseDuration: 66 }
    ]
  },
  {
    durationBand: '8-10m',
    targets: { boulder: 15, bug: 25, drop: 35 },
    waves: [
      { catR: 3.3, flyR: 1.8, burstMin: 5, burstMax: 8, burstInterval: 30, cooldownDuration: 32, firstBurstDelay: 20, fallingDuration: 440, pauseDuration: 88 },
      { catR: 3.2, flyR: 1.7, burstMin: 5, burstMax: 9, burstInterval: 28, cooldownDuration: 28, firstBurstDelay: 10, fallingDuration: 480, pauseDuration: 80 },
      { catR: 3.1, flyR: 1.6, burstMin: 5, burstMax: 9, burstInterval: 27, cooldownDuration: 25, firstBurstDelay: 8, fallingDuration: 520, pauseDuration: 74 },
      { catR: 3.0, flyR: 1.5, burstMin: 6, burstMax: 9, burstInterval: 26, cooldownDuration: 23, firstBurstDelay: 6, fallingDuration: 560, pauseDuration: 68 },
      { catR: 2.9, flyR: 1.4, burstMin: 6, burstMax: 10, burstInterval: 24, cooldownDuration: 21, firstBurstDelay: 4, fallingDuration: 600, pauseDuration: 62 }
    ]
  }
];

export var GAME_DURATION = 10800; /* 3分钟 = 180s × 60fps */

export var SCORE_MULT = { boulder: 5, bug: 4, drop: 1, poop: 0 };

function scaleWaveConfig(wave, difficultyLevel) {
  var d = difficultyLevel - 1;
  var tScale = Math.pow(0.85, d);
  var iScale = Math.pow(0.88, d);
  var cScale = Math.pow(0.90, d);
  return {
    catR: Math.max(1.0, wave.catR * tScale),
    flyR: Math.max(0.6, wave.flyR * tScale),
    burstMin: wave.burstMin,
    burstMax: wave.burstMax + Math.floor(d * 0.5),
    burstInterval: Math.max(20, Math.round(wave.burstInterval * iScale)),
    cooldownDuration: Math.max(16, Math.round(wave.cooldownDuration * cScale)),
    firstBurstDelay: Math.max(0, Math.round(wave.firstBurstDelay * cScale)),
    fallingDuration: wave.fallingDuration,
    pauseDuration: wave.pauseDuration
  };
}

export function getLevelCfg(n, difficultyLevel) {
  var base = LEVEL_CONFIGS[n];
  return {
    durationBand: base.durationBand,
    targets: base.targets,
    waves: base.waves.map(function (wave) {
      return scaleWaveConfig(wave, difficultyLevel);
    })
  };
}

export function getWaveCfg(levelIndex, waveIndex, difficultyLevel) {
  var level = getLevelCfg(levelIndex, difficultyLevel);
  var clampedWaveIndex = Math.max(0, Math.min(level.waves.length - 1, waveIndex));
  return level.waves[clampedWaveIndex];
}

/**
 * 三角计分
 */
export function triangleScore(n) {
  return n * (n + 1) / 2;
}

/**
 * 计算本关获得的网丝数量
 */
export function calcCollectedSilk(collected, targets) {
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
 * 格式化帧数为 m:ss
 */
export function framesToTime(f) {
  var s = Math.floor(f / 60);
  var m = Math.floor(s / 60);
  var ss = s % 60;
  return m + ':' + (ss < 10 ? '0' : '') + ss;
}
