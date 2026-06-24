import test from 'node:test';
import assert from 'node:assert/strict';

import { DistanceConstraint } from '../src/engine/constraints.js';
import { findWrappedReanchorPoint, projectPointToConstraint } from '../src/systems/wrappedSupport.js';

function makeParticle(x, y) {
  return { pos: { x: x, y: y } };
}

test('projectPointToConstraint clamps to the nearest point on the segment', function () {
  var c = new DistanceConstraint(makeParticle(0, 0), makeParticle(10, 0), 1, 10);
  var pt = projectPointToConstraint(14, 6, c);
  assert.equal(pt.x, 10);
  assert.equal(pt.y, 0);
  assert.equal(pt.t, 1);
});

test('findWrappedReanchorPoint returns nearest live segment when current support is gone', function () {
  var dead = new DistanceConstraint(makeParticle(0, 0), makeParticle(0, 10), 1, 10);
  var live = new DistanceConstraint(makeParticle(20, 0), makeParticle(20, 20), 1, 20);
  var pin = { a: live.a };
  var spiderweb = { constraints: [pin, live] };

  var pt = findWrappedReanchorPoint(18, 9, dead, spiderweb, null);

  assert.ok(pt);
  assert.equal(pt.c, live);
  assert.equal(pt.x, 20);
  assert.equal(pt.y, 9);
});

test('findWrappedReanchorPoint returns null when wrapped prey still has live support', function () {
  var live = new DistanceConstraint(makeParticle(0, 0), makeParticle(10, 0), 1, 10);
  var pin = { a: live.a };
  var spiderweb = { constraints: [pin, live] };

  var pt = findWrappedReanchorPoint(4, 3, live, spiderweb, null);

  assert.equal(pt, null);
});

test('findWrappedReanchorPoint abandons detached islands and reanchors to pinned web', function () {
  var anchoredA = makeParticle(0, 0);
  var anchoredB = makeParticle(20, 0);
  var driftingA = makeParticle(80, 0);
  var driftingB = makeParticle(100, 0);
  var anchored = new DistanceConstraint(anchoredA, anchoredB, 1, 20);
  var detached = new DistanceConstraint(driftingA, driftingB, 1, 20);
  var spiderweb = { constraints: [{ a: anchoredA }, anchored, detached] };

  var pt = findWrappedReanchorPoint(92, 6, detached, spiderweb, null);

  assert.ok(pt);
  assert.equal(pt.c, anchored);
  assert.equal(pt.y, 0);
});
