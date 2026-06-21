# Single-Spider Level/Wave Implementation Plan

> Current baseline note: `userPriorityTarget` already exists in code and supports both object targets and valid web point targets. This plan starts from the current implementation rather than a blank slate.

**Goal:** Implement the single-spider multi-wave level structure and persistent same-level web damage first, while preserving the current fast wrapping feel, current click interactions, current HUD, and current broken-end dragging restrictions.

**Architecture:** Keep the existing physics and object simulation, but add a clearer gameplay layer on top of `src/main.js` that separates level data from wave data, introduces explicit wave runtime phase, and makes wave transitions preserve the same web. Reuse the current `userPriorityTarget`, `autoChaseTarget`, bullet time, and HUD behavior instead of rewriting them first.

**Tech Stack:** Vite, vanilla ES modules, Canvas 2D, existing custom Verlet physics engine.

---

## Planning Notes

- There is no automated test harness in this repo today.
- Verification remains `npm run build` plus focused in-browser checks with `npm run dev`.
- Keep changes small and sequential.
- Do not mix unrelated cleanup into these steps.
- `src/main.js` already contains current-targeting and HUD logic that should be integrated, not overwritten.

## Current Implemented Baseline

- `Auto Play` defaults to ON.
- Auto targeting currently chooses the nearest `stuck` object.
- `userPriorityTarget` already supports:
  - `object` target from clicking a trapped object
  - `point` target from clicking a valid web-covered position
- Invalid clicks on web-outside or broken holes are ignored.
- Preferred object targets pause and clear cleanly when invalidated.
- The spider cannot be dragged directly.
- Only broken web endpoints are draggable.
- Dragging a broken endpoint already triggers bullet time.
- HUD has already been redesigned:
  - centered top inventory
  - right-top `web.png` web badge
  - 网丝数量 HUD using collection weights
- `poop` is now partially implemented as a hazard baseline:
  - trapped `poop` can be targeted like other trapped objects
  - trapped `poop` stays on the web instead of auto-escaping
  - spider capture gives `+0` silk, black smoke burst, and `3s` stun
  - player can peel `poop` off the web by dragging to full tension and holding briefly
  - peeling `poop` off does not break web lines

## Shared Acceptance Rules

Every task should satisfy all of these before moving on:

1. `npm run build` succeeds.
2. The game still boots with `npm run dev`.
3. Wrapping still feels quick; do not slow `wrapDur` to add difficulty.
4. Current click behavior stays intact unless a later task explicitly changes it.

## Task 0: Sync Design Docs to Current Baseline

**Files:**
- Modify: `docs/plans/2026-06-21-single-spider-level-wave-design.md`
- Modify: `docs/plans/2026-06-21-single-spider-ai-implementation-breakdown.md`

**Goal:** Make the docs describe the current implemented input/HUD baseline before new gameplay work continues.

**Steps:**
1. Document the current preferred-target system.
2. Document the preserved point-target click behavior.
3. Document invalid click rejection.
4. Document current drag restrictions and bullet time.
5. Mark level/wave persistence and repair orders as planned, not already implemented.

**Manual acceptance:**
- Both docs match current code behavior.
- Future tasks no longer assume cancel-on-empty as the primary click model.

## Task 1: Create Level/Wave Data Shape

**Files:**
- Modify: `src/systems/levelSystem.js`
- Modify: `src/main.js`
- Modify: `src/entities/ThrownObj.js`

**Goal:** Separate `level` from `wave` so one level can contain multiple waves.

**Steps:**
1. Replace the flat 5-entry config with 5 level configs that each contain `waves`.
2. Keep level-owned data at level scope: targets, duration band, wave list.
3. Add runtime indices in `main.js` for `currentLevelIndex` and `currentWaveIndex`.
4. Add a helper to read the current wave config for spawns and object timers.
5. Keep the game booting even before every later mechanic is finished.

**Manual acceptance:**
- The app runs.
- One level now expresses multiple waves in config.
- Newly spawned objects can read timing from the current wave config.

## Task 2: Preserve Web State Across Waves

**Files:**
- Modify: `src/main.js`

**Goal:** Keep the same web for the full level.

**Steps:**
1. Remove the current rule that rebuilds the web when the next wave starts.
2. Ensure same-level wave transitions do not reset `spiderweb`, `brokenEnds`, or web damage state.
3. Keep full rebuild only for new level start, full restart, or retry after failure.
4. Verify that broken paths remain broken after a wave ends.

**Manual acceptance:**
- Break the web during a wave.
- Transition to the next wave.
- The same breaks are still present.

## Task 3: Add Explicit Wave Phases

**Files:**
- Modify: `src/main.js`
- Modify: `src/systems/levelSystem.js`

**Goal:** Turn waves into authored `falling` plus `pause` windows.

**Steps:**
1. Add explicit wave runtime phases such as `WAVE_FALLING` and `WAVE_PAUSE`.
2. Store falling duration and pause duration per wave.
3. Stop new spawns during pause phases.
4. Keep existing objects active during pause phases.
5. Show simple phase text in a small debug/HUD surface while tuning.

**Manual acceptance:**
- During falling phase, objects spawn.
- During pause phase, no new objects spawn.
- Existing objects remain active.

## Task 4: Change Level End Rules

**Files:**
- Modify: `src/main.js`

**Goal:** A level ends only on collectible completion or web break, not at every wave boundary.

**Steps:**
1. Remove the current wave-result flow that resets to a fresh board between old segments.
2. Make wave completion advance only to the next wave in the same level.
3. Keep level completion tied to collecting the level's required objects.
4. Keep game over tied to web failure threshold.

**Manual acceptance:**
- Finishing a wave does not show the current reset-to-new-board behavior.
- Completing all level requirements still ends the level.
- Web failure still ends the level immediately.

## Task 5: Centralize Next-Goal Resolution

**Files:**
- Modify: `src/main.js`

**Goal:** One function decides what the spider should do next.

**Current groundwork already present:**
- `userPriorityTarget`
- `autoChaseTarget`
- target-loss pause

**Planned next rule:**
- `repairOrder > userPriorityTarget > nearestAutoTarget`

## Task 6: Formalize Preferred Target Model

**Files:**
- Modify: `src/main.js`

**Goal:** Keep the current click behavior but make the target model explicit.

**Requirements:**
- Preserve object target clicks.
- Preserve valid web point target clicks.
- Preserve invalid click rejection.
- Cleanly clear invalidated object targets.

## Task 7: Allow Movement-Time Redirection

**Files:**
- Modify: `src/main.js`

**Goal:** Redirect immediately while the spider is only traveling.

## Task 8: Preserve Invalid-Click No-Op Rule

**Files:**
- Modify: `src/main.js` if needed

**Goal:** Keep invalid clicks ignored.

**Requirements:**
- Clicking outside web coverage does nothing.
- Clicking inside broken holes does nothing.
- No marker appears for invalid clicks.

## Task 9: Lock Execution States

**Files:**
- Modify: `src/main.js`

**Goal:** Movement is interruptible; execution is not.

## Task 10: Add `repairOrder` Single Slot

**Files:**
- Modify: `src/main.js`
- Modify: `src/render/webRenderer.js` if visual feedback is needed

**Goal:** Support exactly one highest-priority repair order.

## Task 11: Create Repair Order from Broken Endpoints

**Files:**
- Modify: `src/main.js`
- Modify: `src/engine/VerletJS.js`
- Modify: `src/render/webRenderer.js`

**Goal:** Turn the existing endpoint drag interaction into a real order.

## Task 12: Implement Repair Execution

**Files:**
- Modify: `src/main.js`
- Modify: `src/systems/webIntegrity.js`

**Goal:** The spider can restore a path after finishing current execution.

## Task 13: Re-evaluate `drop` as Side Collection

**Files:**
- Modify: `src/entities/ThrownObj.js`
- Modify: `src/main.js`
- Modify: `src/systems/levelSystem.js`
- Modify: HUD text if needed

**Goal:** Decide whether `drop` remains a main target or becomes low-value side collection after the wave system is stable.

## Task 14: Add Hazard Object Type

**Files:**
- Modify: `src/entities/ThrownObj.js`
- Modify: `src/main.js`
- Modify: `src/render/objectRenderer.js`
- Modify: `src/systems/levelSystem.js`

**Goal:** Introduce a visible zero- or low-reward hazard only after Tasks 1-4 are stable.

**Current status:**
- `poop` now exists in the runtime as a zero-silk hazard object.
- Remaining work is tuning spawn balance, visuals, and long-term level integration.

## Task 15: Add Hazard Penalty State

**Files:**
- Modify: `src/main.js`

**Goal:** Add a non-interruptible punishment state only after target and wave flow are stable.

**Current status:**
- `poop` capture already triggers a `3s` spider stun baseline.
- Remaining work is making this fit the future unified action-state model cleanly.

## Task 16: Consider Manual Hazard Drag-Out

**Files:**
- Modify: `src/main.js`
- Modify: relevant input handling paths

**Goal:** Decide whether non-web direct dragging should expand beyond the current broken-end-only rule.

**Current status:**
- direct drag-out is implemented only for trapped `poop`
- the drag requires strong tension plus a short hold before peel-off
- peel-off never deletes web constraints

## Task 17: Keep Auto Selection as Simple Nearest Visible

**Files:**
- Modify: `src/main.js`

**Goal:** Preserve the intentionally dumb assistant model.

## Task 18: Author Wave Content for All 5 Levels

**Files:**
- Modify: `src/systems/levelSystem.js`
- Modify: `src/main.js`

**Goal:** Replace random-feeling segment progression with authored level/wave pressure.

**Steps:**
1. Define wave content per level by player experience first, not object count first.
2. For every wave, write a short intent label in config or comments, such as:
   - teaching
   - operating
   - break
   - pollution
   - triage
   - collapse
3. For every wave, define:
   - primary pressure
   - secondary pressure
   - weak background pressure
4. For every falling phase, support three timing bands:
   - opening
   - conflict
   - closing
5. Put the main decision conflict mostly in the conflict band.
6. Keep pause phases short and do not attach repair buffs to them.
7. Spread required collectible progress across the level so early waves rarely finish the whole level outright.
8. Introduce light runtime tuning only if needed and keep it narrow, around 10% to 20% maximum.

**Manual acceptance:**
- Every wave can be summarized as one clear player judgment problem.
- Different waves feel different because the pressure mix changes, not only because counts go up.
- Opening, conflict, and closing timing bands feel readable.
- Pause phases reduce new input without becoming free repair windows.
- Required collectibles are not front-loaded so heavily that the level usually ends too early.

### Task 18A: Define Wave Experience Tags

**Files:**
- Modify: `src/systems/levelSystem.js`

**Goal:** Give each wave a player-facing identity before tuning numbers.

**Steps:**
1. Add one short tag or note per wave.
2. Keep tags stable enough to use in balancing discussions.
3. Use the tags to reason about whether the wave is serving a unique role.

**Manual acceptance:**
- Every wave has one clear intent label.
- No wave is just “more stuff” without a reason.

### Task 18B: Author Wave Timing Bands

**Files:**
- Modify: `src/systems/levelSystem.js`
- Modify: `src/main.js`

**Goal:** Avoid uniform spawning across a whole wave.

**Steps:**
1. Support separate spawn logic for opening, conflict, and closing bands.
2. Keep opening band readable.
3. Make the conflict band carry the heaviest overlap.
4. Use the closing band to leave useful backlog for pause decisions rather than create fresh chaos.

**Manual acceptance:**
- The middle of the wave is where the hardest choices happen.
- The end of the wave leads naturally into a decision pause.

### Task 18C: Tune Wave Pressure by Workload

**Files:**
- Modify: `src/systems/levelSystem.js`

**Goal:** Balance waves by estimated spider workload instead of object count only.

**Steps:**
1. Assign rough workload assumptions for:
   - high-value prey
   - leaves
   - repair jobs
   - poop risk
2. Classify each wave roughly as teaching, stable, tension, crisis, or collapse.
3. Tune spawn count, timing, and overlap around those intended bands.

**Manual acceptance:**
- Early waves feel manageable.
- Mid-game waves create meaningful tradeoffs.
- Late waves can trigger collapse after repeated bad calls without feeling random.

### Task 18D: Add Light Progress-Based Adjustment

**Files:**
- Modify: `src/main.js`
- Modify: `src/systems/levelSystem.js`

**Goal:** Allow small runtime correction without erasing consequences.

**Steps:**
1. Add optional small modifiers based on collectible progress gap and current web condition.
2. Keep the adjustment subtle.
3. Never fully rescue the player from earlier mistakes.

**Manual acceptance:**
- The game remains readable when the player falls behind.
- Mistakes still matter.
- Runtime adjustment feels subtle rather than manipulative.

## Task 19: Tune the Negative Loop

**Files:**
- Modify: `src/main.js`
- Modify: `src/systems/levelSystem.js`
- Modify: object timings if needed

**Goal:** One bad decision is survivable; repeated bad ones can collapse the run.

## Suggested Execution Order

1. Task 0
2. Task 1
3. Task 2
4. Task 3
5. Task 4
6. Task 5
7. Task 6
8. Task 7
9. Task 8
10. Task 9
11. Task 10
12. Task 11
13. Task 12
14. Task 13
15. Task 14
16. Task 15
17. Task 16
18. Task 17
19. Task 18
20. Task 19

## Manual Verification Commands

Run after each meaningful task:

```bash
npm run build
```

Run for interactive verification:

```bash
npm run dev
```

## Final Acceptance Checklist

- One level now contains multiple waves.
- The web persists across waves inside a level.
- Pause phases stop new spawns but do not stop existing objects.
- Current object-click and valid-point-click behavior still works.
- Invalid clicks still do nothing.
- Movement is interruptible; execution is not.
- Repair orders can later slot above the current preferred-target system.
- Wrapping speed and overall feel remain intact.
