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
  bindSlider('caterpillarReleaseSec', 'object', P, callbacks);
  bindSlider('flyReleaseSec', 'object', P, callbacks);
  bindSlider('leafReleaseSec', 'object', P, callbacks);

  document.getElementById('btn-rebuild').onclick = function () { callbacks.buildWeb(); };

  document.getElementById('btn-save').onclick = function () {
    localStorage.setItem('spiderPanelParams', JSON.stringify(P));
    var h = document.getElementById('save-hint');
    h.textContent = '\u2713 Saved';
    setTimeout(function () { h.textContent = ''; }, 2000);
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
    callbacks.clearAllObjects();
    callbacks.buildWeb();
    callbacks.buildSpider();
  };

  /* 右面板按钮 */
  document.getElementById('btn-boulder').onclick = function () { callbacks.launchObject('boulder'); };
  document.getElementById('btn-bug').onclick = function () { callbacks.launchObject('bug'); };
  document.getElementById('btn-drop').onclick = function () { callbacks.launchObject('drop'); };
  document.getElementById('btn-clearObj').onclick = callbacks.clearAllObjects;
}
