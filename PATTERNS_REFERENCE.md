# Spider Web Codebase: Procedural Generation & Simulation Patterns

**Last Updated:** 2026-06-18  
**Scope:** Technical implementation patterns extracted from spider_web physics engine, procedural generation, and interaction systems.

---

## 1. GRAPH GENERATION (Procedural Web Topology)

### 1.1 Radial Web Generation
**File:** `src/entities/spiderweb.js`  
**Function:** `createSpiderweb(sim, origin, radius, segments, depth, stiffness, pinStep)`

**Behavior:** Generates a radial spider web topology with procedural noise perturbation.

**Implementation Details:**
- **Polar Coordinate Distribution:** Creates `segments * depth` particles arranged in concentric rings
  - Angular stride: `stride = (2π) / segments`
  - Radial stride: `rStride = radius / (segments * depth)`
  - Angle perturbation: `theta = i * stride + cos(i*0.4)*0.05 + cos(i*0.05)*0.2`
  - Radius perturbation: `sr = radius - rStride*i + cos(i*0.1)*20`
  - Y-offset perturbation: `offy = cos(theta*2.1) * (radius/depth) * 0.2`

- **Constraint Topology:**
  - Circumferential edges: Connect particle `i` to `i+1` (wraps around)
  - Radial edges: Connect particle `i` to `i+segments` (next ring)
  - Stiffness: 0.6 (configurable)
  - Tensor factor: 0.3 applied post-generation to relax initial stress

- **Anchor Points:** Pins every `pinStep` particles (default 4) to fixed positions

**Pitfall:** Cosine-based perturbation creates deterministic variation; use different seed values for randomness.

---

### 1.2 Web Sampling for Foot Placement
**File:** `src/systems/footSystem.js`  
**Function:** `getWebSamplePoints(webComposite, N)`

**Behavior:** Samples N interpolated points along each distance constraint edge.

**Implementation:**
```javascript
for (each DistanceConstraint c in webComposite.constraints) {
  for (s = 1 to N-1) {
    t = s / N
    point = { pa: c.a, pb: c.b, t: t, x: 0, y: 0 }
  }
}
```

**Update Loop:** `updateSamplePoints(pts)` recalculates x,y each frame:
```javascript
p.x = p.pa.pos.x + (p.pb.pos.x - p.pa.pos.x) * p.t
p.y = p.pa.pos.y + (p.pb.pos.y - p.pa.pos.y) * p.t
```

**Use Case:** Provides dense foot placement targets without storing explicit nodes.

---

### 1.3 Trajectory-Based Collision Detection
**File:** `src/systems/stickSystem.js`  
**Function:** `collectPathHitCandidates(px0, py0, px1, py1, catchR, spiderweb, radialRatioFn)`

**Behavior:** Traces object trajectory and collects web constraint intersections.

**Algorithm:**
1. Calculate motion vector: `motDx = px1 - px0, motDy = py1 - py0`
2. For each constraint, sample 8 points along edge
3. Project each point onto trajectory using dot product:
   ```javascript
   proj = ((wx - px0) * motDx + (wy - py0) * motDy) / (motLen²)
   proj = clamp(proj, 0, 1)
   footX = px0 + proj * motDx
   footY = py0 + proj * motDy
   ```
4. Calculate distance from point to projection foot
5. Filter by `catchR` (catch radius threshold)
6. Return hits with metadata: `{ c, t, x, y, radial, dist }`

**Pitfall:** Dot product projection can miss fast-moving objects; use smaller frame deltas or larger catchR.

---

## 2. PHYSICS SIMULATION (Verlet Integration + Constraints)

### 2.1 Verlet Integration Engine
**File:** `src/engine/VerletJS.js`  
**Class:** `VerletJS(width, height, canvas)`

**Core Properties:**
- `gravity`: Vec2(0, 0.2) — applied each frame
- `friction`: 0.99 — air resistance
- `groundFriction`: 0.8 — surface friction (separate)
- `composites[]`: Array of Composite objects (particles + constraints)

**Frame Update Loop:** `frame(step)`
```javascript
for (each particle p in all composites) {
  vel = (p.pos - p.lastPos) * friction
  if (p.pos.y >= height-1 && vel.length² > threshold) {
    // Ground friction: normalize and scale
    m = vel.length()
    vel = (vel / m) * (m * groundFriction)
  }
  p.lastPos = p.pos
  p.pos += gravity
  p.pos += vel
}

// Constraint relaxation (multiple passes for stiffness)
for (i = 0 to step) {
  for (each constraint c) {
    c.relax(1/step)
  }
}
```

**Key Insight:** Velocity is implicit (pos - lastPos); no explicit velocity vector needed.

**Pitfall:** Fixed `step=16` iterations per frame; increasing step increases stiffness but not frame rate.

---

### 2.2 Particle Representation
**File:** `src/engine/Particle.js`  
**Constructor:** `Particle(pos)`

**Properties:**
- `pos`: Current position (Vec2)
- `lastPos`: Previous frame position (Vec2)

**Velocity Calculation:** `vel = pos - lastPos`

**Pitfall:** Modifying `pos` without updating `lastPos` breaks velocity tracking.

---

### 2.3 Composite Container
**File:** `src/engine/Composite.js`  
**Constructor:** `Composite()`

**Properties:**
- `particles[]`: Array of Particle objects
- `constraints[]`: Array of Constraint objects

**Helper Method:** `pin(index, pos)`
- Creates PinConstraint at particle[index]
- Fixes particle to absolute position

---

## 3. CONSTRAINT SYSTEMS

### 3.1 Distance Constraint (Spring)
**File:** `src/engine/constraints.js`  
**Constructor:** `DistanceConstraint(a, b, stiffness, distance)`

**Properties:**
- `a, b`: Particle references
- `distance`: Target distance (auto-calculated if not provided)
- `stiffness`: Correction scale (0.3–0.6 typical)

**Relaxation Algorithm:**
```javascript
relax(sc) {
  n = a.pos - b.pos
  m = n.length²
  delta = ((distance² - m) / m) * stiffness * sc
  n *= delta
  a.pos += n
  b.pos -= n
}
```

**Interpretation:** Corrects both particles equally toward target distance.

**Pitfall:** Stiffness < 0.5 can cause oscillation; > 0.8 can cause instability.

---

### 3.2 Pin Constraint (Fixed Point)
**File:** `src/engine/constraints.js`  
**Constructor:** `PinConstraint(a, pos)`

**Properties:**
- `a`: Particle reference
- `pos`: Fixed position (Vec2)

**Relaxation:**
```javascript
relax() {
  a.pos = pos  // No dynamics; absolute position
}
```

**Use Case:** Web anchor points, immovable obstacles.

---

### 3.3 Angle Constraint (Joint Stiffness)
**File:** `src/engine/constraints.js`  
**Constructor:** `AngleConstraint(a, b, c, stiffness)`

**Properties:**
- `a, b, c`: Three particles forming angle at b
- `angle`: Target angle (stored at construction)
- `stiffness`: Correction scale

**Relaxation Algorithm:**
```javascript
relax(sc) {
  angle_current = angle2(a.pos, b.pos, c.pos)
  diff = angle_current - angle
  
  // Wrap to [-π, π]
  if (diff <= -π) diff += 2π
  else if (diff >= π) diff -= 2π
  
  diff *= sc * stiffness
  
  // Rotate all three particles
  a.pos = rotate(a.pos, b.pos, diff)
  c.pos = rotate(c.pos, b.pos, -diff)
  b.pos = rotate(b.pos, a.pos, diff)
  b.pos = rotate(b.pos, c.pos, -diff)
}
```

**Use Case:** Spider leg joint stiffness, preventing hyperextension.

**Pitfall:** Angle wrapping is critical; missing ±π adjustment causes jitter.

---

## 4. PARTICLE SYSTEMS & ANIMATION

### 4.1 Main Animation Loop
**File:** `src/main.js`  
**Function:** `loop(timestamp)`

**Frame Structure:**
```javascript
loop(timestamp) {
  // 1. Delta-time scaling
  delta = Math.min(timestamp - lastTimestamp, 50)
  timeScale = delta / 16.67  // 60fps baseline
  
  // 2. Update background (always runs)
  updateSylvanBackground(1.0, mouseDown, smoothDrag, mouseX, mouseY)
  if (!IS_MOBILE || bgFrame % 3 === 0) {
    renderSylvanBackground()
  }
  
  // 3. Game logic (if active)
  if (gameState === 'LEVEL_ACTIVE') {
    updateSamplePoints(samplePoints)
    
    // Body movement
    if (target) {
      moveDir = normalize(target - thorax)
      for (each particle p in spider) {
        p.pos += moveDir * moveSpeed * timeScale
        p.lastPos += moveDir * moveSpeed * timeScale
      }
    }
    
    // Foot stepping
    for (each foot fs) {
      if (fs.stepping) {
        fs.t = min(1, fs.t + STEP_SPEED)
        ease = fs.t < 0.5 ? 2*fs.t² : -1 + (4-2*fs.t)*fs.t
        fs.current = lerp(fs.from, fs.targetPos, ease)
        fs.particle.pos = fs.current
        fs.particle.lastPos = fs.current
      }
    }
    
    // Physics
    updateLevelTimer()
    updateLevelSpawner()
    checkWebIntegrity()
    updateThrownObjects()
    
    sim.frame(16)  // Fixed constraint iterations
    sim.draw()
  }
  
  requestAnimFrame(loop)
}
```

**Key Patterns:**
- **Delta-time scaling:** Only game logic uses timeScale; physics uses fixed iterations
- **Simultaneous pos/lastPos update:** Preserves velocity through animation
- **Easing function:** Quadratic ease-in-out for smooth acceleration/deceleration

---

### 4.2 Foot Stepping Animation
**File:** `src/main.js` (lines 1164–1192)

**State Machine:**
```javascript
if (fs.stepping) {
  // Animate from current to target
  fs.t += STEP_SPEED
  ease = quadraticEaseInOut(fs.t)
  fs.current = lerp(fs.from, fs.targetPos, ease)
  fs.particle.pos = fs.current
  fs.particle.lastPos = fs.current
  
  if (fs.t >= 1) {
    fs.stepping = false
    landFoot(fs, spider)  // Create constraint
  }
} else {
  // Foot is landed; track web deformation
  if (fs.landedNode) {
    fs.current = fs.landedNode.pos
  } else if (fs.landedSeg) {
    fs.current = lerp(fs.landedSeg.pa.pos, fs.landedSeg.pb.pos, fs.landedSeg.t)
  }
  fs.particle.pos = fs.current
  fs.particle.lastPos = fs.current
  
  // Trigger next step if drifted too far
  if (distance(fs.current, thorax) > STEP_THRESH) {
    triggerStep(...)
  }
}
```

**Easing Formula:**
```javascript
ease = t < 0.5 ? 2*t² : -1 + (4-2*t)*t
```
Produces smooth acceleration (0→0.5) and deceleration (0.5→1).

---

### 4.3 Thrown Object Physics
**File:** `src/main.js` (lines 710–800+)  
**Function:** `updateThrownObjects()`

**Lifecycle:**
1. **Spawn:** Object created with initial velocity
2. **Free Fall:** Gravity applied each frame
3. **Web Entry:** Trajectory sampled for collision
4. **Stick History:** Candidates collected over 40 frames
5. **Delayed Stick:** After delay, best candidate selected and constraint created
6. **Removal:** On timeout or collection

**Stick History Logic:**
```javascript
if (obj.inWebZone && !obj.stickDelay) {
  obj.stickDelay = STICK_DELAY_FRAMES
  obj.stickHistory = []
}

if (obj.stickDelay > 0) {
  obj.stickDelay--
  hits = collectPathHitCandidates(...)
  obj.stickHistory.push(...hits)
  
  if (obj.stickDelay === 0) {
    chosen = chooseStickCandidate(obj.stickHistory, spiderweb, stickMidBias)
    if (chosen) {
      createConstraint(obj, chosen)
    }
  }
}
```

**Pitfall:** Delayed sticking prevents jitter but can miss fast-moving objects.

---

## 5. INTERACTION HANDLERS

### 5.1 Mouse & Touch Input
**File:** `src/engine/VerletJS.js` (lines 29–67)

**Mouse Handlers:**
```javascript
canvas.onmousedown = () => {
  mouseDown = true
  draggedEntity = nearestEntity()
}

canvas.onmousemove = (e) => {
  r = canvas.getBoundingClientRect()
  mouse.x = (e.clientX - r.left) * (width / r.width)
  mouse.y = (e.clientY - r.top) * (height / r.height)
}

canvas.onmouseup = () => {
  mouseDown = false
  draggedEntity = null
}
```

**Touch Handlers:**
```javascript
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault()
  mouseDown = true
  t = e.touches[0]
  mouse.x = (t.clientX - r.left) * (width / r.width)
  mouse.y = (t.clientY - r.top) * (height / r.height)
  draggedEntity = nearestEntity()
}, { passive: false })
```

**Key Detail:** `passive: false` required to call `preventDefault()` on touch events.

**Pitfall:** DPR (device pixel ratio) scaling must be applied to canvas coordinates.

---

### 5.2 Foot Placement Search
**File:** `src/systems/footSystem.js`  
**Function:** `findStepTarget(webComp, legIndex, spiderComp, moveDir, samplePoints, occupiedPositions)`

**Algorithm:**
1. **Build Alive Particle Set:** Collect all particles referenced by active constraints
   ```javascript
   aliveParticles = {}
   for (each constraint c in webComp.constraints) {
     aliveParticles[c.a.__pid] = true
     aliveParticles[c.b.__pid] = true
   }
   ```

2. **Collect Node Candidates:** Particles within step radius
   ```javascript
   for (each particle wp in webComp.particles) {
     d² = distance²(wp.pos, thorax)
     if (minR² <= d² <= stepR²) {
       if (wp.__pid in aliveParticles) {
         cands.push({ type: 'node', particle: wp, x: wp.pos.x, y: wp.pos.y })
       }
     }
   }
   ```

3. **Collect Segment Candidates:** Interpolated points on constraints
   ```javascript
   for (each samplePoint sp in samplePoints) {
     d² = distance²(sp, thorax)
     if (minR² <= d² <= stepR²) {
       if (sp.pa.__pid in aliveParticles && sp.pb.__pid in aliveParticles) {
         cands.push(sp)
       }
     }
   }
   ```

4. **Score Candidates:**
   ```javascript
   score(cx, cy) {
     // Distance to ideal position
     dx = cx - idealX, dy = cy - idealY
     distScore = 1 / (1 + distance(cx, cy, idealX, idealY))
     
     // Angle alignment
     angle = atan2(cy - thorax.y, cx - thorax.x)
     angleScore = cos(angle - legAngle)
     
     // Leg separation penalty
     separation = min distance to other legs
     sepScore = separation > MIN_LEG_SEP ? 1 : 0.5
     
     return distScore * angleScore * sepScore
   }
   ```

5. **Return Best:** Candidate with highest score, or null if none valid.

**Pitfall:** Alive particle set must be rebuilt each frame; stale references cause invalid placements.

---

### 5.3 Stick Candidate Selection
**File:** `src/systems/stickSystem.js`  
**Function:** `chooseStickCandidate(history, spiderweb, stickMidBias)`

**Algorithm:**
1. **Filter Alive Constraints:**
   ```javascript
   alive = history.filter(h => spiderweb.constraints.indexOf(h.c) !== -1)
   ```

2. **Weight by Depth & Radial Position:**
   ```javascript
   for (each h in alive) {
     depthWeight = 0.4 + 0.6 * ((i+1) / alive.length)  // Older = lower weight
     midness = 1 - abs(h.radial - 0.5) / 0.5  // Center-biased
     h._w = depthWeight * (1 + stickMidBias * midness)
   }
   ```

3. **Weighted Random Selection:**
   ```javascript
   total = sum of all weights
   rnd = random(0, total)
   acc = 0
   for (each h in alive) {
     acc += h._w
     if (rnd <= acc) return h
   }
   ```

**Interpretation:** Prefers recent, center-biased candidates; avoids edge sticking.

---

## 6. ANIMATION LOOPS & EASING

### 6.1 Quadratic Ease-In-Out
**Formula:**
```javascript
ease(t) = t < 0.5 ? 2*t² : -1 + (4-2*t)*t
```

**Behavior:**
- t=0: ease=0 (start)
- t=0.25: ease≈0.125 (slow acceleration)
- t=0.5: ease=0.5 (midpoint)
- t=0.75: ease≈0.875 (slow deceleration)
- t=1: ease=1 (end)

**Use Case:** Foot stepping, object collection animations.

---

### 6.2 Exponential Damping (Parallax Drag)
**File:** `src/main.js` (lines 1124–1126)

**Formula:**
```javascript
smoothDrag.x += (dragOffset.x - smoothDrag.x) * 0.1
smoothDrag.y += (dragOffset.y - smoothDrag.y) * 0.1
```

**Interpretation:** Each frame, move 10% of the way toward target; asymptotically approaches target.

**Half-Life:** ~7 frames to reach 50% of target.

---

### 6.3 Web Integrity Scan (Incremental)
**File:** `src/main.js` (lines 487–534)

**Batched Processing:**
```javascript
continueWebGridBuild() {
  batchSize = 50
  end = min(webGridBuildIdx + batchSize, webGridList.length)
  for (k = webGridBuildIdx to end) {
    if (cellCovered(webGridList[k], spiderweb, coverD)) {
      webGridInitCover++
    }
  }
  webGridBuildIdx = end
}
```

**Benefit:** Spreads computation across frames; prevents frame drops.

**Pitfall:** Grid must be rebuilt when web topology changes (constraints break).

---

## 7. KEY TECHNICAL PATTERNS & PITFALLS

### 7.1 Verlet Integration Stability
- **Fixed constraint iterations (16):** Not scaled by delta-time; ensures consistent stiffness
- **Implicit velocity:** Stored as (pos - lastPos); no explicit velocity vector
- **Friction before position update:** Dampens oscillation before gravity applied
- **Pitfall:** Increasing step count increases stiffness but not frame rate; use stiffness parameter instead

### 7.2 Constraint Relaxation Order
- **Distance constraints first:** Maintain edge lengths
- **Angle constraints second:** Maintain joint angles
- **Pitfall:** Reversing order causes instability; angle constraints can fight distance constraints

### 7.3 Procedural Topology
- **Polar coordinates:** Stride-based distribution ensures even spacing
- **Cosine perturbation:** Deterministic variation; use seed for randomness
- **Tensor factor (0.3):** Relaxes initial stress; prevents over-tightness
- **Pitfall:** Changing stiffness post-generation requires re-tensioning

### 7.4 Collision Detection
- **Trajectory projection:** Dot product method is fast and accurate
- **Radial ratio weighting:** Biases sticking toward web center
- **History-based delayed sticking:** Avoids jitter but can miss fast objects
- **Pitfall:** Catch radius must be tuned per object speed; too small = misses, too large = false positives

### 7.5 Frame-Rate Independence
- **timeScale = delta / 16.67:** Scales game logic to 60fps baseline
- **Physics uses fixed iterations:** Not delta-scaled; ensures stability
- **Background rendering throttled on mobile:** Every 3 frames (~20fps)
- **Pitfall:** Mixing delta-scaled and fixed-iteration systems can cause inconsistency

### 7.6 Interaction Smoothing
- **Exponential damping:** x += (target - x) * 0.1 per frame
- **DPR-aware canvas coordinates:** Scale mouse position by device pixel ratio
- **Touch passive: false:** Required to prevent scroll interference
- **Pitfall:** Forgetting DPR scaling causes misaligned dragging on high-DPI displays

### 7.7 Spatial Queries
- **Web sample points cached:** Updated each frame, not regenerated
- **Alive particle set on-demand:** Built per query, not pre-computed
- **Grid-based web integrity:** Incremental batched scanning
- **Pitfall:** Stale particle references cause invalid placements; rebuild alive set each frame

### 7.8 Animation Easing
- **Quadratic ease-in-out:** Smooth acceleration/deceleration
- **Simultaneous pos/lastPos update:** Preserves velocity through animation
- **Distance-based step triggering:** STEP_THRESH for moving, REST_THRESH for idle
- **Pitfall:** Forgetting to update lastPos breaks velocity tracking; foot will snap on next physics frame

---

## 8. PERFORMANCE CONSIDERATIONS

### 8.1 Constraint Iteration Count
- **Current:** 16 iterations per frame
- **Effect:** Higher = stiffer, more stable; lower = faster, more flexible
- **Trade-off:** Stability vs. performance

### 8.2 Web Sample Point Density
- **Current:** N=8 samples per constraint edge
- **Effect:** Higher = more foot placement options; lower = faster queries
- **Trade-off:** Foot placement quality vs. query speed

### 8.3 Stick History Buffer
- **Current:** 40 frames
- **Effect:** Longer = more stable sticking; shorter = faster response
- **Trade-off:** Stability vs. responsiveness

### 8.4 Grid Cell Size
- **Current:** webGridStep (configurable)
- **Effect:** Smaller = more precise damage tracking; larger = faster scanning
- **Trade-off:** Precision vs. performance

---

## 9. REFERENCES & RELATED SYSTEMS

- **Verlet Integration:** Jakobsen, Thomas. "Advanced Character Physics." GDC 2001.
- **Constraint-Based Physics:** Müller, Matthias et al. "Position Based Dynamics." 2007.
- **Procedural Generation:** Perlin noise, cosine perturbation, polar coordinates
- **Interaction:** Trajectory projection, weighted random selection, exponential damping

---

**End of Document**
