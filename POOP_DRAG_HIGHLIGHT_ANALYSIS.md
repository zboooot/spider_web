# Poop Drag Web Highlight Analysis

## Summary
When dragging poop, connected web strands highlight in yellow/orange. This is caused by **shared web tension rendering logic** that detects `_pickupTension` on stuck objects and propagates danger highlighting through the web via BFS.

---

## Root Cause: Two-Part System

### Part 1: Poop Drag Tension Calculation
**File:** `src/main.js`  
**Lines:** 2057-2068

```javascript
var tensionA = 0;
var tensionB = 0;
if (obj.cA) {
  var anchorA = obj.cA.a === p ? obj.cA.b : obj.cA.a;
  tensionA = Math.max(0, p.pos.dist(anchorA.pos) / Math.max(1, obj.cA.distance) - 1);
}
if (obj.cB) {
  var anchorB = obj.cB.a === p ? obj.cB.b : obj.cB.a;
  tensionB = Math.max(0, p.pos.dist(anchorB.pos) / Math.max(1, obj.cB.distance) - 1);
}
obj._pickupTension = tensionA + tensionB;
obj._pickupCharge = Math.min(1, obj._pickupTension / Math.max(0.001, PICKUP_TENSION_THRESHOLD));
```

**What happens:**
- When poop is dragged, its two attachment constraints (`obj.cA` and `obj.cB`) are stretched
- Tension is calculated as the ratio of current distance to rest distance, minus 1
- Both tensions are summed into `obj._pickupTension`
- `obj._pickupCharge` normalizes tension for visual intensity (0-1 range)

---

### Part 2: Web Danger Highlighting (Shared Logic)
**File:** `src/render/webRenderer.js`  
**Lines:** 292-309

```javascript
if (needDanger) {
  for (var ti = 0; ti < thrownObjects.length; ti++) {
    var obj = thrownObjects[ti];
    if (obj.kind === 'drop') continue;
    if ((obj.state !== 'stuck' && obj.state !== 'freeing') || !obj.stuckOnConstraint) continue;
    var bc = obj.stuckOnConstraint;
    if (!_aliveWebSeg(bc)) continue;
    var ci2 = bc.__ci;
    if (ci2 == null || ci2 < 0 || ci2 >= n) continue;
    var ramp = Math.max(0, obj.stayFrames - 72);
    var danger = 0;
    if (obj.state === 'freeing') danger = 1;
    else if (obj.stayTimer > ramp) danger = 1;
    else if (obj.state === 'stuck' && (obj._pickupTension || 0) > 0.08) danger = 1;  // ← POOP DRAG TRIGGER
    if (danger > 0) _dangerRaw[ci2] = 1;
  }
  _applyDangerBfs(comp, n);
}
```

**Key line 305:**
```javascript
else if (obj.state === 'stuck' && (obj._pickupTension || 0) > 0.08) danger = 1;
```

This condition triggers danger highlighting when:
- Object is in 'stuck' state (poop qualifies)
- `_pickupTension` exceeds 0.08 (happens during drag)

---

### Part 3: BFS Propagation to Connected Strands
**File:** `src/render/webRenderer.js`  
**Lines:** 119-149

```javascript
function _applyDangerBfs(comp, n) {
  for (var ci = 0; ci < n; ci++) {
    if (!_dangerRaw[ci]) continue;  // Only process marked constraints
    var d0 = 1;
    if (_dangerFinal[ci] < d0) _dangerFinal[ci] = d0;
    var cc = comp.constraints[ci];
    if (!_aliveWebSeg(cc)) continue;
    var pts = [cc.a.__pid, cc.b.__pid];
    
    // 1-hop neighbors: 45% intensity
    for (var pi = 0; pi < pts.length; pi++) {
      var nbrs = _pToCI[pts[pi]] || [];
      for (var ni2 = 0; ni2 < nbrs.length; ni2++) {
        var ni3 = nbrs[ni2];
        if (ni3 === ci) continue;
        var d1 = d0 * 0.45;
        if (_dangerFinal[ni3] < d1) _dangerFinal[ni3] = d1;
        
        // 2-hop neighbors: 20.25% intensity
        var cc1 = comp.constraints[ni3];
        if (!_aliveWebSeg(cc1)) continue;
        var pts2 = [cc1.a.__pid, cc1.b.__pid];
        for (var pi2 = 0; pi2 < pts2.length; pi2++) {
          var nbrs2 = _pToCI[pts2[pi2]] || [];
          for (var ni4 = 0; ni4 < nbrs2.length; ni4++) {
            var ni5 = nbrs2[ni4];
            if (ni5 === ci || ni5 === ni3) continue;
            var d2 = d0 * 0.45 * 0.45;
            if (_dangerFinal[ni5] < d2) _dangerFinal[ni5] = d2;
          }
        }
      }
    }
  }
}
```

**Propagation pattern:**
- Direct constraint (poop attachment): 100% danger (`d0 = 1`)
- 1-hop neighbors (connected to attachment points): 45% danger
- 2-hop neighbors (connected to 1-hop): 20.25% danger

---

### Part 4: Visual Rendering
**File:** `src/render/webRenderer.js`  
**Lines:** 173-224

```javascript
function _drawDangerSegments(ctx, comp, n, now) {
  for (var i = 0; i < n; i++) {
    var c = comp.constraints[i];
    if (c instanceof DistanceConstraint) {
      if (!_aliveWebSeg(c)) continue;
      ctx.beginPath();
      ctx.moveTo(c.a.pos.x, c.a.pos.y);
      ctx.lineTo(c.b.pos.x, c.b.pos.y);
      var d = _dangerFinal[i];
      if (d > 0) {
        var isDirect = !!_dangerRaw[i];
        var flashHz = 1 + d * 7;
        var phase = (now / 1000 * flashHz) % 1;
        var blink = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
        strokeR = Math.round(230 + 25 * d);
        strokeG = Math.round(230 * (1 - d * 0.92));
        strokeB = Math.round(230 * (1 - d));
        strokeA = 0.4 + blink * (0.55 + d * 0.45);
        strokeW = 1.6 + d * 5.0 + blink * d * 2.4;
        ctx.strokeStyle = 'rgba(' + strokeR + ',' + strokeG + ',' + strokeB + ',' + strokeA + ')';
        ctx.lineWidth = strokeW;
      }
      ctx.stroke();
    }
  }
}
```

**Color formula for danger level `d`:**
- **Red:** 230 + 25×d (increases with danger)
- **Green:** 230×(1 - 0.92×d) (decreases with danger)
- **Blue:** 230×(1 - d) (decreases with danger)
- **Result:** Yellow (high R, high G, low B) → Orange (high R, medium G, low B)

---

## Poop-Specific Rendering
**File:** `src/render/objectRenderer.js`  
**Lines:** 277-311

Poop also draws its own tension visualization (the glowing lines from poop to attachment points):

```javascript
function drawPoopBlob(ctx, obj, def, applyPriorityFlashRect) {
  var charge = obj._pickupCharge || 0;
  if (obj.cA && obj.cB && obj.state === 'stuck') {
    ctx.strokeStyle = charge > 0
      ? 'rgba(245,232,205,' + Math.min(0.96, 0.58 + charge * 0.22).toFixed(2) + ')'
      : 'rgba(25,18,14,0.55)';
    ctx.lineWidth = charge > 0 ? (7.0 + charge * 4.6) : 3.2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(obj.cA.b.pos.x - obj.particle.pos.x, obj.cA.b.pos.y - obj.particle.pos.y);
    ctx.moveTo(0, 0);
    ctx.lineTo(obj.cB.b.pos.x - obj.particle.pos.x, obj.cB.b.pos.y - obj.particle.pos.y);
    ctx.stroke();
  }
}
```

This draws **cream/tan colored lines** from poop to its two attachment points, with intensity based on `_pickupCharge`.

---

## Complete Flow Diagram

```
User drags poop
    ↓
_pickupDrag state active (main.js:2050-2084)
    ↓
Calculate tension from constraint stretch (main.js:2057-2068)
    ↓
Set obj._pickupTension = tensionA + tensionB
    ↓
Render frame:
    ├─ Draw poop with glowing attachment lines (objectRenderer.js:283-302)
    │  └─ Color intensity based on _pickupCharge
    │
    └─ Check web danger (webRenderer.js:305)
       └─ If _pickupTension > 0.08, mark constraint as danger
          └─ Run BFS propagation (webRenderer.js:119-149)
             └─ Highlight connected strands with decreasing intensity
                └─ Render with yellow→orange color (webRenderer.js:195-203)
```

---

## Key State Fields

| Field | File | Purpose |
|-------|------|---------|
| `obj._pickupTension` | main.js:2067 | Sum of constraint stretch ratios |
| `obj._pickupCharge` | main.js:2068 | Normalized tension (0-1) for visual intensity |
| `obj.cA`, `obj.cB` | ThrownObj.js | The two web constraints poop is stuck on |
| `_dangerRaw[ci]` | webRenderer.js:306 | Binary flag: constraint has direct danger |
| `_dangerFinal[ci]` | webRenderer.js:123,133,143 | Propagated danger intensity (0-1) |
| `_pToCI` | webRenderer.js:59 | Particle ID → constraint indices mapping |

---

## Answer to Original Question

**Why does dragging poop highlight connected web strands?**

1. **Poop drag creates tension** in its two attachment constraints (main.js:2057-2068)
2. **Tension exceeds threshold** (0.08) during drag (webRenderer.js:305)
3. **Web renderer detects this** and marks the constraint as "danger" (webRenderer.js:306)
4. **BFS propagates** the danger signal to 1-hop and 2-hop neighbors (webRenderer.js:119-149)
5. **Connected strands render** with yellow/orange color based on propagated danger level (webRenderer.js:195-203)

The highlight comes from **both**:
- **Shared web tension logic** (danger detection + BFS propagation)
- **Poop-specific drawing** (the glowing attachment lines from poop itself)

The web highlight is a **side effect** of the general "danger visualization" system that also highlights web under heavy prey loads.
