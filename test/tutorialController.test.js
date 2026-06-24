import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createTutorialController,
  shouldStartTutorial,
  isTutorialInsectKind,
  canDragTutorialWrappedPrey,
  buildBreakersBatch,
  stoneOverlapsWebAt,
  stoneCrossesWebTopBand,
  shouldTriggerTutorialStoneImpact,
  resolveTutorialStoneImpactPoint,
  createTutorialStoneImpact,
  tickTutorialStoneImpact,
  applyWebPullTowardPoint,
  applyWebImpactKick,
  TUTORIAL_STONE_PULL_FRAMES,
  TUTORIAL_TARGETS
} from '../src/tutorial/tutorialController.js';

const W = 400;
const H = 700;
const CX = 200;
const CY = 350;

function drainTypes(controller) {
  return controller.drainActions().map(function (a) { return a.type; });
}

test('shouldStartTutorial respects skip and force URL flags', function () {
  assert.equal(shouldStartTutorial({ tutorial: '1', skipTutorial: '1' }), true);
  assert.equal(shouldStartTutorial({ skipTutorial: '1' }), false);
  assert.equal(shouldStartTutorial({}), true);
  assert.equal(shouldStartTutorial({}, '1'), false);
});

test('stoneOverlapsWebAt detects circle overlap without physics', function () {
  assert.equal(stoneOverlapsWebAt(200, 200, 63, 200, 400, 300), true);
  assert.equal(stoneOverlapsWebAt(200, -200, 63, 200, 400, 300), false);
});

test('stoneCrossesWebTopBand detects bottom edge crossing web top', function () {
  assert.equal(stoneCrossesWebTopBand(-50, -10, 63, 350, 348), true);
  assert.equal(stoneCrossesWebTopBand(60, 80, 63, 350, 348), false);
});

test('shouldTriggerTutorialStoneImpact uses disc entry or top-band crossing', function () {
  assert.equal(
    shouldTriggerTutorialStoneImpact(200, -120, 200, 0, 63, 200, 350, 348),
    true
  );
  assert.equal(
    shouldTriggerTutorialStoneImpact(200, -50, 200, -10, 63, 200, 350, 348),
    true
  );
  assert.equal(
    shouldTriggerTutorialStoneImpact(500, 10, 500, 30, 63, 200, 350, 348),
    false
  );
});

test('resolveTutorialStoneImpactPoint anchors the hole to a stable point on the web', function () {
  var pt = resolveTutorialStoneImpactPoint(280, -40, 200, 350, 180);
  assert.ok(pt.x > 200);
  assert.ok(pt.x < 200 + 180 * 0.5);
  assert.ok(pt.y > 350);
  assert.ok(pt.y < 350 + 180 * 0.22);
  var pt2 = resolveTutorialStoneImpactPoint(120, 40, 200, 350, 180);
  assert.ok(pt2.x < 200);
  assert.ok(pt2.y > 350);
});

test('tickTutorialStoneImpact pulls then signals break', function () {
  var impact = createTutorialStoneImpact(200, 120, 63);
  var result = { shouldBreak: false };
  for (var i = 0; i < TUTORIAL_STONE_PULL_FRAMES; i++) {
    result = tickTutorialStoneImpact(impact, 1);
  }
  assert.equal(result.shouldBreak, true);
  assert.equal(impact.phase, 'done');
});

test('applyWebPullTowardPoint moves nearby particles toward stone', function () {
  var particles = [
    { pos: { x: 210, y: 130 }, lastPos: { x: 210, y: 130 } },
    { pos: { x: 500, y: 500 }, lastPos: { x: 500, y: 500 } }
  ];
  var moved = applyWebPullTowardPoint(particles, 200, 120, 120, 0.8, 1);
  assert.ok(moved >= 1);
  assert.ok(particles[0].pos.x < 210);
  assert.ok(particles[0].pos.y < 130);
  assert.equal(particles[1].pos.x, 500);
});

test('applyWebImpactKick pushes nearby particles away from impact point', function () {
  var particles = [
    { pos: { x: 210, y: 130 }, lastPos: { x: 210, y: 130 } },
    { pos: { x: 500, y: 500 }, lastPos: { x: 500, y: 500 } }
  ];
  var moved = applyWebImpactKick(particles, 200, 120, 120, 6);
  assert.ok(moved >= 1);
  assert.ok(particles[0].pos.x > 210 || particles[0].pos.y > 130);
  assert.equal(particles[1].pos.x, 500);
});

test('buildBreakersBatch spawns three staggered stones with scaled sizes', function () {
  var batch = buildBreakersBatch(W, H, CX, CY);
  assert.equal(batch.length, 3);
  assert.equal(batch[0].kind, 'stone');
  assert.ok(batch[0].x < CX);
  assert.ok(batch[0].x > CX - 100);
  assert.equal(batch[0].defOverrides.r, 63);
  assert.equal(batch[0].delayFrames, 0);
  assert.equal(batch[0].breakScale, 1.18);
  assert.equal(batch[1].defOverrides.r, 40.95);
  assert.equal(batch[1].delayFrames, 30);
  assert.ok(batch[1].x > CX);
  assert.ok(batch[1].x < CX + 60);
  assert.equal(batch[1].breakScale, 1.003);
  assert.equal(batch[1].forcedStubCount, 1);
  assert.equal(batch[2].defOverrides.r, 45.864000000000004);
  assert.equal(batch[2].delayFrames, 45);
  assert.ok(batch[2].x > CX);
  assert.ok(batch[2].x > batch[1].x);
  assert.equal(batch[2].breakScale, 1.003);
  assert.equal(batch[2].forcedStubCount, 1);
});

test('isTutorialInsectKind only allows prey insects', function () {
  assert.equal(isTutorialInsectKind('boulder'), true);
  assert.equal(isTutorialInsectKind('bug'), true);
  assert.equal(isTutorialInsectKind('drop'), false);
  assert.equal(isTutorialInsectKind('poop'), false);
});

test('canDragTutorialWrappedPrey only allows guided collect phases', function () {
  assert.equal(canDragTutorialWrappedPrey('wait_collect_one'), true);
  assert.equal(canDragTutorialWrappedPrey('wait_collect_one_drag'), true);
  assert.equal(canDragTutorialWrappedPrey('wait_collect_two'), true);
  assert.equal(canDragTutorialWrappedPrey('wait_collect_two_drag'), true);
  assert.equal(canDragTutorialWrappedPrey('wave_one'), false);
  assert.equal(canDragTutorialWrappedPrey('wave_two'), false);
  assert.equal(canDragTutorialWrappedPrey('wait_repair_drag'), false);
});

test('tutorial flow reaches handoff after two collections', function () {
  var ctrl = createTutorialController(W, H, CX, CY);
  ctrl.start();

  var types = drainTypes(ctrl);
  assert.equal(types.length, 0);

  for (var i = 0; i < 180; i++) ctrl.tick(1);
  types = drainTypes(ctrl);
  assert.ok(types.includes('spawn_batch'));

  ctrl.handleEvent('stub_available');
  types = drainTypes(ctrl);
  assert.ok(types.includes('set_spider_mood'));

  for (var ri = 0; ri < 90; ri++) ctrl.tick(1);
  types = drainTypes(ctrl);
  assert.ok(types.includes('set_spider_mood'));

  for (var ci = 0; ci < 150; ci++) ctrl.tick(1);
  types = drainTypes(ctrl);
  assert.ok(types.includes('show_focus_prompt'));

  ctrl.handleEvent('repair_drag_started');
  types = drainTypes(ctrl);
  assert.ok(types.includes('hide_focus_prompt'));

  ctrl.handleEvent('repair_drag_completed');
  ctrl.handleEvent('repair_finished');
  types = drainTypes(ctrl);
  assert.ok(types.includes('spawn_batch'));
  assert.ok(types.includes('set_insect_target'));
  assert.equal(ctrl.getInsectTarget(), TUTORIAL_TARGETS.boulder);

  ctrl.handleEvent('object_wrapped', { kind: 'boulder' });
  types = drainTypes(ctrl);
  assert.ok(types.includes('show_focus_prompt'));

  ctrl.handleEvent('prey_drag_started');
  types = drainTypes(ctrl);
  assert.ok(types.includes('hide_focus_prompt'));

  ctrl.handleEvent('object_collected', { kind: 'boulder' });
  types = drainTypes(ctrl);
  assert.ok(types.includes('spawn_batch'));
  assert.ok(types.includes('clear_wave_drops'));

  ctrl.handleEvent('object_wrapped', { kind: 'boulder' });
  types = drainTypes(ctrl);
  assert.ok(types.includes('show_focus_prompt'));

  ctrl.handleEvent('prey_drag_started');
  types = drainTypes(ctrl);
  assert.ok(types.includes('hide_focus_prompt'));

  ctrl.handleEvent('object_collected', { kind: 'boulder' });
  types = drainTypes(ctrl);
  assert.ok(types.includes('show_focus_prompt'));

  ctrl.handleEvent('handoff_confirmed');
  types = drainTypes(ctrl);
  assert.ok(types.includes('show_blackout_message'));

  for (var bi = 0; bi < 90; bi++) ctrl.tick(1);
  types = drainTypes(ctrl);
  assert.ok(types.includes('mark_completed'));
  assert.ok(types.includes('handoff_to_level_1'));
  assert.equal(ctrl.isActive(), false);
});
