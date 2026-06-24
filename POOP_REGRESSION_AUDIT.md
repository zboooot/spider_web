# Poop-Specific State/Render Regressions Audit

## Summary
Two critical poop-specific regressions identified after drag unification changes:

### **REGRESSION #1: Poop Behaves Like Leaf After Peel-Off**
**Severity:** HIGH  
**Root Cause:** Missing state transition logic in `falling2` state  
**Impact:** Poop disappears incorrectly instead of falling with proper physics

---

## Issue 1: Missing Poop-Specific Falling2 Physics

### Location
**File:** `src/main.js`  
**Lines:** 2003-2033 (falling2 state handler)

### Problem
The `falling2` state handler has a **conditional branch structure that excludes poop**:

```javascript
} else if (obj.state === 'falling2') {
  if (obj.kind === 'drop') {
    // LEAF PHYSICS: angle, glide, drag, max speed
    obj.angleVel += (Math.random() - 0.5) * obj.angleTurb * _currentTimeScale;
    obj.angleVel *= Math.pow(obj.angleDrag, _currentTimeScale);
    obj.angle += obj.angleVel * _currentTimeScale;
    obj.vx += Math.sin(obj.angle) * obj.glideForce * _currentTimeScale;
    obj.vy += obj.grav * _currentTimeScale;
    var dragScale = Math.pow(obj.drag, _currentTimeScale);
    obj.vx *= dragScale; obj.vy *= dragScale;
    var maxSpd = obj.kind === 'poop' ? 6.2 : 0.8;  // ← POOP REFERENCED HERE
    var spd2 = Math.sqrt(obj.vx * obj.vx + obj.vy * obj.vy);
    if (spd2 > maxSpd) { obj.vx = obj.vx / spd2 * maxSpd; obj.vy = obj.vy / spd2 * maxSpd; }
    p.pos.x += obj.vx * _currentTimeScale; p.pos.y += obj.vy * _currentTimeScale;
  } else if (obj.kind === 'poop') {
    // POOP PHYSICS: peelDrag, gravity, position update
    var peelDragScale = Math.pow(obj.def.peelDrag, _currentTimeScale);
    obj.vx *= peelDragScale;
    obj.vy *= peelDragScale;
    obj.vy += obj.grav * 0.08 * _currentTimeScale;
    p.pos.x += obj.vx * _currentTimeScale;
    p.pos.y += obj.vy * _currentTimeScale;
  } else {
    // BOULDER/BUG: simple gravity
    p.pos.y += obj.grav * _currentTimeScale;
  }
  // CLEANUP LOGIC
  if (obj.kind === 'poop') {
    if (p.pos.y > H + 80 || p.pos.x < -90 || p.pos.x > W + 90) {
      obj.destroy(sim); thrownObjects.splice(oi, 1); updateBadge(obj.kind, -1);
    }
  } else {
    obj.alpha = Math.max(0, obj.alpha - 0.016 * _currentTimeScale);
    if (obj.alpha <= 0) { obj.destroy(sim); thrownObjects.splice(oi, 1); updateBadge(obj.kind, -1); }
  }
}
```

### The Bug
**Line 2012:** `var maxSpd = obj.kind === 'poop' ? 6.2 : 0.8;`

This line is **inside the `if (obj.kind === 'drop')` block**, meaning:
- **Poop never executes the leaf physics** (correct)
- **But poop also never initializes `obj.vx` and `obj.vy` from peelOff**
- The `peelOff()` method sets `this.vx` and `this.vy` (lines 657-658 in ThrownObj.js)
- However, **poop's falling2 handler doesn't apply the peelDrag decay properly** if vx/vy are uninitialized

### Secondary Issue
**Line 2012 is unreachable for poop** because it's inside the `if (obj.kind === 'drop')` block. The maxSpd check for poop is dead code.

### Expected Behavior
After `peelOff()` is called:
1. `obj.state = 'falling2'`
2. `obj.vx` and `obj.vy` are set from drag direction
3. In `falling2`, poop should apply `peelDrag` decay each frame
4. Poop should fall with gravity and drag until off-screen

### Actual Behavior
- Poop enters `falling2` state
- Poop physics branch executes (lines 2016-2022)
- But if `obj.vx` and `obj.vy` are not properly initialized, poop may not move
- Or poop may behave like a leaf if the conditional logic is misinterpreted

---

## Issue 2: Missing Silk Wrap Visuals for Poop

### Location
**File:** `src/render/objectRenderer.js`  
**Lines:** 143-169 (buildSilkSpiral function)

### Problem
The `buildSilkSpiral()` function **explicitly excludes poop**:

```javascript
export function buildSilkSpiral(obj) {
  if (obj.kind !== 'bug' && obj.kind !== 'boulder') return null;  // ← POOP RETURNS NULL
  // ... image loading and contour extraction ...
  var cacheKey = obj.kind + '_' + Math.round(r * 10);
  if (!_silkSpiralCache[cacheKey]) {
    if (!img.complete || img.naturalWidth === 0) return null;
    var contour = _smoothContour(_extractContour(img, drawW, drawH, 180));
    _silkSpiralCache[cacheKey] = contour;
  }
  var contour = _silkSpiralCache[cacheKey];
  var loops = obj.kind === 'bug' ? 10 : 12;
  return _buildSpiralFromContour(contour, loops, 64);
}
```

### Where Silk Spiral is Used
**File:** `src/main.js`  
**Line:** 1720 (in `beginWrapping()`)
```javascript
obj._silkSpiral = buildSilkSpiral(obj);
```

**File:** `src/render/objectRenderer.js`  
**Lines:** 537-553 (in `drawThrownObjects()`)
```javascript
if ((obj.state === 'wrapping' || obj.state === 'wrapped' || obj.state === 'plucking' || obj.state === 'collecting') 
    && obj._silkSpiral 
    && (obj.kind === 'bug' || obj.kind === 'boulder' || obj.kind === 'poop')) {
  var silkProgress = obj.state === 'wrapping' ? obj.wrapT : 1;
  if (silkProgress > 0) {
    // ... draw silk spiral ...
    drawSilkSpiralLocal(ctx, obj, silkProgress);
  }
}
```

### The Bug
1. **buildSilkSpiral() returns null for poop** (line 144)
2. **Rendering code checks for poop in the condition** (line 537) but `obj._silkSpiral` is null
3. **Result:** Silk wrap visuals never render for poop during wrapping/wrapped states

### Expected Behavior
- When poop enters `wrapping` state, `obj._silkSpiral` should be built
- During wrapping, silk spiral should animate from 0 to 1 progress
- During wrapped state, full silk spiral should be visible

### Actual Behavior
- `buildSilkSpiral(poop)` returns null
- `obj._silkSpiral` is null
- Rendering condition `obj._silkSpiral && ...` fails
- No silk visuals appear during poop wrapping

---

## Code Path Analysis

### Poop Peeling Flow
1. **Stuck state** (line 1909-1910):
   ```javascript
   if (obj.kind === 'poop') {
     obj.peelOff(sPullDx, sPullDy);
   }
   ```
   - Calls `ThrownObj.prototype.peelOff()` (ThrownObj.js:645-661)
   - Sets `obj.state = 'falling2'`
   - Sets `obj.vx` and `obj.vy` from drag direction

2. **Falling2 state** (line 2016-2022):
   ```javascript
   } else if (obj.kind === 'poop') {
     var peelDragScale = Math.pow(obj.def.peelDrag, _currentTimeScale);
     obj.vx *= peelDragScale;
     obj.vy *= peelDragScale;
     obj.vy += obj.grav * 0.08 * _currentTimeScale;
     p.pos.x += obj.vx * _currentTimeScale;
     p.pos.y += obj.vy * _currentTimeScale;
   }
   ```
   - Applies peelDrag decay (0.985 per frame)
   - Applies reduced gravity (0.08x)
   - Updates position

3. **Off-screen cleanup** (line 2026-2029):
   ```javascript
   if (obj.kind === 'poop') {
     if (p.pos.y > H + 80 || p.pos.x < -90 || p.pos.x > W + 90) {
       obj.destroy(sim); thrownObjects.splice(oi, 1); updateBadge(obj.kind, -1);
     }
   }
   ```

### Poop Wrapping Flow
1. **Wrapping initiation** (line 1706-1721):
   ```javascript
   function beginWrapping(obj) {
     obj.state = 'wrapping';
     obj.wrapT = 0;
     obj.wrapDur = obj.def.wrapDur;
     obj.particle.lastPos.mutableSet(obj.particle.pos);
     obj.particle._noSimDrag = true;
     wrappingTarget = obj;
     // ...
     obj._silkSpiral = buildSilkSpiral(obj);  // ← RETURNS NULL FOR POOP
   }
   ```

2. **Wrapping state** (line 2035-2044):
   ```javascript
   } else if (obj.state === 'wrapping') {
     p.lastPos.mutableSet(p.pos);
     obj.wrapT = Math.min(1, obj.wrapT + _currentTimeScale / obj.wrapDur);
     if (Math.round(obj.wrapT * obj.wrapDur) % 12 === 0) audioEngine.playSfxWrap(obj.wrapT);
     if (obj.wrapT >= 1) {
       wrappingTarget = null;
       obj.state = 'wrapped';
       obj._popT = 0;
       audioEngine.playCollectSound(obj.kind);
     }
   }
   ```

3. **Rendering** (line 537-553):
   ```javascript
   if ((obj.state === 'wrapping' || obj.state === 'wrapped' || obj.state === 'plucking' || obj.state === 'collecting') 
       && obj._silkSpiral 
       && (obj.kind === 'bug' || obj.kind === 'boulder' || obj.kind === 'poop')) {
     // ... draw silk spiral ...
   }
   ```
   - Condition fails because `obj._silkSpiral` is null

---

## Summary of Fixes Needed

| Issue | File | Lines | Fix |
|-------|------|-------|-----|
| **Poop falling2 physics** | `src/main.js` | 2003-2033 | Verify `obj.vx`/`obj.vy` initialization after `peelOff()` or ensure peelDrag is applied correctly |
| **Missing silk spiral** | `src/render/objectRenderer.js` | 143-144 | Add poop to `buildSilkSpiral()` condition; handle poop image/contour extraction |
| **Dead code** | `src/main.js` | 2012 | Remove unreachable poop maxSpd check from leaf physics block |

---

## Verification Checklist
- [ ] Poop peels off correctly with proper velocity
- [ ] Poop falls with peelDrag decay (0.985 per frame)
- [ ] Poop disappears when off-screen (not when stuck)
- [ ] Poop shows silk wrap visuals during wrapping state
- [ ] Poop shows full silk wrap during wrapped state
- [ ] No console errors related to poop rendering
