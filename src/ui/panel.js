/**
 * 左右面板滑块/按钮绑定
 */

/**
 * 绑定滑块控件
 * @param {string} key - 参数名
 * @param {string} rebuildType - 重建类型: 'web' | 'spider' | 'motion' | 'object'
 * @param {Object} P - 参数对象
 * @param {Object} callbacks - {buildWeb, buildSpider, onMotionChange}
 */
export function bindSlider(key, rebuildType, P, callbacks) {
  var el = document.getElementById('sl-' + key);
  var lbl = document.getElementById('lbl-' + key);
  el.value = P[key];
  lbl.textContent = P[key];
  el.addEventListener('input', function () {
    var v = parseFloat(this.value);
    P[key] = v;
    lbl.textContent = v;
    if (rebuildType === 'web') { callbacks.buildWeb(); }
    else if (rebuildType === 'spider') { callbacks.buildSpider(); }
    else if (rebuildType === 'motion') { callbacks.onMotionChange(); }
    else if (rebuildType === 'repair') { callbacks.onRepairChange(); }
  });
}

/**
 * 初始化所有面板控件
 */
export function initPanel(P, DEFAULTS, callbacks) {
  bindSlider('webRadius', 'web', P, callbacks);
  bindSlider('webSegs', 'web', P, callbacks);
  bindSlider('webDepth', 'web', P, callbacks);
  bindSlider('webStiff', 'web', P, callbacks);
  bindSlider('moveSpeed', 'motion', P, callbacks);
  bindSlider('stepSpeed', 'motion', P, callbacks);
  bindSlider('stepThresh', 'motion', P, callbacks);
  bindSlider('restThresh', 'motion', P, callbacks);
  bindSlider('legStiff', 'spider', P, callbacks);
  bindSlider('jointStiff', 'spider', P, callbacks);
  bindSlider('stickDelayMin', 'object', P, callbacks);
  bindSlider('stickDelayMax', 'object', P, callbacks);
  bindSlider('stickCatchRadius', 'object', P, callbacks);
  bindSlider('stickMidBias', 'object', P, callbacks);
  bindSlider('stickHistory', 'object', P, callbacks);
  bindSlider('caterpillarGravity', 'object', P, callbacks);
  bindSlider('caterpillarWeight', 'object', P, callbacks);
  bindSlider('flyWeight', 'object', P, callbacks);
  bindSlider('leafWeight', 'object', P, callbacks);
  bindSlider('leafGravityMin', 'object', P, callbacks);
  bindSlider('leafGravityMax', 'object', P, callbacks);
  bindSlider('leafMaxSpeed', 'object', P, callbacks);
  bindSlider('caterpillarReleaseSec', 'object', P, callbacks);
  bindSlider('flyReleaseSec', 'object', P, callbacks);
  bindSlider('leafReleaseSec', 'object', P, callbacks);

  /* 补网配置 */
  bindSlider('stubReachRadius', 'repair', P, callbacks);
  bindSlider('stubSnapRadius', 'repair', P, callbacks);

  var repairPatchBtn = document.getElementById('btn-repairPatch');
  function renderRepairPatchBtn(on) {
    repairPatchBtn.textContent = on ? 'Patch Repair: ON' : 'Patch Repair: OFF';
    repairPatchBtn.style.background = on ? 'rgba(60,110,60,0.35)' : '';
    repairPatchBtn.style.color = on ? '#2a5a2a' : '';
  }
  renderRepairPatchBtn(!!P.repairPatch);
  repairPatchBtn.addEventListener('click', function () {
    P.repairPatch = P.repairPatch ? 0 : 1;
    renderRepairPatchBtn(!!P.repairPatch);
  });

  document.getElementById('btn-rebuild').onclick = function () { callbacks.buildWeb(); };

  /* Auto Play 开关 */
  var autoPlayBtn = document.getElementById('btn-autoplay');
  function renderAutoPlayBtn(on) {
    autoPlayBtn.textContent = on ? '🤖 Auto Play: ON' : '🤖 Auto Play: OFF';
    autoPlayBtn.style.background = on ? 'rgba(60,110,60,0.35)' : '';
    autoPlayBtn.style.color = on ? '#2a5a2a' : '';
  }
  renderAutoPlayBtn(callbacks.isAutoPlayOn());
  autoPlayBtn.addEventListener('click', function () {
    var on = callbacks.toggleAutoPlay();
    renderAutoPlayBtn(on);
  });

  document.getElementById('btn-save').onclick = function () {
    localStorage.setItem('spiderPanelParams', JSON.stringify(P));
    var h = document.getElementById('save-hint');
    h.textContent = '\u2713 Saved';
    setTimeout(function () { h.textContent = ''; }, 2000);
  };

  document.getElementById('btn-copy-shared-defaults').onclick = async function () {
    var h = document.getElementById('save-hint');
    var json = callbacks.getSharedDefaultsJson();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(json);
        h.textContent = '\u2713 Shared defaults JSON copied';
      } else {
        throw new Error('clipboard unavailable');
      }
    } catch (e) {
      var ta = document.createElement('textarea');
      ta.value = json;
      ta.setAttribute('readonly', 'readonly');
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      var copied = false;
      try { copied = document.execCommand('copy'); } catch (err) {}
      document.body.removeChild(ta);
      h.textContent = copied ? '\u2713 Shared defaults JSON copied' : 'Copy failed';
    }
    setTimeout(function () { h.textContent = ''; }, 2400);
  };

  document.getElementById('btn-reset').onclick = function () {
    localStorage.removeItem('spiderPanelParams');
    Object.assign(P, DEFAULTS);
    Object.keys(DEFAULTS).forEach(function (key) {
      var el = document.getElementById('sl-' + key);
      var lbl = document.getElementById('lbl-' + key);
      if (el) { el.value = P[key]; lbl.textContent = P[key]; }
    });
    callbacks.onMotionChange();
    callbacks.setAutoPlay(true);
    renderAutoPlayBtn(true);
    callbacks.clearAllObjects();
    callbacks.buildWeb();
    callbacks.buildSpider();
  };

  /* 右面板按钮 */
  document.getElementById('btn-boulder').onclick = function () { callbacks.launchObject('boulder'); };
  document.getElementById('btn-bug').onclick = function () { callbacks.launchObject('bug'); };
  document.getElementById('btn-drop').onclick = function () { callbacks.launchObject('drop'); };
  document.getElementById('btn-poop').onclick = function () { callbacks.launchObject('poop'); };
  document.getElementById('btn-clearObj').onclick = callbacks.clearAllObjects;

  initWaveEditor(callbacks);
}

function initWaveEditor(callbacks) {
  var FPS = 60;
  var WAVE_CLIPBOARD_STORAGE_KEY = 'spiderWaveClipboard';
  var levelSelect = document.getElementById('wave-edit-level');
  var levelCondSelect = document.getElementById('level-cond-level');
  var waveCountInput = document.getElementById('wave-count');
  var waveSelect = document.getElementById('wave-edit-wave');
  var levelFieldMap = {
    boulder: document.getElementById('level-target-boulder'),
    bug: document.getElementById('level-target-bug')
  };
  var metaEl = document.getElementById('wave-edit-meta');
  var estimateFallingEl = document.getElementById('wave-estimate-falling');
  var estimateTotalEl = document.getElementById('wave-estimate-total');
  var estimateLevelTotalEl = document.getElementById('wave-estimate-level-total');
  var estimateCollectEls = {
    boulder: document.getElementById('wave-estimate-boulder'),
    bug: document.getElementById('wave-estimate-bug'),
    poop: document.getElementById('wave-estimate-poop')
  };
  var saveHintEl = document.getElementById('wave-save-hint');
  var levelSaveHintEl = document.getElementById('level-save-hint');
  var useCurrentBtn = document.getElementById('btn-wave-use-current');
  var copyBtn = document.getElementById('btn-wave-copy');
  var pasteBtn = document.getElementById('btn-wave-paste');
  var saveBtn = document.getElementById('btn-wave-save');
  var resetBtn = document.getElementById('btn-wave-reset');
  var levelSaveBtn = document.getElementById('btn-level-save');
  var levelResetBtn = document.getElementById('btn-level-reset');
  var liveApplyTimer = null;
  var waveClipboard = null;

  var fieldMap = {
    label: { el: document.getElementById('wave-label'), integer: false, kind: 'text' },
    question: { el: document.getElementById('wave-question'), integer: false, kind: 'text' },
    notes: { el: document.getElementById('wave-notes'), integer: false, kind: 'text' },
    pauseDuration: { el: document.getElementById('wave-pauseDuration'), integer: false, unit: 'seconds' },
    firstBurstDelay: { el: document.getElementById('wave-firstBurstDelay'), integer: false, unit: 'seconds' },
    burstGap: { el: document.getElementById('wave-burstGap'), integer: false, unit: 'seconds' },
    burstIntervalMin: { el: document.getElementById('wave-burstIntervalMin'), integer: false, unit: 'seconds' },
    burstIntervalMax: { el: document.getElementById('wave-burstIntervalMax'), integer: false, unit: 'seconds' },
    burstMin: { el: document.getElementById('wave-burstMin'), integer: true },
    burstMax: { el: document.getElementById('wave-burstMax'), integer: true },
    burstCount: { el: document.getElementById('wave-burstCount'), integer: true },
    'spawnWeights.boulder': { el: document.getElementById('wave-weight-boulder'), integer: false },
    'spawnWeights.bug': { el: document.getElementById('wave-weight-bug'), integer: false },
    'spawnWeights.drop': { el: document.getElementById('wave-weight-drop'), integer: false },
    'spawnWeights.poop': { el: document.getElementById('wave-weight-poop'), integer: false }
  };

  function getConfigs() {
    return callbacks.getWaveEditorConfigs();
  }

  function getSelectedLevelIndex() {
    return parseInt(levelSelect.value, 10) || 0;
  }

  function getSelectedWaveIndex() {
    return parseInt(waveSelect.value, 10) || 0;
  }

  function getSelectedLevelConditionIndex() {
    return parseInt(levelCondSelect.value, 10) || 0;
  }

  function getSelectedWave() {
    var configs = getConfigs();
    var level = configs[getSelectedLevelIndex()];
    return level && level.waves ? level.waves[getSelectedWaveIndex()] : null;
  }

  function getSelectedLevel() {
    var configs = getConfigs();
    return configs[getSelectedLevelIndex()] || null;
  }

  function getSelectedConditionLevel() {
    var configs = getConfigs();
    return configs[getSelectedLevelConditionIndex()] || null;
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function loadClipboard() {
    try {
      var raw = localStorage.getItem(WAVE_CLIPBOARD_STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function saveClipboard(value) {
    waveClipboard = cloneJson(value);
    localStorage.setItem(WAVE_CLIPBOARD_STORAGE_KEY, JSON.stringify(waveClipboard));
  }

  function renderPasteState() {
    if (!pasteBtn) return;
    pasteBtn.disabled = !waveClipboard;
    pasteBtn.style.opacity = waveClipboard ? '1' : '0.55';
  }

  function setByPath(obj, path, value) {
    var parts = path.split('.');
    var target = obj;
    for (var i = 0; i < parts.length - 1; i++) target = target[parts[i]];
    target[parts[parts.length - 1]] = value;
  }

  function formatFieldValue(path, value) {
    var binding = fieldMap[path];
    if (!binding || value == null) return value;
    if (binding.kind === 'text') return value;
    if (binding.unit === 'seconds') return (value / FPS).toFixed(1);
    return value;
  }

  function parseFieldValue(path, raw) {
    var binding = fieldMap[path];
    if (binding.kind === 'text') return raw;
    var parsed = binding.unit === 'seconds'
      ? parseFloat(raw)
      : (binding.integer ? parseInt(raw, 10) : parseFloat(raw));
    if (!isFinite(parsed)) return null;
    if (binding.unit === 'seconds') return Math.max(0, Math.round(parsed * FPS));
    return parsed;
  }

  function isIncompleteNumericInput(path, raw) {
    var binding = fieldMap[path];
    if (!binding || binding.kind === 'text') return false;
    return raw === '' || raw === '-' || raw === '.' || raw === '-.' || /[.]$/.test(raw);
  }

  function formatMeta(levelIndex, waveIndex, wave) {
    if (!wave) return 'No wave selected';
    var lines = [];
    lines.push('Editing L' + (levelIndex + 1) + ' W' + (waveIndex + 1));
    if (wave.label) lines.push(wave.label);
    if (wave.question) lines.push(wave.question);
    return lines.join('\n');
  }

  function estimateWaveFrames(wave) {
    if (!wave) return { falling: 0, total: 0 };
    var burstCount = Math.max(1, wave.burstCount || 1);
    var avgBurstSize = ((wave.burstMin || 1) + (wave.burstMax || 1)) * 0.5;
    var avgInterval = ((wave.burstIntervalMin || 0) + (wave.burstIntervalMax || 0)) * 0.5;
    var perBurstFrames = Math.max(0, avgBurstSize - 1) * avgInterval;
    var fallingFrames = (wave.firstBurstDelay || 0)
      + burstCount * perBurstFrames
      + Math.max(0, burstCount - 1) * (wave.burstGap || 0);
    return {
      falling: fallingFrames,
      total: fallingFrames + (wave.pauseDuration || 0)
    };
  }

  function estimateWaveCollectibles(wave) {
    var result = { boulder: 0, bug: 0, drop: 0, poop: 0 };
    if (!wave) return result;
    var burstCount = Math.max(1, wave.burstCount || 1);
    var avgBurstSize = ((wave.burstMin || 1) + (wave.burstMax || 1)) * 0.5;
    var totalSpawns = burstCount * avgBurstSize;
    var weights = wave.spawnWeights || {};
    var order = ['boulder', 'bug', 'drop', 'poop'];
    var totalWeight = 0;
    for (var i = 0; i < order.length; i++) totalWeight += Math.max(0, weights[order[i]] || 0);
    if (totalWeight <= 0) return result;
    for (var j = 0; j < order.length; j++) {
      var key = order[j];
      result[key] = totalSpawns * (Math.max(0, weights[key] || 0) / totalWeight);
    }
    return result;
  }

  function estimateLevelCollectibles(level) {
    var total = { boulder: 0, bug: 0, drop: 0, poop: 0 };
    if (!level || !Array.isArray(level.waves)) return total;
    for (var i = 0; i < level.waves.length; i++) {
      var waveEstimate = estimateWaveCollectibles(level.waves[i]);
      total.boulder += waveEstimate.boulder;
      total.bug += waveEstimate.bug;
      total.drop += waveEstimate.drop;
      total.poop += waveEstimate.poop;
    }
    return total;
  }

  function estimateLevelFrames(level) {
    var total = { falling: 0, total: 0 };
    if (!level || !Array.isArray(level.waves)) return total;
    for (var i = 0; i < level.waves.length; i++) {
      var waveEstimate = estimateWaveFrames(level.waves[i]);
      total.falling += waveEstimate.falling;
      total.total += waveEstimate.total;
    }
    return total;
  }

  function renderWaveOptions() {
    var configs = getConfigs();
    var level = configs[getSelectedLevelIndex()];
    waveSelect.innerHTML = '';
    if (!level || !level.waves) return;
    level.waves.forEach(function (wave, idx) {
      var opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = 'W' + (idx + 1) + (wave.label ? ' · ' + wave.label : '');
      waveSelect.appendChild(opt);
    });
    if (getSelectedWaveIndex() >= level.waves.length) waveSelect.value = '0';
  }

  function renderWaveEditor() {
    var levelIndex = getSelectedLevelIndex();
    var level = getConfigs()[levelIndex];
    var waveIndex = getSelectedWaveIndex();
    var wave = getSelectedWave();
    waveCountInput.value = level && level.waves ? String(level.waves.length) : '0';
    metaEl.textContent = formatMeta(levelIndex, waveIndex, wave);
    var estimate = estimateWaveFrames(wave);
    estimateFallingEl.textContent = (estimate.falling / FPS).toFixed(1) + 's';
    estimateTotalEl.textContent = (estimate.total / FPS).toFixed(1) + 's';
    var levelEstimate = estimateLevelFrames(level);
    estimateLevelTotalEl.textContent = (levelEstimate.total / FPS).toFixed(1) + 's';
    var collectEstimate = estimateLevelCollectibles(level);
    Object.keys(estimateCollectEls).forEach(function (key) {
      estimateCollectEls[key].textContent = collectEstimate[key].toFixed(1);
    });
    if (!wave) return;
    Object.keys(fieldMap).forEach(function (path) {
      var parts = path.split('.');
      var value = wave;
      for (var i = 0; i < parts.length; i++) value = value[parts[i]];
      fieldMap[path].el.value = String(value != null ? formatFieldValue(path, value) : '');
    });
    renderPasteState();
  }

  function renderLevelConditionsEditor() {
    var level = getSelectedConditionLevel();
    if (!level || !level.targets) return;
    Object.keys(levelFieldMap).forEach(function (key) {
      levelFieldMap[key].value = String(level.targets[key] != null ? level.targets[key] : 0);
    });
  }

  function syncToCurrentWave() {
    levelSelect.value = String(callbacks.getCurrentLevelIndex());
    renderWaveOptions();
    waveSelect.value = String(callbacks.getCurrentWaveIndex());
    renderWaveEditor();
    levelCondSelect.value = String(callbacks.getCurrentLevelIndex());
    renderLevelConditionsEditor();
  }

  function handleFieldInput(path, commit) {
    var wave = getSelectedWave();
    if (!wave) return;
    var raw = fieldMap[path].el.value;
    if (isIncompleteNumericInput(path, raw)) return;
    var parsed = parseFieldValue(path, raw);
    if (parsed == null) return;
    if (fieldMap[path].kind === 'text') {
      setByPath(wave, path, parsed);
      callbacks.onWaveEditorChange(getSelectedLevelIndex(), getSelectedWaveIndex());
      if (commit && callbacks.onWaveEditorCommit) {
        callbacks.onWaveEditorCommit(getSelectedLevelIndex(), getSelectedWaveIndex(), path);
      }
      return;
    }
    if (path === 'burstMax') parsed = Math.max(parsed, parseInt(fieldMap.burstMin.el.value, 10) || 1);
    if (path === 'burstMin') {
      var burstMax = parseInt(fieldMap.burstMax.el.value, 10) || parsed;
      if (parsed > burstMax) fieldMap.burstMax.el.value = String(parsed);
    }
    if (path === 'burstIntervalMax') {
      var minSec = parseFloat(fieldMap.burstIntervalMin.el.value) || 0.1;
      parsed = Math.max(parsed, Math.round(minSec * FPS));
    }
    if (path === 'burstIntervalMin') {
      var maxSec = parseFloat(fieldMap.burstIntervalMax.el.value) || (parsed / FPS);
      if (parsed > Math.round(maxSec * FPS)) fieldMap.burstIntervalMax.el.value = (parsed / FPS).toFixed(1);
    }
    if (path.indexOf('spawnWeights.') === 0) parsed = Math.max(0, parsed);
    setByPath(wave, path, parsed);
    callbacks.onWaveEditorChange(getSelectedLevelIndex(), getSelectedWaveIndex());
    if (!commit && callbacks.queueWaveEditorLiveApply) {
      callbacks.queueWaveEditorLiveApply(getSelectedLevelIndex(), getSelectedWaveIndex(), path);
    }
    if (commit && callbacks.onWaveEditorCommit) {
      callbacks.onWaveEditorCommit(getSelectedLevelIndex(), getSelectedWaveIndex(), path);
    }
  }

  function handleWaveCountInput() {
    var levelIndex = getSelectedLevelIndex();
    var configs = getConfigs();
    var level = configs[levelIndex];
    if (!level || !level.waves) return;
    var requested = parseInt(waveCountInput.value, 10);
    if (!isFinite(requested)) return;
    requested = Math.max(1, Math.min(12, requested));
    var currentCount = level.waves.length;
    if (requested === currentCount) return;

    if (requested > currentCount) {
      var template = cloneJson(level.waves[currentCount - 1]);
      for (var i = currentCount; i < requested; i++) {
        var nextWave = cloneJson(template);
        nextWave.label = 'L' + (levelIndex + 1) + '-' + (i + 1) + ' Custom';
        if (nextWave.question) nextWave.question = '';
        if (nextWave.notes) nextWave.notes = '';
        level.waves.push(nextWave);
      }
    } else {
      level.waves.splice(requested);
    }

    renderWaveOptions();
    var selectedWaveIndex = Math.min(getSelectedWaveIndex(), level.waves.length - 1);
    waveSelect.value = String(selectedWaveIndex);
    callbacks.onWaveEditorChange(levelIndex, selectedWaveIndex);
    renderWaveEditor();
  }

  function handleLevelTargetInput(key) {
    var level = getSelectedConditionLevel();
    if (!level || !level.targets) return;
    var parsed = parseInt(levelFieldMap[key].value, 10);
    if (!isFinite(parsed)) return;
    level.targets[key] = Math.max(0, parsed);
    callbacks.onLevelConditionsChange(getSelectedLevelConditionIndex());
  }

  function copySelectedWave() {
    var wave = getSelectedWave();
    if (!wave) return;
    saveClipboard(wave);
    renderPasteState();
    saveHintEl.textContent = 'Copied current wave values';
    setTimeout(function () { saveHintEl.textContent = ''; }, 1400);
  }

  function pasteIntoSelectedWave() {
    if (!waveClipboard) return;
    var configs = getConfigs();
    var levelIndex = getSelectedLevelIndex();
    var waveIndex = getSelectedWaveIndex();
    var level = configs[levelIndex];
    if (!level || !level.waves || !level.waves[waveIndex]) return;
    level.waves[waveIndex] = cloneJson(waveClipboard);
    callbacks.onWaveEditorChange(levelIndex, waveIndex);
    if (callbacks.onWaveEditorCommit) callbacks.onWaveEditorCommit(levelIndex, waveIndex, 'pasteWave');
    renderWaveOptions();
    waveSelect.value = String(waveIndex);
    renderWaveEditor();
    saveHintEl.textContent = 'Pasted wave values into current wave';
    setTimeout(function () { saveHintEl.textContent = ''; }, 1600);
  }

  getConfigs().forEach(function (_level, idx) {
    var opt = document.createElement('option');
    opt.value = String(idx);
    opt.textContent = 'Level ' + (idx + 1);
    levelSelect.appendChild(opt);
  });
  getConfigs().forEach(function (_level, idx) {
    var opt = document.createElement('option');
    opt.value = String(idx);
    opt.textContent = 'Level ' + (idx + 1);
    levelCondSelect.appendChild(opt);
  });

  levelSelect.addEventListener('change', function () {
    renderWaveOptions();
    waveSelect.value = '0';
    renderWaveEditor();
  });
  levelCondSelect.addEventListener('change', renderLevelConditionsEditor);
  waveSelect.addEventListener('change', renderWaveEditor);
  waveCountInput.addEventListener('input', handleWaveCountInput);
  Object.keys(levelFieldMap).forEach(function (key) {
    levelFieldMap[key].addEventListener('input', function () { handleLevelTargetInput(key); });
    levelFieldMap[key].addEventListener('change', renderWaveEditor);
  });

  Object.keys(fieldMap).forEach(function (path) {
    fieldMap[path].el.addEventListener('input', function () { handleFieldInput(path, false); });
    fieldMap[path].el.addEventListener('change', function () {
      handleFieldInput(path, true);
      renderWaveEditor();
    });
  });

  useCurrentBtn.addEventListener('click', function () {
    syncToCurrentWave();
    saveHintEl.textContent = 'Synced to current wave';
    setTimeout(function () { saveHintEl.textContent = ''; }, 1200);
  });
  copyBtn.addEventListener('click', copySelectedWave);
  pasteBtn.addEventListener('click', pasteIntoSelectedWave);
  saveBtn.addEventListener('click', function () {
    callbacks.saveWaveEditorConfigs();
    saveHintEl.textContent = '✓ Wave content saved';
    setTimeout(function () { saveHintEl.textContent = ''; }, 1800);
  });
  resetBtn.addEventListener('click', function () {
    callbacks.resetWaveEditorConfigs();
    while (levelSelect.firstChild) levelSelect.removeChild(levelSelect.firstChild);
    getConfigs().forEach(function (_level, idx) {
      var opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = 'Level ' + (idx + 1);
      levelSelect.appendChild(opt);
    });
    syncToCurrentWave();
    saveHintEl.textContent = 'Reset to default authored waves';
    setTimeout(function () { saveHintEl.textContent = ''; }, 1800);
  });
  levelSaveBtn.addEventListener('click', function () {
    callbacks.saveLevelConditions();
    levelSaveHintEl.textContent = '✓ Saved conditions for Level ' + (getSelectedLevelConditionIndex() + 1);
    setTimeout(function () { levelSaveHintEl.textContent = ''; }, 1800);
  });
  levelResetBtn.addEventListener('click', function () {
    callbacks.resetLevelConditions(getSelectedLevelConditionIndex());
    renderLevelConditionsEditor();
    levelSaveHintEl.textContent = 'Reset Level ' + (getSelectedLevelConditionIndex() + 1) + ' goals';
    setTimeout(function () { levelSaveHintEl.textContent = ''; }, 1800);
  });

  waveClipboard = loadClipboard();
  syncToCurrentWave();
}
