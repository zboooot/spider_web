# Single-Spider Level/Wave Design

## Goal

Turn the current fast single-run spider prototype into a short-form management game where one spider survives a whole level across multiple waves on the same damaged web.

The player still does not perform most labor directly. The player corrects a simple automatic system by setting the next preferred target, choosing where the spider should move on the current web, and later issuing repair work on broken routes.

This document is synced to the current implemented baseline first, then marks the remaining planned systems explicitly.

## One-Sentence Loop

Each level should play on one continuous web across multiple waves: the spider auto-targets the nearest valid trapped object, the player can override with an object target or a valid web point target, and repeated poor prioritization should lead to missed pickups, growing web damage, and eventual collapse.

## Simplest Possible Loop

### Current Implemented Baseline

1. Objects fall onto the web and become collectible only after they enter `stuck` state.
2. The spider auto-targets the nearest `stuck` object when `Auto Play` is on.
3. The player can click a trapped object to set a preferred object target.
4. The player can click a still-covered web position to set a preferred point target.
5. The player cannot drag the spider directly.
6. The player can drag only broken web endpoints.
7. Dragging a broken endpoint triggers bullet time while the rest of the world pauses.

### Planned Full Loop

1. A level contains multiple authored waves on one persistent web.
2. The spider chooses the next action from one fixed priority rule.
3. During travel, the player can redirect the spider with object or point targeting.
4. The player can connect two broken endpoints to create a highest-priority repair order.
5. Later waves add more explicit pressure and hazard types.
6. The level ends only on completion or web break, not at each wave boundary.

## Core Design Intent

This version is deliberately not a dexterity game. It should feel like managing a flawed but predictable assistant.

The spider is intentionally simple:
- It auto-selects the nearest valid trapped object.
- It does not understand value.
- It does not understand danger.
- It can be corrected while moving.
- It should not be instantly redirected out of committed execution states.

The player is intentionally limited:
- The player cannot draw arbitrary new web.
- The player cannot directly drag the spider.
- The player cannot queue many commands.
- The player can currently set exactly one preferred target at a time.
- The player can currently drag only broken web endpoints.

The game should preserve the current quick wrapping and collection feel. Depth comes from overlapping obligations, not from making any single action slower.

## Current Implemented Interaction Rules

### Auto Targeting

- `Auto Play` is enabled by default.
- The spider auto-locks the nearest `stuck` object.
- Auto targeting pauses briefly after wrapping or target loss.

### Preferred Target

The runtime slot is currently `userPriorityTarget`.

It supports two target types:
- `object`: click a trapped object
- `point`: click a web-covered point

Rules already in code:
- Clicking a `stuck` object sets object priority.
- Clicking a web-covered point sets point priority.
- Clicking outside the web or inside a broken hole does nothing.
- If a preferred object target disappears or becomes invalid, the spider pauses for about `0.5s` and then re-evaluates.
- With a preferred point target, the spider avoids incidental wrapping on the way.
- With a preferred object target, the spider avoids other objects and only wraps the chosen target.

### Dragging

- The spider is not draggable.
- Normal web nodes are not draggable.
- Only broken endpoints are draggable.
- Dragging a broken endpoint triggers bullet time.

## Level Structure

- Total levels: 5
- Current codebase still needs explicit level/wave separation.
- Each level should own:
  - one persistent web state
  - one collectible requirement table
  - one sequence of wave configs
  - one failure threshold based on accumulated web damage

Planned rebuild rules:
- rebuild web when starting a new level
- rebuild web when restarting the run
- rebuild web when retrying after failure
- do not rebuild web between waves in the same level

## Wave Structure

### Current Implemented Baseline

The current code still uses a spawner-internal `cooldown` / `burst` cycle and treats each old level config as one full segment.

### Planned Wave Model

Each authored wave should have two gameplay phases.

### Falling Phase

For a fixed duration, the game spawns a configured mix of objects.

Current live object set:
- `boulder`
- `bug`
- `drop`
- `poop`

Planned later expansion:
- add more authored per-wave mixes
- possibly add hazard objects after the level/wave foundation is stable

### Pause Phase

For a short duration, no new objects are spawned.

Important:
- Existing objects remain on the web.
- Existing danger remains active.
- Repairs should not become free or faster.
- The pause is only a lower-noise decision window.

## Win/Loss Conditions

### Current Implemented Baseline

- A run currently advances by completing the target table of the current config.
- The web currently breaks the run when internal `webLossPct >= 50`.
- The existing UI still says `Wave Complete` even though the old code flow is effectively level progression.

### Planned Level Win

The player wins the level immediately when all required collectibles for that level are gathered.

### Planned Level Loss

The player loses immediately when web damage reaches the failure threshold.

Failure should usually come from a chain of 2-3 bad decisions rather than one mistake.

## Persistent Web Damage Within a Level

### Current Implemented Baseline

- Broken routes are real.
- Broken endpoints are tracked.
- Broken-end dragging already exists.
- Clicking through broken holes is already rejected for point targets.

### Planned Same-Level Persistence

Within a level:
- broken edges should stay broken across waves
- broken endpoints should stay broken until repaired
- pathing consequences should remain active between waves
- isolated weak areas should continue to matter

The intended feeling is that the level becomes its own history.

## Player Interaction Rules

The player currently has two implemented direct interventions and one partially prepared interaction.

### 1. Click a Trapped Object

Current behavior:
- clicking a `stuck` object sets `userPriorityTarget.type = 'object'`
- clicking another object replaces the previous object target
- the target is highlighted visually

Planned interpretation:
- this is the object-target branch of the future priority system

### 2. Click a Valid Web Point

Current behavior:
- clicking a still-covered point on the web sets `userPriorityTarget.type = 'point'`
- the spider moves toward that point
- route holes and off-web clicks are ignored

Design note:
- this point-target interaction is intentionally preserved and is now part of the synced design baseline

### 3. Connect Two Broken Endpoints

Current behavior:
- broken endpoints are draggable
- bullet time activates during endpoint dragging
- no repair order is created yet

Planned behavior:
- dragging from one valid broken endpoint to another should create one highest-priority repair order

### 4. Drag `poop` Off the Web

Current behavior:
- `poop` can be clicked like any other trapped object and set as an object priority target
- if the player drags far enough on a trapped `poop`, the interaction switches from click to drag
- the `poop` remains strongly attached to the web while dragging
- the player must pull to the limit and hold for about `1s` before the `poop` peels off
- peeling a `poop` off does not break web lines
- once peeled off, the `poop` flies away in the drag direction and falls off-screen

## Spider State Model

### Current Implemented Baseline

The live code explicitly supports:
- auto travel
- preferred-target travel
- wrapping
- collecting
- short pause after target loss
- `poop` stun lock after spider capture

### Planned Expanded State Names

- `Idle`
- `TravelToAuto`
- `TravelToPriorityObject`
- `TravelToPriorityPoint`
- `TravelToRepair`
- `PauseAfterCancelOrLoss`
- `Wrapping`
- `Repairing`
- `Collecting`
- `StunnedByPoop`

### Interrupt Rules

Current baseline:
- travel can be redirected
- `wrapping` is effectively non-interruptible

Planned full rule:
- movement is interruptible
- execution is commitment
- `Wrapping`, `Repairing`, `Collecting`, and `StunnedByPoop` should be treated as non-interruptible execution states

## Priority Resolution

### Current Implemented Baseline

The current live behavior is:

`preferred target > nearest auto target`

Where preferred target may be:
- a trapped object
- a valid web point

### Planned Full Rule

The future unified rule should be:

`repairOrder > preferred target > nearest auto target`

Interpretation:
- repair orders outrank everything
- player preference outranks system automation
- system automation stays intentionally dumb

## Object Roles

### Boulder

Current role:
- high-value collection target
- larger web pressure source
- 网丝数量 `+5`

### Bug

Current role:
- medium-value collection target
- 网丝数量 `+4`

### Drop

Current role:
- low-value collection target
- currently still part of the main objective table
- 网丝数量 `+1`

Planned role:
- may later become a lower-priority side collection rather than a required main objective

### Poop

Current role:
- hazard object
- can be auto-targeted because nearest-auto logic is still simple
- can be manually clicked as a preferred object target
- can be manually dragged off the web
- does not add to the top collectible inventory bar
- 网丝数量 `+0`

Current captured behavior:
- once trapped, `poop` stays on the web and does not auto-escape
- while trapped, it slow-pulses with a dark flash
- if the spider finishes wrapping it, a black smoke burst plays and the spider is stunned in place for `3s`

Current manual cleanup behavior:
- dragging it creates a strong sticky resistance feeling
- the web object connection stays intact while dragging
- pulling it off never breaks the web itself
- after the player reaches full tension and holds briefly, it peels off and is flung away

## HUD Baseline

The current HUD is already part of the synced design:

- top-center collectible inventory bar
- right-top web integrity badge using `src/assets/web.png`
- web number and `%` rendered as separate HUD elements
- 网丝数量显示在 web badge 下方
- 网丝数量按收集权重累积
- preferred object targets flash white without an extra outer ring

## Negative Loop Design

The intended failure spiral should still come from accumulation, not sudden randomness.

Current baseline already supports the first half of that feeling:
- auto targeting can choose a merely nearest object
- player correction matters
- invalid clicks do nothing
- target loss causes a brief recovery pause
- broken web holes remove usable movement/selection area
- trapped `poop` can waste spider time and force a `3s` stun if not manually removed

Planned next step:
- same web must persist across waves so bad decisions stack inside one level

## Wave Design Principles

Waves should change the type of pressure, not only the quantity.

Every wave must be designed around one clear player judgment problem.

If a wave cannot be summarized as one clear question, it is probably too noisy.

Good examples of wave questions are:
- Should I repair now or keep collecting?
- Should I manually mark that high-value target before the spider wastes time on something closer?
- Should I drag poop out now before the spider auto-targets it?
- Can I afford to ignore leaves for the moment?

### Three Pressure Types

Each wave should be built from three pressure types:

1. Collection Pressure
- high-value prey
- low-value leaves
- level collectible progress

2. Repair Pressure
- newly broken routes
- unresolved old breaks
- detour cost caused by damaged paths

3. Cleanup Pressure
- poop count
- poop placement
- risk that nearest-auto logic chooses the wrong thing

Each wave should use:
- one primary pressure
- one secondary pressure
- one weak background pressure

Avoid making all three equally strong unless the wave is intentionally a late-game collapse wave.

### Spider Workload Framing

Do not balance waves by raw object count alone.
Balance them by estimated spider workload.

A useful design approximation is:

`wave workload = collection workload + repair workload + cleanup risk workload`

The exact values should be tuned during implementation, but the intended pressure bands are:
- Teaching wave: about 70% to 80% of available spider time
- Stable wave: about 85% to 95%
- Tension wave: about 95% to 105%
- Crisis wave: about 105% to 115%
- Collapse wave: above 115%, used sparingly

The goal is to create pressure through overlap and judgment, not through random clutter.

### Wave Timing Structure

Each falling phase should be divided into three timing bands rather than using one uniform spawn curve.

1. Opening Band
- about 20% of the falling phase
- establishes the main problem
- should remain readable

2. Conflict Band
- about 50% to 60% of the falling phase
- primary and secondary pressures overlap here
- this is where the real decision cost should happen

3. Closing Band
- about 20% to 30% of the falling phase
- should stop introducing too many fresh problems
- should leave a meaningful backlog for the pause window

### Pause Rule

The pause phase is not a reward phase.

It exists only to reduce new incoming objects and give the player a short natural decision window.

The pause phase should not:
- repair faster
- repair cheaper
- automatically stabilize the board
- feel like free recovery

The pause phase should let the player decide whether to:
- issue a repair order
- redirect to the next most important target
- manually remove poop
- ignore low-value objects and accept the risk

### Wave Experience Matrix

Useful authored wave archetypes are:
- Teaching Wave
- Operating Wave
- Break Wave
- Pollution Wave
- Triage Wave
- Collapse Wave

Their intended roles are:

| Wave Type | Primary Pressure | Secondary Pressure | Intended Lesson |
|---|---|---|---|
| Teaching | Collection | Repair | Learn marking and repair timing |
| Operating | Collection | Cleanup | Learn that not everything deserves attention |
| Break | Repair | Collection | Learn that unresolved structure damage carries forward |
| Pollution | Cleanup | Collection | Learn that poop is an automation pollutant |
| Triage | Collection | Repair or Cleanup | Learn that one correct choice excludes another |
| Collapse | Repair | Cleanup | Reveal the negative loop after accumulated mistakes |

### Progress-Tied Tuning

Wave content may react lightly to player state, but should not strongly rubber-band.

Allowed:
- small reduction in trash density if the player is far behind on required collectibles
- small reduction in extreme overlap if the web is already near failure

Not allowed:
- dramatic rescue behavior
- hidden systems that erase the consequences of bad choices

Recommended runtime adjustment range:
- about 10% to 20% at most

### Balance by Object Role

High-value prey:
- should define the main reason to redirect the spider
- should mostly appear during conflict bands
- should be distributed across middle and late waves so the level does not end too early

Leaves:
- should remain low-value
- should sometimes be worth taking if they are naturally on the way
- should more often be safe to ignore

Poop:
- should be visually unmistakable
- should be dangerous because nearest-auto logic is simple
- should be common enough to matter, but not so common that the game becomes janitorial

### Key Design Test

A wave is well designed if, after playing it, the player can clearly say:
- what the main problem of the wave was
- what they chose to prioritize
- what they ignored
- why the next wave became easier or harder

## Suggested 5-Level Progression

### Level 1

- teach object target and point target correction
- teach that invalid clicks on broken holes do nothing
- teach broken-end dragging
- wave count: 3

Recommended wave flow:

| Wave | Player Question | Primary Pressure | Secondary Pressure | Notes |
|---|---|---|---|---|
| 1-1 | What will the spider do if I do nothing? | Collection | Low repair | No poop. Very readable opening. |
| 1-2 | Which target is worth manually marking first? | Collection | Repair | First obvious redirect moment. |
| 1-3 | Should I repair now or greed one more pickup? | Repair | Collection | First real same-level carryover lesson. |

### Level 2

- teach persistent web damage across waves
- make board continuity obvious
- wave count: 4

Recommended wave flow:

| Wave | Player Question | Primary Pressure | Secondary Pressure | Notes |
|---|---|---|---|---|
| 2-1 | This board persists; what should I leave unfinished? | Collection | Repair | Safe opener with visible leftovers. |
| 2-2 | Is that leaf worth the time right now? | Collection | Cleanup-like leaf pressure | Still no poop. Leaves become meaningful noise. |
| 2-3 | If I skip this repair, how much worse is next wave? | Repair | Collection | Strong carryover lesson. |
| 2-4 | Is this pause for fixing or finishing? | Repair | Collection | Short decision window, no repair bonus. |

### Level 3

- increase overlap pressure
- introduce poop as an automation pollutant
- wave count: 4 to 5

Recommended wave flow:

| Wave | Player Question | Primary Pressure | Secondary Pressure | Notes |
|---|---|---|---|---|
| 3-1 | Can I still run a clean level without major mistakes? | Collection | Repair | Warm entry into the level. |
| 3-2 | Do I drag this poop now or accept the risk? | Cleanup | Collection | First poop exposure. Keep count low. |
| 3-3 | What happens if I ignore a bad nearest target? | Cleanup | Collection | First visible poop mistake punishment. |
| 3-4 | Repair or poop removal: which one is actually first? | Repair | Cleanup | First true conflict between them. |
| 3-5 optional | Did I really learn to correct the auto system? | Collection | Cleanup | Validation wave. |

### Level 4

- overlap collection pressure with repair pressure
- make single-spider workload clearly insufficient for perfect play
- wave count: 5

Recommended wave flow:

| Wave | Player Question | Primary Pressure | Secondary Pressure | Notes |
|---|---|---|---|---|
| 4-1 | Do I stabilize first or keep pace with collection? | Collection | Repair | Sets the tone. |
| 4-2 | Is this route more important than that prey? | Collection | Repair | Strong conflict band. |
| 4-3 | Is poop now more urgent than low-value work? | Cleanup | Collection | Pollution wave. |
| 4-4 | I can only do one thing first. Which one? | Repair | Collection | Hard triage wave. |
| 4-5 | Can I keep the system stable under overlapping pressure? | Collection | Repair/Cleanup | Full mixed wave. |

### Level 5

- sustained triage under low slack
- expose the negative loop after repeated mistakes
- wave count: 5 to 6

Recommended wave flow:

| Wave | Player Question | Primary Pressure | Secondary Pressure | Notes |
|---|---|---|---|---|
| 5-1 | There is no free setup time now. What matters immediately? | Collection | Repair | Fast opening pressure. |
| 5-2 | If I do not clean this now, will the spider waste itself? | Cleanup | Repair | Strong poop tension. |
| 5-3 | Which valuable target do I accept losing? | Collection | Cleanup | Core triage wave. |
| 5-4 | How do I recover from the mistake I already made? | Repair | Cleanup | Shows carryover punishment. |
| 5-5 | What do I protect when collapse has already started? | Repair | Collection | Collapse-edge wave. |
| 5-6 optional | Final closure with tiny recovery space | Collection | Repair/Cleanup | Not a free win; only a final test. |

### Level-to-Wave Experience Rule

Each level should escalate by changing the kind of judgment the player must make, not only by increasing quantity.

Recommended progression logic:
- Level 1: understand marking and repair timing
- Level 2: understand persistent web damage across waves
- Level 3: understand poop as an automation pollutant
- Level 4: manage overlapping repair, collection, and cleanup
- Level 5: survive collapse pressure caused by accumulated mistakes

## Known Design Problems and Solutions

### Problem: Current code still treats one config as one whole segment

Solution:
- separate level data from wave data
- keep web rebuild only for real level transitions

### Problem: Current preferred-target model is ahead of the docs

Solution:
- sync docs to the existing object-target and point-target behavior
- keep invalid click rejection explicit

### Problem: Current broken-end dragging has no repair result yet

Solution:
- keep the dragging restriction and bullet time baseline
- layer real repair-order validation on top later

### Problem: Current drop objects are still required objectives

Solution:
- leave them as-is for now in the synced baseline
- revisit objective composition after level/wave persistence lands

## Out of Scope for This Version

- multiple spiders
- arbitrary web construction
- complex queued commands
- direct spider dragging
- value-aware auto AI
- meta-progression outside the run

## Success Criteria

This design is working if all of the following are true:

1. Wrapping still feels quick and satisfying.
2. The player clearly understands what clicks are valid and invalid.
3. Preferred object targets and preferred point targets are both readable and useful.
4. The web eventually persists across multiple waves in the same level.
5. Wave pauses reduce noise without granting free recovery.
6. One mistake is survivable, but repeated poor calls often lead to collapse.
