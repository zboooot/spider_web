# Spider Web Rendering + Foot Placement Optimization Matrix (Code-Backed)

Date: 2026-06-19
Project: `spider_web`
Scope: `webRenderer.js`, `footSystem.js`, `stickSystem.js`, `webIntegrity.js`, `main.js`, `Vec2.js`, `constraints.js`, `VerletJS.js`

---

## 1) Confirmed Current Strengths

- Modular split is clear: render, locomotion, stick, integrity, engine separation is already good.
- Main loop has time-scale awareness (`delta`/`timeScale`) and mobile background throttling.
- Foot system already has occupancy-aware scoring and partner-leg conflict prevention baseline.
- Stick pipeline already has hit history, delayed sticking, and alive-constraint filtering.

---

## 2) Confirmed Risks / Defects (Risk -> Trigger -> Impact -> Mitigation)

### P0 (Correctness / Stability)

1. **Zero-length normalize can emit NaN**  
   - Risk: `Vec2.normal()` divides by magnitude without epsilon guard.  
   - Trigger: coincident points or zero vector normalization.  
   - Impact: NaN can propagate to physics positions and render state.  
   - Mitigation: in `src/engine/Vec2.js`, early return `(0,0)` when `m < eps`.

2. **Distance relaxation divisor can explode near zero**  
   - Risk: `DistanceConstraint.relax()` uses `/ m` where `m = length^2` without epsilon clamp.  
   - Trigger: constraint endpoints become coincident or near-coincident.  
   - Impact: huge correction impulses / Infinity-like instability / jitter cascades.  
   - Mitigation: in `src/engine/constraints.js`, skip or clamp when `m < eps`.

### P1 (Largest Frame-Time Risks)

3. **Web integrity scan is full Cartesian scan**  
   - Risk: `scanWebCells -> cellCovered -> ptToSegDist2` is `O(cells * constraints)`.  
   - Trigger: larger grid radius + many constraints + scan windows.  
   - Impact: large frame-time spikes, especially on mobile.  
   - Mitigation: event-driven/incremental scan, spatial pruning, scan budget per frame.

4. **Danger adjacency rebuilt every frame**  
   - Risk: `webRenderer` rebuilds particle->constraint adjacency each draw.  
   - Trigger: normal gameplay frame loop with non-trivial constraint counts.  
   - Impact: persistent avoidable CPU overhead before BFS diffusion.  
   - Mitigation: cache adjacency and invalidate only on topology changes (break/add).

5. **Break flash overlay has nested constraints×flashes loop**  
   - Risk: for each constraint, iterate all flashes and compute distance.  
   - Trigger: burst breaks + large web.  
   - Impact: bursty frame drops post-break events.  
   - Mitigation: flash-side indexing or local neighborhood mapping; cap active flashes.

6. **Foot target search is full scan per trigger**  
   - Risk: `findStepTarget` scans all alive particles + sample points.  
   - Trigger: repeated stepping under movement + denser web.  
   - Impact: locomotion hitching and uneven frame pacing.  
   - Mitigation: spatial hash/grid for local candidate lookup.

7. **Stick candidate collection has fixed 9-sample multiplier**  
   - Risk: `collectPathHitCandidates` loops constraints and samples each at `0..8`.  
   - Trigger: frequent moving objects crossing web with high constraint count.  
   - Impact: hot-loop cost scales quickly.  
   - Mitigation: adaptive sampling by velocity/path length + early-out pruning.

### P2 (Behavior Quality / Robustness)

8. **Foot target can become stale between selection and landing**  
   - Risk: target chosen, then topology changes before landing.  
   - Trigger: web break/removal while foot is in stepping animation.  
   - Impact: visual snap or abrupt leg correction.  
   - Mitigation: revalidate target on landing frame; fallback to nearest valid candidate.

9. **Fixed `sim.frame(16)` can hide perf pressure**  
   - Risk: solver iterations are constant even when frame budget is stressed.  
   - Trigger: thermal throttling / device load spikes.  
   - Impact: frame pacing degrades while simulation cost remains fixed.  
   - Mitigation: adaptive iteration window with lower/upper clamps and hysteresis.

10. **Per-frame array filtering creates GC churn**  
    - Risk: `webBreakFlashes = webBreakFlashes.filter(...)` allocates each frame.  
    - Trigger: long sessions with frequent flash updates.  
    - Impact: micro-stutter from allocation + GC pressure.  
    - Mitigation: in-place compaction or ring-buffer style retention.

---

## 3) Items Explicitly Pruned (Not Treated as Confirmed Defects)

- Claims conflicting with existing guards (e.g. denominator already wrapped in `Math.max(...)`) were removed.
- “Infinite BFS loop” was removed (current diffusion depth is explicitly bounded to 2 hops).
- “Memory leak” statements without retained-reference evidence were downgraded to “GC churn risk”.

---

## 4) Implementation Priority Roadmap

### P0 (Today)
- Add epsilon guards in:
  - `src/engine/Vec2.js` (`normal`)
  - `src/engine/constraints.js` (`DistanceConstraint.relax`)

### P1 (2–4 days)
- `webIntegrity`: incremental/budgeted scans + pruning.
- `webRenderer`: cached adjacency + cheaper flash propagation.
- `footSystem` + `stickSystem`: spatial/localized lookup and adaptive sampling.

### P2 (After P1 stabilizes)
- landing revalidation + fallback candidate chain.
- adaptive solver iterations linked to frame budget.
- in-place maintenance for short-lived arrays.

---

## 5) Verification Plan (Performance + Stability)

Collect per-frame timings (`avg`, `p95`) for:
- `checkWebIntegrity` scan segment
- `collectPathHitCandidates`
- `findStepTarget`
- `webRenderer` danger+flash stages

Also log workload counters per frame:
- `constraints`, `particles`, `cells`, `flashes`, `triggerStep` call count

Success criteria:
- No NaN positions detected in physics particles across stress scenario.
- Reduced p95 frame time in medium/stress scenarios after P1.
- No visible foot snap in break-heavy sequences after landing revalidation.
