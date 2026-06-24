import test from 'node:test';
import assert from 'node:assert/strict';

import { DistanceConstraint } from '../src/engine/constraints.js';
import {
  resolveNavigation,
  isNavReachable,
  findNearestNavPoint,
  findNavPath,
  resolveActiveWaypointIndex,
  invalidateNavCache,
  getNavSteerHint,
  hasReachedNavGoal
} from '../src/systems/navigationGraph.js';

function makeParticle(x, y) {
  return { pos: { x: x, y: y } };
}

test('findNearestNavPoint snaps to anchored segment', function () {
  invalidateNavCache();
  var a = makeParticle(0, 0);
  var b = makeParticle(20, 0);
  var edge = new DistanceConstraint(a, b, 1, 20);
  var spiderweb = { constraints: [{ a: a }, edge], _topologyVersion: 1 };

  var pt = findNearestNavPoint(12, 4, spiderweb, null);
  assert.ok(pt);
  assert.equal(pt.y, 0);
  assert.ok(pt.x >= 0 && pt.x <= 20);
});

test('isNavReachable is true within anchored component', function () {
  invalidateNavCache();
  var a = makeParticle(0, 0);
  var b = makeParticle(20, 0);
  var c = makeParticle(40, 0);
  var ab = new DistanceConstraint(a, b, 1, 20);
  var bc = new DistanceConstraint(b, c, 1, 20);
  var spiderweb = { constraints: [{ a: a }, ab, bc], _topologyVersion: 2 };

  assert.equal(isNavReachable(2, 0, 36, 0, spiderweb, null), true);
});

test('isNavReachable is false across disconnected components', function () {
  invalidateNavCache();
  var anchoredA = makeParticle(0, 0);
  var anchoredB = makeParticle(20, 0);
  var islandA = makeParticle(80, 0);
  var islandB = makeParticle(100, 0);
  var anchored = new DistanceConstraint(anchoredA, anchoredB, 1, 20);
  var island = new DistanceConstraint(islandA, islandB, 1, 20);
  var spiderweb = { constraints: [{ a: anchoredA }, anchored, island], _topologyVersion: 3 };

  assert.equal(isNavReachable(10, 0, 90, 0, spiderweb, null), false);
});

test('findNavPath simplifies collinear chains', function () {
  invalidateNavCache();
  var pin = makeParticle(0, 0);
  var p1 = makeParticle(20, 0);
  var p2 = makeParticle(40, 0);
  var p3 = makeParticle(60, 0);
  var p4 = makeParticle(80, 0);
  var e1 = new DistanceConstraint(pin, p1, 1, 20);
  var e2 = new DistanceConstraint(p1, p2, 1, 20);
  var e3 = new DistanceConstraint(p2, p3, 1, 20);
  var e4 = new DistanceConstraint(p3, p4, 1, 20);
  var spiderweb = {
    constraints: [{ a: pin }, e1, e2, e3, e4],
    _topologyVersion: 5
  };

  var path = findNavPath(2, 0, 78, 0, spiderweb, null);
  assert.ok(path);
  assert.ok(path.length <= 3, 'expected simplified path, got ' + path.length);
});

test('resolveActiveWaypointIndex can lookahead to a farther corner', function () {
  var path = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 40 }
  ];
  var idx = resolveActiveWaypointIndex(path, 0, 18, 2, 8);
  assert.ok(idx >= 1);
});

test('getNavSteerHint returns next corner on an L-shaped path', function () {
  var path = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 40 }
  ];
  var hint = getNavSteerHint(10, 0, 40, 40, path);
  assert.ok(hint);
  assert.equal(hint.x, 40);
  assert.equal(hint.y, 0);
});

test('hasReachedNavGoal accepts close thorax or on-web proximity', function () {
  invalidateNavCache();
  var a = makeParticle(0, 0);
  var b = makeParticle(20, 0);
  var edge = new DistanceConstraint(a, b, 1, 20);
  var spiderweb = { constraints: [{ a: a }, edge], _topologyVersion: 6 };

  assert.equal(hasReachedNavGoal(18, 1, 19, 0, spiderweb, null, 16), true);
  assert.equal(hasReachedNavGoal(0, 0, 80, 0, spiderweb, null, 16), false);
});

test('resolveNavigation falls back to nearest reachable point', function () {
  invalidateNavCache();
  var anchoredA = makeParticle(0, 0);
  var anchoredB = makeParticle(20, 0);
  var islandA = makeParticle(80, 0);
  var islandB = makeParticle(100, 0);
  var anchored = new DistanceConstraint(anchoredA, anchoredB, 1, 20);
  var island = new DistanceConstraint(islandA, islandB, 1, 20);
  var spiderweb = { constraints: [{ a: anchoredA }, anchored, island], _topologyVersion: 4 };

  var nav = resolveNavigation(10, 0, 90, 0, spiderweb, null);
  assert.ok(nav);
  assert.equal(nav.snapped, true);
  assert.ok(nav.path.length >= 1);
  assert.ok(nav.destX <= 20);
});