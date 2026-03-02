# Junction Trim Algorithm — Design Decision

**Date:** 2026-03-02
**Status:** Accepted
**Resolves:** GitHub issue #4 (junction trim algorithm)

---

## Context

When two swept-profile elements meet at a junction, the rendered geometry must be trimmed so elements do not visually or geometrically overlap. The junction schema stores pre-computed `trim_planes` for `butt` and `mitre` rules; the viewer and IFC exporter must consume these to produce correct geometry.

Three approaches were evaluated:

1. **CSG Boolean (three-bvh-csg)** — subtract the intersecting volume from each element mesh at render time or export time. Accurate but carries a full CSG dependency and is slow for complex models; using it in the viewer would block the render loop.
2. **Plane-clip at render time via shader** — pass trim planes as uniforms and discard fragments in the fragment shader. Fast but requires custom GLSL, prevents Three.js's built-in post-processing from operating correctly on the clipped geometry, and produces no watertight solid for export.
3. **Hybrid plane-sweep: ClippingPlanes for viewer, plane-sweep trimmer for export** — use Three.js built-in `material.clippingPlanes` for zero-cost real-time rendering, and a custom plane-sweep algorithm (Sutherland-Hodgman) to compute watertight trimmed geometry for IFC export and pre-baked cache.

---

## Decision

Use the **hybrid plane-sweep approach** (Approach 3).

- **Viewer (real-time):** Three.js `material.clippingPlanes` per element, populated from the junction's `trim_planes` array. Requires `renderer.localClippingEnabled = true`. No geometry is modified; clipping is resolved by the GPU rasteriser. Complexity: O(1) per junction, regardless of element vertex count.
- **IFC export / geometry bake:** Custom `trimMeshByPlane()` algorithm (Sutherland-Hodgman triangle-mesh clipper with cap reconstruction). Applied once at export time or when the bundle is saved. Produces a watertight closed solid suitable for `IfcFacetedBrep`.
- **Custom rule junctions:** Render the `JunctionGeometry` mesh directly; no trimming is applied to the connected elements (the custom geometry file provides the connection detail).

CSG via three-bvh-csg is **not used** for the initial implementation. It may be adopted in a future version for non-planar intersections (e.g., curved-path junctions, NURBS surfaces).

---

## Algorithm Specification

### 1. Viewer — Three.js ClippingPlanes

For each element with an associated junction:

1. Load all junction files that reference this element's ID.
2. From each junction's `trim_planes` array, select entries where `element_id` matches the current element.
3. Convert each entry to a `THREE.Plane`:

   ```
   plane = new THREE.Plane(
     new THREE.Vector3(tp.plane_normal.x, tp.plane_normal.y, tp.plane_normal.z),
     -(tp.plane_normal.x * tp.plane_origin.x +
       tp.plane_normal.y * tp.plane_origin.y +
       tp.plane_normal.z * tp.plane_origin.z)
   )
   ```

4. Assign the resulting array to `mesh.material.clippingPlanes`.
5. Ensure `renderer.localClippingEnabled = true` (set once on the renderer).

The clipping plane convention keeps geometry on the side where `dot(point, normal) + constant >= 0`, which matches the OEBF definition: the keep side is `dot(P - origin, normal) >= 0`.

This approach is correct for L-junctions, T-junctions, and X-junctions. Each element in a junction receives only the planes applicable to it; the priority element receives no clipping planes.

### 2. IFC Export — trimMeshByPlane (Sutherland-Hodgman)

**Input:** A triangle mesh `{ vertices: [[x,y,z], …], faces: [[i,j,k], …] }` and a plane `{ normal: [x,y,z], origin: [x,y,z] }`.

**Output:** A trimmed, watertight closed mesh (same structure).

**Algorithm per triangle:**

1. Compute the signed distance of each vertex from the plane: `d = dot(v - origin, normal)`.
2. Classify vertices: keep (`d >= 0`), clip (`d < 0`).
3. If all keep: output triangle unchanged.
4. If all clip: discard triangle.
5. If mixed: apply Sutherland-Hodgman edge clipping.
   - Walk each edge `(A, B)` of the triangle.
   - If A is kept, emit A.
   - If the edge crosses the plane, compute the intersection `P = A + t(B - A)` where `t = d_A / (d_A - d_B)`, and emit P.
   - Collect intersection points as a cap edge `[P1, P2]`.
6. Fan-triangulate the resulting clipped polygon.

**Cap reconstruction:**

After processing all triangles, collect the set of cap edges (one per clipped triangle that crossed the plane). Link edges into closed polygon(s) by building an adjacency map and walking the chain. Triangulate each cap polygon as a fan from the first vertex. The cap winding is oriented so its outward normal is `-plane.normal` (pointing toward the clipped side, i.e., outward from the kept solid).

**Multiple planes:** Apply `trimMeshByPlane` sequentially. For a butt junction with two elements: the priority element is not trimmed (no planes applied); the subordinate element is trimmed by one plane. For a T-junction: the subordinate element may receive a single plane. For an X-junction: both elements may each receive a plane.

**Performance:** For a 50-element model with an average of 500 triangles per element and 20 junctions, total trim work is approximately 50 × 500 × 20-plane operations. In practice, each element is trimmed by at most 2–3 planes (one junction at each end). The algorithm is O(T) per plane where T is the triangle count. Expected total time: under 200 ms on modern hardware.

### 3. Butt Trim Plane Computation

When trim planes are not pre-stored in the junction file and must be computed:

- **Priority element path direction:** `dirP = normalise(pathEnd - pathStart)`.
- **Intersection point:** the point on the priority element's path closest to the subordinate element's endpoint.
- **Trim plane for subordinate element at end `start`:** `{ normal: +dirP, origin: intersectionPoint }`.
- **Trim plane for subordinate element at end `end`:** `{ normal: -dirP, origin: intersectionPoint }`.

### 4. Mitre Trim Plane Computation

Both elements are trimmed by the same bisecting plane:

- `bisector = normalise(dirA + dirB)` where `dirA`, `dirB` are the outward path directions of each element from the junction point.
- Trim plane: `{ normal: bisector, origin: junctionPoint }`.
- The same plane and normal is valid for both elements, as both elements' kept volumes are on the `dot(P - junctionPoint, bisector) >= 0` side.

---

## Junction Type Mapping

| Junction type | Elements trimmed | Planes per element |
|---|---|---|
| L-junction (`butt`) | Subordinate element only | 1 |
| L-junction (`mitre`) | Both elements | 1 each |
| T-junction (`butt`) | Subordinate element only | 1 (or 2 if double-sided) |
| X-junction (`butt`) | Both elements, at crossing | 1–2 each |
| Custom | None (custom geometry renders in place) | 0 |

---

## Rationale

**Why ClippingPlanes over fragment-shader clipping:**
Three.js `material.clippingPlanes` is implemented in the standard Three.js material system; it works with `MeshStandardMaterial`, `MeshPhysicalMaterial`, and `MeshLambertMaterial` without any custom GLSL. It also correctly interacts with Three.js shadow maps, SSAO, and post-processing. Custom fragment-shader clipping would require forking every material shader and maintaining those forks.

**Why a custom plane-sweep trimmer over three-bvh-csg:**
The OEBF trim problem is a restricted subset of general CSG: all trim planes are planar (not curved surfaces), and each element is trimmed at most at its two endpoints. General CSG (BVH + mesh-mesh intersection) is significantly more complex to compute and requires an additional library dependency. The Sutherland-Hodgman plane clipper is 150 lines of dependency-free code, runs in linear time, and handles all OEBF junction types. Full CSG can be added as a fallback for v0.2 curved-path junctions.

**Why not three-bvh-csg for viewer:**
three-bvh-csg computes geometry on the CPU. Even at ~1 ms per operation, 50 elements × 20 planes = 1000 operations in the viewer startup path would add ~1 s of CPU work before first render. ClippingPlanes cost nothing at load time.

---

## Acceptance Criteria

| Criterion | How it is met |
|---|---|
| L-junctions | One ClippingPlane per element; priority element unchanged |
| T-junctions | One ClippingPlane on subordinate element |
| X-junctions | Two ClippingPlanes on each element (or one, depending on routing) |
| Watertight for IFC export | `trimMeshByPlane` produces closed solid with cap face |
| Performance: 50 elements in under 2 s | ClippingPlanes: O(1) per junction. Bake/export: O(T×P) total ≪ 2 s |

---

## Files Affected

| Action | File |
|---|---|
| New | `viewer/src/junction-trimmer.js` — plane-sweep algorithm + Three.js plane converter |
| New | `viewer/src/junction-trimmer.test.js` — Vitest unit tests |
| New | `viewer/package.json` — Vite + Three.js + Vitest |
| New | `viewer/vite.config.js` — Vite / Vitest configuration |
| New | `viewer/src/junction-renderer.js` — Three.js ClippingPlanes integration |
| This document | `docs/decisions/2026-03-02-junction-trim-algorithm.md` |

---

## Open Questions (deferred to v0.2)

- **Curved-path junctions:** When the path is a spline, the trim surface is not a plane. Evaluate three-bvh-csg or a swept-surface intersection for this case.
- **Cap capping in viewer:** Three.js ClippingPlanes leave the cut face open (no cap). Stencil-based capping (`THREE.Group` with `stencilWrite`) may be added to the viewer for a cleaner visual result. Not required for v0.1.
- **Per-layer trimming:** Cavity walls have multiple material layers that should each be trimmed independently at a junction. Requires the sweep-profile to carry layer boundary information. Deferred.

---

*End of decision document.*
