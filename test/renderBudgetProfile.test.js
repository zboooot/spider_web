import test from 'node:test';
import assert from 'node:assert/strict';

import { getRenderBudgetProfile } from '../src/render/renderBudgetProfile.js';

test('getRenderBudgetProfile caps mobile retina cost', function () {
  var profile = getRenderBudgetProfile(true, 3);

  assert.equal(profile.sceneDpr, 1.5);
  assert.equal(profile.backgroundDpr, 1);
  assert.equal(profile.backgroundFrameInterval, 4);
});

test('getRenderBudgetProfile leaves desktop rendering untouched', function () {
  var profile = getRenderBudgetProfile(false, 2);

  assert.equal(profile.sceneDpr, 2);
  assert.equal(profile.backgroundDpr, 2);
  assert.equal(profile.backgroundFrameInterval, 2);
});
