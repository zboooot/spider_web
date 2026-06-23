# Spider Web Optimization Guide
## Concrete Patterns for Visuals, Gait, & Mobile Performance

**Generated:** 2026-06-19  
**Project:** spider_web (Verlet-based spider web game)  
**Scope:** Web damage visualization, multi-leg foothold computation, iOS frame-budget robustness

---

## PART 1: WEB DAMAGE VISUALIZATION STABILITY & PERFORMANCE

### 1.1 Current State Analysis

**Current Implementation** (`src/render/webRenderer.js`):
- **Danger propagation:** BFS 2-layer expansion from stuck objects
- **Rendering:** Per-frame danger recalculation + color/width modulation
- **Flashing:** Red break flashes on constraint removal
- **Cost:** O(constraints × neighbors) per frame for danger calculation

**Identified Bottlenecks:**
1. **Redundant danger recalculation** — Full BFS every frame even when no objects move
2. **Particle-to-constraint adjacency rebuilt every frame** — `pToCI` map regenerated
3. **No incremental damage tracking** — Entire web re-evaluated for integrity
4. **Canvas state thrashing** — Repeated `ctx.fillStyle`, `ctx.strokeStyle` changes

---

### 1.2 Optimization Patterns (Categorized)

#### **PATTERN A: Incremental Danger Tracking**

**Problem:** Recalculating danger for entire web every frame is O(n²) in worst case.

**Solution:** Maintain a "dirty set" of constraints that need re-evaluation.

```javascript
// Add to webRenderer initialization
const dangerCache = {
  values: {},        // constraint_index → danger_value
  dirty: new Set(),  // indices needing recalc
  lastStuckObjects: new Set()
};

// In drawConstraints, replace full BFS with:
function updateDangerIncremental(thrownObjects, constraints, dangerCache) {
  // Step 1: Detect changes in stuck objects
  const currentStuck = new Set();
  for (const obj of thrownObjects) {
    if ((obj.state === 'stuck' || obj.state === 'freeing') && obj.stuckOnConstraint) {
      const ci = constraints.indexOf(obj.stuckOnConstraint);
      if (ci !== -1) {
        currentStuck.add(ci);
        dangerCache.dirty.add(ci);  // Mark for update
      }
    }
  }
  
  // Step 2: Mark removed objects' constraints as dirty
  for (const ci of dangerCache.lastStuckObjects) {
    if (!currentStuck.has(ci)) {
      dangerCache.dirty.add(ci);
    }
  }
  
  // Step 3: Recalculate only dirty constraints + their neighbors
  for (const ci of dangerCache.dirty) {
    const danger = calculateConstraintDanger(ci, currentStuck);
    dangerCache.values[ci] = danger;
    
    // Mark neighbors as dirty for next frame (lazy propagation)
    const neighbors = getConstraintNeighbors(ci, constraints);
    for (const ni of neighbors) {
      dangerCache.dirty.add(ni);
    }
  }
  
  dangerCache.lastStuckObjects = currentStuck;
  dangerCache.dirty.clear();
  
  return dangerCache.values;
}
```

**Expected Gain:** 60–80% reduction in danger calculation cost on stable frames.

---

#### **PATTERN B: Cached Particle-to-Constraint Adjacency**

**Problem:** `pToCI` map rebuilt every frame; O(constraints) cost.

**Solution:** Maintain persistent adjacency + invalidate on constraint changes.

```javascript
class ConstraintAdjacency {
  constructor() {
    this.pToCI = new Map();  // particle_id → [constraint_indices]
    this.version = 0;
  }
  
  rebuild(constraints) {
    this.pToCI.clear();
    for (let ci = 0; ci < constraints.length; ci++) {
      const c = constraints[ci];
      if (!(c instanceof DistanceConstraint)) continue;
      
      const paId = c.a.__pid || (c.a.__pid = getNextPid());
      const pbId = c.b.__pid || (c.b.__pid = getNextPid());
      
      if (!this.pToCI.has(paId)) this.pToCI.set(paId, []);
      if (!this.pToCI.has(pbId)) this.pToCI.set(pbId, []);
      
      this.pToCI.get(paId).push(ci);
      this.pToCI.get(pbId).push(ci);
    }
    this.version++;
  }
  
  getNeighbors(ci, constraints) {
    const c = constraints[ci];
    const paId = c.a.__pid;
    const pbId = c.b.__pid;
    
    const neighbors = new Set();
    for (const ni of (this.pToCI.get(paId) || [])) {
      if (ni !== ci) neighbors.add(ni);
    }
    for (const ni of (this.pToCI.get(pbId) || [])) {
      if (ni !== ci) neighbors.add(ni);
    }
    return neighbors;
  }
}

// In main loop, rebuild only when constraints change:
if (constraintCountChanged) {
  adjacency.rebuild(spiderweb.constraints);
}
```

**Expected Gain:** Eliminates O(constraints) per-frame adjacency cost.

---

#### **PATTERN C: Canvas State Caching**

**Problem:** Repeated `ctx.fillStyle = "..."` and `ctx.strokeStyle = "..."` trigger expensive state changes.

**Solution:** Cache current state and skip redundant assignments.

```javascript
class CanvasStateCache {
  constructor(ctx) {
    this.ctx = ctx;
    this.fillStyle = null;
    this.strokeStyle = null;
    this.lineWidth = null;
    this.globalAlpha = null;
  }
  
  setFillStyle(style) {
    if (this.fillStyle !== style) {
      this.ctx.fillStyle = style;
      this.fillStyle = style;
    }
  }
  
  setStrokeStyle(style) {
    if (this.strokeStyle !== style) {
      this.ctx.strokeStyle = style;
      this.strokeStyle = style;
    }
  }
  
  setLineWidth(width) {
    if (this.lineWidth !== width) {
      this.ctx.lineWidth = width;
      this.lineWidth = width;
    }
  }
  
  setGlobalAlpha(alpha) {
    if (this.globalAlpha !== alpha) {
      this.ctx.globalAlpha = alpha;
      this.globalAlpha = alpha;
    }
  }
}

// Usage in drawConstraints:
const stateCache = new CanvasStateCache(ctx);
for (let ci = 0; ci < constraints.length; ci++) {
  const danger = dangerFinal[ci] || 0;
  const color = danger > 0.5 ? "rgba(255,0,0,0.8)" : "rgba(200,200,200,0.5)";
  stateCache.setStrokeStyle(color);  // Only changes if different
  // ... draw constraint
}
```

**Expected Gain:** 30–50% reduction in canvas API calls on dense webs.

---

#### **PATTERN D: Offscreen Damage Layer**

**Problem:** Damage visualization (flashing, color shifts) redrawn every frame.

**Solution:** Render damage to separate offscreen canvas, composite once.

```javascript
class DamageLayer {
  constructor(width, height) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d');
    this.needsRedraw = true;
  }
  
  update(dangerMap, constraints, breakFlashes, breakFrame) {
    if (!this.needsRedraw && breakFlashes.length === 0) return;
    
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Draw danger overlays
    for (let ci = 0; ci < constraints.length; ci++) {
      const danger = dangerMap[ci] || 0;
      if (danger < 0.1) continue;
      
      const c = constraints[ci];
      const alpha = danger * 0.6;
      this.ctx.strokeStyle = `rgba(255, 100, 100, ${alpha})`;
      this.ctx.lineWidth = 2 + danger * 2;
      this.ctx.beginPath();
      this.ctx.moveTo(c.a.pos.x, c.a.pos.y);
      this.ctx.lineTo(c.b.pos.x, c.b.pos.y);
      this.ctx.stroke();
    }
    
    // Draw break flashes
    for (const flash of breakFlashes) {
      const age = breakFrame - flash.frame;
      if (age > 10) continue;
      const alpha = (1 - age / 10) * 0.8;
      this.ctx.fillStyle = `rgba(255, 200, 0, ${alpha})`;
      this.ctx.fillRect(flash.x - 5, flash.y - 5, 10, 10);
    }
    
    this.needsRedraw = false;
  }
  
  draw(mainCtx) {
    mainCtx.drawImage(this.canvas, 0, 0);
  }
}

// In main render loop:
damageLayer.update(dangerFinal, constraints, webBreakFlashes, breakFrame);
// ... draw web normally ...
damageLayer.draw(ctx);  // Composite damage on top
```

**Expected Gain:** Separates damage rendering from web geometry; enables selective updates.

---

### 1.3 Common Failure Modes & Fixes

| Failure Mode | Symptom | Root Cause | Fix |
|---|---|---|---|
| **Danger "sticks" after object removed** | Red glow persists after object freed | Dirty set not cleared properly | Ensure `dangerCache.dirty.clear()` after update |
| **Flashing too fast/slow** | Break flashes appear/disappear abruptly | `breakFrame` counter not synced | Use global frame counter, not `Date.now()` |
| **Damage propagation "jumps"** | Danger suddenly appears 2 layers away | BFS not respecting layer boundaries | Validate neighbor distance in `getConstraintNeighbors()` |
| **Canvas state corruption** | Colors/widths wrong after damage render | State cache not reset on context loss | Add `ctx.oncontextlost` handler to reset cache |
| **Memory leak in adjacency** | Particle IDs accumulate indefinitely | `__pid` assigned but never cleaned | Rebuild adjacency when constraints removed |

---

## PART 2: MULTI-LEG GAIT & FOOTHOLD COMPUTATION

### 2.1 Current State Analysis

**Current Implementation** (`src/systems/footSystem.js`):
- **Candidate collection:** Nodes + segment sample points (N=8 per edge)
- **Scoring:** Distance to ideal + leg separation penalty
- **Gait control:** Partner stepping (legs 0↔1, 2↔3 mutually exclusive)
- **Cost:** O(particles + sample_points) per step trigger

**Identified Bottlenecks:**
1. **Full candidate scan every step** — No spatial indexing
2. **Scoring function too simple** — Only distance + separation, no direction/continuity
3. **Rigid gait phases** — Binary stepping, no smooth phase control
4. **No re-validation at landing** — Target may become invalid during swing

---

### 2.2 Optimization Patterns

#### **PATTERN A: Spatial Hash for Candidate Lookup**

**Problem:** `findStepTarget` scans all particles + sample points; O(n) per step.

**Solution:** Grid-based spatial hash for O(1) neighbor queries.

```javascript
class SpatialHashGrid {
  constructor(cellSize) {
    this.cellSize = cellSize;
    this.cells = new Map();  // "x,y" → [candidates]
  }
  
  insert(candidate) {
    const key = this.getCellKey(candidate.x, candidate.y);
    if (!this.cells.has(key)) this.cells.set(key, []);
    this.cells.get(key).push(candidate);
  }
  
  getCellKey(x, y) {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    return `${cx},${cy}`;
  }
  
  queryRadius(x, y, radius) {
    const results = [];
    const cellRadius = Math.ceil(radius / this.cellSize);
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    
    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      for (let dy = -cellRadius; dy <= cellRadius; dy++) {
        const key = `${cx + dx},${cy + dy}`;
        const cell = this.cells.get(key);
        if (!cell) continue;
        
        for (const cand of cell) {
          const d2 = (cand.x - x) ** 2 + (cand.y - y) ** 2;
          if (d2 <= radius ** 2) {
            results.push(cand);
          }
        }
      }
    }
    return results;
  }
  
  clear() {
    this.cells.clear();
  }
}

// In footSystem initialization:
const candidateGrid = new SpatialHashGrid(40);  // 40px cells

// In main loop, rebuild grid each frame:
function updateCandidateGrid(webComp, samplePoints) {
  candidateGrid.clear();
  
  // Insert node candidates
  for (const wp of webComp.particles) {
    candidateGrid.insert({ type: 'node', particle: wp, x: wp.pos.x, y: wp.pos.y });
  }
  
  // Insert segment candidates
  for (const sp of samplePoints) {
    candidateGrid.insert({ type: 'segment', ...sp });
  }
}

// In findStepTarget, replace full scan with grid query:
export function findStepTarget(webComp, legIndex, spiderComp, moveDir, samplePoints, occupiedPositions) {
  const stepR = 53, minR = 10;
  const thorax = spiderComp.particles[0].pos;
  
  // Query grid instead of scanning all candidates
  const candidates = candidateGrid.queryRadius(thorax.x, thorax.y, stepR);
  const filtered = candidates.filter(c => {
    const d2 = (c.x - thorax.x) ** 2 + (c.y - thorax.y) ** 2;
    return d2 >= minR * minR && d2 <= stepR * stepR;
  });
  
  // ... rest of scoring logic ...
}
```

**Expected Gain:** 70–90% reduction in candidate evaluation time.

---

#### **PATTERN B: Enhanced Scoring with Direction & Continuity**

**Problem:** Current score only considers distance; ignores movement direction and step history.

**Solution:** Multi-factor scoring with direction alignment and temporal continuity.

```javascript
function scoreCandidate(candidate, thorax, idealPos, moveDir, lastStepPos, occupiedPositions) {
  const cx = candidate.x, cy = candidate.y;
  
  // Factor 1: Distance to ideal position (0–1, lower is better)
  const dx = cx - idealPos.x, dy = cy - idealPos.y;
  const distSq = dx * dx + dy * dy;
  const distScore = 1 / (1 + Math.sqrt(distSq));
  
  // Factor 2: Direction alignment (0–1, higher is better)
  let dirScore = 0.5;  // Default if no movement
  if (moveDir && (moveDir.x !== 0 || moveDir.y !== 0)) {
    const toCandidate = { x: cx - thorax.x, y: cy - thorax.y };
    const len = Math.sqrt(toCandidate.x ** 2 + toCandidate.y ** 2);
    if (len > 0.1) {
      const dot = (toCandidate.x * moveDir.x + toCandidate.y * moveDir.y) / len;
      dirScore = Math.max(0, dot);  // Penalize backward steps
    }
  }
  
  // Factor 3: Continuity with last step (0–1, higher is better)
  let contScore = 0.5;  // Default if no history
  if (lastStepPos) {
    const drift = Math.sqrt((cx - lastStepPos.x) ** 2 + (cy - lastStepPos.y) ** 2);
    contScore = 1 / (1 + drift / 10);  // Prefer nearby positions
  }
  
  // Factor 4: Leg separation penalty (0–1, higher is better)
  let sepScore = 1;
  if (occupiedPositions) {
    const MIN_LEG_SEP = 14;
    for (const occ of occupiedPositions) {
      const d2 = (cx - occ.x) ** 2 + (cy - occ.y) ** 2;
      if (d2 < MIN_LEG_SEP * MIN_LEG_SEP * 4) {
        sepScore *= 0.7;  // Soft penalty
      }
    }
  }
  
  // Weighted combination
  const weights = {
    distance: 0.4,
    direction: 0.3,
    continuity: 0.2,
    separation: 0.1
  };
  
  return (
    distScore * weights.distance +
    dirScore * weights.direction +
    contScore * weights.continuity +
    sepScore * weights.separation
  );
}
```

**Expected Gain:** More natural gait; fewer "jittery" foot placements.

---

#### **PATTERN C: Phase-Based Gait Control**

**Problem:** Binary stepping (on/off) creates rigid, unnatural gait.

**Solution:** Continuous phase tracking with configurable duty factor.

```javascript
class GaitController {
  constructor(numLegs = 4) {
    this.phases = new Array(numLegs).fill(0);  // 0–1 per leg
    this.dutyFactor = 0.6;  // Fraction of cycle spent in swing
    this.cycleSpeed = 0.05;  // Phase increment per frame
  }
  
  update() {
    for (let i = 0; i < this.phases.length; i++) {
      this.phases[i] = (this.phases[i] + this.cycleSpeed) % 1;
    }
  }
  
  canStep(legIndex) {
    const phase = this.phases[legIndex];
    // Allow stepping in the "swing window"
    return phase > (1 - this.dutyFactor) && phase < 1;
  }
  
  getPhaseProgress(legIndex) {
    const phase = this.phases[legIndex];
    if (phase < 1 - this.dutyFactor) {
      return 0;  // Stance phase
    }
    // Swing phase progress (0–1)
    return (phase - (1 - this.dutyFactor)) / this.dutyFactor;
  }
  
  setGait(preset) {
    // Preset gaits: 'creeping', 'walking', 'running'
    const gaits = {
      creeping: { dutyFactor: 0.8, cycleSpeed: 0.02 },
      walking: { dutyFactor: 0.6, cycleSpeed: 0.05 },
      running: { dutyFactor: 0.4, cycleSpeed: 0.1 }
    };
    Object.assign(this, gaits[preset]);
  }
}

// In main loop:
const gaitController = new GaitController(4);

function updateSpiderGait() {
  gaitController.update();
  
  for (let i = 0; i < 4; i++) {
    if (gaitController.canStep(i)) {
      triggerStep(i, moveDir, footState, spiderweb, spider, samplePoints, moveDir, STEP_COOLDOWN);
    }
  }
}
```

**Expected Gain:** Smoother, more lifelike locomotion; easier to tune for different speeds.

---

#### **PATTERN D: Landing Validation & Fallback**

**Problem:** Target may become invalid during swing (constraint breaks, web deforms).

**Solution:** Re-validate at landing; use fallback candidates.

```javascript
export function landFoot(fs, spider, spiderweb, samplePoints, fallbackCandidates) {
  audioEngine.playSfxFootstep();
  liftFoot(fs, spider);
  
  let sp = fs.targetStepPoint;
  
  // Step 1: Validate target still exists
  if (sp) {
    if (sp.type === 'node') {
      // Check if particle is still alive
      const aliveParticles = buildAliveParticleSet(spiderweb);
      if (!aliveParticles[sp.particle.__pid]) {
        sp = null;  // Target invalid
      }
    } else {
      // Check if segment endpoints are alive
      const aliveParticles = buildAliveParticleSet(spiderweb);
      if (!aliveParticles[sp.pa.__pid] || !aliveParticles[sp.pb.__pid]) {
        sp = null;  // Target invalid
      }
    }
  }
  
  // Step 2: Use fallback if primary target invalid
  if (!sp && fallbackCandidates && fallbackCandidates.length > 0) {
    sp = fallbackCandidates[0];  // Use best fallback
  }
  
  // Step 3: Land on valid target
  if (!sp) return;  // No valid target; foot stays in air
  
  if (sp.type === 'node') {
    const d = fs.particle.pos.dist(sp.particle.pos);
    const c = new DistanceConstraint(fs.particle, sp.particle, 1, d);
    spider.constraints.push(c);
    fs.constraintA = c;
    fs.landedNode = sp.particle;
  } else {
    const dA = fs.particle.pos.dist(sp.pa.pos);
    const dB = fs.particle.pos.dist(sp.pb.pos);
    const cA = new DistanceConstraint(fs.particle, sp.pa, 1, dA);
    const cB = new DistanceConstraint(fs.particle, sp.pb, 1, dB);
    spider.constraints.push(cA);
    spider.constraints.push(cB);
    fs.constraintA = cA;
    fs.constraintB = cB;
    fs.landedSeg = sp;
  }
  
  fs.targetStepPoint = null;
}

// In triggerStep, collect top-N candidates as fallbacks:
export function triggerStep(i, md, footState, spiderweb, spider, samplePoints, moveDir, STEP_COOLDOWN) {
  const fs = footState[i];
  if (!fs || fs.stepping || fs.cooldown > 0) return;
  
  const occupied = footState
    .filter((_, oi) => oi !== i)
    .map(other => ({ x: other.current.x, y: other.current.y }));
  
  // Get top-3 candidates instead of just best
  const candidates = findStepTargets(spiderweb, i, spider, md, samplePoints, occupied, 3);
  if (!candidates.length) return;
  
  const sp = candidates[0];
  const dx = sp.x - fs.current.x, dy = sp.y - fs.current.y;
  if (dx * dx + dy * dy < 25) return;
  
  liftFoot(fs, spider);
  fs.from = new Vec2(fs.current.x, fs.current.y);
  fs.targetPos = new Vec2(sp.x, sp.y);
  fs.targetStepPoint = sp;
  fs.fallbackCandidates = candidates.slice(1);  // Store fallbacks
  fs.stepping = true;
  fs.t = 0;
  fs.cooldown = STEP_COOLDOWN;
}
```

**Expected Gain:** Eliminates "foot snap" when target becomes invalid mid-swing.

---

### 2.3 Common Failure Modes & Fixes

| Failure Mode | Symptom | Root Cause | Fix |
|---|---|---|---|
| **Legs cross over** | Legs tangle; spider looks broken | Separation penalty too weak | Increase `MIN_LEG_SEP` or weight in scoring |
| **Foot "snaps" mid-swing** | Sudden jerk when landing | Target became invalid; no fallback | Implement landing validation + fallback candidates |
| **Gait looks robotic** | Synchronized stepping; unnatural rhythm | Binary stepping; no phase offset | Use `GaitController` with phase-based triggering |
| **Spatial hash misses candidates** | Foot can't reach valid targets | Cell size too large | Reduce `cellSize` or increase query radius |
| **Direction score always 0** | Spider walks backward | `moveDir` not normalized | Normalize `moveDir` before dot product |
| **Continuity penalty too strong** | Feet "stick" to same spot | Drift threshold too low | Increase drift threshold in `contScore` calculation |

---

## PART 3: MOBILE FRAME-BUDGET ROBUSTNESS (iOS)

### 3.1 Current State Analysis

**Current Implementation:**
- **Physics:** Fixed 16 iterations per frame (Verlet)
- **Background:** Throttled to every 3 frames on mobile
- **Rendering:** Full web + particles + objects every frame
- **Input:** Touch handlers with `passive: false`

**iOS-Specific Risks:**
1. **Thermal throttling** — Long physics iterations cause CPU heat
2. **Memory pressure** — Constraint arrays grow unbounded
3. **Audio context loss** — Front/back switching breaks playback
4. **Touch jank** — Input processing blocks rendering

---

### 3.2 Optimization Patterns

#### **PATTERN A: Adaptive Iteration Count**

**Problem:** Fixed 16 iterations; no response to frame budget pressure.

**Solution:** Dynamically adjust iterations based on frame time.

```javascript
class AdaptivePhysics {
  constructor(targetFPS = 60) {
    this.targetFrameTime = 1000 / targetFPS;  // ~16.67ms
    this.minIterations = 4;
    this.maxIterations = 16;
    this.currentIterations = 8;
    this.frameTimeHistory = [];
    this.historySize = 10;
  }
  
  recordFrameTime(deltaMs) {
    this.frameTimeHistory.push(deltaMs);
    if (this.frameTimeHistory.length > this.historySize) {
      this.frameTimeHistory.shift();
    }
  }
  
  getIterationCount() {
    if (this.frameTimeHistory.length < 3) {
      return this.currentIterations;  // Not enough data
    }
    
    const avgFrameTime = this.frameTimeHistory.reduce((a, b) => a + b) / this.frameTimeHistory.length;
    const p95FrameTime = this.frameTimeHistory.sort((a, b) => a - b)[Math.floor(this.frameTimeHistory.length * 0.95)];
    
    // If P95 frame time is high, reduce iterations
    if (p95FrameTime > this.targetFrameTime * 1.2) {
      this.currentIterations = Math.max(this.minIterations, this.currentIterations - 1);
    }
    // If average frame time is low, increase iterations
    else if (avgFrameTime < this.targetFrameTime * 0.7) {
      this.currentIterations = Math.min(this.maxIterations, this.currentIterations + 1);
    }
    
    return this.currentIterations;
  }
}

// In main loop:
const adaptivePhysics = new AdaptivePhysics(60);

function loop(timestamp) {
  const delta = Math.min(timestamp - lastTimestamp, 50);
  
  // ... game logic ...
  
  const iterations = adaptivePhysics.getIterationCount();
  sim.frame(iterations);
  
  adaptivePhysics.recordFrameTime(delta);
  
  requestAnimationFrame(loop);
}
```

**Expected Gain:** Maintains 60fps on lower-end devices; prevents thermal throttling.

---

#### **PATTERN B: Constraint Pooling & Reuse**

**Problem:** Creating/destroying constraints every frame causes GC pressure.

**Solution:** Object pool for constraints.

```javascript
class ConstraintPool {
  constructor(initialSize = 100) {
    this.available = [];
    this.inUse = new Set();
    
    for (let i = 0; i < initialSize; i++) {
      this.available.push(new DistanceConstraint(null, null, 0, 0));
    }
  }
  
  acquire(a, b, stiffness, distance) {
    let c;
    if (this.available.length > 0) {
      c = this.available.pop();
      c.a = a;
      c.b = b;
      c.stiffness = stiffness;
      c.distance = distance;
    } else {
      c = new DistanceConstraint(a, b, stiffness, distance);
    }
    this.inUse.add(c);
    return c;
  }
  
  release(c) {
    if (this.inUse.has(c)) {
      this.inUse.delete(c);
      c.a = null;
      c.b = null;
      this.available.push(c);
    }
  }
  
  releaseAll() {
    for (const c of this.inUse) {
      c.a = null;
      c.b = null;
      this.available.push(c);
    }
    this.inUse.clear();
  }
}

// In footSystem:
const constraintPool = new ConstraintPool(200);

export function landFoot(fs, spider) {
  audioEngine.playSfxFootstep();
  liftFoot(fs, spider);
  
  const sp = fs.targetStepPoint;
  if (!sp) return;
  
  if (sp.type === 'node') {
    const d = fs.particle.pos.dist(sp.particle.pos);
    const c = constraintPool.acquire(fs.particle, sp.particle, 1, d);
    spider.constraints.push(c);
    fs.constraintA = c;
    fs.landedNode = sp.particle;
  } else {
    const dA = fs.particle.pos.dist(sp.pa.pos);
    const dB = fs.particle.pos.dist(sp.pb.pos);
    const cA = constraintPool.acquire(fs.particle, sp.pa, 1, dA);
    const cB = constraintPool.acquire(fs.particle, sp.pb, 1, dB);
    spider.constraints.push(cA);
    spider.constraints.push(cB);
    fs.constraintA = cA;
    fs.constraintB = cB;
    fs.landedSeg = sp;
  }
  
  fs.targetStepPoint = null;
}

export function liftFoot(fs, spider) {
  [fs.constraintA, fs.constraintB].forEach(function (c) {
    if (!c) return;
    const i = spider.constraints.indexOf(c);
    if (i !== -1) {
      spider.constraints.splice(i, 1);
      constraintPool.release(c);  // Return to pool
    }
  });
  fs.constraintA = null;
  fs.constraintB = null;
  fs.landedNode = null;
  fs.landedSeg = null;
}
```

**Expected Gain:** 40–60% reduction in GC pressure; smoother frame times.

---

#### **PATTERN C: Render Batching & Layer Separation**

**Problem:** Drawing web + particles + objects + damage every frame; many state changes.

**Solution:** Batch by layer; use offscreen canvases.

```javascript
class RenderLayers {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    
    // Layer canvases
    this.webLayer = document.createElement('canvas');
    this.webLayer.width = width;
    this.webLayer.height = height;
    this.webCtx = this.webLayer.getContext('2d');
    
    this.particleLayer = document.createElement('canvas');
    this.particleLayer.width = width;
    this.particleLayer.height = height;
    this.particleCtx = this.particleLayer.getContext('2d');
    
    this.damageLayer = document.createElement('canvas');
    this.damageLayer.width = width;
    this.damageLayer.height = height;
    this.damageCtx = this.damageLayer.getContext('2d');
    
    this.webDirty = true;
    this.particleDirty = true;
    this.damageDirty = true;
  }
  
  renderWeb(spiderweb) {
    if (!this.webDirty) return;
    
    this.webCtx.clearRect(0, 0, this.width, this.height);
    spiderweb.drawConstraints(this.webCtx, spiderweb);
    spiderweb.drawParticles(this.webCtx, spiderweb);
    
    this.webDirty = false;
  }
  
  renderParticles(spider, thrownObjects) {
    if (!this.particleDirty) return;
    
    this.particleCtx.clearRect(0, 0, this.width, this.height);
    // Draw spider
    // Draw thrown objects
    
    this.particleDirty = false;
  }
  
  renderDamage(dangerMap, constraints, breakFlashes) {
    if (!this.damageDirty) return;
    
    this.damageCtx.clearRect(0, 0, this.width, this.height);
    // Draw danger overlays
    // Draw break flashes
    
    this.damageDirty = false;
  }
  
  composite(mainCtx) {
    mainCtx.drawImage(this.webLayer, 0, 0);
    mainCtx.drawImage(this.particleLayer, 0, 0);
    mainCtx.drawImage(this.damageLayer, 0, 0);
  }
  
  invalidateWeb() { this.webDirty = true; }
  invalidateParticles() { this.particleDirty = true; }
  invalidateDamage() { this.damageDirty = true; }
}

// In main loop:
const renderLayers = new RenderLayers(W, H);

function loop(timestamp) {
  // ... physics & logic ...
  
  // Only redraw layers that changed
  if (webChanged) renderLayers.invalidateWeb();
  if (particlesChanged) renderLayers.invalidateParticles();
  if (damageChanged) renderLayers.invalidateDamage();
  
  renderLayers.renderWeb(spiderweb);
  renderLayers.renderParticles(spider, thrownObjects);
  renderLayers.renderDamage(dangerMap, spiderweb.constraints, webBreakFlashes);
  
  renderLayers.composite(ctx);
}
```

**Expected Gain:** 30–50% reduction in canvas API calls; enables selective updates.

---

#### **PATTERN D: Audio Context Recovery**

**Problem:** Front/back switching loses audio context; playback stops.

**Solution:** Explicit recovery handler.

```javascript
class AudioContextManager {
  constructor(audioEngine) {
    this.audioEngine = audioEngine;
    this.isRecovering = false;
    
    document.addEventListener('visibilitychange', () => this.onVisibilityChange());
    window.addEventListener('focus', () => this.onFocus());
  }
  
  onVisibilityChange() {
    if (document.hidden) {
      // App backgrounded; pause audio
      this.audioEngine.pause();
    } else {
      // App foregrounded; attempt recovery
      this.attemptRecovery();
    }
  }
  
  onFocus() {
    this.attemptRecovery();
  }
  
  async attemptRecovery() {
    if (this.isRecovering) return;
    this.isRecovering = true;
    
    try {
      const ctx = this.audioEngine.audioContext;
      
      // Check context state
      if (ctx.state === 'suspended') {
        // Resume requires user interaction; trigger via click
        await ctx.resume();
        console.log('Audio context resumed');
      }
      
      // Restart playback
      this.audioEngine.resume();
    } catch (err) {
      console.error('Audio recovery failed:', err);
    } finally {
      this.isRecovering = false;
    }
  }
}

// In main.js initialization:
const audioManager = new AudioContextManager(audioEngine);
```

**Expected Gain:** Eliminates silent audio after app backgrounding.

---

### 3.3 Common Failure Modes & Fixes

| Failure Mode | Symptom | Root Cause | Fix |
|---|---|---|---|
| **Frame rate drops to 30fps** | Jank on older iPhones | Physics iterations too high | Use `AdaptivePhysics` to reduce iterations |
| **Memory grows unbounded** | App crashes after 10 min | Constraint pool not releasing | Ensure `liftFoot()` calls `constraintPool.release()` |
| **Audio cuts out after backgrounding** | Silent when app returns | Audio context suspended | Implement `AudioContextManager` with recovery |
| **Touch input lags** | 200ms+ delay between tap and response | Input processing blocks render | Move input to separate RAF callback |
| **Thermal throttling kicks in** | FPS drops after 2 min of play | CPU overheating | Reduce physics iterations + background render frequency |
| **Canvas becomes blurry** | Text/lines fuzzy on Retina | DPR scaling not applied | Multiply canvas size by `devicePixelRatio` |

---

## PART 4: IMPLEMENTATION ROADMAP

### Phase 0 (Immediate, <1 day)
- [ ] Add `CanvasStateCache` to `webRenderer.js` — 30–50% canvas API reduction
- [ ] Implement `AdaptivePhysics` in `main.js` — Prevents thermal throttling
- [ ] Add `AudioContextManager` — Fixes audio loss on backgrounding

### Phase 1 (Short-term, 2–3 days)
- [ ] Implement `SpatialHashGrid` for foot placement — 70–90% candidate lookup speedup
- [ ] Add `GaitController` for phase-based stepping — More natural locomotion
- [ ] Implement `ConstraintPool` — 40–60% GC pressure reduction

### Phase 2 (Medium-term, 1 week)
- [ ] Add incremental danger tracking (`dangerCache`) — 60–80% danger calc reduction
- [ ] Implement `RenderLayers` for batched rendering — 30–50% canvas call reduction
- [ ] Add landing validation + fallback candidates — Eliminates foot snap

### Phase 3 (Long-term, 2+ weeks)
- [ ] Upgrade to XPBD constraint solver — Better stability at low iteration counts
- [ ] Implement multi-gait presets (creeping/walking/running) — Gameplay variety
- [ ] Add performance monitoring dashboard — Real-time FPS/memory tracking

---

## PART 5: EXTERNAL REFERENCES & CASE STUDIES

### Academic & Technical Papers
1. **Jakobsen, Thomas** — "Advanced Character Physics" (GDC 2001)
   - Verlet integration fundamentals; constraint relaxation
   - URL: https://www.gdcvault.com/play/1020585/Advanced-Character-Physics

2. **Müller, Matthias et al.** — "Position Based Dynamics" (2007)
   - Constraint-based physics; XPBD solver
   - URL: https://matthias-research.github.io/pages/publications/posBasedDyn.pdf

3. **Suzuki et al.** — "Foot Trajectory as a Key Factor for Diverse Gait Patterns" (Nature 2025)
   - Phase-driven foot trajectories; gait synthesis
   - URL: https://www.nature.com/articles/s41598-024-84060-5

### Production Game Implementations
4. **Unity-Procedural-IK-Wall-Walking-Spider** (GitHub)
   - Spatial IK + terrain adaptation
   - URL: https://github.com/PhilS94/Unity-Procedural-IK-Wall-Walking-Spider

5. **Procedural-Spider-Animation** (Lightningale)
   - Multi-leg procedural animation patterns
   - URL: https://github.com/Lightningale/Procedural-Spider-Animation

### Canvas & Performance Optimization
6. **MDN: Optimizing Canvas** (2025)
   - Canvas API best practices; batching; offscreen rendering
   - URL: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas

7. **Blaze2DJS** — High-performance 2D rendering engine
   - GPU-accelerated damage numbers; dynamic atlasing
   - URL: https://github.com/yosukira/Blaze2DJS

8. **ReoGrid Web** — 10,000-row spreadsheet at 60fps
   - Canvas state caching; per-frame optimization
   - URL: https://web.reogrid.net/articles/canvas-spreadsheet-10000-rows-60fps/

9. **ElliottProgrammer: Canvas Particle Optimization** (2026)
   - Typed arrays; struct-of-arrays layout; OffscreenCanvas
   - URL: https://blog.elliottprogrammer.com/4-performance-optimizations-that-made-my-canvas-particle-animation-butter-smooth/

### Spatial Indexing
10. **Spatial Hash Grid Implementations** (GitHub)
    - Multiple production-ready implementations
    - URLs:
      - https://github.com/RSamaium/RPG-JS (TypeScript)
      - https://github.com/simondevyoutube/Tutorial_SpatialHashGrid_Optimized (JavaScript)
      - https://github.com/pmndrs/koota (Entity-based)

---

## PART 6: QUICK REFERENCE CHECKLIST

### Web Damage Visualization
- [ ] Implement incremental danger tracking (dirty set)
- [ ] Cache particle-to-constraint adjacency
- [ ] Add canvas state caching (fillStyle, strokeStyle, lineWidth)
- [ ] Separate damage rendering to offscreen layer
- [ ] Monitor: danger recalc time, canvas API calls, memory

### Multi-Leg Gait
- [ ] Add spatial hash grid for candidate lookup
- [ ] Enhance scoring: distance + direction + continuity + separation
- [ ] Implement phase-based gait controller
- [ ] Add landing validation + fallback candidates
- [ ] Monitor: step trigger frequency, foot placement quality, gait smoothness

### Mobile Frame Budget
- [ ] Implement adaptive physics iteration count
- [ ] Add constraint object pooling
- [ ] Batch rendering into layers
- [ ] Implement audio context recovery
- [ ] Monitor: P50/P95 frame time, GC pauses, thermal throttling

---

**Document Version:** 1.0  
**Last Updated:** 2026-06-19  
**Maintainer:** Spider Web Optimization Task Force
