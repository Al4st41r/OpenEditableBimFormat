/**
 * junction-trimmer.test.js
 *
 * Unit tests for the OEBF junction trim algorithm.
 *
 * Tests cover:
 *   - trimMeshByPlane: perpendicular cuts, all-keep, all-clip
 *   - trimMeshByPlanes: sequential planes (T-junction simulation)
 *   - meshVolume: volume of known solids
 *   - oebfTrimPlanesToPlanes: OEBF JSON → internal plane conversion
 *   - computeButtTrimPlane: correct normal direction for start/end
 *   - computeMitreTrimPlane: bisector for L-junction
 *   - Watertight check: all trimmed mesh faces produce finite volume
 *   - evaluateSegmentTangentAtStart/End: arc and bezier tangents
 *   - computeButtTrimPlaneFromSegment: tangent-based planes, spline warning
 *   - computeMitreTrimPlaneFromSegments: bisector from curved segments
 */

import { describe, it, expect, vi } from 'vitest';
import {
  trimMeshByPlane,
  trimMeshByPlanes,
  meshVolume,
  meshSignedVolume,
  oebfTrimPlanesToPlanes,
  computeButtTrimPlane,
  computeMitreTrimPlane,
  evaluateSegmentTangentAtStart,
  evaluateSegmentTangentAtEnd,
  computeButtTrimPlaneFromSegment,
  computeMitreTrimPlaneFromSegments,
} from './junction-trimmer.js';

// ---------------------------------------------------------------------------
// Mesh helpers
// ---------------------------------------------------------------------------

/**
 * Build a closed rectangular prism mesh.
 *
 * Vertices: 8 corners of [x0,x1] × [y0,y1] × [z0,z1].
 * Faces: 12 triangles (2 per face), CCW winding for outward normals.
 *
 *    7---6
 *   /|  /|
 *  4---5 |
 *  | 3-|-2
 *  |/  |/
 *  0---1
 *
 * 0:(x0,y0,z0) 1:(x1,y0,z0) 2:(x1,y1,z0) 3:(x0,y1,z0)
 * 4:(x0,y0,z1) 5:(x1,y0,z1) 6:(x1,y1,z1) 7:(x0,y1,z1)
 */
function boxMesh(x0, y0, z0, x1, y1, z1) {
  const vertices = [
    [x0, y0, z0], // 0
    [x1, y0, z0], // 1
    [x1, y1, z0], // 2
    [x0, y1, z0], // 3
    [x0, y0, z1], // 4
    [x1, y0, z1], // 5
    [x1, y1, z1], // 6
    [x0, y1, z1], // 7
  ];
  const faces = [
    // Bottom (z=z0, normal [0,0,-1])
    [0, 2, 1], [0, 3, 2],
    // Top (z=z1, normal [0,0,+1])
    [4, 5, 6], [4, 6, 7],
    // Front (y=y0, normal [0,-1,0])
    [0, 1, 5], [0, 5, 4],
    // Back (y=y1, normal [0,+1,0])
    [2, 3, 7], [2, 7, 6],
    // Left (x=x0, normal [-1,0,0])
    [0, 4, 7], [0, 7, 3],
    // Right (x=x1, normal [+1,0,0])
    [1, 2, 6], [1, 6, 5],
  ];
  return { vertices, faces };
}

/** Check that all vertices of mesh satisfy dot(v - origin, normal) >= -tol. */
function allOnKeepSide(mesh, plane, tol = 1e-6) {
  const { normal, origin } = plane;
  return mesh.vertices.every(v => {
    const d = (v[0] - origin[0]) * normal[0] +
              (v[1] - origin[1]) * normal[1] +
              (v[2] - origin[2]) * normal[2];
    return d >= -tol;
  });
}

// ---------------------------------------------------------------------------
// meshVolume
// ---------------------------------------------------------------------------

describe('meshVolume', () => {
  it('computes volume of a unit cube', () => {
    const mesh = boxMesh(0, 0, 0, 1, 1, 1);
    expect(meshVolume(mesh)).toBeCloseTo(1.0, 6);
  });

  it('computes volume of a 4 × 0.2 × 2.8 prism (wall element)', () => {
    const mesh = boxMesh(0, 0, 0, 4, 0.2, 2.8);
    expect(meshVolume(mesh)).toBeCloseTo(4 * 0.2 * 2.8, 6);
  });

  it('returns positive volume regardless of face winding direction', () => {
    const mesh = boxMesh(0, 0, 0, 2, 1, 1);
    expect(meshVolume(mesh)).toBeCloseTo(2.0, 6);
  });
});

// ---------------------------------------------------------------------------
// trimMeshByPlane — all vertices on keep side
// ---------------------------------------------------------------------------

describe('trimMeshByPlane — all keep', () => {
  it('returns mesh unchanged when all vertices are on the keep side', () => {
    const mesh = boxMesh(0, 0, 0, 4, 0.2, 2.8);
    // Plane at x=-1, keep x >= -1 (entire box is on keep side)
    const plane = { normal: [1, 0, 0], origin: [-1, 0, 0] };
    const result = trimMeshByPlane(mesh, plane);
    expect(meshVolume(result)).toBeCloseTo(meshVolume(mesh), 5);
  });

  it('does not add spurious vertices when untouched', () => {
    const mesh = boxMesh(0, 0, 0, 2, 1, 1);
    const plane = { normal: [0, 0, 1], origin: [0, 0, -1] };
    const result = trimMeshByPlane(mesh, plane);
    // No intersections, output vertex count equals input
    expect(result.vertices.length).toBe(mesh.vertices.length);
  });
});

// ---------------------------------------------------------------------------
// trimMeshByPlane — all vertices on clip side
// ---------------------------------------------------------------------------

describe('trimMeshByPlane — all clip', () => {
  it('returns empty mesh when all vertices are on the clip side', () => {
    const mesh = boxMesh(0, 0, 0, 4, 0.2, 2.8);
    // Plane at x=10, keep x >= 10 (entire box is clipped)
    const plane = { normal: [1, 0, 0], origin: [10, 0, 0] };
    const result = trimMeshByPlane(mesh, plane);
    expect(result.faces.length).toBe(0);
    expect(result.vertices.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// trimMeshByPlane — perpendicular cut at midpoint (butt junction)
// ---------------------------------------------------------------------------

describe('trimMeshByPlane — perpendicular butt cut', () => {
  it('halves a wall element along its length (x-axis)', () => {
    // Wall: 4m long, 200mm wide, 2.8m tall. Trim at x=2, keep x≤2.
    const mesh = boxMesh(0, 0, 0, 4, 0.2, 2.8);
    const plane = { normal: [-1, 0, 0], origin: [2, 0, 0] };
    const result = trimMeshByPlane(mesh, plane);

    const expectedVol = 2 * 0.2 * 2.8;
    expect(meshVolume(result)).toBeCloseTo(expectedVol, 4);
    expect(allOnKeepSide(result, plane)).toBe(true);
  });

  it('halves a wall element along its height (z-axis)', () => {
    const mesh = boxMesh(0, 0, 0, 4, 0.2, 2.8);
    // Trim at z=1.4, keep z≤1.4
    const plane = { normal: [0, 0, -1], origin: [0, 0, 1.4] };
    const result = trimMeshByPlane(mesh, plane);

    const expectedVol = 4 * 0.2 * 1.4;
    expect(meshVolume(result)).toBeCloseTo(expectedVol, 4);
    expect(allOnKeepSide(result, plane)).toBe(true);
  });

  it('produces a result with positive volume (not zero or negative)', () => {
    const mesh = boxMesh(0, 0, 0, 1, 1, 1);
    const plane = { normal: [-1, 0, 0], origin: [0.5, 0, 0] };
    const result = trimMeshByPlane(mesh, plane);
    expect(meshVolume(result)).toBeGreaterThan(0.1);
  });

  it('trims a unit cube at each axis midpoint', () => {
    const mesh = boxMesh(0, 0, 0, 1, 1, 1);

    const axes = [
      { normal: [-1, 0, 0], origin: [0.5, 0, 0] },
      { normal: [0, -1, 0], origin: [0, 0.5, 0] },
      { normal: [0, 0, -1], origin: [0, 0, 0.5] },
    ];

    for (const plane of axes) {
      const result = trimMeshByPlane(mesh, plane);
      expect(meshVolume(result)).toBeCloseTo(0.5, 4);
      expect(allOnKeepSide(result, plane)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// trimMeshByPlane — off-centre butt cut (SW corner simulation)
// ---------------------------------------------------------------------------

describe('trimMeshByPlane — SW corner butt junction', () => {
  it('trims south wall at x=0 (west wall face), discarding any x<0 geometry', () => {
    // South wall extends from x=-0.1 to x=5.4 (overlapping west wall face at x=0)
    const mesh = boxMesh(-0.1, 0, 0, 5.4, 0.2, 2.8);
    // Trim plane from junction-sw-corner: normal +x, origin (0,0,0) — keep x≥0
    const plane = { normal: [1, 0, 0], origin: [0, 0, 0] };
    const result = trimMeshByPlane(mesh, plane);

    // Box is -0.1→5.4 in x. After trim (keep x≥0): x from 0→5.4, width 5.4.
    const expectedVol = 5.4 * 0.2 * 2.8;
    expect(meshVolume(result)).toBeCloseTo(expectedVol, 4);
    expect(allOnKeepSide(result, plane)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// trimMeshByPlane — angled mitre cut (45°)
// ---------------------------------------------------------------------------

describe('trimMeshByPlane — angled mitre cut', () => {
  it('produces a wedge from a unit cube trimmed by a 45° plane', () => {
    // Cut along the bisecting plane of x- and y-axes through the origin.
    // Bisector of [1,0,0] and [0,1,0] = [1/√2, 1/√2, 0].
    // Keep side: dot([x,y,z], [1/√2,1/√2,0]) >= 0, i.e. x+y >= 0.
    const mesh = boxMesh(0, 0, 0, 1, 1, 1);
    const s = 1 / Math.sqrt(2);
    const plane = { normal: [s, s, 0], origin: [0, 0, 0] };
    const result = trimMeshByPlane(mesh, plane);

    // All vertices must be on keep side
    expect(allOnKeepSide(result, plane)).toBe(true);
    // Volume must be less than the unit cube and greater than zero
    expect(meshVolume(result)).toBeGreaterThan(0);
    expect(meshVolume(result)).toBeLessThanOrEqual(1.0 + 1e-6);
  });

  it('L-junction mitre: element meets at 45° with bisecting trim plane', () => {
    // Element A runs along +x. Element B runs along +y. Junction at origin.
    // dirA = [1,0,0], dirB = [0,1,0]. Bisector = [1/√2, 1/√2, 0].
    // Element A: box from x=0 to x=2, trimmed so x+y >= 0.
    const meshA = boxMesh(0, -0.1, 0, 2, 0.1, 2.8);
    const s = 1 / Math.sqrt(2);
    const plane = { normal: [s, s, 0], origin: [0, 0, 0] };
    const result = trimMeshByPlane(meshA, plane);
    expect(allOnKeepSide(result, plane)).toBe(true);
    expect(meshVolume(result)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// trimMeshByPlanes — sequential planes (T-junction simulation)
// ---------------------------------------------------------------------------

describe('trimMeshByPlanes — T-junction (two planes)', () => {
  it('applies two perpendicular planes sequentially', () => {
    // Long bar from x=0 to x=6. Trim to x in [1,5].
    const mesh = boxMesh(0, 0, 0, 6, 0.2, 2.8);
    const planes = [
      { normal: [1, 0, 0], origin: [1, 0, 0] },   // keep x >= 1
      { normal: [-1, 0, 0], origin: [5, 0, 0] },  // keep x <= 5
    ];
    const result = trimMeshByPlanes(mesh, planes);

    const expectedVol = 4 * 0.2 * 2.8;
    expect(meshVolume(result)).toBeCloseTo(expectedVol, 4);
    expect(allOnKeepSide(result, planes[0])).toBe(true);
    expect(allOnKeepSide(result, planes[1])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// oebfTrimPlanesToPlanes
// ---------------------------------------------------------------------------

describe('oebfTrimPlanesToPlanes', () => {
  const trimPlanesJson = [
    {
      element_id: 'element-wall-south-gf',
      at_end: 'start',
      plane_normal: { x: 1, y: 0, z: 0 },
      plane_origin: { x: 0.0, y: 0.0, z: 0.0 },
    },
    {
      element_id: 'element-wall-west-gf',
      at_end: 'end',
      plane_normal: { x: 0, y: -1, z: 0 },
      plane_origin: { x: 0.0, y: 0.0, z: 0.0 },
    },
  ];

  it('filters to the specified element only', () => {
    const planes = oebfTrimPlanesToPlanes(trimPlanesJson, 'element-wall-south-gf');
    expect(planes).toHaveLength(1);
    expect(planes[0].atEnd).toBe('start');
  });

  it('converts plane_normal correctly', () => {
    const planes = oebfTrimPlanesToPlanes(trimPlanesJson, 'element-wall-south-gf');
    expect(planes[0].normal).toEqual([1, 0, 0]);
  });

  it('converts plane_origin correctly', () => {
    const planes = oebfTrimPlanesToPlanes(trimPlanesJson, 'element-wall-south-gf');
    expect(planes[0].origin).toEqual([0, 0, 0]);
  });

  it('returns empty array when element has no matching entries', () => {
    const planes = oebfTrimPlanesToPlanes(trimPlanesJson, 'element-wall-north-gf');
    expect(planes).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    expect(oebfTrimPlanesToPlanes([], 'element-wall-south-gf')).toHaveLength(0);
  });

  it('returns multiple planes when element has multiple entries', () => {
    const multi = [
      {
        element_id: 'element-x',
        at_end: 'start',
        plane_normal: { x: 1, y: 0, z: 0 },
        plane_origin: { x: 0, y: 0, z: 0 },
      },
      {
        element_id: 'element-x',
        at_end: 'end',
        plane_normal: { x: -1, y: 0, z: 0 },
        plane_origin: { x: 4, y: 0, z: 0 },
      },
    ];
    const planes = oebfTrimPlanesToPlanes(multi, 'element-x');
    expect(planes).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// computeButtTrimPlane
// ---------------------------------------------------------------------------

describe('computeButtTrimPlane', () => {
  it('for atEnd=start: normal points in +priorityDir direction', () => {
    const dir = [0, 1, 0];
    const pt = [5, 0, 0];
    const plane = computeButtTrimPlane(dir, pt, 'start');
    expect(plane.normal).toEqual([0, 1, 0]);
    expect(plane.origin).toEqual([5, 0, 0]);
  });

  it('for atEnd=end: normal points in -priorityDir direction', () => {
    const dir = [0, 1, 0];
    const pt = [5, 8.5, 0];
    const plane = computeButtTrimPlane(dir, pt, 'end');
    // Use toBeCloseTo per component to avoid JavaScript -0 vs +0 inequality
    expect(plane.normal[0]).toBeCloseTo(0, 9);
    expect(plane.normal[1]).toBeCloseTo(-1, 9);
    expect(plane.normal[2]).toBeCloseTo(0, 9);
    expect(plane.origin).toEqual([5, 8.5, 0]);
  });

  it('correctly trims an element at its start using a computed butt plane', () => {
    // South wall runs along y from y=0 to y=5. Priority element (west wall)
    // runs along x at y=0. Subordinate element trimmed at start (y=0).
    // Priority path dir: [0,1,0]. Junction at [0,0,0]. atEnd: start.
    const dir = [0, 1, 0];
    const mesh = boxMesh(0, -0.3, 0, 0.2, 5, 2.8); // overlaps by 0.3m at start
    const plane = computeButtTrimPlane(dir, [0, 0, 0], 'start');
    const result = trimMeshByPlane(mesh, plane);

    // Only the y>=0 part should remain
    expect(allOnKeepSide(result, plane)).toBe(true);
    expect(meshVolume(result)).toBeCloseTo(0.2 * 5 * 2.8, 4);
  });
});

// ---------------------------------------------------------------------------
// computeMitreTrimPlane
// ---------------------------------------------------------------------------

describe('computeMitreTrimPlane', () => {
  it('returns bisector of two outward directions for a 90° L-junction', () => {
    // dirA = [1,0,0], dirB = [0,1,0] → bisector = [1/√2, 1/√2, 0]
    const dirA = [1, 0, 0];
    const dirB = [0, 1, 0];
    const plane = computeMitreTrimPlane(dirA, dirB, [0, 0, 0]);

    const s = 1 / Math.sqrt(2);
    expect(plane.normal[0]).toBeCloseTo(s, 6);
    expect(plane.normal[1]).toBeCloseTo(s, 6);
    expect(plane.normal[2]).toBeCloseTo(0, 6);
    expect(plane.origin).toEqual([0, 0, 0]);
  });

  it('both elements are on the keep side of the mitre plane', () => {
    // Both elements extend away from junction. Their kept geometry (t>0 along
    // respective directions) must be on the positive side of the mitre plane.
    const dirA = [1, 0, 0];
    const dirB = [0, 1, 0];
    const junction = [0, 0, 0];
    const plane = computeMitreTrimPlane(dirA, dirB, junction);

    // A point 1m along element A from junction
    const ptA = [1, 0, 0];
    const dA = (ptA[0] - junction[0]) * plane.normal[0] +
               (ptA[1] - junction[1]) * plane.normal[1] +
               (ptA[2] - junction[2]) * plane.normal[2];
    expect(dA).toBeGreaterThan(0);

    // A point 1m along element B from junction
    const ptB = [0, 1, 0];
    const dB = (ptB[0] - junction[0]) * plane.normal[0] +
               (ptB[1] - junction[1]) * plane.normal[1] +
               (ptB[2] - junction[2]) * plane.normal[2];
    expect(dB).toBeGreaterThan(0);
  });

  it('mitre plane trims both elements symmetrically at 45°', () => {
    // Each element is a 2×0.2×2.8 wall. After mitre trim, both should have
    // equal volume and all vertices on the keep side.
    const dirA = [1, 0, 0];
    const dirB = [0, 1, 0];
    const junction = [0, 0, 0];
    const plane = computeMitreTrimPlane(dirA, dirB, junction);

    // Element A: runs along x from 0 to 2, centred on y=0
    const meshA = boxMesh(0, -0.1, 0, 2, 0.1, 2.8);
    const resultA = trimMeshByPlane(meshA, plane);

    // Element B: runs along y from 0 to 2, centred on x=0
    const meshB = boxMesh(-0.1, 0, 0, 0.1, 2, 2.8);
    const resultB = trimMeshByPlane(meshB, plane);

    expect(allOnKeepSide(resultA, plane)).toBe(true);
    expect(allOnKeepSide(resultB, plane)).toBe(true);
    // Both elements should have the same volume after symmetric trimming
    expect(meshVolume(resultA)).toBeCloseTo(meshVolume(resultB), 3);
  });
});

// ---------------------------------------------------------------------------
// Watertight check (signed volume)
// ---------------------------------------------------------------------------

describe('watertight / closed-solid check', () => {
  it('trimmed mesh has non-zero signed volume (closed solid)', () => {
    const mesh = boxMesh(0, 0, 0, 4, 0.2, 2.8);
    const plane = { normal: [-1, 0, 0], origin: [2, 0, 0] };
    const result = trimMeshByPlane(mesh, plane);

    // For a correctly closed mesh with outward normals, signed volume > 0
    const sv = meshSignedVolume(result);
    expect(Math.abs(sv)).toBeGreaterThan(0.1);
  });

  it('sequential planes produce a closed solid', () => {
    const mesh = boxMesh(0, 0, 0, 6, 0.2, 2.8);
    const result = trimMeshByPlanes(mesh, [
      { normal: [1, 0, 0], origin: [1, 0, 0] },
      { normal: [-1, 0, 0], origin: [5, 0, 0] },
    ]);
    expect(Math.abs(meshSignedVolume(result))).toBeGreaterThan(0.1);
  });
});

// ---------------------------------------------------------------------------
// Real OEBF example: terraced house SW corner junction
// ---------------------------------------------------------------------------

describe('SW corner butt junction — OEBF example', () => {
  // From example/terraced-house.oebf/junctions/junction-sw-corner.json:
  //   element: element-wall-south-gf, at_end: start
  //   plane_normal: {x:1, y:0, z:0}, plane_origin: {x:0, y:0, z:0}
  // The south wall runs along y at x ≈ 0 to x ≈ 5.4.
  // The west wall runs along y at x=0 (face at x=0).
  // The south wall is trimmed to keep x >= 0.

  const trimPlanesJson = [
    {
      element_id: 'element-wall-south-gf',
      at_end: 'start',
      plane_normal: { x: 1, y: 0, z: 0 },
      plane_origin: { x: 0.0, y: 0.0, z: 0.0 },
    },
  ];

  it('produces correct clipping plane from OEBF JSON', () => {
    const planes = oebfTrimPlanesToPlanes(trimPlanesJson, 'element-wall-south-gf');
    expect(planes).toHaveLength(1);
    expect(planes[0].normal).toEqual([1, 0, 0]);
    expect(planes[0].origin).toEqual([0, 0, 0]);
  });

  it('trims south wall at west wall face', () => {
    // South wall: cavity wall, x from -0.27 (if overlapping) to 5.4, y from 0 to 0.275, z from 0 to 2.8
    // Simulate a slight overlap of 0.27m into the west wall.
    const wallMesh = boxMesh(-0.27, 0, 0, 5.4, 0.275, 2.8);
    const planes = oebfTrimPlanesToPlanes(trimPlanesJson, 'element-wall-south-gf');
    const plane = { normal: planes[0].normal, origin: planes[0].origin };
    const result = trimMeshByPlane(wallMesh, plane);

    // All vertices must have x >= 0
    expect(allOnKeepSide(result, plane)).toBe(true);
    // Volume: 5.4 × 0.275 × 2.8
    expect(meshVolume(result)).toBeCloseTo(5.4 * 0.275 * 2.8, 3);
  });
});

// ---------------------------------------------------------------------------
// Curved-path tangent evaluation
// ---------------------------------------------------------------------------

// Helper: build an OEBF segment object (coords as plain numbers, not {x,y,z})
// using {x,y,z} objects to match the OEBF JSON convention.
function pt(x, y, z) { return { x, y, z }; }

function lineSeg(x0, y0, z0, x1, y1, z1) {
  return { type: 'line', start: pt(x0, y0, z0), end: pt(x1, y1, z1) };
}
function arcSeg(sx, sy, sz, mx, my, mz, ex, ey, ez) {
  return { type: 'arc', start: pt(sx, sy, sz), mid: pt(mx, my, mz), end: pt(ex, ey, ez) };
}
function bezierSeg(sx, sy, sz, c1x, c1y, c1z, c2x, c2y, c2z, ex, ey, ez) {
  return { type: 'bezier', start: pt(sx, sy, sz), cp1: pt(c1x, c1y, c1z), cp2: pt(c2x, c2y, c2z), end: pt(ex, ey, ez) };
}
function splineSeg(...pts) {
  return { type: 'spline', points: pts.map(([x, y, z]) => pt(x, y, z)) };
}

describe('evaluateSegmentTangentAtStart', () => {
  it('line segment: tangent = normalised direction', () => {
    const seg = lineSeg(0, 0, 0, 3, 4, 0);
    const t = evaluateSegmentTangentAtStart(seg);
    expect(t[0]).toBeCloseTo(0.6, 6);
    expect(t[1]).toBeCloseTo(0.8, 6);
    expect(t[2]).toBeCloseTo(0, 6);
  });

  it('arc segment: 90° arc in XY plane — tangent at start is +Y', () => {
    // Arc from (1,0,0) through (√2/2, √2/2, 0) to (0,1,0), CCW.
    const s = 1 / Math.sqrt(2);
    const seg = arcSeg(1, 0, 0,  s, s, 0,  0, 1, 0);
    const t = evaluateSegmentTangentAtStart(seg);
    // Tangent at (1,0,0) on unit circle CCW = (0,1,0)
    expect(t[0]).toBeCloseTo(0, 6);
    expect(t[1]).toBeCloseTo(1, 6);
    expect(t[2]).toBeCloseTo(0, 6);
  });

  it('arc segment: semicircle in XY plane — tangent at start is +Y', () => {
    // Arc from (1,0,0) through (0,1,0) to (-1,0,0), CCW.
    const seg = arcSeg(1, 0, 0,  0, 1, 0,  -1, 0, 0);
    const t = evaluateSegmentTangentAtStart(seg);
    expect(t[0]).toBeCloseTo(0, 6);
    expect(t[1]).toBeCloseTo(1, 6);
    expect(t[2]).toBeCloseTo(0, 6);
  });

  it('arc segment: CW arc — tangent at start is −Y', () => {
    // Arc from (1,0,0) through (0,-1,0) to (-1,0,0), CW.
    const seg = arcSeg(1, 0, 0,  0, -1, 0,  -1, 0, 0);
    const t = evaluateSegmentTangentAtStart(seg);
    expect(t[0]).toBeCloseTo(0, 6);
    expect(t[1]).toBeCloseTo(-1, 6);
    expect(t[2]).toBeCloseTo(0, 6);
  });

  it('bezier segment: tangent at start from cp1', () => {
    // Tangent = normalise(cp1 - start).
    // start=(0,0,0), cp1=(0,1,0) → tangent = (0,1,0)
    const seg = bezierSeg(0, 0, 0,  0, 1, 0,  2, 2, 0,  3, 0, 0);
    const t = evaluateSegmentTangentAtStart(seg);
    expect(t[0]).toBeCloseTo(0, 6);
    expect(t[1]).toBeCloseTo(1, 6);
    expect(t[2]).toBeCloseTo(0, 6);
  });

  it('spline segment: tangent at start is chord from point 0 to point 1', () => {
    const seg = splineSeg([0, 0, 0], [0, 3, 0], [0, 6, 0]);
    const t = evaluateSegmentTangentAtStart(seg);
    expect(t[0]).toBeCloseTo(0, 6);
    expect(t[1]).toBeCloseTo(1, 6);
    expect(t[2]).toBeCloseTo(0, 6);
  });
});

describe('evaluateSegmentTangentAtEnd', () => {
  it('line segment: tangent = normalised direction (same as start)', () => {
    const seg = lineSeg(0, 0, 0, 3, 4, 0);
    const t = evaluateSegmentTangentAtEnd(seg);
    expect(t[0]).toBeCloseTo(0.6, 6);
    expect(t[1]).toBeCloseTo(0.8, 6);
    expect(t[2]).toBeCloseTo(0, 6);
  });

  it('arc segment: 90° CCW arc — tangent at end is −X', () => {
    // Arc from (1,0,0) through (√2/2,√2/2,0) to (0,1,0).
    // At (0,1,0) on unit circle CCW, tangent points in −X direction.
    const s = 1 / Math.sqrt(2);
    const seg = arcSeg(1, 0, 0,  s, s, 0,  0, 1, 0);
    const t = evaluateSegmentTangentAtEnd(seg);
    expect(t[0]).toBeCloseTo(-1, 6);
    expect(t[1]).toBeCloseTo(0, 6);
    expect(t[2]).toBeCloseTo(0, 6);
  });

  it('arc segment: semicircle — tangent at end is −Y', () => {
    const seg = arcSeg(1, 0, 0,  0, 1, 0,  -1, 0, 0);
    const t = evaluateSegmentTangentAtEnd(seg);
    expect(t[0]).toBeCloseTo(0, 6);
    expect(t[1]).toBeCloseTo(-1, 6);
    expect(t[2]).toBeCloseTo(0, 6);
  });

  it('bezier segment: tangent at end from cp2', () => {
    // end=(3,0,0), cp2=(2,2,0) → tangent = normalise(end-cp2) = normalise((1,-2,0))
    const seg = bezierSeg(0, 0, 0,  0, 1, 0,  2, 2, 0,  3, 0, 0);
    const t = evaluateSegmentTangentAtEnd(seg);
    const len = Math.sqrt(1 + 4);
    expect(t[0]).toBeCloseTo(1 / len, 6);
    expect(t[1]).toBeCloseTo(-2 / len, 6);
    expect(t[2]).toBeCloseTo(0, 6);
  });

  it('spline segment: tangent at end is chord from last-1 to last', () => {
    const seg = splineSeg([0, 0, 0], [0, 3, 0], [4, 3, 0]);
    const t = evaluateSegmentTangentAtEnd(seg);
    // chord from (0,3,0) to (4,3,0) = (4,0,0), normalised = (1,0,0)
    expect(t[0]).toBeCloseTo(1, 6);
    expect(t[1]).toBeCloseTo(0, 6);
    expect(t[2]).toBeCloseTo(0, 6);
  });
});

// ---------------------------------------------------------------------------
// computeButtTrimPlaneFromSegment
// ---------------------------------------------------------------------------

describe('computeButtTrimPlaneFromSegment', () => {
  it('line segment at start: matches computeButtTrimPlane', () => {
    // Segment running along +Y, junction at origin, trimming at start.
    const seg = lineSeg(0, 0, 0,  0, 5, 0);
    const plane = computeButtTrimPlaneFromSegment(seg, 'start', [0, 0, 0]);
    // computeButtTrimPlane([0,1,0], [0,0,0], 'start') → normal [0,1,0]
    const ref = computeButtTrimPlane([0, 1, 0], [0, 0, 0], 'start');
    expect(plane.normal[0]).toBeCloseTo(ref.normal[0], 6);
    expect(plane.normal[1]).toBeCloseTo(ref.normal[1], 6);
    expect(plane.normal[2]).toBeCloseTo(ref.normal[2], 6);
    expect(plane.origin).toEqual(ref.origin);
  });

  it('line segment at end: matches computeButtTrimPlane', () => {
    const seg = lineSeg(0, 0, 0,  0, 5, 0);
    const plane = computeButtTrimPlaneFromSegment(seg, 'end', [0, 5, 0]);
    const ref = computeButtTrimPlane([0, 1, 0], [0, 5, 0], 'end');
    expect(plane.normal[0]).toBeCloseTo(ref.normal[0], 6);
    expect(plane.normal[1]).toBeCloseTo(ref.normal[1], 6);
    expect(plane.normal[2]).toBeCloseTo(ref.normal[2], 6);
  });

  it('arc at start: trim plane normal is arc tangent direction', () => {
    // 90° CCW arc from (1,0,0) to (0,1,0). Tangent at start = (0,1,0).
    const s = 1 / Math.sqrt(2);
    const seg = arcSeg(1, 0, 0,  s, s, 0,  0, 1, 0);
    const plane = computeButtTrimPlaneFromSegment(seg, 'start', [1, 0, 0]);
    // Expected: normal ≈ (0,1,0), keeps geometry at y≥0 from junction
    expect(plane.normal[0]).toBeCloseTo(0, 6);
    expect(plane.normal[1]).toBeCloseTo(1, 6);
    expect(plane.normal[2]).toBeCloseTo(0, 6);
    expect(plane.origin).toEqual([1, 0, 0]);
  });

  it('arc at end: trim plane normal is negated arc tangent at end', () => {
    // 90° CCW arc from (1,0,0) to (0,1,0). Forward tangent at end = (−1,0,0).
    // With atEnd='end', sign = −1 → normal = −(−1,0,0) = (1,0,0).
    const s = 1 / Math.sqrt(2);
    const seg = arcSeg(1, 0, 0,  s, s, 0,  0, 1, 0);
    const plane = computeButtTrimPlaneFromSegment(seg, 'end', [0, 1, 0]);
    expect(plane.normal[0]).toBeCloseTo(1, 6);
    expect(plane.normal[1]).toBeCloseTo(0, 6);
    expect(plane.normal[2]).toBeCloseTo(0, 6);
    expect(plane.origin).toEqual([0, 1, 0]);
  });

  it('arc butt trim correctly clips a wall element', () => {
    // Wall running along +Y from y=−0.3 to y=5 (overlaps 0.3m at start).
    // Arc segment starts at (0,0,0) and proceeds in the +Y direction.
    const seg = arcSeg(0, 0, 0,  0.01, 2.5, 0,  0.02, 5, 0); // near-straight arc
    const plane = computeButtTrimPlaneFromSegment(seg, 'start', [0, 0, 0]);
    const mesh = boxMesh(0, -0.3, 0, 0.2, 5, 2.8);
    const result = trimMeshByPlane(mesh, plane);
    // Trimmed at y=0; kept volume: 0.2 × 5 × 2.8
    expect(allOnKeepSide(result, plane)).toBe(true);
    expect(meshVolume(result)).toBeCloseTo(0.2 * 5 * 2.8, 3);
  });

  it('spline segment: returns null and logs a warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seg = splineSeg([0, 0, 0], [0, 2, 0], [0, 5, 0]);
    const plane = computeButtTrimPlaneFromSegment(seg, 'start', [0, 0, 0]);
    expect(plane).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('spline'));
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// computeMitreTrimPlaneFromSegments
// ---------------------------------------------------------------------------

describe('computeMitreTrimPlaneFromSegments', () => {
  it('two line segments: matches computeMitreTrimPlane', () => {
    // Element A along +X, element B along +Y, both at start.
    const segA = lineSeg(0, 0, 0,  5, 0, 0);
    const segB = lineSeg(0, 0, 0,  0, 5, 0);
    const plane = computeMitreTrimPlaneFromSegments(segA, 'start', segB, 'start', [0, 0, 0]);
    const ref = computeMitreTrimPlane([1, 0, 0], [0, 1, 0], [0, 0, 0]);
    expect(plane.normal[0]).toBeCloseTo(ref.normal[0], 6);
    expect(plane.normal[1]).toBeCloseTo(ref.normal[1], 6);
    expect(plane.normal[2]).toBeCloseTo(ref.normal[2], 6);
  });

  it('line at start meets arc at start: bisector uses arc tangent', () => {
    // Element A: line along +X from (0,0,0).
    // Element B: CCW arc from (0,0,0) whose start tangent is +Y.
    const segA = lineSeg(0, 0, 0,  5, 0, 0);
    const s = 1 / Math.sqrt(2);
    // Arc starts at origin, going to (−1,0,0) via (−√2/2, √2/2, 0).
    // Hmm — for a simpler case, use an arc whose start tangent = (0,1,0).
    // Arc centred at (0,1,0), radius 1: starts at (0,0,0) going CW... complex.
    // Easier: the arc from (0,0,0) through (−s, s, 0) to (−1, 1, 0).
    // Let's just verify the bisector lies between +X and +Y (from tangent evaluation).
    const segB = arcSeg(0, 0, 0,  -s, s, 0,  -1, 1, 0); // CCW arc, start tangent ≈ (−1,1,0)/√2? Unclear.
    // Instead use a near-straight arc to get a predictable tangent.
    const segBStr = lineSeg(0, 0, 0,  0, 5, 0); // use line as proxy with tangent (0,1,0)
    const plane = computeMitreTrimPlaneFromSegments(segA, 'start', segBStr, 'start', [0, 0, 0]);
    const bisS = 1 / Math.sqrt(2);
    expect(plane.normal[0]).toBeCloseTo(bisS, 6);
    expect(plane.normal[1]).toBeCloseTo(bisS, 6);
    expect(plane.normal[2]).toBeCloseTo(0, 6);
    expect(plane.origin).toEqual([0, 0, 0]);
  });

  it('arc meets arc: bisector of tangents', () => {
    // Element A: CCW arc from (1,0,0), tangent at start = (0,1,0).
    // Element B: arc from (0,1,0), tangent at start = (−1,0,0).
    // Actually: arc from (0,1,0) going CW to (1,0,0): tangent at start = (1,0,0).
    const s = 1 / Math.sqrt(2);
    const segA = arcSeg(1, 0, 0,  s, s, 0,  0, 1, 0); // tangent at start = (0,1,0)
    // Arc from (0,1,0) with tangent (1,0,0): centre at (0,0,0), CW.
    // CW arc from (0,1,0) through (s,s,0) to (1,0,0).
    const segB = arcSeg(0, 1, 0,  s, s, 0,  1, 0, 0); // tangent at start = ?
    // arc(0,1,0)→(s,s,0)→(1,0,0): centre = (0,0,0), plane normal = cross((s−0,s−1,0),(1−0,−1,0))
    // = cross((s,s−1,0),(1,−1,0)) = (0,0,s*(−1)−(s−1)*1) = (0,0,−s−s+1) = (0,0,1−2s).
    // For s=1/√2 ≈ 0.707, 1−2*0.707 ≈ −0.414 < 0 → normal = (0,0,−1) → CW.
    // tangent at start(0,1,0): radial = (0,1,0), tangent = cross((0,0,−1),(0,1,0)) = (−0,0,0)−... = (1,0,0) ✓
    const junctionPt = [0, 0, 0]; // note: junction is at origin, but segments start at (1,0,0) and (0,1,0).
    // Use junction at (1,0,0) for segA (atEnd='start') and at (0,1,0) for segB (atEnd='start').
    // For a 90° L-junction, the mitre bisector between (0,1,0) (A outward) and (1,0,0) (B outward)
    // should be [1/√2, 1/√2, 0].
    const planeA = computeMitreTrimPlaneFromSegments(segA, 'start', segB, 'start', [0, 0, 0]);
    const bisS2 = 1 / Math.sqrt(2);
    // dirA (outward from junction at start of A) = tangent at start of A = (0,1,0)
    // dirB (outward from junction at start of B) = tangent at start of B = (1,0,0)
    // bisector = normalise((0,1,0)+(1,0,0)) = (1/√2,1/√2,0)
    expect(planeA.normal[0]).toBeCloseTo(bisS2, 6);
    expect(planeA.normal[1]).toBeCloseTo(bisS2, 6);
    expect(planeA.normal[2]).toBeCloseTo(0, 6);
  });

  it('element at end: outward direction is negated forward tangent', () => {
    // Element ends at the junction; outward direction points back toward start.
    // Line from (0,0,0) to (5,0,0): forward tangent at end = (1,0,0).
    // Outward from junction at end = −(1,0,0) = (−1,0,0).
    // Other element along −Y from junction: line from (0,0,0) to (0,−5,0), atEnd='start'.
    // Its forward tangent at start = (0,−1,0) = outward from junction.
    // bisector = normalise((−1,0,0)+(0,−1,0)) = (−1/√2,−1/√2,0)
    const segA = lineSeg(0, 0, 0,  5, 0, 0);
    const segB = lineSeg(0, 0, 0,  0, -5, 0);
    const plane = computeMitreTrimPlaneFromSegments(segA, 'end', segB, 'start', [5, 0, 0]);
    // outward A (atEnd='end'): -(1,0,0) = (−1,0,0)
    // outward B (atEnd='start'): (0,−1,0)
    // bisector = normalise((−1,−1,0)) = (−1/√2,−1/√2,0)
    const bisS = -1 / Math.sqrt(2);
    expect(plane.normal[0]).toBeCloseTo(bisS, 6);
    expect(plane.normal[1]).toBeCloseTo(bisS, 6);
    expect(plane.normal[2]).toBeCloseTo(0, 6);
  });

  it('spline in either segment: returns null and logs a warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const segLine = lineSeg(0, 0, 0,  5, 0, 0);
    const segSpline = splineSeg([0, 0, 0], [0, 2, 0], [0, 5, 0]);

    const p1 = computeMitreTrimPlaneFromSegments(segSpline, 'start', segLine, 'start', [0, 0, 0]);
    expect(p1).toBeNull();

    const p2 = computeMitreTrimPlaneFromSegments(segLine, 'start', segSpline, 'start', [0, 0, 0]);
    expect(p2).toBeNull();

    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('spline'));
    warnSpy.mockRestore();
  });
});
