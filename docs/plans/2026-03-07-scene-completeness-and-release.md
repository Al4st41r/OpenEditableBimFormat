# Scene Completeness and v0.1 Release — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the viewer scene (arrays, custom junctions, grids), add .oebfz loading, CI, README, close test coverage gaps, and ship v0.1.0.

**Architecture:** All tasks follow the existing pattern: `loadBundle.js` handles data loading and returns plain data objects; Three.js construction happens in `main.js` or dedicated scene builders. Tests go in `.test.js` files co-located with source. Python tests go in `ifc-tools/tests/`.

**Tech Stack:** Vite 6, Three.js 0.170+, Vitest, Playwright, fzstd (Zstd WASM), Python 3.12 + uv + IfcOpenShell, GitHub Actions.

**Issues:** #23 (array wiring), #24 (custom junction), #25 (grid), #26 (.oebfz), #27 (visual regression), #28 (CI), #19 (README), #20 (test coverage), #30 (release).

---

## Task 21: Wire custom junction mesh rendering (Issue #24)

**Files:**
- Modify: `viewer/src/loader/loadBundle.js`
- Modify: `viewer/src/main.js`
- Modify: `viewer/src/loader/loadBundle.test.js`

**Context:** `buildCustomJunctionMesh(geomJson, materialMap)` exists in `junction-renderer.js` but is never called. Junctions with `rule: "custom"` reference a `custom_geometry` filename (e.g. `"junction-ne-padstone-geometry.json"`). `loadBundle` must load the geometry JSON and attach it to the junction object. `main.js` then calls `buildCustomJunctionMesh`.

**Step 1: Write the failing tests**

Add to `viewer/src/loader/loadBundle.test.js`, inside the `'loadBundle — junctions'` describe block:

```javascript
const CUSTOM_GEOM = {
  junction_id: 'junction-custom',
  vertices: [
    { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 },
    { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 },
  ],
  faces: [{ indices: [0, 1, 2, 3], material_id: 'mat-brick' }],
};

const CUSTOM_JUNCTION = {
  id: 'junction-custom',
  type: 'Junction',
  rule: 'custom',
  elements: ['element-wall-a'],
  trim_planes: [],
  custom_geometry: 'junction-custom-geometry.json',
};

test('custom junction has geomData attached from custom_geometry file', async () => {
  const model = { elements: ['element-wall-a'], junctions: ['junction-custom'], arrays: [] };
  const files = bundleFiles({
    'model.json': model,
    'junctions/junction-custom.json': CUSTOM_JUNCTION,
    'junctions/junction-custom-geometry.json': CUSTOM_GEOM,
  });
  const { junctions } = await loadBundle(mockDirHandle(files));
  expect(junctions[0].geomData).toBeDefined();
  expect(junctions[0].geomData.vertices).toHaveLength(4);
});

test('custom junction with missing geometry file is skipped with warning', async () => {
  const model = { elements: ['element-wall-a'], junctions: ['junction-custom'], arrays: [] };
  const files = bundleFiles({
    'model.json': model,
    'junctions/junction-custom.json': CUSTOM_JUNCTION,
    // geometry file intentionally absent
  });
  const { junctions } = await loadBundle(mockDirHandle(files));
  expect(junctions).toHaveLength(0); // skipped on error
});
```

**Step 2: Run tests to verify they fail**

```bash
cd viewer && npm test -- --reporter=verbose 2>&1 | grep -A2 "custom junction"
```
Expected: both tests FAIL — `geomData` is undefined.

**Step 3: Update `loadBundle.js` to load custom geometry**

In the junctions loop (around line 80), replace the simple push with:

```javascript
for (const junctionId of (model.junctions ?? [])) {
  try {
    const junction = await _readJson(dirHandle, `junctions/${junctionId}.json`);
    if (junction.rule === 'custom' && junction.custom_geometry) {
      junction.geomData = await _readJson(
        dirHandle,
        `junctions/${junction.custom_geometry}`,
      );
    }
    junctions.push(junction);
  } catch (err) {
    console.warn(`[OEBF] Skipping junction ${junctionId}: ${err.message}`);
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
cd viewer && npm test
```
Expected: all tests pass (count increases by 2).

**Step 5: Update `main.js` to render custom junction meshes**

Add import at top:

```javascript
import { applyJunctionClipping, buildCustomJunctionMesh } from './junction-renderer.js';
```

In the open-dir-btn handler, after `applyJunctionClipping(currentGroup, junctions)`, add:

```javascript
// Build materialMap for custom junction rendering
const matMap = new Map();
for (const meshData of meshes) {
  if (!matMap.has(meshData.materialId)) {
    const mat = new THREE.MeshLambertMaterial({
      color: new THREE.Color(meshData.colour),
      side: THREE.DoubleSide,
    });
    matMap.set(meshData.materialId, mat);
  }
}
for (const junction of junctions) {
  if (junction.rule === 'custom' && junction.geomData) {
    const customMesh = buildCustomJunctionMesh(junction.geomData, matMap);
    currentGroup.add(customMesh);
  }
}
```

**Step 6: Verify full test suite still passes**

```bash
cd viewer && npm test
```
Expected: all tests pass.

**Step 7: Commit**

```bash
git add viewer/src/loader/loadBundle.js viewer/src/loader/loadBundle.test.js viewer/src/main.js
git commit -m "feat: wire custom junction mesh rendering into scene loader (closes #24)"
```

---

## Task 22: Symbol geometry builder and array scene wiring (Issue #23)

**Files:**
- Create: `viewer/src/loader/loadSymbol.js`
- Create: `viewer/src/loader/loadSymbol.test.js`
- Modify: `viewer/src/loader/loadBundle.js`
- Modify: `viewer/src/loader/loadBundle.test.js`
- Modify: `viewer/src/main.js`

**Context:** `buildArrayGroup(arrayDef, pathPoints, sourceGeometries)` in `arrayRenderer.js` takes `sourceGeometries: Array<{geometry: THREE.BufferGeometry, material: THREE.Material}>`. Each array entity has a `source_id` referencing a Symbol. For v0.1 all symbols use `geometry_definition: "box"`. `loadBundle` must return raw array+symbol data; `main.js` converts it to Three.js objects and calls `buildArrayGroup`.

### Part A — Symbol geometry builder

**Step 1: Write failing tests for `loadSymbol.js`**

Create `viewer/src/loader/loadSymbol.test.js`:

```javascript
import { describe, test, expect } from 'vitest';
import * as THREE from 'three';
import { buildSymbolGeometries } from './loadSymbol.js';

const BOX_SYMBOL = {
  id: 'symbol-fence-post',
  type: 'Symbol',
  geometry_definition: 'box',
  parameters: { width_m: 0.075, depth_m: 0.075, height_m: 1.2, material: 'mat-timber' },
};

const MAT_MAP = new Map([
  ['mat-timber', new THREE.MeshLambertMaterial({ color: 0x8B5E3C })],
]);

describe('buildSymbolGeometries — box', () => {
  test('returns one entry for a box symbol', () => {
    const geoms = buildSymbolGeometries(BOX_SYMBOL, MAT_MAP);
    expect(geoms).toHaveLength(1);
  });

  test('geometry is a BoxGeometry (has position attribute)', () => {
    const [{ geometry }] = buildSymbolGeometries(BOX_SYMBOL, MAT_MAP);
    expect(geometry.attributes.position).toBeDefined();
  });

  test('material falls back to grey when material_id not in map', () => {
    const [{ material }] = buildSymbolGeometries(BOX_SYMBOL, new Map());
    expect(material.color.getHexString()).toBe('888888');
  });

  test('throws for unknown geometry_definition', () => {
    const bad = { ...BOX_SYMBOL, geometry_definition: 'cylinder' };
    expect(() => buildSymbolGeometries(bad, MAT_MAP)).toThrow(/unsupported/i);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd viewer && npm test -- loadSymbol
```
Expected: FAIL — module not found.

**Step 3: Create `viewer/src/loader/loadSymbol.js`**

```javascript
import * as THREE from 'three';

/**
 * Build an array of {geometry, material} objects from a Symbol entity.
 * Used as source geometries for buildArrayGroup().
 *
 * @param {object} symbolDef - parsed OEBF symbol JSON
 * @param {Map<string, THREE.Material>} matMap - material ID → THREE.Material
 * @returns {Array<{geometry: THREE.BufferGeometry, material: THREE.Material}>}
 */
export function buildSymbolGeometries(symbolDef, matMap) {
  const { geometry_definition, parameters } = symbolDef;

  if (geometry_definition === 'box') {
    const { width_m = 0.1, depth_m = 0.1, height_m = 1.0, material } = parameters;
    const geometry = new THREE.BoxGeometry(width_m, depth_m, height_m);
    // Translate so the base of the box sits at Z=0 (origin at bottom centre)
    geometry.translate(0, 0, height_m / 2);
    const mat = matMap.get(material)
      ?? new THREE.MeshLambertMaterial({ color: 0x888888, side: THREE.DoubleSide });
    return [{ geometry, material: mat }];
  }

  throw new Error(`buildSymbolGeometries: unsupported geometry_definition "${geometry_definition}"`);
}
```

**Step 4: Run tests to verify they pass**

```bash
cd viewer && npm test -- loadSymbol
```
Expected: 4 tests pass.

### Part B — Wire arrays into loadBundle

**Step 5: Write failing tests for array loading in `loadBundle.test.js`**

Add to `loadBundle.test.js`:

```javascript
const ARRAY_PATH = {
  id: 'path-boundary',
  type: 'Path',
  closed: false,
  segments: [{ type: 'line', start: { x: 0, y: 0, z: 0 }, end: { x: 9, y: 0, z: 0 } }],
};

const SYMBOL_DEF = {
  id: 'symbol-post',
  type: 'Symbol',
  geometry_definition: 'box',
  parameters: { width_m: 0.075, depth_m: 0.075, height_m: 1.2, material: 'mat-brick' },
};

const ARRAY_DEF = {
  id: 'array-posts',
  type: 'Array',
  source_id: 'symbol-post',
  path_id: 'path-boundary',
  mode: 'spacing',
  spacing: 1.8,
  start_offset: 0,
  end_offset: 0,
  alignment: 'fixed',
  offset_local: { x: 0, y: 0, z: 0 },
  rotation_local_deg: 0,
};

describe('loadBundle — arrays', () => {
  function arrayBundleFiles() {
    const model = { elements: [], junctions: [], arrays: ['array-posts'] };
    return bundleFiles({
      'model.json': model,
      'arrays/array-posts.json': ARRAY_DEF,
      'paths/path-boundary.json': ARRAY_PATH,
      'symbols/symbol-post.json': SYMBOL_DEF,
    });
  }

  test('returns arrays with arrayDef, pathPoints, and symbolDef', async () => {
    const { arrays } = await loadBundle(mockDirHandle(arrayBundleFiles()));
    expect(arrays).toHaveLength(1);
    expect(arrays[0].arrayDef.id).toBe('array-posts');
    expect(arrays[0].pathPoints).toBeInstanceOf(Array);
    expect(arrays[0].symbolDef.id).toBe('symbol-post');
  });

  test('array pathPoints has at least 2 points', async () => {
    const { arrays } = await loadBundle(mockDirHandle(arrayBundleFiles()));
    expect(arrays[0].pathPoints.length).toBeGreaterThanOrEqual(2);
  });

  test('missing array file is skipped with warning', async () => {
    const model = { elements: [], junctions: [], arrays: ['array-missing'] };
    const files = bundleFiles({ 'model.json': model });
    const { arrays } = await loadBundle(mockDirHandle(files));
    expect(arrays).toHaveLength(0);
  });

  test('returns empty arrays when model.arrays is absent', async () => {
    const { arrays } = await loadBundle(mockDirHandle(bundleFiles()));
    expect(arrays).toEqual([]);
  });
});
```

**Step 6: Run tests to verify they fail**

```bash
cd viewer && npm test -- loadBundle
```
Expected: 4 new tests FAIL — `arrays` is undefined.

**Step 7: Update `loadBundle.js` to process arrays**

Add import at top:
```javascript
import { parsePath } from './loadPath.js';
```
(Already imported — no change needed.)

After the junctions loop in `loadBundle()`, add:

```javascript
const arrays = [];
for (const arrayId of (model.arrays ?? [])) {
  try {
    const arrayDef  = await _readJson(dirHandle, `arrays/${arrayId}.json`);
    const pathData  = await _readJson(dirHandle, `paths/${arrayDef.path_id}.json`);
    const symbolDef = await _readJson(dirHandle, `symbols/${arrayDef.source_id}.json`);
    const parsedPath = parsePath(pathData);
    arrays.push({ arrayDef, pathPoints: parsedPath.points, symbolDef });
  } catch (err) {
    console.warn(`[OEBF] Skipping array ${arrayId}: ${err.message}`);
  }
}

return { meshes, manifest, junctions, arrays };
```

**Step 8: Run tests to verify they pass**

```bash
cd viewer && npm test
```
Expected: all tests pass (count increases by 4).

**Step 9: Wire array rendering into `main.js`**

Add imports:

```javascript
import { buildArrayGroup }      from './array/arrayRenderer.js';
import { buildSymbolGeometries } from './loader/loadSymbol.js';
```

In the open-dir-btn handler, after the custom junction loop, add:

```javascript
// Build a shared material map from all loaded meshes
const allMatColours = {};
for (const meshData of meshes) {
  if (meshData.colour) allMatColours[meshData.materialId] = meshData.colour;
}

for (const { arrayDef, pathPoints, symbolDef } of arrays) {
  try {
    const matMap = new Map();
    const matId = symbolDef.parameters?.material;
    if (matId && allMatColours[matId]) {
      matMap.set(matId, new THREE.MeshLambertMaterial({
        color: new THREE.Color(allMatColours[matId]),
        side: THREE.DoubleSide,
      }));
    }
    const sourceGeometries = buildSymbolGeometries(symbolDef, matMap);
    const arrayGroup = buildArrayGroup(arrayDef, pathPoints, sourceGeometries);
    currentGroup.add(arrayGroup);
  } catch (err) {
    console.warn(`[OEBF] Skipping array render ${arrayDef.id}: ${err.message}`);
  }
}
```

**Step 10: Run full test suite**

```bash
cd viewer && npm test
```
Expected: all tests pass.

**Step 11: Commit**

```bash
git add viewer/src/loader/loadSymbol.js viewer/src/loader/loadSymbol.test.js \
        viewer/src/loader/loadBundle.js viewer/src/loader/loadBundle.test.js \
        viewer/src/main.js
git commit -m "feat: symbol geometry builder and array scene wiring (closes #23)"
```

---

## Task 23: Grid entity rendering (Issue #25)

**Files:**
- Create: `viewer/src/loader/loadGrid.js`
- Create: `viewer/src/loader/loadGrid.test.js`
- Modify: `viewer/src/loader/loadBundle.js`
- Modify: `viewer/src/loader/loadBundle.test.js`
- Modify: `viewer/src/main.js`

**Context:** Grid entities have orthogonal `axes` (direction `x` or `y`, offset in metres) and `elevations` (Z values). Render as `THREE.LineSegments` — subtle grey lines in the scene. The grid from the example spans from axis `1` (y=0) to `2` (y=5.4) and `A` (x=0) to `B` (x=8.5).

**Step 1: Write failing tests for `loadGrid.js`**

Create `viewer/src/loader/loadGrid.test.js`:

```javascript
import { describe, test, expect } from 'vitest';
import { buildGridLineSegments } from './loadGrid.js';

const GRID = {
  id: 'grid-structural',
  type: 'Grid',
  axes: [
    { id: '1', direction: 'y', offset_m: 0.0 },
    { id: '2', direction: 'y', offset_m: 5.4 },
    { id: 'A', direction: 'x', offset_m: 0.0 },
    { id: 'B', direction: 'x', offset_m: 8.5 },
  ],
  elevations: [
    { id: 'GF', z_m: 0.0 },
    { id: 'FF', z_m: 3.0 },
  ],
};

describe('buildGridLineSegments', () => {
  test('returns an object with positions Float32Array', () => {
    const result = buildGridLineSegments(GRID);
    expect(result.positions).toBeInstanceOf(Float32Array);
  });

  test('produces 2 y-direction lines and 2 x-direction lines = 4 line pairs, 8 points', () => {
    // 2 Y-axes (horizontal lines) + 2 X-axes (vertical lines) = 4 lines
    // Each line is 2 points × 3 components = 6 floats; 4 lines = 24 floats
    const result = buildGridLineSegments(GRID);
    expect(result.positions.length).toBe(24);
  });

  test('Y-direction axis at offset 0 produces a horizontal line at y=0', () => {
    const result = buildGridLineSegments(GRID);
    // First line: y-axis at offset 0.0 → start (xMin,0,0) end (xMax,0,0)
    // xMin = min of x-offsets = 0, xMax = max of x-offsets = 8.5
    expect(result.positions[1]).toBeCloseTo(0.0); // y of start
    expect(result.positions[4]).toBeCloseTo(0.0); // y of end
  });

  test('grid with no axes returns empty positions', () => {
    const empty = { id: 'g', type: 'Grid', axes: [], elevations: [] };
    const result = buildGridLineSegments(empty);
    expect(result.positions.length).toBe(0);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd viewer && npm test -- loadGrid
```
Expected: FAIL — module not found.

**Step 3: Create `viewer/src/loader/loadGrid.js`**

```javascript
/**
 * loadGrid.js
 *
 * Converts an OEBF Grid entity into line segment data suitable for
 * THREE.LineSegments. Grid lines are drawn in the XY plane; one line
 * per axis, spanning the full extent of the perpendicular axes.
 */

/**
 * Build line segment positions from an OEBF grid entity.
 *
 * @param {object} gridDef - parsed OEBF grid JSON
 * @returns {{ positions: Float32Array }}
 */
export function buildGridLineSegments(gridDef) {
  const axes = gridDef.axes ?? [];
  if (axes.length === 0) return { positions: new Float32Array(0) };

  const xOffsets = axes.filter(a => a.direction === 'x').map(a => a.offset_m);
  const yOffsets = axes.filter(a => a.direction === 'y').map(a => a.offset_m);

  const xMin = xOffsets.length ? Math.min(...xOffsets) : 0;
  const xMax = xOffsets.length ? Math.max(...xOffsets) : 0;
  const yMin = yOffsets.length ? Math.min(...yOffsets) : 0;
  const yMax = yOffsets.length ? Math.max(...yOffsets) : 0;

  const pts = [];

  // Y-direction axes → horizontal lines (constant Y, spanning X range)
  for (const y of yOffsets) {
    pts.push(xMin, y, 0,  xMax, y, 0);
  }

  // X-direction axes → vertical lines (constant X, spanning Y range)
  for (const x of xOffsets) {
    pts.push(x, yMin, 0,  x, yMax, 0);
  }

  return { positions: new Float32Array(pts) };
}
```

**Step 4: Run tests to verify they pass**

```bash
cd viewer && npm test -- loadGrid
```
Expected: 4 tests pass.

**Step 5: Write failing tests for grid loading in `loadBundle.test.js`**

Add to `loadBundle.test.js`:

```javascript
const GRID_DEF = {
  id: 'grid-structural',
  type: 'Grid',
  axes: [
    { id: '1', direction: 'y', offset_m: 0 },
    { id: '2', direction: 'y', offset_m: 5.4 },
    { id: 'A', direction: 'x', offset_m: 0 },
    { id: 'B', direction: 'x', offset_m: 8.5 },
  ],
  elevations: [],
};

describe('loadBundle — grids', () => {
  test('returns grids array with loaded grid objects', async () => {
    const model = { elements: [], junctions: [], arrays: [], grids: ['grid-structural'] };
    const files = bundleFiles({
      'model.json': model,
      'grids/grid-structural.json': GRID_DEF,
    });
    const { grids } = await loadBundle(mockDirHandle(files));
    expect(grids).toHaveLength(1);
    expect(grids[0].id).toBe('grid-structural');
  });

  test('returns empty grids array when model.grids is absent', async () => {
    const { grids } = await loadBundle(mockDirHandle(bundleFiles()));
    expect(grids).toEqual([]);
  });

  test('missing grid file is skipped with warning', async () => {
    const model = { elements: [], junctions: [], arrays: [], grids: ['grid-missing'] };
    const files = bundleFiles({ 'model.json': model });
    const { grids } = await loadBundle(mockDirHandle(files));
    expect(grids).toHaveLength(0);
  });
});
```

**Step 6: Run tests to verify they fail**

```bash
cd viewer && npm test -- loadBundle
```
Expected: FAIL — `grids` is undefined.

**Step 7: Update `loadBundle.js` to load grids**

After the arrays loop, before `return`, add:

```javascript
const grids = [];
for (const gridId of (model.grids ?? [])) {
  try {
    const grid = await _readJson(dirHandle, `grids/${gridId}.json`);
    grids.push(grid);
  } catch (err) {
    console.warn(`[OEBF] Skipping grid ${gridId}: ${err.message}`);
  }
}

return { meshes, manifest, junctions, arrays, grids };
```

**Step 8: Run tests to verify they pass**

```bash
cd viewer && npm test
```
Expected: all tests pass.

**Step 9: Wire grid rendering into `main.js`**

Add import:

```javascript
import { buildGridLineSegments } from './loader/loadGrid.js';
```

In the open-dir-btn handler, after the arrays loop, add:

```javascript
for (const grid of grids) {
  const { positions } = buildGridLineSegments(grid);
  if (positions.length === 0) continue;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({ color: 0x555555, opacity: 0.5, transparent: true });
  const lines = new THREE.LineSegments(geometry, material);
  lines.userData.gridId = grid.id;
  currentGroup.add(lines);
}
```

Destructure `grids` from `loadBundle` result:

```javascript
const { meshes, manifest, junctions, arrays, grids } = await loadBundle(dirHandle);
```

**Step 10: Run full test suite**

```bash
cd viewer && npm test
```
Expected: all tests pass.

**Step 11: Commit**

```bash
git add viewer/src/loader/loadGrid.js viewer/src/loader/loadGrid.test.js \
        viewer/src/loader/loadBundle.js viewer/src/loader/loadBundle.test.js \
        viewer/src/main.js
git commit -m "feat: grid entity loader and scene rendering (closes #25)"
```

---

## Task 24: .oebfz Zstd compressed bundle loading (Issue #26)

**Files:**
- Modify: `viewer/package.json`
- Create: `viewer/src/loader/loadBundleZstd.js`
- Create: `viewer/src/loader/loadBundleZstd.test.js`
- Modify: `viewer/src/main.js`
- Modify: `viewer/index.html`

**Context:** `.oebfz` is a Zstd-compressed tar archive of the bundle directory. `fzstd` decompresses in the browser. A minimal tar parser extracts files by path. The loader returns the same `{meshes, manifest, junctions, arrays, grids}` shape as `loadBundle()`.

**Step 1: Install fzstd**

```bash
cd viewer && npm install fzstd
```

Verify it appears in `package.json` dependencies.

**Step 2: Write failing tests for `loadBundleZstd.js`**

Create `viewer/src/loader/loadBundleZstd.test.js`:

```javascript
import { describe, test, expect } from 'vitest';
import { parseTar, extractFilesFromTar } from './loadBundleZstd.js';

// Minimal valid TAR header + content for a single file "manifest.json"
// TAR format: 512-byte header blocks + 512-byte data blocks, padded to 512
function buildMiniTar(filename, content) {
  const contentBytes = new TextEncoder().encode(content);
  const header = new Uint8Array(512);
  const enc = new TextEncoder();

  // Filename (bytes 0–99)
  enc.encodeInto(filename, header.subarray(0, 100));
  // File size in octal (bytes 124–135)
  const sizeOctal = contentBytes.length.toString(8).padStart(11, '0');
  enc.encodeInto(sizeOctal, header.subarray(124, 135));
  // Type flag: '0' = regular file (byte 156)
  header[156] = 0x30; // '0'

  // Simple checksum
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += (i >= 148 && i < 156) ? 32 : header[i];
  const checksumOctal = sum.toString(8).padStart(6, '0') + '\0 ';
  enc.encodeInto(checksumOctal, header.subarray(148, 156));

  const dataBlocks = Math.ceil(contentBytes.length / 512);
  const data = new Uint8Array(dataBlocks * 512);
  data.set(contentBytes);

  const result = new Uint8Array(512 + dataBlocks * 512);
  result.set(header, 0);
  result.set(data, 512);
  return result;
}

describe('parseTar / extractFilesFromTar', () => {
  test('extracts a single file by path', () => {
    const tar = buildMiniTar('manifest.json', '{"format":"oebf"}');
    const files = extractFilesFromTar(tar);
    expect(files.has('manifest.json')).toBe(true);
  });

  test('extracted content matches original', () => {
    const tar = buildMiniTar('manifest.json', '{"format":"oebf"}');
    const files = extractFilesFromTar(tar);
    expect(files.get('manifest.json')).toBe('{"format":"oebf"}');
  });

  test('returns empty map for a zero-length buffer', () => {
    const files = extractFilesFromTar(new Uint8Array(0));
    expect(files.size).toBe(0);
  });
});
```

**Step 3: Run tests to verify they fail**

```bash
cd viewer && npm test -- loadBundleZstd
```
Expected: FAIL — module not found.

**Step 4: Create `viewer/src/loader/loadBundleZstd.js`**

```javascript
/**
 * loadBundleZstd.js
 *
 * Loads an OEBF bundle from a Zstd-compressed .oebfz archive.
 * Decompresses with fzstd (WASM), extracts files from a POSIX tar,
 * then runs the same pipeline as loadBundle().
 *
 * Returns the same { meshes, manifest, junctions, arrays, grids } shape.
 */

import { decompress } from 'fzstd';
import { parsePath }         from './loadPath.js';
import { buildProfileShape } from './loadProfile.js';
import { sweepProfile }      from '../geometry/sweep.js';
import { buildSlabMeshData } from './loadSlab.js';

// ── Tar extraction ──────────────────────────────────────────────────────────

/**
 * Extract files from a POSIX ustar archive into a Map of path → text content.
 *
 * @param {Uint8Array} tarBytes
 * @returns {Map<string, string>}
 */
export function extractFilesFromTar(tarBytes) {
  const files = new Map();
  const decoder = new TextDecoder();
  let offset = 0;

  while (offset + 512 <= tarBytes.length) {
    const header = tarBytes.subarray(offset, offset + 512);

    // Two consecutive zero blocks = end of archive
    if (header.every(b => b === 0)) break;

    const name     = decoder.decode(header.subarray(0, 100)).replace(/\0/g, '').trim();
    const sizeOctal = decoder.decode(header.subarray(124, 136)).replace(/\0/g, '').trim();
    const typeFlag  = String.fromCharCode(header[156]);

    const size = sizeOctal ? parseInt(sizeOctal, 8) : 0;
    const dataOffset = offset + 512;
    const blockCount = Math.ceil(size / 512);

    if (typeFlag === '0' || typeFlag === '\0') {
      // Strip leading directory component added by some tar implementations
      const normalised = name.replace(/^[^/]+\//, '');
      if (normalised && size > 0) {
        const content = decoder.decode(tarBytes.subarray(dataOffset, dataOffset + size));
        files.set(normalised, content);
      }
    }

    offset = dataOffset + blockCount * 512;
  }

  return files;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Load an OEBF bundle from a .oebfz File object.
 *
 * @param {File} file
 * @returns {Promise<{ meshes: Array, manifest: object, junctions: Array, arrays: Array, grids: Array }>}
 */
export async function loadBundleZstd(file) {
  const compressed = new Uint8Array(await file.arrayBuffer());
  const tarBytes = decompress(compressed);
  const fileMap = extractFilesFromTar(tarBytes);

  function readJson(path) {
    const text = fileMap.get(path);
    if (!text) throw new Error(`Missing file in archive: ${path}`);
    return JSON.parse(text);
  }

  const manifest  = readJson('manifest.json');
  const model     = readJson('model.json');
  const materials = readJson('materials/library.json');

  const matMap = {};
  for (const m of materials.materials) matMap[m.id] = m;

  const meshes = [];

  for (const elementId of model.elements) {
    try {
      const element  = readJson(`elements/${elementId}.json`);
      const pathData = readJson(`paths/${element.path_id}.json`);
      const profData = readJson(`profiles/${element.profile_id}.json`);

      const parsedPath    = parsePath(pathData);
      const profileShapes = buildProfileShape(profData);
      const sweptMeshes   = sweepProfile(parsedPath.points, profileShapes);

      for (const sm of sweptMeshes) {
        const mat = matMap[sm.materialId];
        meshes.push({ ...sm, elementId, colour: mat?.colour_hex ?? '#888888', description: element.description });
      }
    } catch (err) {
      console.warn(`[OEBF] Skipping element ${elementId}: ${err.message}`);
    }
  }

  for (const slabId of (model.slabs ?? [])) {
    try {
      const slab     = readJson(`slabs/${slabId}.json`);
      const pathData = readJson(`paths/${slab.boundary_path_id}.json`);
      const mat      = matMap[slab.material_id];
      meshes.push({ ...buildSlabMeshData(slab, pathData), colour: mat?.colour_hex ?? '#888888', description: slab.description ?? '' });
    } catch (err) {
      console.warn(`[OEBF] Skipping slab ${slabId}: ${err.message}`);
    }
  }

  const junctions = [];
  for (const junctionId of (model.junctions ?? [])) {
    try {
      const junction = readJson(`junctions/${junctionId}.json`);
      if (junction.rule === 'custom' && junction.custom_geometry) {
        junction.geomData = readJson(`junctions/${junction.custom_geometry}`);
      }
      junctions.push(junction);
    } catch (err) {
      console.warn(`[OEBF] Skipping junction ${junctionId}: ${err.message}`);
    }
  }

  const arrays = [];
  for (const arrayId of (model.arrays ?? [])) {
    try {
      const arrayDef  = readJson(`arrays/${arrayId}.json`);
      const pathData  = readJson(`paths/${arrayDef.path_id}.json`);
      const symbolDef = readJson(`symbols/${arrayDef.source_id}.json`);
      const parsedPath = parsePath(pathData);
      arrays.push({ arrayDef, pathPoints: parsedPath.points, symbolDef });
    } catch (err) {
      console.warn(`[OEBF] Skipping array ${arrayId}: ${err.message}`);
    }
  }

  const grids = [];
  for (const gridId of (model.grids ?? [])) {
    try {
      grids.push(readJson(`grids/${gridId}.json`));
    } catch (err) {
      console.warn(`[OEBF] Skipping grid ${gridId}: ${err.message}`);
    }
  }

  return { meshes, manifest, junctions, arrays, grids };
}
```

**Step 5: Run tests to verify they pass**

```bash
cd viewer && npm test -- loadBundleZstd
```
Expected: 3 tests pass.

**Step 6: Wire .oebfz loading into `main.js`**

Add import:
```javascript
import { loadBundleZstd } from './loader/loadBundleZstd.js';
```

Replace the `open-file-btn` handler stub with:

```javascript
document.getElementById('open-file-btn').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.oebfz';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    statusEl.textContent = 'Loading…';
    _clearScene();
    try {
      const { meshes, manifest, junctions, arrays, grids } = await loadBundleZstd(file);
      _buildScene(meshes, manifest, junctions, arrays, grids);
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
      console.error(err);
    }
  };
  input.click();
});
```

Extract the scene-building code from the `open-dir-btn` handler into a shared `_buildScene(meshes, manifest, junctions, arrays, grids)` function, and call it from both button handlers.

**Step 7: Add Firefox FSA fallback message**

In the `open-dir-btn` handler, the existing check `if (!window.showDirectoryPicker)` already handles this — update the message:

```javascript
statusEl.textContent = 'Your browser does not support folder opening (Firefox). Use "Open .oebfz" instead.';
```

**Step 8: Run full test suite**

```bash
cd viewer && npm test
```
Expected: all tests pass.

**Step 9: Commit**

```bash
git add viewer/package.json viewer/package-lock.json \
        viewer/src/loader/loadBundleZstd.js viewer/src/loader/loadBundleZstd.test.js \
        viewer/src/main.js
git commit -m "feat: .oebfz Zstd compressed bundle loading (closes #26)"
```

---

## Task 25: GitHub Actions CI pipeline (Issue #28)

**Files:**
- Create: `.github/workflows/ci.yml`

**Context:** Two test suites: `viewer/` (Vitest, Node 20) and `ifc-tools/` (pytest, Python 3.12 + uv). IfcOpenShell is heavy — cache `.venv` by `uv.lock` hash.

**Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  viewer-tests:
    name: Viewer (Vitest)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: viewer/package-lock.json
      - run: cd viewer && npm ci
      - run: cd viewer && npm test

  ifc-tools-tests:
    name: IFC Tools (pytest)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - name: Install uv
        run: pip install uv
      - name: Cache uv venv
        uses: actions/cache@v4
        with:
          path: ifc-tools/.venv
          key: ifc-tools-venv-${{ hashFiles('ifc-tools/uv.lock') }}
      - run: cd ifc-tools && uv sync
      - run: cd ifc-tools && uv run pytest tests/ -v
```

**Step 2: Push and verify CI runs**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions for viewer and ifc-tools tests (closes #28)"
git push
```

Check: `gh run list --repo Al4st41r/OpenEditableBimFormat --limit 3`

Expected: both jobs pass (green).

---

## Task 26: Project README (Issue #19)

**Files:**
- Modify: `README.md`

**Context:** Current README is 2 lines. The issue body has a detailed spec for sections. Tone: technical, UK English, no emojis.

**Step 1: Write README.md**

Replace the contents of `README.md` with a full document covering:

1. **Project title and one-line description**
2. **Why OEBF** — the LLM-editing problem, plain-text proposition, path-first geometry
3. **Quick start** — how to open the example bundle in the viewer, how to validate with ajv
4. **Key features** — bullet list
5. **Project structure** — annotated bundle directory tree + repository layout
6. **Tech stack** — JSON Schema, Three.js/Vite, Python/IfcOpenShell, Tauri v2, Zstd
7. **Running tests** — npm test, uv run pytest, npx playwright test
8. **Roadmap** — phases with current status
9. **CI badge** — link to GitHub Actions workflow
10. **Licence**

See the full content in `docs/plans/2026-03-07-scene-completeness-and-release.md` Task 26 notes. Write complete markdown — no placeholders.

**Step 2: Verify README renders on GitHub**

```bash
gh browse --repo Al4st41r/OpenEditableBimFormat
```

Check no broken links, headers render, code blocks format correctly.

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: write project README (closes #19)"
```

---

## Task 27: Test coverage review (Issue #20)

**Files:**
- Modify: `viewer/src/loader/loadPath.test.js`
- Modify: `viewer/src/loader/loadProfile.test.js`
- Modify: `viewer/src/geometry/sweep.test.js`
- Modify: `viewer/src/loader/loadBundle.test.js`
- Modify: `ifc-tools/tests/test_ifc_importer.py`

**Context:** Issue #20 lists specific gaps per module. Tackle each in turn. Each test must follow the red → green pattern. Do not change implementation code unless a gap reveals a genuine bug.

**Viewer gaps to address:**

- `loadPath`: closed path, very short path (<1 mm), arc with degenerate mid-point
- `loadProfile`: zero-thickness layer should skip or error clearly
- `sweep`: closed path returns tube with no gap, degenerate all-zero path throws
- `loadBundle`: missing `manifest.json` throws; missing `model.json` throws
- `loadBundle`: two elements sharing the same profile both get correct geometry

**Python gaps to address:**

- `test_ifc_importer`: `IfcWallStandardCase` maps to `ifc_type: "IfcWall"`
- `test_ifc_importer`: `_slugify` edge cases (all-numeric, leading hyphens, >40 chars)
- `test_ifc_importer`: element whose geometry throws is skipped, rest imports

**Step 1–N:** For each gap: write the test, run to confirm FAIL, fix or confirm existing code handles it, run to confirm PASS, commit per module.

```bash
# After each module batch:
cd viewer && npm test
cd ifc-tools && uv run pytest tests/ -v
```

**Final commit:**

```bash
git add viewer/src/**/*.test.js ifc-tools/tests/*.py
git commit -m "test: expand coverage for loadPath, loadProfile, sweep, loadBundle, ifc_importer (closes #20)"
```

---

## Task 28: Update project-status.md

**Files:**
- Modify: `docs/project-status.md`

**Context:** The file was written before today's implementation batch. It describes Tasks 7–17 as not started. It needs a full rewrite to reflect the current state.

**Step 1: Rewrite `project-status.md`**

Replace the entire file with an accurate status document. Include:
- Date: today
- Test count: current (run `npm test` and `uv run pytest` to get counts)
- What is working: all completed tasks with file locations
- What is still pending: Tasks 18, 20, and the items from this plan
- Open GitHub issues with current state

**Step 2: Commit**

```bash
git add docs/project-status.md
git commit -m "docs: update project-status.md to reflect 2026-03-07 implementation state"
```

---

## Task 29: v0.1 release (Issue #30)

**Prerequisites:** Tasks 21–28 complete, CI passing.

**Files:**
- Modify: `example/terraced-house.oebf/manifest.json`
- Modify: `example/terraced-house.oebf/OEBF-GUIDE.md` (version comment in header)

**Step 1: Confirm all tests pass**

```bash
cd viewer && npm test
cd ../ifc-tools && uv run pytest tests/ -v
```

Expected: all pass.

**Step 2: Update manifest format_version**

In `example/terraced-house.oebf/manifest.json`, confirm `"format_version": "0.1.0"`.

**Step 3: Update OEBF-GUIDE.md header**

Ensure the first line reads:
```
<!-- OEBF Format Guide v0.1.0 — 2026-03-07 -->
```

**Step 4: Commit, tag, and release**

```bash
git add example/terraced-house.oebf/manifest.json example/terraced-house.oebf/OEBF-GUIDE.md
git commit -m "chore: mark format_version 0.1.0 for release"
git tag v0.1.0
git push && git push --tags
```

Create GitHub release:

```bash
gh release create v0.1.0 \
  --repo Al4st41r/OpenEditableBimFormat \
  --title "OEBF v0.1.0" \
  --notes "$(cat <<'EOF'
## OEBF v0.1.0

First stable release of the Open Editable BIM Format.

### Format
- 12 JSON entity schemas (manifest, path, profile, element, junction, junction-geometry, array, slab, grid, group, opening, symbol, material)
- Example bundle: terraced-house.oebf (4 walls, 1 slab, 5 junctions, 1 array, structural grid)
- OEBF-GUIDE.md embedded in every bundle for LLM context

### Web Viewer
- Three.js + Vite scene loader
- Sweep geometry engine with per-layer materialised meshes
- Junction trim planes (butt, mitre, custom mesh)
- InstancedMesh array rendering
- Grid entity rendering
- File System Access API directory loading + .oebfz Zstd upload
- Profile SVG editor (postMessage integration)

### IFC Tools
- Python CLI (uv): `oebf ifc import` and `oebf ifc export`
- Import: IfcWall, IfcSlab, IfcColumn, IfcBeam with spatial hierarchy
- Export: OEBF sweep → IfcExtrudedAreaSolid + IfcMaterialLayerSetUsage

### Tests
- 220+ Vitest unit tests (viewer)
- 19 pytest tests (ifc-tools)
- 3 Playwright e2e tests (profile editor)
- GitHub Actions CI on push to main

### What is not in v0.1
- Tauri v2 desktop wrapper (Issue #10)
- OEBF-GUIDE.md LLM test harness (Issue #22)
- Boolean opening cuts in viewer (Issue #29)
- CSG spline junction trim (Issue #18, v0.2)
EOF
)"
```

---

## Running All Tests

```bash
# JavaScript unit tests
cd viewer && npm test

# Playwright e2e (profile editor)
cd viewer && npx playwright test

# Python IFC tools
cd ifc-tools && uv run pytest tests/ -v

# CI status
gh run list --repo Al4st41r/OpenEditableBimFormat --limit 5
```
