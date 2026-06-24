import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyContourPhaseOffset,
  buildContourCacheKey,
  getPreyRenderAngle,
  getWrapDrawSize,
  isSilkWrappedKind,
  shouldDrawSilkForObject
} from '../src/render/preyWrapProfile.js';

test('isSilkWrappedKind covers bug boulder poop only', function () {
  assert.equal(isSilkWrappedKind('bug'), true);
  assert.equal(isSilkWrappedKind('boulder'), true);
  assert.equal(isSilkWrappedKind('poop'), true);
  assert.equal(isSilkWrappedKind('drop'), false);
});

test('getWrapDrawSize uses image aspect ratio when available', function () {
  var img = { naturalWidth: 80, naturalHeight: 100 };
  var bug = getWrapDrawSize('bug', 10, img);
  assert.equal(bug.height, 43.2);
  assert.ok(Math.abs(bug.width - 34.56) < 0.001);
});

test('getPreyRenderAngle matches prior conventions', function () {
  var bug = { kind: 'bug', angle: 1.2, _wrapAngle: 0.1 };
  assert.ok(Math.abs(getPreyRenderAngle(bug) - (1.2 + Math.PI / 2 + 0.1)) < 0.0001);

  var boulder = { kind: 'boulder', state: 'wrapped', stuckAngle: 0.8, _wrapAngle: 0 };
  assert.ok(Math.abs(getPreyRenderAngle(boulder) - (0.8 + Math.PI / 2)) < 0.0001);

  var poop = { kind: 'poop', angle: 2, _wrapAngle: 0.5 };
  assert.ok(Math.abs(getPreyRenderAngle(poop) - (2 * 0.45 + 0.5 * 0.6)) < 0.0001);
});

test('buildContourCacheKey changes when image fingerprint changes', function () {
  var imgA = { src: '/a.png', naturalWidth: 10, naturalHeight: 20 };
  var imgB = { src: '/b.png', naturalWidth: 10, naturalHeight: 20 };
  assert.notEqual(
    buildContourCacheKey('boulder', imgA, 12),
    buildContourCacheKey('boulder', imgB, 12)
  );
});

test('applyContourPhaseOffset rotates contour sample angles', function () {
  var contour = [{ r: 10, angle: 0 }, { r: 12, angle: Math.PI / 2 }];
  var shifted = applyContourPhaseOffset(contour, Math.PI / 4);
  assert.ok(Math.abs(shifted[0].angle - Math.PI / 4) < 0.0001);
});

test('shouldDrawSilkForObject requires spiral and wrapped lifecycle state', function () {
  var obj = {
    kind: 'bug',
    state: 'wrapping',
    _silkSpiral: [{ x: 0, y: 0 }]
  };
  assert.equal(shouldDrawSilkForObject(obj), true);
  obj._silkSpiral = null;
  assert.equal(shouldDrawSilkForObject(obj), false);
  obj._silkSpiral = [{ x: 0, y: 0 }];
  obj.state = 'stuck';
  assert.equal(shouldDrawSilkForObject(obj), false);
});