# Viewer Performance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Establish the performance envelope of the Three.js web viewer and implement `THREE.InstancedMesh` array rendering and geometry caching to keep the viewer interactive at realistic model scales.

**Architecture:** Path sampling utilities compute arc-length-parameterised sample points from a polyline; the array renderer builds one `InstancedMesh` per source geometry layer; the geometry cache stores `BufferGeometry` objects keyed by `profileId:pathLength:sweepMode`; `docs/performance.md` documents the measured draw-call budget and per-scenario fps targets.

**Tech Stack:** Three.js 0.170+, Vite 6, Vitest (tests run with `npm test` in `viewer/`), JavaScript ESM.

---

## Task 1: Path sampling utilities

**Files:**
- Create: `viewer/src/path/pathSampler.js`
- Create: `viewer/src/path/pathSampler.test.js`

Path points are always a pre-tessellated 3D polyline `[{x,y,z}, ...]`. These utilities support the array renderer's need to place instances at arc-length intervals.

---

**Step 1: Write failing tests**

Create `viewer/src/path/pathSampler.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  computePathLength,
  samplePathAtDistance,
} from './pathSampler.js';

const LINE = [
  { x: 0, y: 0, z: 0 },
  { x: 3, y: 0, z: 0 },
  { x: 3, y: 4, z: 0 },
];
// segment 1: length 3, segment 2: length 4, total 7

describe('computePathLength', () => {
  it('returns 0 for a single point', () => {
    expect(computePathLength([{ x: 0, y: 0, z: 0 }])).toBe(0);
  });

  it('returns 7 for the L-shaped polyline', () => {
    expect(computePathLength(LINE)).toBeCloseTo(7, 5);
  });
});

describe('samplePathAtDistance', () => {
  it('returns start point at distance 0', () => {
    const { position } = samplePathAtDistance(LINE, 0);
    expect(position).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('returns midpoint of first segment at distance 1.5', () => {
    const { position } = samplePathAtDistance(LINE, 1.5);
    expect(position.x).toBeCloseTo(1.5);
    expect(position.y).toBeCloseTo(0);
    expect(position.z).toBeCloseTo(0);
  });

  it('returns start of second segment at distance 3', () => {
    const { position } = samplePathAtDistance(LINE, 3);
    expect(position.x).toBeCloseTo(3);
    expect(position.y).toBeCloseTo(0);
    expect(position.z).toBeCloseTo(0);
  });

  it('returns midpoint of second segment at distance 5', () => {
    const { position } = samplePathAtDistance(LINE, 5);
    expect(position.x).toBeCloseTo(3);
    expect(position.y).toBeCloseTo(2);
    expect(position.z).toBeCloseTo(0);
  });

  it('clamps to end point when distance exceeds path length', () => {
    const { position } = samplePathAtDistance(LINE, 100);
    expect(position).toEqual(LINE[LINE.length - 1]);
  });

  it('returns correct tangent for first segment', () => {
    const { tangent } = samplePathAtDistance(LINE, 1);
    expect(tangent.x).toBeCloseTo(1);
    expect(tangent.y).toBeCloseTo(0);
    expect(tangent.z).toBeCloseTo(0);
  });

  it('returns correct tangent for second segment', () => {
    const { tangent } = samplePathAtDistance(LINE, 4);
    expect(tangent.x).toBeCloseTo(0);
    expect(tangent.y).toBeCloseTo(1);
    expect(tangent.z).toBeCloseTo(0);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd viewer && npm test -- --reporter=verbose path/pathSampler
```

Expected: `Cannot find module './pathSampler.js'`

---

**Step 3: Write minimal implementation**

Create `viewer/src/path/pathSampler.js`:

```js
/**
 * pathSampler.js
 *
 * Arc-length parameterisation utilities for OEBF polyline paths.
 *
 * Path points are always a pre-tessellated 3D polyline [{x,y,z}, ...].
 * Arcs and beziers are tessellated by the path loader before reaching here.
 */

/**
 * Compute the total arc length of a polyline.
 *
 * @param {Array<{x:number,y:number,z:number}>} points
 * @returns {number} total length in metres
 */
export function computePathLength(points) {
  let length = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    length += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return length;
}

/**
 * Sample a polyline at a given arc-length distance from the start.
 *
 * Returns the interpolated 3D position and the unit tangent of the segment
 * that contains the sample point. If distance exceeds the path length the
 * result is clamped to the final point.
 *
 * @param {Array<{x:number,y:number,z:number}>} points
 * @param {number} distance - arc-length from start (metres)
 * @returns {{ position: {x,y,z}, tangent: {x,y,z} }}
 */
export function samplePathAtDistance(points, distance) {
  if (points.length === 1) {
    return { position: { ...points[0] }, tangent: { x: 1, y: 0, z: 0 } };
  }

  let accumulated = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const segLen = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (accumulated + segLen >= distance) {
      const t = segLen > 0 ? (distance - accumulated) / segLen : 0;
      return {
        position: {
          x: a.x + t * dx,
          y: a.y + t * dy,
          z: a.z + t * dz,
        },
        tangent: {
          x: dx / segLen,
          y: dy / segLen,
          z: dz / segLen,
        },
      };
    }

    accumulated += segLen;
  }

  // Clamp to end
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const dx = last.x - prev.x;
  const dy = last.y - prev.y;
  const dz = last.z - prev.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;

  return {
    position: { ...last },
    tangent: { x: dx / len, y: dy / len, z: dz / len },
  };
}
```

**Step 4: Run tests to verify they pass**

```bash
cd viewer && npm test -- --reporter=verbose path/pathSampler
```

Expected: all 8 tests pass.

**Step 5: Commit**

```bash
git add viewer/src/path/pathSampler.js viewer/src/path/pathSampler.test.js
git commit -m "feat: path arc-length sampling utilities"
```

---

## Task 2: Geometry cache

**Files:**
- Create: `viewer/src/geometry/geometryCache.js`
- Create: `viewer/src/geometry/geometryCache.test.js`

The cache prevents redundant sweep computation when multiple elements share an identical profile + path length + sweep mode. It also enables InstancedMesh source geometries to be retrieved cheaply.

---

**Step 1: Write failing tests**

Create `viewer/src/geometry/geometryCache.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  makeGeometryKey,
  getCachedGeometry,
  setCachedGeometry,
  clearGeometryCache,
  getCacheStats,
} from './geometryCache.js';

beforeEach(() => {
  clearGeometryCache();
});

describe('makeGeometryKey', () => {
  it('produces a stable string key', () => {
    const key = makeGeometryKey('profile-cavity-250', 5.4, 'perpendicular');
    expect(key).toBe('profile-cavity-250:5.4000:perpendicular');
  });

  it('rounds path length to 4 decimal places', () => {
    const key = makeGeometryKey('p', 1.23456789, 'fixed');
    expect(key).toBe('p:1.2346:fixed');
  });
});

describe('getCachedGeometry / setCachedGeometry', () => {
  it('returns null for a cache miss', () => {
    expect(getCachedGeometry('missing:0.0000:perpendicular')).toBeNull();
  });

  it('returns the stored geometry on cache hit', () => {
    const geom = new THREE.BufferGeometry();
    const key = makeGeometryKey('p', 1, 'perpendicular');
    setCachedGeometry(key, geom);
    expect(getCachedGeometry(key)).toBe(geom);
  });

  it('stores independent entries for different keys', () => {
    const g1 = new THREE.BufferGeometry();
    const g2 = new THREE.BufferGeometry();
    const k1 = makeGeometryKey('p', 1, 'perpendicular');
    const k2 = makeGeometryKey('p', 2, 'perpendicular');
    setCachedGeometry(k1, g1);
    setCachedGeometry(k2, g2);
    expect(getCachedGeometry(k1)).toBe(g1);
    expect(getCachedGeometry(k2)).toBe(g2);
  });
});

describe('clearGeometryCache', () => {
  it('removes all entries', () => {
    const key = makeGeometryKey('p', 1, 'perpendicular');
    setCachedGeometry(key, new THREE.BufferGeometry());
    clearGeometryCache();
    expect(getCachedGeometry(key)).toBeNull();
  });
});

describe('getCacheStats', () => {
  it('reports size 0 when empty', () => {
    expect(getCacheStats().size).toBe(0);
  });

  it('reports correct size after insertions', () => {
    setCachedGeometry(makeGeometryKey('p', 1, 'perpendicular'), new THREE.BufferGeometry());
    setCachedGeometry(makeGeometryKey('p', 2, 'perpendicular'), new THREE.BufferGeometry());
    expect(getCacheStats().size).toBe(2);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd viewer && npm test -- --reporter=verbose geometry/geometryCache
```

Expected: `Cannot find module './geometryCache.js'`

---

**Step 3: Write minimal implementation**

Create `viewer/src/geometry/geometryCache.js`:

```js
/**
 * geometryCache.js
 *
 * In-memory cache for swept BufferGeometry objects.
 *
 * Cache key: `${profileId}:${pathLength.toFixed(4)}:${sweepMode}`
 *
 * Two elements with the same profile, path length, and sweep mode produce
 * geometrically identical meshes and can share a single BufferGeometry
 * instance (read-only). InstancedMesh relies on this shared geometry.
 *
 * Call clearGeometryCache() when loading a new project to release GPU memory.
 */

/** @type {Map<string, import('three').BufferGeometry>} */
const _cache = new Map();

/**
 * Build a cache key from the three parameters that uniquely determine a
 * swept geometry's shape.
 *
 * @param {string} profileId
 * @param {number} pathLength - in metres
 * @param {string} sweepMode - 'perpendicular' | 'fixed' | 'twisted'
 * @returns {string}
 */
export function makeGeometryKey(profileId, pathLength, sweepMode) {
  return `${profileId}:${pathLength.toFixed(4)}:${sweepMode}`;
}

/**
 * Retrieve a cached geometry, or null on miss.
 *
 * @param {string} key
 * @returns {import('three').BufferGeometry | null}
 */
export function getCachedGeometry(key) {
  return _cache.get(key) ?? null;
}

/**
 * Store a geometry in the cache.
 *
 * @param {string} key
 * @param {import('three').BufferGeometry} geometry
 */
export function setCachedGeometry(key, geometry) {
  _cache.set(key, geometry);
}

/**
 * Dispose all cached geometries and clear the map.
 * Call this when unloading a project to release GPU-side buffer memory.
 */
export function clearGeometryCache() {
  for (const geom of _cache.values()) {
    geom.dispose();
  }
  _cache.clear();
}

/**
 * Return diagnostic statistics for the current cache state.
 *
 * @returns {{ size: number }}
 */
export function getCacheStats() {
  return { size: _cache.size };
}
```

**Step 4: Run tests to verify they pass**

```bash
cd viewer && npm test -- --reporter=verbose geometry/geometryCache
```

Expected: all 8 tests pass.

**Step 5: Commit**

```bash
git add viewer/src/geometry/geometryCache.js viewer/src/geometry/geometryCache.test.js
git commit -m "feat: geometry cache keyed by profile, path length, and sweep mode"
```

---

## Task 3: Array instance distribution

**Files:**
- Create: `viewer/src/array/arrayDistributor.js`
- Create: `viewer/src/array/arrayDistributor.test.js`

Pure functions that compute how many instances to place and at which arc-length distances, given an array definition and total path length. These are separated from the Three.js renderer so they can be unit-tested without a DOM.

---

**Step 1: Write failing tests**

Create `viewer/src/array/arrayDistributor.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  computeInstanceCount,
  computeInstanceDistances,
} from './arrayDistributor.js';

// Helper: array definition factory
const def = (mode, opts = {}) => ({
  mode,
  spacing: opts.spacing ?? 1.0,
  count: opts.count ?? null,
  start_offset: opts.start_offset ?? 0,
  end_offset: opts.end_offset ?? 0,
});

describe('computeInstanceCount', () => {
  describe('spacing mode', () => {
    it('places 6 posts on a 5 m path at 1 m spacing', () => {
      expect(computeInstanceCount(def('spacing', { spacing: 1 }), 5)).toBe(6);
    });

    it('places 4 posts on a 5.4 m path at 1.8 m spacing', () => {
      // 5.4 / 1.8 = 3, floor(3) + 1 = 4
      expect(computeInstanceCount(def('spacing', { spacing: 1.8 }), 5.4)).toBe(4);
    });

    it('respects start_offset', () => {
      // usable = 5 - 1 = 4, 4 / 1 = 4, +1 = 5
      expect(computeInstanceCount(def('spacing', { spacing: 1, start_offset: 1 }), 5)).toBe(5);
    });

    it('respects end_offset', () => {
      // usable = 5 - 0.5 = 4.5, floor(4.5) + 1 = 5
      expect(computeInstanceCount(def('spacing', { spacing: 1, end_offset: 0.5 }), 5)).toBe(5);
    });

    it('returns 0 when usable length is 0', () => {
      expect(computeInstanceCount(def('spacing', { spacing: 1, start_offset: 3, end_offset: 3 }), 5)).toBe(0);
    });
  });

  describe('count mode', () => {
    it('returns the exact count from the definition', () => {
      expect(computeInstanceCount(def('count', { count: 7 }), 10)).toBe(7);
    });
  });

  describe('fill mode', () => {
    it('fills 5 m with 1 m spacing → 5 instances (no +1)', () => {
      expect(computeInstanceCount(def('fill', { spacing: 1 }), 5)).toBe(5);
    });
  });
});

describe('computeInstanceDistances', () => {
  it('spacing mode: first instance at start_offset', () => {
    const distances = computeInstanceDistances(def('spacing', { spacing: 2, start_offset: 0.5 }), 10);
    expect(distances[0]).toBeCloseTo(0.5);
    expect(distances[1]).toBeCloseTo(2.5);
  });

  it('count mode: evenly spaced including both endpoints', () => {
    const distances = computeInstanceDistances(def('count', { count: 3 }), 6);
    expect(distances).toHaveLength(3);
    expect(distances[0]).toBeCloseTo(0);
    expect(distances[1]).toBeCloseTo(3);
    expect(distances[2]).toBeCloseTo(6);
  });

  it('count mode with single instance: placed at start_offset', () => {
    const distances = computeInstanceDistances(def('count', { count: 1, start_offset: 1 }), 10);
    expect(distances).toHaveLength(1);
    expect(distances[0]).toBeCloseTo(1);
  });

  it('returns empty array when count is 0', () => {
    const distances = computeInstanceDistances(
      def('spacing', { spacing: 1, start_offset: 5, end_offset: 5 }),
      5,
    );
    expect(distances).toHaveLength(0);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd viewer && npm test -- --reporter=verbose array/arrayDistributor
```

Expected: `Cannot find module './arrayDistributor.js'`

---

**Step 3: Write minimal implementation**

Create `viewer/src/array/arrayDistributor.js`:

```js
/**
 * arrayDistributor.js
 *
 * Pure functions for computing array instance positions along a path.
 *
 * These functions are independent of Three.js and can be unit-tested without
 * a DOM or WebGL context.
 */

/**
 * Compute the number of instances to place for a given array definition and
 * total path length.
 *
 * @param {object} arrayDef - parsed OEBF array JSON
 * @param {number} pathLength - total arc length of the path (metres)
 * @returns {number}
 */
export function computeInstanceCount(arrayDef, pathLength) {
  const start = arrayDef.start_offset ?? 0;
  const end = arrayDef.end_offset ?? 0;
  const usable = pathLength - start - end;

  if (usable <= 0) return 0;

  switch (arrayDef.mode) {
    case 'count':
      return arrayDef.count ?? 0;

    case 'spacing':
      return Math.floor(usable / arrayDef.spacing) + 1;

    case 'fill':
      return Math.floor(usable / arrayDef.spacing);

    default:
      return 0;
  }
}

/**
 * Compute the arc-length distance from the path start for each instance.
 *
 * @param {object} arrayDef - parsed OEBF array JSON
 * @param {number} pathLength - total arc length of the path (metres)
 * @returns {number[]} distances in metres from path start
 */
export function computeInstanceDistances(arrayDef, pathLength) {
  const count = computeInstanceCount(arrayDef, pathLength);
  if (count === 0) return [];

  const start = arrayDef.start_offset ?? 0;
  const end = arrayDef.end_offset ?? 0;
  const usable = pathLength - start - end;
  const distances = [];

  switch (arrayDef.mode) {
    case 'spacing':
    case 'fill': {
      for (let i = 0; i < count; i++) {
        distances.push(start + i * arrayDef.spacing);
      }
      break;
    }

    case 'count': {
      const step = count > 1 ? usable / (count - 1) : 0;
      for (let i = 0; i < count; i++) {
        distances.push(start + i * step);
      }
      break;
    }

    default:
      break;
  }

  return distances;
}
```

**Step 4: Run tests to verify they pass**

```bash
cd viewer && npm test -- --reporter=verbose array/arrayDistributor
```

Expected: all 10 tests pass.

**Step 5: Commit**

```bash
git add viewer/src/array/arrayDistributor.js viewer/src/array/arrayDistributor.test.js
git commit -m "feat: array instance count and distance distribution"
```

---

## Task 4: Array renderer (InstancedMesh)

**Files:**
- Create: `viewer/src/array/arrayRenderer.js`
- Create: `viewer/src/array/arrayRenderer.test.js`

Builds one `THREE.InstancedMesh` per source geometry layer for a given array definition. The caller pre-computes path points and provides source geometries; this module handles only the Three.js instantiation.

---

**Step 1: Write failing tests**

Create `viewer/src/array/arrayRenderer.test.js`:

```js
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildArrayGroup } from './arrayRenderer.js';

// Minimal array definition: 5 posts at 1 m spacing along a 4 m straight path
const ARRAY_DEF = {
  id: 'array-test-posts',
  mode: 'spacing',
  spacing: 1,
  start_offset: 0,
  end_offset: 0,
  alignment: 'fixed',
  offset_local: { x: 0, y: 0, z: 0 },
  rotation_local_deg: 0,
};

// Straight path along X axis, 4 m long
const PATH_POINTS = [
  { x: 0, y: 0, z: 0 },
  { x: 4, y: 0, z: 0 },
];

// Two-layer source (e.g., a timber post with facing layer)
const SOURCE_GEOMETRIES = [
  { geometry: new THREE.BufferGeometry(), material: new THREE.MeshStandardMaterial() },
  { geometry: new THREE.BufferGeometry(), material: new THREE.MeshStandardMaterial() },
];

describe('buildArrayGroup', () => {
  it('returns a THREE.Group', () => {
    const group = buildArrayGroup(ARRAY_DEF, PATH_POINTS, SOURCE_GEOMETRIES);
    expect(group).toBeInstanceOf(THREE.Group);
  });

  it('creates one InstancedMesh per source geometry layer', () => {
    const group = buildArrayGroup(ARRAY_DEF, PATH_POINTS, SOURCE_GEOMETRIES);
    const meshes = group.children.filter(c => c instanceof THREE.InstancedMesh);
    expect(meshes).toHaveLength(2);
  });

  it('each InstancedMesh has the correct instance count', () => {
    // path length = 4, spacing = 1, count = floor(4/1)+1 = 5
    const group = buildArrayGroup(ARRAY_DEF, PATH_POINTS, SOURCE_GEOMETRIES);
    for (const child of group.children) {
      expect(child.count).toBe(5);
    }
  });

  it('stores arrayId in userData', () => {
    const group = buildArrayGroup(ARRAY_DEF, PATH_POINTS, SOURCE_GEOMETRIES);
    expect(group.userData.arrayId).toBe('array-test-posts');
  });

  it('returns an empty group when path is too short for any instance', () => {
    const shortDef = { ...ARRAY_DEF, start_offset: 3, end_offset: 3 };
    const group = buildArrayGroup(shortDef, PATH_POINTS, SOURCE_GEOMETRIES);
    expect(group.children).toHaveLength(0);
  });

  it('sets instance matrices (instanceMatrix.needsUpdate true)', () => {
    const group = buildArrayGroup(ARRAY_DEF, PATH_POINTS, SOURCE_GEOMETRIES);
    for (const child of group.children) {
      expect(child.instanceMatrix.needsUpdate).toBe(true);
    }
  });

  it('places instances at correct world positions for fixed alignment', () => {
    const group = buildArrayGroup(ARRAY_DEF, PATH_POINTS, SOURCE_GEOMETRIES);
    const im = group.children[0];

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();

    // Instance 0 should be at (0,0,0)
    im.getMatrixAt(0, matrix);
    position.setFromMatrixPosition(matrix);
    expect(position.x).toBeCloseTo(0);
    expect(position.y).toBeCloseTo(0);

    // Instance 1 should be at (1,0,0)
    im.getMatrixAt(1, matrix);
    position.setFromMatrixPosition(matrix);
    expect(position.x).toBeCloseTo(1);
    expect(position.y).toBeCloseTo(0);
  });

  it('handles tangent alignment: instance X-axis follows path tangent', () => {
    const tangentDef = { ...ARRAY_DEF, alignment: 'tangent', mode: 'count', count: 2 };
    const group = buildArrayGroup(tangentDef, PATH_POINTS, SOURCE_GEOMETRIES);
    const im = group.children[0];

    const matrix = new THREE.Matrix4();
    im.getMatrixAt(0, matrix);

    // Extract rotation: X column of matrix should point along path tangent (+X)
    const xAxis = new THREE.Vector3();
    xAxis.setFromMatrixColumn(matrix, 0);
    expect(xAxis.x).toBeCloseTo(1);
    expect(xAxis.y).toBeCloseTo(0);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd viewer && npm test -- --reporter=verbose array/arrayRenderer
```

Expected: `Cannot find module './arrayRenderer.js'`

---

**Step 3: Write minimal implementation**

Create `viewer/src/array/arrayRenderer.js`:

```js
/**
 * arrayRenderer.js
 *
 * Builds THREE.InstancedMesh groups from OEBF array definitions.
 *
 * Performance rationale:
 *   A naive approach creates one THREE.Mesh per instance, costing N draw calls
 *   for N instances. InstancedMesh collapses all instances to a single draw
 *   call (plus one uniform upload per instance matrix). For an array of 200
 *   fence posts this reduces draw calls from 200 → 1.
 *
 *   Multi-layer sources (e.g., a 4-layer cavity wall) produce 4 InstancedMesh
 *   objects — one per layer — still a dramatic saving over 200×4 = 800 calls.
 *
 * @module arrayRenderer
 */

import * as THREE from 'three';
import { computePathLength, samplePathAtDistance } from '../path/pathSampler.js';
import { computeInstanceDistances } from './arrayDistributor.js';

/**
 * Build a quaternion that orients an instance relative to the path at a
 * given sample point.
 *
 * Source geometry convention: the source element's forward axis is +X.
 *
 * @param {{ x:number, y:number, z:number }} tangent - unit tangent of path at sample
 * @param {string} alignment - 'fixed' | 'tangent' | 'perpendicular'
 * @param {number} rotationLocalDeg - additional rotation around world Z (degrees)
 * @returns {THREE.Quaternion}
 */
function buildOrientation(tangent, alignment, rotationLocalDeg) {
  const q = new THREE.Quaternion();

  if (alignment === 'tangent') {
    const forward = new THREE.Vector3(1, 0, 0);
    const t = new THREE.Vector3(tangent.x, tangent.y, tangent.z).normalize();
    q.setFromUnitVectors(forward, t);
  } else if (alignment === 'perpendicular') {
    // Perpendicular to path in XY plane; instance Z stays vertical
    const tx = tangent.x;
    const ty = tangent.y;
    const tLen = Math.sqrt(tx * tx + ty * ty) || 1;
    const perpX = -ty / tLen;
    const perpY = tx / tLen;
    const forward = new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3(perpX, perpY, 0);
    q.setFromUnitVectors(forward, perp);
  }
  // 'fixed': identity quaternion — no rotation applied

  if (rotationLocalDeg) {
    const localRot = new THREE.Quaternion();
    localRot.setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      rotationLocalDeg * (Math.PI / 180),
    );
    q.multiply(localRot);
  }

  return q;
}

/**
 * Build a 4×4 instance matrix from sample position, orientation parameters,
 * and a local translation offset.
 *
 * @param {{ x:number, y:number, z:number }} position
 * @param {{ x:number, y:number, z:number }} tangent
 * @param {string} alignment
 * @param {{ x:number, y:number, z:number }} offsetLocal
 * @param {number} rotationLocalDeg
 * @returns {THREE.Matrix4}
 */
function buildInstanceMatrix(position, tangent, alignment, offsetLocal, rotationLocalDeg) {
  const q = buildOrientation(tangent, alignment, rotationLocalDeg);

  // Apply local offset in instance space
  const localOffset = new THREE.Vector3(offsetLocal.x, offsetLocal.y, offsetLocal.z)
    .applyQuaternion(q);

  const pos = new THREE.Vector3(
    position.x + localOffset.x,
    position.y + localOffset.y,
    position.z + localOffset.z,
  );

  const matrix = new THREE.Matrix4();
  matrix.compose(pos, q, new THREE.Vector3(1, 1, 1));
  return matrix;
}

/**
 * Build a THREE.Group containing one InstancedMesh per source geometry layer.
 *
 * @param {object} arrayDef - parsed OEBF array JSON
 * @param {Array<{x:number,y:number,z:number}>} pathPoints - pre-tessellated polyline
 * @param {Array<{geometry: THREE.BufferGeometry, material: THREE.Material}>} sourceGeometries
 * @returns {THREE.Group}
 */
export function buildArrayGroup(arrayDef, pathPoints, sourceGeometries) {
  const group = new THREE.Group();
  group.userData.arrayId = arrayDef.id;

  const pathLength = computePathLength(pathPoints);
  const distances = computeInstanceDistances(arrayDef, pathLength);
  const count = distances.length;

  if (count === 0) return group;

  const alignment = arrayDef.alignment ?? 'fixed';
  const offsetLocal = arrayDef.offset_local ?? { x: 0, y: 0, z: 0 };
  const rotationLocalDeg = arrayDef.rotation_local_deg ?? 0;

  // Pre-compute all instance matrices
  const matrices = distances.map(d => {
    const { position, tangent } = samplePathAtDistance(pathPoints, d);
    return buildInstanceMatrix(position, tangent, alignment, offsetLocal, rotationLocalDeg);
  });

  // Create one InstancedMesh per source geometry layer
  for (const { geometry, material } of sourceGeometries) {
    const im = new THREE.InstancedMesh(geometry, material, count);
    im.userData.arrayId = arrayDef.id;

    matrices.forEach((matrix, i) => {
      im.setMatrixAt(i, matrix);
    });

    im.instanceMatrix.needsUpdate = true;
    group.add(im);
  }

  return group;
}
```

**Step 4: Run tests to verify they pass**

```bash
cd viewer && npm test -- --reporter=verbose array/arrayRenderer
```

Expected: all 8 tests pass.

**Step 5: Run the full test suite**

```bash
cd viewer && npm test
```

Expected: all tests pass (pathSampler, geometryCache, arrayDistributor, arrayRenderer, junction-trimmer).

**Step 6: Commit**

```bash
git add viewer/src/array/arrayRenderer.js viewer/src/array/arrayRenderer.test.js
git commit -m "feat: InstancedMesh array renderer — one draw call per geometry layer"
```

---

## Task 5: Performance documentation

**Files:**
- Create: `docs/performance.md`

Document the draw-call budget, per-scenario fps projections, and the rationale for each optimisation. This is the reference for any future LOD or batching decisions.

---

**Step 1: Write `docs/performance.md`**

See Task 5 content in the implementation notes below.

**Step 2: Commit**

```bash
git add docs/performance.md
git commit -m "docs: viewer performance limits and draw-call analysis"
```

---

## Execution Handoff

Plan saved. This session will use **subagent-driven development** to implement task-by-task with review between steps.
