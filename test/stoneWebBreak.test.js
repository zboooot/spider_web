import test from 'node:test';
import assert from 'node:assert/strict';

import { DistanceConstraint } from '../src/engine/constraints.js';
import { breakWebInRadius } from '../src/entities/ThrownObj.js';

function makeParticle(x, y) {
  return { pos: { x: x, y: y }, __pid: x + ':' + y };
}

test('breakWebInRadius uses the stone radius for destruction', function () {
  var a = makeParticle(0, 0);
  var b = makeParticle(30, 0);
  var near = new DistanceConstraint(a, b, 1, 30);
  near.__webId = 1;

  var farA = makeParticle(100, 0);
  var farB = makeParticle(130, 0);
  var far = new DistanceConstraint(farA, farB, 1, 30);
  far.__webId = 2;

  var spiderweb = { constraints: [near, far], particles: [a, b, farA, farB] };
  var removed = [];
  var index = {
    isAliveId: function (id) { return id === 1 || id === 2; },
    removeConstraint: function (id) { removed.push(id); }
  };

  var broke = breakWebInRadius(12, 0, 14, spiderweb, [], 0, null, { index: index }, true);
  assert.equal(broke, 1);
  assert.deepEqual(removed, [1]);
});

test('breakWebInRadius can force tutorial stub creation for deterministic repair flow', function () {
  var a = makeParticle(0, 0);
  var b = makeParticle(30, 0);
  var c = makeParticle(60, 20);
  var d = makeParticle(60, -20);
  var near = new DistanceConstraint(a, b, 1, 30);
  var branchA = new DistanceConstraint(b, c, 1, 36);
  var branchB = new DistanceConstraint(b, d, 1, 36);

  var spiderweb = { constraints: [near, branchA, branchB], particles: [a, b, c, d] };

  var broke = breakWebInRadius(12, 0, 14, spiderweb, [], 0, null, null, true, 1);

  assert.equal(broke, 1);
  assert.ok(spiderweb.particles.some(function (pt) { return !!pt.__isStub; }));
});

test('breakWebInRadius can force two tutorial stubs for the large stone', function () {
  var a = makeParticle(0, 0);
  var b = makeParticle(30, 0);
  var c = makeParticle(60, 20);
  var d = makeParticle(60, -20);
  var near = new DistanceConstraint(a, b, 1, 30);
  var branchA = new DistanceConstraint(b, c, 1, 36);
  var branchB = new DistanceConstraint(b, d, 1, 36);

  var spiderweb = { constraints: [near, branchA, branchB], particles: [a, b, c, d] };
  breakWebInRadius(12, 0, 14, spiderweb, [], 0, null, null, true, 2);

  var stubs = spiderweb.particles.filter(function (pt) { return !!pt.__isStub; });
  assert.ok(stubs.length >= 2);
});
