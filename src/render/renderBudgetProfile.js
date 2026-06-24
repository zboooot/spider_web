export function isMobileDevice(nav) {
  var maxTouchPoints = nav && typeof nav.maxTouchPoints === 'number' ? nav.maxTouchPoints : 0;
  var userAgent = nav && nav.userAgent ? nav.userAgent : '';
  return maxTouchPoints > 1 || /iPhone|iPad|Android/i.test(userAgent);
}

export function getRenderBudgetProfile(isMobile, devicePixelRatio) {
  var dpr = Math.max(1, devicePixelRatio || 1);
  return {
    sceneDpr: isMobile ? Math.min(dpr, 1.5) : dpr,
    backgroundDpr: isMobile ? Math.min(dpr, 1) : dpr,
    backgroundFrameInterval: isMobile ? 4 : 2,
  };
}
