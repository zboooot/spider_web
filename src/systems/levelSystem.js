/**
 * 关卡系统 — 关卡/波次配置、计分、难度缩放
 */

export var LEVEL_CONFIGS = [
  {
    durationBand: '4-5m',
    targets: { boulder: 5, bug: 0, drop: 20 },
    waves: [
      {
        label: '1-1 Teaching Opening',
        question: 'What will the spider do if I do nothing?',
        primaryPressure: 'collection',
        secondaryPressure: 'low repair',
        notes: 'No poop. Very readable opening.',
        spawnWeights: { boulder: 0.84, bug: 0.00, drop: 0.16, poop: 0.00 },
        catR: 6.6, flyR: 4.4,
        burstMin: 2, burstMax: 3, burstCount: 2,
        burstIntervalMin: 60, burstIntervalMax: 76, burstGap: 74, firstBurstDelay: 54,
        pauseDuration: 132
      },
      {
        label: '1-2 First Redirect',
        question: 'Which target is worth manually marking first?',
        primaryPressure: 'collection',
        secondaryPressure: 'repair',
        notes: 'First obvious redirect moment.',
        spawnWeights: { boulder: 0.74, bug: 0.00, drop: 0.26, poop: 0.00 },
        catR: 5.9, flyR: 4.2,
        burstMin: 3, burstMax: 4, burstCount: 4,
        burstIntervalMin: 48, burstIntervalMax: 64, burstGap: 58, firstBurstDelay: 24,
        pauseDuration: 118
      },
      {
        label: '1-3 Repair Or Greed',
        question: 'Should I repair now or greed one more pickup?',
        primaryPressure: 'repair',
        secondaryPressure: 'collection',
        notes: 'First real same-level carryover lesson.',
        spawnWeights: { boulder: 0.80, bug: 0.00, drop: 0.20, poop: 0.00 },
        catR: 5.1, flyR: 4.0,
        burstMin: 4, burstMax: 5, burstCount: 4,
        burstIntervalMin: 42, burstIntervalMax: 58, burstGap: 46, firstBurstDelay: 16,
        pauseDuration: 110
      }
    ]
  },
  {
    durationBand: '5-6m',
    targets: { boulder: 10, bug: 10, drop: 30 },
    waves: [
      { catR: 5.5, flyR: 3.2, burstMin: 3, burstMax: 5, burstCount: 4, burstIntervalMin: 44, burstIntervalMax: 58, burstGap: 58, firstBurstDelay: 40, pauseDuration: 100 },
      { catR: 5.2, flyR: 3.0, burstMin: 3, burstMax: 6, burstCount: 5, burstIntervalMin: 40, burstIntervalMax: 52, burstGap: 48, firstBurstDelay: 18, pauseDuration: 90 },
      { catR: 5.0, flyR: 2.8, burstMin: 4, burstMax: 6, burstCount: 5, burstIntervalMin: 36, burstIntervalMax: 49, burstGap: 44, firstBurstDelay: 12, pauseDuration: 84 },
      { catR: 4.8, flyR: 2.7, burstMin: 4, burstMax: 6, burstCount: 6, burstIntervalMin: 34, burstIntervalMax: 46, burstGap: 40, firstBurstDelay: 10, pauseDuration: 78 }
    ]
  },
  {
    durationBand: '6-7m',
    targets: { boulder: 10, bug: 20, drop: 30 },
    waves: [
      { catR: 4.6, flyR: 2.7, burstMin: 4, burstMax: 6, burstIntervalMin: 36, burstIntervalMax: 48, burstGap: 46, firstBurstDelay: 34, fallingDuration: 400, pauseDuration: 96 },
      { catR: 4.3, flyR: 2.5, burstMin: 4, burstMax: 7, burstIntervalMin: 34, burstIntervalMax: 44, burstGap: 40, firstBurstDelay: 14, fallingDuration: 430, pauseDuration: 88 },
      { catR: 4.1, flyR: 2.3, burstMin: 4, burstMax: 7, burstIntervalMin: 31, burstIntervalMax: 41, burstGap: 36, firstBurstDelay: 10, fallingDuration: 470, pauseDuration: 82 },
      { catR: 4.0, flyR: 2.2, burstMin: 5, burstMax: 7, burstIntervalMin: 29, burstIntervalMax: 39, burstGap: 34, firstBurstDelay: 8, fallingDuration: 500, pauseDuration: 76 }
    ]
  },
  {
    durationBand: '7-8m',
    targets: { boulder: 12, bug: 22, drop: 34 },
    waves: [
      {
        label: '4-1 Stabilize Or Pace',
        question: 'Do I stabilize first or keep pace with collection?',
        primaryPressure: 'collection',
        secondaryPressure: 'repair',
        notes: 'Sets the tone with visible carryover and low poop.',
        spawnWeights: { boulder: 0.54, bug: 0.20, drop: 0.22, poop: 0.04 },
        catR: 3.9, flyR: 2.2,
        burstMin: 4, burstMax: 6, burstCount: 5,
        burstIntervalMin: 28, burstIntervalMax: 38, burstGap: 32, firstBurstDelay: 16,
        pauseDuration: 88
      },
      {
        label: '4-2 Route Or Prey',
        question: 'Is this route more important than that prey?',
        primaryPressure: 'collection',
        secondaryPressure: 'repair',
        notes: 'Strong conflict band with more bug pressure.',
        spawnWeights: { boulder: 0.42, bug: 0.30, drop: 0.22, poop: 0.06 },
        catR: 3.7, flyR: 2.0,
        burstMin: 4, burstMax: 7, burstCount: 5,
        burstIntervalMin: 26, burstIntervalMax: 35, burstGap: 29, firstBurstDelay: 10,
        pauseDuration: 82
      },
      {
        label: '4-3 Pollution Wave',
        question: 'Is poop now more urgent than low-value work?',
        primaryPressure: 'cleanup',
        secondaryPressure: 'collection',
        notes: 'First full pollution wave of the run.',
        spawnWeights: { boulder: 0.34, bug: 0.26, drop: 0.20, poop: 0.20 },
        catR: 3.5, flyR: 1.9,
        burstMin: 5, burstMax: 7, burstCount: 5,
        burstIntervalMin: 24, burstIntervalMax: 32, burstGap: 27, firstBurstDelay: 8,
        pauseDuration: 76
      },
      {
        label: '4-4 Hard Triage',
        question: 'I can only do one thing first. Which one?',
        primaryPressure: 'repair',
        secondaryPressure: 'collection',
        notes: 'Hard triage with less slack between bursts.',
        spawnWeights: { boulder: 0.46, bug: 0.28, drop: 0.14, poop: 0.12 },
        catR: 3.4, flyR: 1.8,
        burstMin: 5, burstMax: 8, burstCount: 5,
        burstIntervalMin: 22, burstIntervalMax: 30, burstGap: 24, firstBurstDelay: 6,
        pauseDuration: 70
      },
      {
        label: '4-5 Mixed Load',
        question: 'Can I keep the system stable under overlapping pressure?',
        primaryPressure: 'collection',
        secondaryPressure: 'repair/cleanup',
        notes: 'Full mixed wave; perfect play should feel impossible.',
        spawnWeights: { boulder: 0.40, bug: 0.28, drop: 0.14, poop: 0.18 },
        catR: 3.3, flyR: 1.7,
        burstMin: 5, burstMax: 9, burstCount: 6,
        burstIntervalMin: 20, burstIntervalMax: 28, burstGap: 22, firstBurstDelay: 4,
        pauseDuration: 64
      }
    ]
  },
  {
    durationBand: '8-10m',
    targets: { boulder: 16, bug: 28, drop: 36 },
    waves: [
      {
        label: '5-1 No Free Setup',
        question: 'There is no free setup time now. What matters immediately?',
        primaryPressure: 'collection',
        secondaryPressure: 'repair',
        notes: 'Fast opener with almost no warmup slack.',
        spawnWeights: { boulder: 0.44, bug: 0.30, drop: 0.18, poop: 0.08 },
        catR: 3.3, flyR: 1.8,
        burstMin: 5, burstMax: 8, burstCount: 5,
        burstIntervalMin: 22, burstIntervalMax: 30, burstGap: 24, firstBurstDelay: 8,
        pauseDuration: 76
      },
      {
        label: '5-2 Strong Poop Tension',
        question: 'If I do not clean this now, will the spider waste itself?',
        primaryPressure: 'cleanup',
        secondaryPressure: 'repair',
        notes: 'Poop tension is high and intentional.',
        spawnWeights: { boulder: 0.28, bug: 0.24, drop: 0.14, poop: 0.34 },
        catR: 3.2, flyR: 1.7,
        burstMin: 5, burstMax: 8, burstCount: 5,
        burstIntervalMin: 21, burstIntervalMax: 28, burstGap: 21, firstBurstDelay: 6,
        pauseDuration: 70
      },
      {
        label: '5-3 Accept A Loss',
        question: 'Which valuable target do I accept losing?',
        primaryPressure: 'collection',
        secondaryPressure: 'cleanup',
        notes: 'Core triage wave with high-value conflict.',
        spawnWeights: { boulder: 0.42, bug: 0.32, drop: 0.10, poop: 0.16 },
        catR: 3.1, flyR: 1.6,
        burstMin: 6, burstMax: 9, burstCount: 6,
        burstIntervalMin: 20, burstIntervalMax: 27, burstGap: 19, firstBurstDelay: 4,
        pauseDuration: 66
      },
      {
        label: '5-4 Recover Under Damage',
        question: 'How do I recover from the mistake I already made?',
        primaryPressure: 'repair',
        secondaryPressure: 'cleanup',
        notes: 'Carryover punishment should now be obvious.',
        spawnWeights: { boulder: 0.34, bug: 0.26, drop: 0.10, poop: 0.30 },
        catR: 3.0, flyR: 1.5,
        burstMin: 6, burstMax: 9, burstCount: 6,
        burstIntervalMin: 19, burstIntervalMax: 26, burstGap: 18, firstBurstDelay: 4,
        pauseDuration: 60
      },
      {
        label: '5-5 Collapse Edge',
        question: 'What do I protect when collapse has already started?',
        primaryPressure: 'repair',
        secondaryPressure: 'collection',
        notes: 'Collapse-edge wave with minimal recovery margin.',
        spawnWeights: { boulder: 0.38, bug: 0.30, drop: 0.08, poop: 0.24 },
        catR: 2.9, flyR: 1.4,
        burstMin: 6, burstMax: 10, burstCount: 6,
        burstIntervalMin: 18, burstIntervalMax: 24, burstGap: 16, firstBurstDelay: 3,
        pauseDuration: 54
      },
      {
        label: '5-6 Final Test',
        question: 'Can I close the run without a free recovery window?',
        primaryPressure: 'collection',
        secondaryPressure: 'repair/cleanup',
        notes: 'Final closure wave; not a free win, just a last exam.',
        spawnWeights: { boulder: 0.34, bug: 0.30, drop: 0.08, poop: 0.28 },
        catR: 2.9, flyR: 1.4,
        burstMin: 6, burstMax: 10, burstCount: 7,
        burstIntervalMin: 17, burstIntervalMax: 23, burstGap: 15, firstBurstDelay: 2,
        pauseDuration: 48
      }
    ]
  }
];

export var GAME_DURATION = 10800; /* 3分钟 = 180s × 60fps */

export var SCORE_MULT = { boulder: 5, bug: 4, drop: 1, poop: 0 };

function scaleWaveConfig(wave, difficultyLevel) {
  var d = difficultyLevel - 1;
  var iScale = Math.pow(0.88, d);
  var gScale = Math.pow(0.90, d);
  return {
    label: wave.label,
    question: wave.question,
    primaryPressure: wave.primaryPressure,
    secondaryPressure: wave.secondaryPressure,
    notes: wave.notes,
    spawnWeights: wave.spawnWeights,
    burstMin: wave.burstMin,
    burstMax: wave.burstMax + Math.floor(d * 0.5),
    burstCount: Math.max(1, wave.burstCount || 1),
    burstIntervalMin: Math.max(12, Math.round((wave.burstIntervalMin != null ? wave.burstIntervalMin : wave.burstInterval) * iScale)),
    burstIntervalMax: Math.max(12, Math.round((wave.burstIntervalMax != null ? wave.burstIntervalMax : wave.burstInterval) * iScale)),
    burstGap: Math.max(0, Math.round((wave.burstGap != null ? wave.burstGap : wave.cooldownDuration || 0) * gScale)),
    firstBurstDelay: Math.max(0, Math.round(wave.firstBurstDelay)),
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
  ['boulder', 'bug'].forEach(function (k) {
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
