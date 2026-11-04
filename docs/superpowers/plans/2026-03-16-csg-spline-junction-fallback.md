# CSG Spline Junction Fallback Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `null` fallback for spline-path junctions with a real mesh-mesh boolean subtraction via `three-bvh-csg`, producing gap-free geometry at load time.

**Architecture:** A new `junction-csg.js` module wraps `three-bvh-csg`'s `Evaluator` and exports `applyCsgJunctions(sceneRoot, junctions)`, which mirrors the API of `applyJunctionClipping` in `junction-renderer.js`. It is called once in `_buildScene` after planar clipping. Junctions opt in via `trim_method: "csg"` (schema already supports this field). CSG runs on the THREE.Mesh objects that already exist in the scene; the subordinate mesh's geometry is replaced in-place.

**Tech Stack:** Three.js 0.170+, three-bvh-csg 0.0.18, Vitest (node environment)

---

## Chunk 1: Dependency + Module Skeleton

### Task 1: Add `three-bvh-csg` to viewer dependencies

**Files:**
- Modify: `viewer/package.json`

- [ ] **Step 1: Install the package**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npm install three-bvh-csg
```

Expected: `three-bvh-csg` appears in `package.json` `dependencies` and `node_modules`.

- [ ] **Step 2: Verify the package exports**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && node -e "import('three-bvh-csg').then(m => console.log(Object.keys(m)))"
```

Expected: output includes `Evaluator`, `SUBTRACTION`, `INTERSECTION`, `ADDITION`.

- [ ] **Step 3: Commit**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer
git add package.json package-lock.json
git commit -m "feat: add three-bvh-csg dependency for spline junction CSG"
```

---

### Task 2: Write failing tests for `applyCsgJunctions`

**Files:**
- Create: `viewer/src/junction-csg.test.js`

- [ ] **Step 1: Create the test file**

```javascript
// viewer/src/junction-csg.test.js
/**
 * junction-csg.test.js
 *
 * Tests for CSG-based junction trimming (spline path fallback).
 * Uses actual THREE.BufferGeometry so three-bvh-csg can operate on it.
 */

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { applyCsgJunctions } from './junction-csg.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a THREE.Mesh whose geometry spans [x0,x1] × [y0,y1] × [z0,z1].
 * Geometry is baked into world space (identity matrix on mesh).
 */
function makeBoxMesh(x0, y0, z0, x1, y1, z1, elementId) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  const w = x1 - x0, h = y1 - y0, d = z1 - z0;
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(cx, cy, cz); // bake world position into geometry vertices
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xaaaaaa }));
  mesh.userData.elementId = elementId;
  return mesh;
}

/** Return the bounding box of a mesh's geometry (after updateWorldMatrix). */
function geoBoundingBox(mesh) {
  mesh.geometry.computeBoundingBox();
  return mesh.geometry.boundingBox;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('applyCsgJunctions', () => {
  it('no-op for empty junctions array', () => {
    const group = new THREE.Group();
    const mesh = makeBoxMesh(0, 0, 0, 2, 1, 1, 'element-a');
    const originalGeo = mesh.geometry;
    group.add(mesh);

    applyCsgJunctions(group, []);

    expect(mesh.geometry).toBe(originalGeo); // geometry unchanged
  });

  it('no-op for junctions without trim_method: "csg"', () => {
    const group = new THREE.Group();
    const mesh = makeBoxMesh(0, 0, 0, 2, 1, 1, 'element-a');
    const originalGeo = mesh.geometry;
    group.add(mesh);

    const junction = {
      id: 'junction-planar',
      type: 'Junction',
      elements: ['element-a', 'element-b'],
      rule: 'butt',
      priority: ['element-b'],
      trim_planes: [{ element_id: 'element-a', at_end: 'end',
        plane_normal: { x: 1, y: 0, z: 0 },
        plane_origin: { x: 1.5, y: 0, z: 0 } }],
    };

    applyCsgJunctions(group, [junction]);

    expect(mesh.geometry).toBe(originalGeo); // planar junction skipped
  });

  it('replaces subordinate mesh geometry for a CSG junction', () => {
    const group = new THREE.Group();
    // element-a (subordinate): wall spanning x=[0,2], y=[0,0.3], z=[0,2.4]
    const meshA = makeBoxMesh(0, 0, 0, 2, 0.3, 2.4, 'element-a');
    // element-b (dominant): wall spanning x=[1.5,5], y=[-5,5], z=[0,2.4]
    // Overlaps element-a for x in [1.5, 2]
    const meshB = makeBoxMesh(1.5, -5, 0, 5, 5, 2.4, 'element-b');
    group.add(meshA);
    group.add(meshB);

    const originalGeo = meshA.geometry;

    const junction = {
      id: 'junction-spline-butt',
      type: 'Junction',
      elements: ['element-a', 'element-b'],
      rule: 'butt',
      priority: ['element-b'],
      trim_method: 'csg',
      trim_planes: [],
    };

    applyCsgJunctions(group, [junction]);

    // Geometry must have been replaced (CSG returns a new geometry object)
    expect(meshA.geometry).not.toBe(originalGeo);

    // After CSG, element-a should not extend into element-b's region
    // element-b starts at x=1.5, so element-a should end at x≤1.5
    const bb = geoBoundingBox(meshA);
    expect(bb.max.x).toBeLessThanOrEqual(1.5 + 0.01); // 1cm tolerance
  });

  it('leaves dominant mesh geometry unchanged', () => {
    const group = new THREE.Group();
    const meshA = makeBoxMesh(0, 0, 0, 2, 0.3, 2.4, 'element-a');
    const meshB = makeBoxMesh(1.5, -5, 0, 5, 5, 2.4, 'element-b');
    group.add(meshA);
    group.add(meshB);

    const originalGeoB = meshB.geometry;

    const junction = {
      id: 'junction-spline-butt',
      type: 'Junction',
      elements: ['element-a', 'element-b'],
      rule: 'butt',
      priority: ['element-b'],
      trim_method: 'csg',
      trim_planes: [],
    };

    applyCsgJunctions(group, [junction]);

    // Dominant mesh is untouched
    expect(meshB.geometry).toBe(originalGeoB);
  });

  it('warns and skips CSG junction with missing priority', () => {
    const group = new THREE.Group();
    const meshA = makeBoxMesh(0, 0, 0, 2, 0.3, 2.4, 'element-a');
    group.add(meshA);
    const originalGeo = meshA.geometry;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const junction = {
      id: 'junction-no-priority',
      type: 'Junction',
      elements: ['element-a'],
      rule: 'butt',
      priority: [],
      trim_method: 'csg',
      trim_planes: [],
    };

    applyCsgJunctions(group, [junction]);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no subordinate'));
    expect(meshA.geometry).toBe(originalGeo);

    warnSpy.mockRestore();
  });

  it('warns and skips when a referenced element mesh is not in the scene', () => {
    const group = new THREE.Group();
    // Only add element-b; element-a is missing from scene
    const meshB = makeBoxMesh(1.5, -5, 0, 5, 5, 2.4, 'element-b');
    group.add(meshB);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const junction = {
      id: 'junction-missing-mesh',
      type: 'Junction',
      elements: ['element-a', 'element-b'],
      rule: 'butt',
      priority: ['element-b'],
      trim_method: 'csg',
      trim_planes: [],
    };

    // Should not throw
    expect(() => applyCsgJunctions(group, [junction])).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('logs CSG timing for each junction', () => {
    const group = new THREE.Group();
    const meshA = makeBoxMesh(0, 0, 0, 2, 0.3, 2.4, 'element-a');
    const meshB = makeBoxMesh(1.5, -5, 0, 5, 5, 2.4, 'element-b');
    group.add(meshA);
    group.add(meshB);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const junction = {
      id: 'junction-timing',
      type: 'Junction',
      elements: ['element-a', 'element-b'],
      rule: 'butt',
      priority: ['element-b'],
      trim_method: 'csg',
      trim_planes: [],
    };

    applyCsgJunctions(group, [junction]);

    // Expect a log message containing the junction id and timing
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('junction-timing'),
    );

    logSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npx vitest run src/junction-csg.test.js
```

Expected: FAIL — `Cannot find module './junction-csg.js'`

---

### Task 3: Implement `viewer/src/junction-csg.js`

**Files:**
- Create: `viewer/src/junction-csg.js`

- [ ] **Step 1: Create the module**

```javascript
// viewer/src/junction-csg.js
/**
 * junction-csg.js
 *
 * CSG-based junction trimming for OEBF building elements with spline paths.
 *
 * Junctions that cannot be trimmed with planar clip planes (e.g., those whose
 * elements use spline path segments) carry `trim_method: "csg"` and have an
 * empty `trim_planes` array. This module detects those junctions and applies
 * a mesh-mesh boolean subtraction via `three-bvh-csg`, replacing the
 * subordinate element's geometry in-place.
 *
 * Usage: call applyCsgJunctions(sceneRoot, junctions) once after the scene
 * group is populated and after applyJunctionClipping() has run.
 *
 * Priority rules:
 *   - Elements listed in junction.priority are dominant (not trimmed).
 *   - Elements NOT in junction.priority are subordinate (get trimmed).
 *   - If priority is empty no subordinates can be identified; junction is
 *     skipped with a warning.
 *
 * Performance: CSG time is logged per junction. Target < 5 ms on M2 MacBook
 * Air (measured at load time, not per frame — CSG runs once only).
 *
 * See: docs/decisions/2026-03-02-junction-trim-algorithm.md
 *      Issue #18: v0.2 CSG spline junction trim
 */

import * as THREE from 'three';
import { Evaluator, SUBTRACTION } from 'three-bvh-csg';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Apply CSG trimming to any junctions that carry `trim_method: "csg"`.
 *
 * Traverses sceneRoot to build an elementId → THREE.Mesh map, then for each
 * CSG junction performs a boolean SUBTRACTION of each dominant element from
 * each subordinate element, replacing the subordinate geometry in-place.
 *
 * @param {THREE.Object3D} sceneRoot - root object whose children include the
 *   element meshes (each with mesh.userData.elementId set)
 * @param {Array<object>} junctions - array of parsed junction JSON objects
 */
export function applyCsgJunctions(sceneRoot, junctions) {
  const csgJunctions = junctions.filter(j => j.trim_method === 'csg');
  if (csgJunctions.length === 0) return;

  // Build elementId → THREE.Mesh map from the scene
  const meshMap = new Map();
  sceneRoot.traverse(obj => {
    if (obj instanceof THREE.Mesh && obj.userData.elementId) {
      meshMap.set(obj.userData.elementId, obj);
    }
  });

  const evaluator = new Evaluator();

  for (const junction of csgJunctions) {
    const t0 = performance.now();
    try {
      _applyOneCsgJunction(evaluator, junction, meshMap);
    } catch (err) {
      console.warn(`[OEBF] CSG failed for junction ${junction.id}: ${err.message}`);
    }
    const dt = performance.now() - t0;
    console.log(`[OEBF] CSG junction ${junction.id}: ${dt.toFixed(1)} ms`);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Apply CSG trim for a single junction.
 *
 * Subordinate elements (not in junction.priority) each have all dominant
 * elements subtracted from them in sequence.
 *
 * @param {Evaluator} evaluator - reused three-bvh-csg Evaluator instance
 * @param {object} junction - parsed junction JSON
 * @param {Map<string, THREE.Mesh>} meshMap - elementId → mesh
 */
function _applyOneCsgJunction(evaluator, junction, meshMap) {
  const prioritySet = new Set(junction.priority ?? []);
  const dominantIds = junction.elements.filter(id => prioritySet.has(id));
  const subordinateIds = junction.elements.filter(id => !prioritySet.has(id));

  if (subordinateIds.length === 0) {
    console.warn(
      `[OEBF] CSG junction ${junction.id}: no subordinate elements ` +
      `(all elements are in priority list). Skipping.`
    );
    return;
  }

  for (const subId of subordinateIds) {
    const subMesh = meshMap.get(subId);
    if (!subMesh) {
      console.warn(
        `[OEBF] CSG junction ${junction.id}: subordinate element "${subId}" ` +
        `not found in scene. Skipping.`
      );
      continue;
    }

    for (const domId of dominantIds) {
      const domMesh = meshMap.get(domId);
      if (!domMesh) {
        console.warn(
          `[OEBF] CSG junction ${junction.id}: dominant element "${domId}" ` +
          `not found in scene. Skipping.`
        );
        continue;
      }

      // Ensure world matrices are current before CSG (three-bvh-csg uses matrixWorld)
      subMesh.updateWorldMatrix(true, false);
      domMesh.updateWorldMatrix(true, false);

      // Perform SUBTRACTION: subMesh - domMesh → result
      const result = evaluator.evaluate(subMesh, domMesh, SUBTRACTION);

      // Replace subordinate geometry in-place; dispose old geometry
      subMesh.geometry.dispose();
      subMesh.geometry = result.geometry;
    }
  }
}
```

- [ ] **Step 2: Run tests**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npx vitest run src/junction-csg.test.js
```

Expected: all 6 tests PASS.

- [ ] **Step 3: Commit**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat
git add viewer/src/junction-csg.js viewer/src/junction-csg.test.js
git commit -m "feat: add CSG junction trim module (junction-csg.js) with tests"
```

---

## Chunk 2: Scene Integration

### Task 4: Integrate `applyCsgJunctions` into `viewer/src/main.js`

The scene builder (`_buildScene`) currently calls `applyJunctionClipping` (planar GPU clipping) on line 103. CSG trimming must run in the same function, immediately after planar clipping, so that the baked geometry is in place before the camera-fit step.

**Files:**
- Modify: `viewer/src/main.js:20` (import)
- Modify: `viewer/src/main.js:103` (call site in `_buildScene`)

- [ ] **Step 1: Add the import for `applyCsgJunctions`**

In `viewer/src/main.js`, the import block starts at line 15. Add the new import after the existing `junction-renderer.js` import (line 20):

Old line 20:
```javascript
import { applyJunctionClipping, buildCustomJunctionMesh } from './junction-renderer.js';
```

The import to add goes on a new line after line 20:
```javascript
import { applyCsgJunctions } from './junction-csg.js';
```

- [ ] **Step 2: Call `applyCsgJunctions` in `_buildScene`**

In `_buildScene`, after the existing call to `applyJunctionClipping` (line 103), add the CSG call:

Replace:
```javascript
  applyJunctionClipping(currentGroup, junctions);
```

With:
```javascript
  applyJunctionClipping(currentGroup, junctions);
  applyCsgJunctions(currentGroup, junctions);
```

- [ ] **Step 3: Run the full Vitest suite to check nothing is broken**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npm test
```

Expected: all tests PASS (or same count as before — no regressions).

- [ ] **Step 4: Commit**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat
git add viewer/src/main.js
git commit -m "feat: call applyCsgJunctions in _buildScene for trim_method:csg junctions"
```

---

## Chunk 3: Verification

### Task 5: Run full test suite and verify

- [ ] **Step 1: Run all Vitest unit tests**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npm test
```

Expected: all tests pass. Count should be ≥ 237 (existing) + 6 (new junction-csg tests).

- [ ] **Step 2: Check CI passes locally**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat && npm --prefix viewer test
```

- [ ] **Step 3: Final commit and push**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat
git push
```

---

## Notes

- The `junction-renderer.js` `buildClippingPlaneMap` already skips junctions with empty `trim_planes` (line 32), so CSG junctions with `trim_planes: []` receive no planar clipping — no change needed there.
- The `trim_method` field is already in `spec/schema/junction.schema.json` as an optional enum `["planar", "csg", "none"]`.
- Performance target (< 5 ms per junction on M2 MacBook Air) is logged via `console.log` on each CSG operation. It cannot be asserted in CI (hardware-dependent) but is observable at runtime.
- The `Evaluator` instance is created once and reused across all CSG junctions to avoid BVH rebuild overhead.
