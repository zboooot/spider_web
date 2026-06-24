import flyUrl from './fly.png';
import fly01Url from './fly01.png';
import fly02Url from './fly02.png';
import leafUrl from './leaf.png';
import poopUrl from './poop.png';
import popoUrl from './popo.png';
import popoBlinkUrl from './popo_blink.png';
import popoBoredUrl from './popo_bored.png';
import popoCry01Url from './popo_cry01.png';
import popoCry02Url from './popo_cry02.png';
import popoPackUrl from './popo_pack.png';
import popoShockUrl from './popo_shock.png';
import wormUrl from './worm.png';
import worm00Url from './worm00.png';
import worm01Url from './worm01.png';
import worm02Url from './worm02.png';

function createImage(src) {
  var img = new Image();
  img.src = src;
  return img;
}

export var flyImg = createImage(flyUrl);
export var fly01Img = createImage(fly01Url);
export var fly02Img = createImage(fly02Url);
export var wormImg = createImage(wormUrl);
export var worm00Img = createImage(worm00Url);
export var worm01Img = createImage(worm01Url);
export var worm02Img = createImage(worm02Url);
export var leafImg = createImage(leafUrl);
export var poopImg = createImage(poopUrl);

export var popoHeadImg = createImage(popoUrl);
export var popoBlinkImg = createImage(popoBlinkUrl);
export var popoPackImg = createImage(popoPackUrl);
export var popoShockImg = createImage(popoShockUrl);
export var popoCry01Img = createImage(popoCry01Url);
export var popoCry02Img = createImage(popoCry02Url);
export var popoBoredImg = createImage(popoBoredUrl);
