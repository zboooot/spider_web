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
  ['boulder', 'bug', 'drop'].forEach(function (k) {
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

/**
 * 收集特效：闪白圆 + 跳字网丝数量
 */
export function playCollectFX(obj, screenShellEl, canvas, collectLayer, W, H, SCORE_MULT) {
  var p = obj.particle.pos;
  var stageRect = screenShellEl.getBoundingClientRect();
  var canvasRect = canvas.getBoundingClientRect();
  var sx = (canvasRect.left - stageRect.left) + p.x * (canvasRect.width / W);
  var sy = (canvasRect.top - stageRect.top) + p.y * (canvasRect.height / H);

  var flash = document.createElement('div');
  flash.className = 'collect-flash';
  flash.style.left = sx + 'px';
  flash.style.top = sy + 'px';
  flash.style.animation = 'collectFlashAnim 0.35s ease-out forwards';
  collectLayer.appendChild(flash);
  setTimeout(function () { if (flash.parentNode) flash.parentNode.removeChild(flash); }, 400);

  var silkGain = typeof SCORE_MULT[obj.kind] === 'number' ? SCORE_MULT[obj.kind] : 1;
  var pop = document.createElement('div');
  pop.className = 'collect-silk-pop';
  pop.textContent = '+' + silkGain;
  pop.style.left = sx + 'px';
  pop.style.top = sy + 'px';
  pop.style.animation = 'collectSilkAnim 0.55s ease-out forwards';
  collectLayer.appendChild(pop);
  setTimeout(function () { if (pop.parentNode) pop.parentNode.removeChild(pop); }, 600);
}
