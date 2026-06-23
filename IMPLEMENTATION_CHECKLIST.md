# Spider Web Optimization — Implementation Checklist

**Project:** spider_web  
**Generated:** 2026-06-19  
**Status:** Ready for Phase 0 implementation

---

## PHASE 0: IMMEDIATE WINS (< 1 day)

### Task 0.1: Canvas State Caching
**File:** `src/render/webRenderer.js`  
**Effort:** 30 min  
**Expected Gain:** 30–50% canvas API reduction

- [ ] Create `CanvasStateCache` class (copy from guide)
- [ ] Instantiate in `setupWebDraw()` function
- [ ] Replace all `ctx.fillStyle =` with `stateCache.setFillStyle()`
- [ ] Replace all `ctx.strokeStyle =` with `stateCache.setStrokeStyle()`
- [ ] Replace all `ctx.lineWidth =` with `stateCache.setLineWidth()`
- [ ] Test: Verify colors/widths render correctly
- [ ] Benchmark: Measure canvas API call count before/after

**Verification:**
```javascript
// In browser console:
const calls = [];
const origFillStyle = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'fillStyle');
Object.defineProperty(CanvasRenderingContext2D.prototype, 'fillStyle', {
  set(v) { calls.push('fillStyle'); origFillStyle.set.call(this, v); }
});
// Run game for 10 frames, check calls.length
```

---

### Task 0.2: Adaptive Physics Iteration
**File:** `src/main.js`  
**Effort:** 45 min  
**Expected Gain:** Prevents thermal throttling on iOS

- [ ] Create `AdaptivePhysics` class (copy from guide)
- [ ] Instantiate in `main.js` initialization
- [ ] Replace `sim.frame(16)` with `sim.frame(adaptivePhysics.getIterationCount())`
- [ ] Call `adaptivePhysics.recordFrameTime(delta)` each frame
- [ ] Test on iPhone: Verify FPS stays at 60 for 5+ minutes
- [ ] Benchmark: Measure P95 frame time before/after

**Verification:**
```javascript
// In browser console:
window.frameTimeSamples = [];
// Patch loop to record frame times
// After 60 frames: Math.max(...frameTimeSamples) should be < 20ms
```

---

### Task 0.3: Audio Context Recovery
**File:** `src/audio/audioEngine.js` (or new `src/audio/audioContextManager.js`)  
**Effort:** 30 min  
**Expected Gain:** Fixes audio loss on app backgrounding

- [ ] Create `AudioContextManager` class (copy from guide)
- [ ] Instantiate in `main.js` initialization
- [ ] Add `visibilitychange` listener
- [ ] Add `focus` listener
- [ ] Test: Background app, return to foreground, verify audio plays
- [ ] Test: Mute/unmute system audio, verify recovery

**Verification:**
```javascript
// In browser console:
// 1. Play audio
// 2. Tab away (visibilitychange fires)
// 3. Tab back (recovery fires)
// 4. Verify audio context state === 'running'
```

---

## PHASE 1: SHORT-TERM OPTIMIZATIONS (2–3 days)

### Task 1.1: Spatial Hash Grid for Foot Placement
**File:** `src/systems/footSystem.js`  
**Effort:** 2 hours  
**Expected Gain:** 70–90% candidate lookup speedup

- [ ] Create `SpatialHashGrid` class (copy from guide)
- [ ] Add `candidateGrid` instance to footSystem module
- [ ] Create `updateCandidateGrid()` function
- [ ] Call `updateCandidateGrid()` in main loop before foot stepping
- [ ] Modify `findStepTarget()` to use `candidateGrid.queryRadius()` instead of full scan
- [ ] Test: Verify foot placement still works correctly
- [ ] Benchmark: Measure candidate evaluation time before/after

**Verification:**
```javascript
// In browser console:
const start = performance.now();
for (let i = 0; i < 100; i++) {
  findStepTarget(...);
}
console.log('Time:', performance.now() - start);
// Should be significantly faster
```

---

### Task 1.2: Gait Controller (Phase-Based Stepping)
**File:** `src/systems/footSystem.js`  
**Effort:** 1.5 hours  
**Expected Gain:** More natural locomotion

- [ ] Create `GaitController` class (copy from guide)
- [ ] Instantiate in main loop
- [ ] Replace binary stepping logic with `gaitController.canStep(legIndex)`
- [ ] Call `gaitController.update()` each frame
- [ ] Test: Verify spider walks smoothly without synchronized stepping
- [ ] Tune: Adjust `dutyFactor` and `cycleSpeed` for desired gait

**Verification:**
```javascript
// Visual test:
// 1. Watch spider walk
// 2. Legs should not all step at same time
// 3. Gait should look more natural/lifelike
```

---

### Task 1.3: Constraint Object Pooling
**File:** `src/systems/footSystem.js`  
**Effort:** 1.5 hours  
**Expected Gain:** 40–60% GC pressure reduction

- [ ] Create `ConstraintPool` class (copy from guide)
- [ ] Instantiate in footSystem module
- [ ] Modify `landFoot()` to use `constraintPool.acquire()`
- [ ] Modify `liftFoot()` to use `constraintPool.release()`
- [ ] Test: Verify spider still lands feet correctly
- [ ] Benchmark: Measure GC pause time before/after

**Verification:**
```javascript
// In browser console:
// 1. Open DevTools Performance tab
// 2. Record 10 seconds of gameplay
// 3. Check GC pause frequency/duration
// 4. Should be significantly reduced
```

---

## PHASE 2: MEDIUM-TERM OPTIMIZATIONS (1 week)

### Task 2.1: Incremental Danger Tracking
**File:** `src/render/webRenderer.js`  
**Effort:** 2 hours  
**Expected Gain:** 60–80% danger calculation reduction

- [ ] Create `dangerCache` object with `values`, `dirty`, `lastStuckObjects`
- [ ] Create `updateDangerIncremental()` function (copy from guide)
- [ ] Create `buildAliveParticleSet()` helper
- [ ] Create `getConstraintNeighbors()` helper
- [ ] Replace full BFS danger calculation with incremental version
- [ ] Test: Verify danger visualization still works correctly
- [ ] Benchmark: Measure danger calculation time before/after

**Verification:**
```javascript
// Visual test:
// 1. Throw objects at web
// 2. Danger should propagate correctly
// 3. No visual artifacts or missing danger zones
```

---

### Task 2.2: Render Layers (Batched Rendering)
**File:** `src/render/webRenderer.js` (or new `src/render/renderLayers.js`)  
**Effort:** 2.5 hours  
**Expected Gain:** 30–50% canvas API reduction

- [ ] Create `RenderLayers` class (copy from guide)
- [ ] Instantiate in main loop
- [ ] Move web rendering to `renderLayers.renderWeb()`
- [ ] Move particle rendering to `renderLayers.renderParticles()`
- [ ] Move damage rendering to `renderLayers.renderDamage()`
- [ ] Call `renderLayers.composite()` to combine layers
- [ ] Test: Verify all visual elements render correctly
- [ ] Benchmark: Measure canvas API calls before/after

**Verification:**
```javascript
// Visual test:
// 1. Play game normally
// 2. Verify web, spider, objects, damage all visible
// 3. No visual glitches or missing elements
```

---

### Task 2.3: Landing Validation & Fallback Candidates
**File:** `src/systems/footSystem.js`  
**Effort:** 1.5 hours  
**Expected Gain:** Eliminates foot snap on web damage

- [ ] Create `buildAliveParticleSet()` helper
- [ ] Modify `landFoot()` to validate target before landing
- [ ] Modify `triggerStep()` to collect top-3 candidates
- [ ] Store fallback candidates in `fs.fallbackCandidates`
- [ ] Use fallback if primary target invalid
- [ ] Test: Damage web while spider is stepping; verify no foot snap
- [ ] Benchmark: Measure landing success rate before/after

**Verification:**
```javascript
// Stress test:
// 1. Throw many objects to damage web
// 2. Watch spider step while web is breaking
// 3. Feet should land smoothly without snapping
```

---

## PHASE 3: LONG-TERM OPTIMIZATIONS (2+ weeks)

### Task 3.1: XPBD Constraint Solver Upgrade
**File:** `src/engine/VerletJS.js`  
**Effort:** 3+ days  
**Expected Gain:** Better stability at low iteration counts

- [ ] Research XPBD algorithm (see references in guide)
- [ ] Implement XPBD constraint relaxation
- [ ] Test stability with reduced iteration counts (4–8)
- [ ] Benchmark: Measure constraint violation before/after
- [ ] Tune: Find optimal iteration count for stability

**Verification:**
```javascript
// Stability test:
// 1. Set iterations to 4
// 2. Play game for 5 minutes
// 3. Web should not collapse or oscillate excessively
```

---

### Task 3.2: Multi-Gait Presets
**File:** `src/systems/footSystem.js`  
**Effort:** 1 day  
**Expected Gain:** Gameplay variety

- [ ] Extend `GaitController` with preset system
- [ ] Implement 'creeping', 'walking', 'running' presets
- [ ] Add UI controls to switch gaits
- [ ] Test: Verify each gait looks distinct and natural
- [ ] Tune: Adjust parameters for desired feel

**Verification:**
```javascript
// Visual test:
// 1. Switch between gaits
// 2. Each should have distinct rhythm/speed
// 3. All should look natural
```

---

### Task 3.3: Performance Monitoring Dashboard
**File:** `src/ui/performanceMonitor.js` (new)  
**Effort:** 1 day  
**Expected Gain:** Real-time visibility into performance

- [ ] Create performance monitoring UI
- [ ] Track: FPS, frame time, physics time, render time, GC pauses
- [ ] Display: Real-time graphs or text overlay
- [ ] Add: Toggle to show/hide monitor
- [ ] Test: Verify accurate measurements
- [ ] Benchmark: Use to validate optimization gains

**Verification:**
```javascript
// Visual test:
// 1. Enable performance monitor
// 2. Play game
// 3. Verify metrics update in real-time
// 4. Compare before/after optimization
```

---

## TESTING & VALIDATION

### Performance Benchmarks
- [ ] Baseline: Record metrics before any optimizations
- [ ] Phase 0: Measure improvement after canvas caching + adaptive physics + audio recovery
- [ ] Phase 1: Measure improvement after spatial hash + gait controller + pooling
- [ ] Phase 2: Measure improvement after danger tracking + render layers + landing validation
- [ ] Phase 3: Measure improvement after XPBD + gaits + monitoring

### Device Testing
- [ ] iPhone 12 (baseline)
- [ ] iPhone 11 (older device)
- [ ] iPhone SE (budget device)
- [ ] iPad (larger screen)

### Metrics to Track
- [ ] P50 / P95 frame time
- [ ] GC pause frequency / duration
- [ ] Memory peak / 30-min drift
- [ ] Touch input latency
- [ ] Audio playback stability
- [ ] Thermal throttling onset time

---

## ROLLOUT PLAN

### Week 1: Phase 0 (Immediate)
- Monday: Canvas state caching
- Tuesday: Adaptive physics
- Wednesday: Audio recovery
- Thursday: Testing & validation
- Friday: Deploy to production

### Week 2–3: Phase 1 (Short-term)
- Spatial hash grid
- Gait controller
- Constraint pooling
- Testing & validation
- Deploy to production

### Week 4: Phase 2 (Medium-term)
- Danger tracking
- Render layers
- Landing validation
- Testing & validation
- Deploy to production

### Week 5+: Phase 3 (Long-term)
- XPBD solver
- Multi-gait presets
- Performance monitoring
- Ongoing tuning

---

## SUCCESS CRITERIA

### Phase 0
- [ ] Canvas API calls reduced by 30–50%
- [ ] P95 frame time < 20ms on iPhone 11
- [ ] Audio plays after backgrounding

### Phase 1
- [ ] Candidate lookup 70–90% faster
- [ ] Gait looks natural (no synchronized stepping)
- [ ] GC pauses reduced by 40–60%

### Phase 2
- [ ] Danger calculation 60–80% faster
- [ ] Canvas calls reduced by additional 30–50%
- [ ] No foot snap on web damage

### Phase 3
- [ ] Stable at 4–8 iterations (vs. 16)
- [ ] 3+ distinct gaits available
- [ ] Real-time performance visibility

---

**Document Version:** 1.0  
**Last Updated:** 2026-06-19  
**Next Review:** After Phase 0 completion
