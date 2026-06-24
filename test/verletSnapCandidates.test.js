import test from 'node:test';
import assert from 'node:assert/strict';

import { pickNearestSnapCandidate } from '../src/engine/VerletJS.js';

test('pickNearestSnapCandidate chooses the closest candidate', function () {
  var candidates = [
    { pt: { pos: { x: 210, y: 320 } }, d2: 120 },
    { pt: { pos: { x: 300, y: 350 } }, d2: 260 },
    { pt: { pos: { x: 240, y: 340 } }, d2: 80 }
  ];

  var picked = pickNearestSnapCandidate(candidates);

  assert.equal(picked, candidates[2]);
});

test('pickNearestSnapCandidate returns null for empty input', function () {
  assert.equal(pickNearestSnapCandidate([]), null);
  assert.equal(pickNearestSnapCandidate(null), null);
});
