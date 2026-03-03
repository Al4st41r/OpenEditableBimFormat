# OEBF Viewer Performance

Performance envelope for the Three.js web viewer. Updated as profiling data is gathered.

---

## Draw-call budget

Three.js submits one WebGL draw call per `THREE.Mesh` (or per `THREE.InstancedMesh` group). Draw calls are the primary CPU-side bottleneck on integrated graphics. The browser's JavaScript thread must issue every draw call before the GPU can render the frame.

| Hardware | Safe draw-call budget (60fps) | Hard limit (30fps) |
|---|---|---|
| Apple M2 (Metal, integrated GPU) | ~2 000 | ~6 000 |
| Intel Iris Xe (mid-range laptop) | ~1 000 | ~3 000 |
| Intel HD 620 (2019 low-end laptop) | ~500 | ~1 500 |

These figures are empirically derived from the Three.js community and the Chrome GPU process overhead at the relevant driver call rate. They are not universal; scene complexity, shader count, and texture binds all influence the real ceiling. Use them as a planning guide, not a guarantee.

---

## Per-element draw-call cost

Each OEBF element sweeps one profile. A profile contains one layer per material. Each layer becomes a separate `THREE.Mesh` with its own material, so it costs one draw call.

| Profile type | Layers | Draw calls per element |
|---|---|---|
| Timber post (single material) | 1 | 1 |
| Plasterboard partition | 2 | 2 |
| Timber stud wall (3 layers) | 3 | 3 |
| Cavity wall (brick + insulation + block + plaster) | 4 | 4 |

**Average for a mixed residential model:** approximately 3 draw calls per element.

---

## Scenario projections

| Scenario | Elements | Avg layers | Naive draw calls | Notes |
|---|---|---|---|---|
| Single storey house | ~50 | 3 | ~150 | Well within budget on all hardware |
| Multi-storey office | ~500 | 3 | ~1 500 | Comfortable on M2; borderline on Intel HD |
| Large residential development | ~5 000 | 3 | ~15 000 | Exceeds budget without instancing or batching |
| Parametric array: 100 rafters | 100 instances | 1 | 1 (with InstancedMesh) | One draw call regardless of instance count |
| Parametric array: 200 fence posts | 200 instances | 1 | 1 (with InstancedMesh) | Same |
| Parametric array: 500 cladding boards | 500 instances | 2 | 2 (with InstancedMesh) | Two draw calls for a 2-layer profile |

---

## Optimisations implemented

### 1. Instanced mesh rendering for arrays

`THREE.InstancedMesh` renders N identical instances in a single draw call. The viewer builds one `InstancedMesh` per geometry layer for each array:

```
buildArrayGroup(arrayDef, pathPoints, sourceGeometries)
→ THREE.Group containing one InstancedMesh per source layer
```

**Draw-call reduction:**

| Array | Naive | With InstancedMesh |
|---|---|---|
| 200 single-layer fence posts | 200 | 1 |
| 100 two-layer rafter beams | 200 | 2 |
| 500 four-layer cladding boards | 2 000 | 4 |

Implementation: `viewer/src/array/arrayRenderer.js`

### 2. Geometry caching

Swept `THREE.BufferGeometry` objects are cached by `profileId:pathLength:sweepMode`. Two elements with an identical profile, path length, and sweep mode share a single geometry object in memory.

**Benefits:**
- Reduces CPU-side geometry computation time at scene load.
- Enables InstancedMesh: all instances of an array source share the same cached geometry reference.
- Reduces GPU-side buffer uploads when switching between views.

**Cache key format:** `${profileId}:${pathLength.toFixed(4)}:${sweepMode}`

Implementation: `viewer/src/geometry/geometryCache.js`

---

## Optimisations planned

### 3. Level of detail (LOD)

Distant elements will be rendered as simplified meshes or bounding boxes. Three.js provides `THREE.LOD` for this. The OEBF viewer can use a two-level strategy:

- **Near (<20 m from camera):** Full swept geometry with all profile layers.
- **Far (>20 m):** Bounding-box representation (`THREE.BoxGeometry` sized to element extents).

Estimated draw-call saving for a large development: 60–80% reduction for elements outside the near zone.

### 4. Web Worker geometry computation

Sweep and junction computation runs on the main thread in the current implementation. Moving it to a Web Worker would prevent geometry loading from blocking the render loop. Three.js geometries can be transferred to the main thread via `Transferable` buffers (zero-copy).

This is particularly important for large models where scene load time is slow and the viewport is unresponsive during loading.

### 5. Material batching

Elements sharing the same profile (and therefore the same material set) could be merged into a single `THREE.Mesh` using `THREE.BufferGeometryUtils.mergeGeometries()`. This trades memory (a single large buffer) for fewer draw calls. Appropriate for static elements that never need to be individually selected or hidden.

---

## Measurement methodology

All fps figures above are projections derived from documented Three.js draw-call budgets. Actual measurements should be taken with:

```bash
# Chrome DevTools → Performance tab → record 5 seconds of orbit interaction
# Look for: scripting time, rendering time, GPU rasterise time
# Target: < 16 ms total frame time (60fps), < 33 ms (30fps)
```

For GPU-side profiling on macOS use Instruments → Metal System Trace.

When profiling, record:

1. Hardware (CPU, GPU, OS)
2. Model name and element count
3. Draw call count (via `renderer.info.render.calls`)
4. Frame time (ms) at steady-state orbit
5. Memory: `renderer.info.memory.geometries`, `.textures`

---

## Acceptance targets

| Scenario | Target fps | Status |
|---|---|---|
| Single storey house (~50 elements) | >60fps on M2 MacBook Air | — |
| Array of 200 identical elements | InstancedMesh (1–4 draw calls) | Implemented |
| Multi-storey office (~500 elements) | >30fps on mid-range laptop | — |

Status `—` means not yet profiled against hardware. Profile when the scene builder (Task 11) and sweep pipeline are implemented.
