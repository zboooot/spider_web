import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on('console', (msg) => {
  console.log('[console:' + msg.type() + ']', msg.text());
});
page.on('pageerror', (err) => {
  console.log('[pageerror]', err.message);
});

await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' });
await page.click('#btn-level-tutorial');
await page.waitForTimeout(1500);

const result = await page.evaluate(() => {
  const overlay = document.getElementById('game-overlay');
  const hint = document.getElementById('tutorial-hint');
  const phase = document.getElementById('phase-bar');
  return {
    overlayDisplay: overlay ? getComputedStyle(overlay).display : null,
    hintDisplay: hint ? getComputedStyle(hint).display : null,
    hintText: hint ? hint.textContent : null,
    phaseText: phase ? phase.textContent : null,
    phaseDisplay: phase ? getComputedStyle(phase).display : null,
    hasFocusOverlay: !!document.querySelector('.tutorial-focus-overlay')
  };
});

console.log(JSON.stringify(result, null, 2));

await browser.close();
