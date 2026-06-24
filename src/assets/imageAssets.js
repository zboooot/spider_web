/**
 * Runtime image loaders.
 * Dev uses the native static server at /src/assets/*.
 * Production build inlines these via the Vite image-assets build plugin.
 */

function createImage(src) {
  var img = new Image();
  img.src = src;
  return img;
}

function assetPath(fileName) {
  return '/src/assets/' + fileName;
}

export var flyImg = createImage(assetPath('fly.png'));
export var fly01Img = createImage(assetPath('fly01.png'));
export var fly02Img = createImage(assetPath('fly02.png'));
export var wormImg = createImage(assetPath('worm.png'));
export var worm00Img = createImage(assetPath('worm00.png'));
export var worm01Img = createImage(assetPath('worm01.png'));
export var worm02Img = createImage(assetPath('worm02.png'));
export var leafImg = createImage(assetPath('leaf.png'));
export var poopImg = createImage(assetPath('poop.png'));

export var popoHeadImg = createImage(assetPath('popo.png'));
export var popoBlinkImg = createImage(assetPath('popo_blink.png'));
export var popoPackImg = createImage(assetPath('popo_pack.png'));
export var popoShockImg = createImage(assetPath('popo_shock.png'));
export var popoCry01Img = createImage(assetPath('popo_cry01.png'));
export var popoCry02Img = createImage(assetPath('popo_cry02.png'));
export var popoBoredImg = createImage(assetPath('popo_bored.png'));