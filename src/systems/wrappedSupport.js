import { DistanceConstraint } from '../engine/constraints.js';
import { ptSegDistSq } from '../physics/CollisionMath.js';

function isConstraintAlive(constraint, spiderweb, spatialOpts) {
  if (!constraint || !(constraint instanceof DistanceConstraint)) return false;
  if (spatialOpts && spatialOpts.index) {
    return !constraint.__webId || spatialOpts.index.isAliveId(constraint.__webId);
  }
  return spiderweb.constraints.indexOf(constraint) !== -1;
}

function getAliveSupportConstraints(spiderweb, spatialOpts) {
  var constraints = [];
  for (var i = 0; i < spiderweb.constraints.length; i++) {
    var constraint = spiderweb.constraints[i];
    if (!(constraint instanceof DistanceConstraint)) continue;
    if (constraint.__isStubAnchor) continue;
    if (!isConstraintAlive(constraint, spiderweb, spatialOpts)) continue;
    constraints.push(constraint);
  }
  return constraints;
}

function getAnchoredParticles(spiderweb, aliveConstraints) {
  var anchored = [];
  var queue = [];
  for (var i = 0; i < spiderweb.constraints.length; i++) {
    var constraint = spiderweb.constraints[i];
    if (constraint instanceof DistanceConstraint) continue;
    if (!constraint || !constraint.a) continue;
    if (anchored.indexOf(constraint.a) !== -1) continue;
    anchored.push(constraint.a);
    queue.push(constraint.a);
  }
  while (queue.length) {
    var particle = queue.shift();
    for (var ci = 0; ci < aliveConstraints.length; ci++) {
      var edge = aliveConstraints[ci];
      var next = null;
      if (edge.a === particle) next = edge.b;
      else if (edge.b === particle) next = edge.a;
      if (!next || anchored.indexOf(next) !== -1) continue;
      anchored.push(next);
      queue.push(next);
    }
  }
  return anchored;
}

function isConstraintAnchored(constraint, anchoredParticles) {
  return anchoredParticles.indexOf(constraint.a) !== -1 || anchoredParticles.indexOf(constraint.b) !== -1;
}

function findNearestAnchoredConstraint(px, py, constraints, anchoredParticles) {
  var best = null;
  var bestD2 = Infinity;
  for (var i = 0; i < constraints.length; i++) {
    var constraint = constraints[i];
    if (!isConstraintAnchored(constraint, anchoredParticles)) continue;
    var d2 = ptSegDistSq(px, py, constraint.a.pos.x, constraint.a.pos.y, constraint.b.pos.x, constraint.b.pos.y);
    if (d2 < bestD2) {
      bestD2 = d2;
      best = constraint;
    }
  }
  return best;
}

export function projectPointToConstraint(px, py, constraint) {
  var ax = constraint.a.pos.x;
  var ay = constraint.a.pos.y;
  var bx = constraint.b.pos.x;
  var by = constraint.b.pos.y;
  var dx = bx - ax;
  var dy = by - ay;
  var lenSq = dx * dx + dy * dy;
  var t = 0;
  if (lenSq > 1e-12) {
    t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
  }
  var x = ax + dx * t;
  var y = ay + dy * t;
  return { c: constraint, t: t, x: x, y: y };
}

export function findWrappedReanchorPoint(px, py, currentConstraint, spiderweb, spatialOpts) {
  if (!spiderweb) return null;
  var aliveConstraints = getAliveSupportConstraints(spiderweb, spatialOpts);
  if (!aliveConstraints.length) return null;
  var anchoredParticles = getAnchoredParticles(spiderweb, aliveConstraints);
  if (
    isConstraintAlive(currentConstraint, spiderweb, spatialOpts)
    && isConstraintAnchored(currentConstraint, anchoredParticles)
  ) return null;
  var nextConstraint = findNearestAnchoredConstraint(px, py, aliveConstraints, anchoredParticles);
  if (!nextConstraint) return null;
  return projectPointToConstraint(px, py, nextConstraint);
}
