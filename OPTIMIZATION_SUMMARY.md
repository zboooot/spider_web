# Spider Web Optimization — Executive Summary

**Date:** 2026-06-19  
**Project:** spider_web (Verlet-based spider web game)  
**Scope:** Web damage visualization, multi-leg gait, iOS mobile performance

---

## DELIVERABLES

### 1. **OPTIMIZATION_GUIDE_2026.md** (Comprehensive Reference)
- **3 Major Optimization Areas:**
  - **Part 1:** Web Damage Visualization (4 patterns + failure modes)
  - **Part 2:** Multi-Leg Gait & Foothold (4 patterns + failure modes)
  - **Part 3:** Mobile Frame-Budget Robustness (4 patterns + failure modes)
- **Part 4:** Implementation Roadmap (3-phase plan)
- **Part 5:** External References (10 academic/production sources)
- **Part 6:** Quick Reference Checklist

### 2. **IMPLEMENTATION_CHECKLIST.md** (Task-by-Task Breakdown)
- **Phase 0 (Immediate, <1 day):** 3 tasks
  - Canvas state caching (30–50% API reduction)
  - Adaptive physics (prevents thermal throttling)
  - Audio context recovery (fixes backgrounding)
- **Phase 1 (Short-term, 2–3 days):** 3 tasks
  - Spatial hash grid (70–90% lookup speedup)
  - Gait controller (natural locomotion)
  - Constraint pooling (40–60% GC reduction)
- **Phase 2 (Medium-term, 1 week):** 3 tasks
  - Incremental danger tracking (60–80% calc reduction)
  - Render layers (30–50% canvas reduction)
  - Landing validation (eliminates foot snap)
- **Phase 3 (Long-term, 2+ weeks):** 3 tasks
  - XPBD solver upgrade
  - Multi-gait presets
  - Performance monitoring dashboard

---

## KEY FINDINGS

### Current State
✓ **Strengths:**
- Modular architecture (generation, physics, interaction, rendering)
- Complete interaction chain (collision → sticking → breaking → collection)
- Existing mobile awareness (background throttling, touch input)

✗ **Bottlenecks:**
- **Danger calculation:** Full BFS every frame (O(n²) worst case)
- **Foot placement:** Full candidate scan every step (O(particles + samples))
- **Canvas rendering:** Repeated state changes (fillStyle, strokeStyle, lineWidth)
- **Physics:** Fixed 16 iterations; no thermal throttling response
- **Memory:** Constraint creation/destruction causes GC pressure

### Expected Gains (Cumulative)

| Phase | Focus | Expected Gain | Timeline |
|-------|-------|---------------|----------|
| **0** | Canvas + Physics + Audio | 30–50% canvas, 60fps on iOS | <1 day |
| **1** | Spatial + Gait + Pooling | 70–90% lookup, natural gait, 40–60% GC | 2–3 days |
| **2** | Danger + Layers + Validation | 60–80% danger, 30–50% canvas, no snap | 1 week |
| **3** | XPBD + Gaits + Monitoring | 4–8 iterations stable, 3+ gaits, visibility | 2+ weeks |

---

## CONCRETE PATTERNS (Categorized)

### Web Damage Visualization
1. **Incremental Danger Tracking** — Dirty set instead of full BFS
2. **Cached Adjacency** — Persistent particle-to-constraint map
3. **Canvas State Caching** — Skip redundant fillStyle/strokeStyle assignments
4. **Offscreen Damage Layer** — Separate rendering for damage effects

### Multi-Leg Gait
1. **Spatial Hash Grid** — O(1) candidate lookup vs. O(n) scan
2. **Enhanced Scoring** — Distance + direction + continuity + separation
3. **Phase-Based Gait** — Continuous phase control vs. binary stepping
4. **Landing Validation** — Re-check target; use fallback candidates

### Mobile Frame Budget
1. **Adaptive Iteration** — Dynamic physics iterations based on frame time
2. **Constraint Pooling** — Reuse constraint objects; reduce GC
3. **Render Batching** — Separate layers; selective updates
4. **Audio Recovery** — Explicit context recovery on backgrounding

---

## COMMON FAILURE MODES & FIXES

### Web Damage
| Issue | Cause | Fix |
|-------|-------|-----|
| Danger "sticks" | Dirty set not cleared | `dangerCache.dirty.clear()` after update |
| Flashing wrong speed | Frame counter mismatch | Use global frame counter, not `Date.now()` |
| Damage jumps | BFS boundary violation | Validate neighbor distance |
| Canvas corruption | State cache not reset | Add context loss handler |
| Memory leak | Particle IDs accumulate | Rebuild adjacency on constraint removal |

### Gait
| Issue | Cause | Fix |
|-------|-------|-----|
| Legs cross | Separation penalty weak | Increase `MIN_LEG_SEP` or weight |
| Foot snaps | Target invalid; no fallback | Implement landing validation |
| Robotic gait | Binary stepping | Use phase-based gait controller |
| Hash misses | Cell size too large | Reduce `cellSize` or increase radius |
| Direction always 0 | `moveDir` not normalized | Normalize before dot product |

### Mobile
| Issue | Cause | Fix |
|-------|-------|-----|
| 30fps jank | Iterations too high | Use `AdaptivePhysics` |
| Memory leak | Pool not releasing | Ensure `release()` called |
| Audio silent | Context suspended | Implement recovery handler |
| Touch lag | Input blocks render | Separate RAF callback |
| Thermal throttle | CPU overheating | Reduce iterations + background frequency |

---

## EXTERNAL REFERENCES

### Academic
- **Jakobsen (GDC 2001):** Verlet integration fundamentals
- **Müller et al. (2007):** Position-based dynamics & XPBD
- **Suzuki et al. (Nature 2025):** Phase-driven gait synthesis

### Production Code
- **Unity-Procedural-IK-Wall-Walking-Spider:** Spatial IK + terrain
- **Procedural-Spider-Animation:** Multi-leg patterns
- **Blaze2DJS:** GPU-accelerated 2D rendering
- **ReoGrid Web:** Canvas state caching (10K rows @ 60fps)
- **ElliottProgrammer:** Particle optimization (typed arrays, OffscreenCanvas)

### Spatial Indexing
- **RSamaium/RPG-JS:** TypeScript spatial hash
- **simondevyoutube/Tutorial_SpatialHashGrid_Optimized:** JavaScript reference
- **pmndrs/koota:** Entity-based spatial hash

---

## IMPLEMENTATION ROADMAP

### Week 1: Phase 0 (Immediate)
```
Mon: Canvas state caching (30 min)
Tue: Adaptive physics (45 min)
Wed: Audio recovery (30 min)
Thu: Testing & validation
Fri: Deploy
```

### Week 2–3: Phase 1 (Short-term)
```
Spatial hash grid (2 hrs)
Gait controller (1.5 hrs)
Constraint pooling (1.5 hrs)
Testing & validation
Deploy
```

### Week 4: Phase 2 (Medium-term)
```
Danger tracking (2 hrs)
Render layers (2.5 hrs)
Landing validation (1.5 hrs)
Testing & validation
Deploy
```

### Week 5+: Phase 3 (Long-term)
```
XPBD solver (3+ days)
Multi-gait presets (1 day)
Performance monitoring (1 day)
Ongoing tuning
```

---

## SUCCESS METRICS

### Phase 0
- [ ] Canvas API calls: 30–50% reduction
- [ ] P95 frame time: < 20ms on iPhone 11
- [ ] Audio: Plays after backgrounding

### Phase 1
- [ ] Candidate lookup: 70–90% faster
- [ ] Gait: Natural (no synchronized stepping)
- [ ] GC pauses: 40–60% reduction

### Phase 2
- [ ] Danger calculation: 60–80% faster
- [ ] Canvas calls: Additional 30–50% reduction
- [ ] Foot snap: Eliminated

### Phase 3
- [ ] Physics: Stable at 4–8 iterations
- [ ] Gaits: 3+ distinct presets
- [ ] Monitoring: Real-time visibility

---

## QUICK START

### For Developers
1. Read **OPTIMIZATION_GUIDE_2026.md** (patterns + code examples)
2. Follow **IMPLEMENTATION_CHECKLIST.md** (task-by-task)
3. Start with Phase 0 (< 1 day, high impact)
4. Use verification scripts to validate each task

### For Project Managers
1. Phase 0: 1 day, 3 tasks, 30–50% canvas reduction
2. Phase 1: 2–3 days, 3 tasks, 70–90% lookup speedup
3. Phase 2: 1 week, 3 tasks, 60–80% danger reduction
4. Phase 3: 2+ weeks, 3 tasks, XPBD + gaits + monitoring

---

## FILES GENERATED

1. **OPTIMIZATION_GUIDE_2026.md** (660 lines)
   - Comprehensive reference with code examples
   - 12 concrete patterns with failure modes
   - 10 external references
   - Implementation roadmap

2. **IMPLEMENTATION_CHECKLIST.md** (400+ lines)
   - Phase-by-phase task breakdown
   - Effort estimates & expected gains
   - Verification scripts
   - Testing & validation plan
   - Success criteria

3. **SUMMARY.md** (this document)
   - Executive overview
   - Key findings & patterns
   - Quick reference
   - Implementation roadmap

---

**Generated:** 2026-06-19  
**Status:** Ready for Phase 0 implementation  
**Next Step:** Start with Task 0.1 (Canvas State Caching)
