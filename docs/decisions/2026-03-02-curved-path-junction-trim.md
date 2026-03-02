# Curved-Path Junction Trim — Design Decision

**Date:** 2026-03-02
**Status:** Accepted
**Resolves:** GitHub issue #11 (curved path junction trim)

---

## Context

The v0.1 junction trim algorithm (see `docs/decisions/2026-03-02-junction-trim-algorithm.md`)
uses flat clip planes computed from straight-line path directions. When one or both paths
at a junction are curved (arc, bezier, spline), the trim plane must be derived from the
path's tangent at the junction endpoint rather than a simple endpoint-to-endpoint chord.

Four cases arise:

| Case | Description | Planar? |
|---|---|---|
| Straight meets straight | Well-defined perpendicular or bisecting plane | Yes |
| Straight meets arc | Trim plane tangent to arc at junction | Yes |
| Arc meets arc | Each element uses tangent at its endpoint | Yes |
| Spline meets anything | Endpoint tangent is an approximation only | No (CSG required) |

For cases 1–3, a flat trim plane derived from the exact path tangent is geometrically
correct for the viewer and produces a watertight solid for IFC export. For case 4,
the tangent at a spline endpoint is only a chord approximation; a planar trim
may leave visible gaps at the junction, so CSG is required for correctness.

---

## Decision

Extend the junction trimmer with tangent-aware trim plane computation. The strategy
by path type is:

**Line** — tangent is the normalised segment direction vector. Exact.

**Arc** (defined by start, mid, end) — tangent is computed analytically from the
circumcircle of the three points. The circumcircle normal gives the arc's plane;
the tangent at any endpoint is the cross product of the plane normal with the
normalised radius vector at that point. Exact for any arc radius and orientation.

**Bezier** (cubic, defined by start, cp1, cp2, end) — tangent at start is the
direction from start to cp1; tangent at end is the direction from cp2 to end.
This is the standard Bernstein derivative evaluated at t=0 and t=1. Exact.

**Spline** (through-points, no explicit tangent constraints) — tangent at start
is the chord from points[0] to points[1]; at end, from points[n−2] to points[n−1].
This is an approximation. For any junction involving a spline path,
`computeButtTrimPlaneFromSegment` and `computeMitreTrimPlaneFromSegments` return
null and log a `console.warn`. The junction should carry `trim_method: "csg"` and
the author should use `custom_geometry` or a future CSG exporter.

---

## Algorithm Specification

### Circumcircle Tangent (Arc)

Given arc endpoints a = `start`, b = `mid`, c = `end`:

```
ab = b − a
ac = c − a
p  = |ab|²
q  = ab · ac
r  = |ac|²
denominator = 2(pr − q²) = 2|ab × ac|²

s = r(p − q) / denominator
t = p(r − q) / denominator
centre = a + s·ab + t·ac
```

The arc's plane normal is `normalise(ab × ac)`. The tangent at a point P on the arc is:

```
radial  = normalise(P − centre)
tangent = normalise(planeNormal × radial)
```

This produces the tangent in the direction of arc traversal (start → mid → end).
For a clockwise arc the plane normal reverses sign, which flips the tangent correctly.
The degenerate case (collinear a, b, c — straight arc) falls back to the chord direction.

### Outward Direction Convention

For the mitre bisector, both elements' outward directions (pointing away from the
junction along the element's interior) are required:

- Element whose `at_end = 'start'` at the junction: outward = forward tangent at start.
- Element whose `at_end = 'end'` at the junction: outward = −(forward tangent at end).

The mitre bisector is then `normalise(dirA + dirB)` as before.

### CSG Fallback

When a spline segment is detected, the helper functions return null and log:

```
[OEBF] computeButtTrimPlaneFromSegment: spline segment requires CSG for accurate
butt trim. Trim plane not computed; set trim_method:"csg" on the junction and use
custom_geometry or a future CSG exporter.
```

The caller is responsible for:
1. Setting `trim_method: "csg"` on the junction entity.
2. Providing a `custom_geometry` file for the viewer and IFC export to use.

---

## Schema Change

The `trim_method` field is added to `spec/schema/junction.schema.json` (optional):

| Value | Meaning |
|---|---|
| `"planar"` | `trim_planes` computed from path tangents; flat clip plane is correct |
| `"csg"` | Non-planar trim required; `trim_planes` is empty; use `custom_geometry` |
| `"none"` | Trim planes not yet computed |

---

## New Exports (`viewer/src/junction-trimmer.js`)

| Function | Description |
|---|---|
| `evaluateSegmentTangentAtStart(segment)` | Unit tangent at segment start, forward direction |
| `evaluateSegmentTangentAtEnd(segment)` | Unit tangent at segment end, forward direction |
| `computeButtTrimPlaneFromSegment(segment, atEnd, intersectionPoint)` | Butt plane from path tangent; null for splines |
| `computeMitreTrimPlaneFromSegments(segA, atEndA, segB, atEndB, junctionPoint)` | Mitre bisector from tangents; null if either is a spline |

Internal helpers (not exported):

| Function | Description |
|---|---|
| `circumcenter3d(a, b, c)` | 3D circumcentre of triangle; used for arc tangents |
| `evaluateArcTangentAtStart(start, mid, end)` | Arc tangent at start |
| `evaluateArcTangentAtEnd(start, mid, end)` | Arc tangent at end |

---

## Rationale

**Why not approximate spline tangents with a plane?**
A Catmull-Rom or similar spline may have significant curvature between the penultimate
control point and the endpoint. For straight elements, a flat trim plane is exact by
definition. For arcs and bezier curves the endpoint tangents are exact derivatives.
For a spline the chord from points[n−2] to points[n−1] may misrepresent the true
tangent by several degrees when control points are closely spaced or the spline has
high curvature near the endpoint. Because OEBF targets IFC export where watertight
geometry is required, an inaccurate trim plane would silently introduce geometry errors.
Logging a warning and returning null makes the failure explicit.

**Why extend the trimmer rather than a separate module?**
The existing `computeButtTrimPlane` and `computeMitreTrimPlane` functions take
pre-computed direction vectors. The new functions wrap them with tangent evaluation,
keeping the core algorithm unchanged and all tests passing. No existing behaviour
is modified.

**Why flat planes for arc-meets-arc junctions rather than a ruled surface?**
Each element is trimmed individually by its own flat plane derived from its tangent.
The two planes differ for a mitre (each element has its own tangent), but the shared
mitre plane from `computeMitreTrimPlane` using both tangent vectors provides a single
bisecting plane that is correct for visual purposes and produces adequate geometry for
IFC export at building scale (where arc radii are typically large relative to wall
thickness). A ruled-surface intersection is deferred to a future version alongside
the full CSG implementation.

---

## Acceptance Criteria

| Criterion | How it is met |
|---|---|
| Circular arc junctions handled without CSG (butt and mitre) | `evaluateArcTangentAtStart/End` computes exact tangent; `computeButtTrimPlaneFromSegment` and `computeMitreTrimPlaneFromSegments` produce flat trim planes for arc segments |
| Spline junctions fall back to CSG with a warning | Both helpers return null and call `console.warn` when a spline segment is detected |
| Junction entity records trim method | `trim_method` field added to `spec/schema/junction.schema.json` |
| Existing straight-path behaviour unchanged | All 30 pre-existing tests continue to pass; new functions call existing `computeButtTrimPlane` / `computeMitreTrimPlane` internally |

---

## Files Affected

| Action | File |
|---|---|
| Modified | `viewer/src/junction-trimmer.js` — new tangent helpers and segment-aware trim plane functions |
| Modified | `viewer/src/junction-trimmer.test.js` — 22 new tests for tangent evaluation and segment-aware helpers |
| Modified | `spec/schema/junction.schema.json` — `trim_method` optional field |
| This document | `docs/decisions/2026-03-02-curved-path-junction-trim.md` |

---

## Open Questions (deferred)

- **Full CSG for splines:** three-bvh-csg or a swept-surface intersection algorithm
  would replace the null-return fallback for spline junctions. Targeted at v0.2.
- **Ruled-surface trim for arc-meets-arc:** when both elements have large-radius arcs
  and a mitre junction is required, a ruled surface between the two tangent planes
  would give exact geometry. Deferred pending demand.
- **Multi-segment paths:** when a path has multiple segments, the junction endpoint
  may fall on the boundary between two segments. The caller is currently responsible
  for identifying which segment contains the junction endpoint and passing it to the
  helper. A future path-query utility (`pathTangentAtPoint`) would automate this.

---

*End of decision document.*
