# Current Game Logic Audit Inputs (Foothold + Walk Animation)

This note summarizes the current implementation from local source files:
- `src/systems/footSystem.js`
- `src/main.js`
- `src/render/spiderRenderer.js`

## 1) Foothold selection and stepping (`footSystem.js`)

### Key flow
- `findStepTarget(...)`
  - Builds candidate footholds from web nodes + segment sample points.
  - Uses occupancy and collision constraints:
    - foothold uniqueness keys (`node:*`, `seg:*`)
    - side constraints (`isRightLeg`, `sideMargin`)
    - segment intersection checks against occupied leg segments
    - minimum leg separation (`MIN_LEG_SEP`)
    - progress/toward-move penalties
  - Node preference over segment via `SEG_PENALTY`.

- `triggerStep(...)`
  - Blocks if leg is already stepping or cooling down.
  - Collects occupied positions, occupied segments, and occupied foothold keys from other legs.
  - Calls `findStepTarget(...)`; rejects tiny moves (`< 400` squared distance).
  - Calls `liftFoot(...)`, sets `from/targetPos/targetStepPoint`, then marks `stepping=true`.

- `landFoot(...)`
  - Re-validates target foothold uniqueness against landed and in-flight targets of other legs.
  - Verifies node/segment still alive in current web constraints.
  - Creates `DistanceConstraint`(s) from foot particle to target node/segment endpoints.
  - Sets hold frames (`10` for node, `16` for segment).

- `liftFoot(...)`
  - Removes existing foot constraints and clears landed state.

## 2) Walking loop and gait coordination (`main.js`)

### Leg state initialization
- `buildSpider()` initializes `footState` per leg:
  - `current`, `from`, `targetPos`, `targetStepPoint`
  - landed references (`landedNode`, `landedSeg`)
  - stepping flags (`stepping`, `t`, `cooldown`, `holdFrames`, `phase`)

### Per-frame feet logic (main loop near lines ~1710+)
- `updateSamplePoints(samplePoints)` runs after physics frame.
- For each leg:
  - reduce `cooldown` / `holdFrames`
  - if not stepping, increase phase (`phaseRate` depends on having move target)
  - if stepping:
    - interpolate with quadratic easing
    - update foot particle position directly
    - on completion call `landFoot(...)`
  - if not stepping and landed:
    - follow landed node/segment position updates
  - evaluate `needStep` using drift vs thresholds
  - gate with `_isPhaseEligible(...)`, partner leg state, swing limits
  - call `triggerStep(...)` with move or rest parameters
  - on successful trigger: reset phase and advance gait cursor

### Gait and phase controls
- `_gaitOrderIdle = [0,2,1,3]`
- `_gaitOrderMove = [0,3,1,2]`
- `_isPhaseEligible(...)` combines slot distance in gait order + phase threshold + emergency override.
- Locomotion lock state (`IDLE_LOCKED`) uses foothold validity and drift checks.

## 3) Render-side spider leg animation (`spiderRenderer.js`)

- `setupSpiderDraw(...)` creates custom draw callback.
- Draw path uses `footState[fi].current` as chain endpoint override.
- Smoothes visual foot jumps via `_footDrawPrev` clamping.
- Legs rendered as soft curved chains with quadratic curves.
- During wrapping target state, applies procedural scrambling/settling transforms per leg and joint index.

## 4) Notable implementation characteristics
- Foot placement is **constraint-based** and **foothold-unique**.
- Stepping trigger is **drift-threshold + gait/phase gated**.
- Animation blends **physics-updated foot anchors** with **render-time curve stylization**.
