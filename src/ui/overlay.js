/**
 * 弹窗 / HUD 管理
 */

var overlayEl, overlayCardEl;

export function initOverlay() {
  overlayEl = document.getElementById('game-overlay');
  overlayCardEl = document.getElementById('overlay-card');
}

export function showOverlay(html) {
  overlayCardEl.innerHTML = html;
  overlayEl.style.display = 'flex';
}

export function hideOverlay() {
  overlayEl.style.display = 'none';
}

/**
 * 刷新顶部 HUD 文字 + 跳动动画
 */
export function refreshWaveHUD(flashKind, gameState, getLevelCfgFn, currentLevel, levelCollected) {
  if (gameState !== 'LEVEL_ACTIVE' && gameState !== 'LEVEL_INTRO') return;
  var cfg = getLevelCfgFn(currentLevel);
  ['boulder', 'bug'].forEach(function (k) {
    var el = document.getElementById('inv-' + k + '-count');
    if (el) {
      el.textContent = levelCollected[k] + '/' + cfg.targets[k];
      if (k === flashKind) {
        el.classList.remove('inv-count-pop');
        void el.offsetWidth;
        el.classList.add('inv-count-pop');
        setTimeout(function () { el.classList.remove('inv-count-pop'); }, 400);
        var art = document.getElementById('inv-' + k + '-art');
        if (art) {
          art.classList.remove('inv-icon-pop');
          void art.offsetWidth;
          art.classList.add('inv-icon-pop');
          setTimeout(function () { art.classList.remove('inv-icon-pop'); }, 450);
        }
      }
    }
  });
}

var _PREY_NAMES = { boulder: '毛毛虫!', bug: '苍蝇!', drop: '树叶!' };

export function playFloatingText(sx, sy, collectLayer, text) {
  if (!text) return;
  var pop = document.createElement('div');
  pop.className = 'collect-score-pop';
  if (text === 'Packed') pop.classList.add('collect-score-pop-packed');
  pop.textContent = text;
  pop.style.left = sx + 'px';
  pop.style.top = (text === 'Packed' ? (sy - 26) : sy) + 'px';
  pop.style.animation = 'collectScoreAnim 0.6s ease-out forwards';
  collectLayer.appendChild(pop);
  setTimeout(function () { if (pop.parentNode) pop.parentNode.removeChild(pop); }, 650);
}

export function playCollectFX(sx, sy, collectLayer, kind, labelOverride) {
  var flash = document.createElement('div');
  flash.className = 'collect-flash';
  flash.style.left = sx + 'px';
  flash.style.top = sy + 'px';
  flash.style.animation = 'collectFlashAnim 0.35s ease-out forwards';
  collectLayer.appendChild(flash);
  setTimeout(function () { if (flash.parentNode) flash.parentNode.removeChild(flash); }, 400);

  var label = labelOverride === false
    ? ''
    : (typeof labelOverride === 'string' ? labelOverride : (kind === 'drop' ? '' : (_PREY_NAMES[kind] || '')));
  if (label) {
    playFloatingText(sx, sy, collectLayer, label);
  }
}
