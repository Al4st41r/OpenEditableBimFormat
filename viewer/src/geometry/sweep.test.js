import { describe, test, expect } from 'vitest';
import { sweepProfile } from './sweep.js';

// ─── helpers ────────────────────────────────────────────────────────────────

/** Rectangle profile layer in profile space (X = thickness, Y = height). */
function rect(x0, x1, height = 2.7) {
  return { x0, x1, height };
}

function layerFrom({ x0, x1, height }, materialId = 'mat-a') {
  return {
    materialId,
    points: [
      { x: x0, y: 0 },
      { x: x1, y: 0 },
      { x: x1, y: height },
      { x: x0, y: height },
    ],
  };
}

/** Extract all X values from a flat vertices Float32Array. */
function xVals(verts) {
  const xs = [];
  for (let i = 0; i < verts.length; i += 3) xs.push(verts[i]);
  return xs;
}

/** Extract all Z values. */
function zVals(verts) {
  const zs = [];
  for (let i = 2; i < verts.length; i += 3) zs.push(verts[i]);
  return zs;
}

// ─── vertex / index count math ──────────────────────────────────────────────
// Tube grid:  N_frames × M_verts
// Start cap:  M_verts  (fan from first profile point, (M-2) triangles)
// End cap:    M_verts  (same)
// Total verts: (N + 2) × M
// Side indices: (N-1) × M × 6
// Cap indices:  (M-2) × 3 × 2

describe('sweepProfile — output structure', () => {
  test('returns one mesh per profile layer', () => {
    const path = [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }];
    const layers = [
      layerFrom(rect(-0.05, 0.05), 'mat-a'),
      layerFrom(rect(0.05, 0.15), 'mat-b'),
    ];
    const meshes = sweepProfile(path, layers);
    expect(meshes).toHaveLength(2);
  });

  test('each mesh carries its materialId', () => {
    const path = [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }];
    const meshes = sweepProfile(path, [
      layerFrom(rect(-0.05, 0.05), 'mat-brick'),
      layerFrom(rect(0.05, 0.15), 'mat-block'),
    ]);
    expect(meshes[0].materialId).toBe('mat-brick');
    expect(meshes[1].materialId).toBe('mat-block');
  });

  test('vertices is a Float32Array, indices is a Uint32Array', () => {
    const path = [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }];
    const [mesh] = sweepProfile(path, [layerFrom(rect(-0.05, 0.05))]);
    expect(mesh.vertices).toBeInstanceOf(Float32Array);
    expect(mesh.normals).toBeInstanceOf(Float32Array);
    expect(mesh.indices).toBeInstanceOf(Uint32Array);
  });
});

describe('sweepProfile — vertex counts', () => {
  // N=2 frames, M=4 profile points → total verts = (2+2)*4 = 16
  test('2-point path, 4-vertex profile: (N+2)×M = 16 vertices', () => {
    const path = [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }];
    const [mesh] = sweepProfile(path, [layerFrom(rect(-0.05, 0.05))]);
    expect(mesh.vertices.length / 3).toBe(16);
  });

  // N=3 frames, M=4 → (3+2)*4 = 20
  test('3-point path, 4-vertex profile: (N+2)×M = 20 vertices', () => {
    const path = [
      { x: 0, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
      { x: 3, y: 4, z: 0 },
    ];
    const [mesh] = sweepProfile(path, [layerFrom(rect(-0.05, 0.05))]);
    expect(mesh.vertices.length / 3).toBe(20);
  });
});

describe('sweepProfile — index counts', () => {
  // N=2, M=4: side (N-1)*M*6 = 24, caps (M-2)*3*2 = 12 → 36
  test('2-point path, 4-vertex profile: 36 indices', () => {
    const path = [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }];
    const [mesh] = sweepProfile(path, [layerFrom(rect(-0.05, 0.05))]);
    expect(mesh.indices.length).toBe(36);
  });

  // N=3, M=4: side (3-1)*4*6 = 48, caps 12 → 60
  test('3-point path, 4-vertex profile: 60 indices', () => {
    const path = [
      { x: 0, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
      { x: 3, y: 4, z: 0 },
    ];
    const [mesh] = sweepProfile(path, [layerFrom(rect(-0.05, 0.05))]);
    expect(mesh.indices.length).toBe(60);
  });
});

describe('sweepProfile — vertex positions', () => {
  test('straight X-axis path: vertex X range spans 0 to path length', () => {
    const path = [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }];
    const [mesh] = sweepProfile(path, [layerFrom(rect(-0.1, 0.1))]);
    const xs = xVals(mesh.vertices);
    expect(Math.min(...xs)).toBeCloseTo(0, 3);
    expect(Math.max(...xs)).toBeCloseTo(4, 3);
  });

  test('straight X-axis path: vertex Z spans 0 to wall height', () => {
    const path = [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }];
    const [mesh] = sweepProfile(path, [layerFrom(rect(-0.05, 0.05), 'mat-a')]);
    const zs = zVals(mesh.vertices);
    expect(Math.min(...zs)).toBeCloseTo(0, 3);
    expect(Math.max(...zs)).toBeCloseTo(2.7, 3);
  });

  test('path offset from origin: vertices follow path origin', () => {
    const path = [
      { x: 1, y: 2, z: 0 },
      { x: 6, y: 2, z: 0 },
    ];
    const [mesh] = sweepProfile(path, [layerFrom(rect(-0.05, 0.05))]);
    const xs = xVals(mesh.vertices);
    expect(Math.min(...xs)).toBeCloseTo(1, 3);
    expect(Math.max(...xs)).toBeCloseTo(6, 3);
  });
});

describe('sweepProfile — edge cases', () => {
  test('vertical path (tangent parallel to world-Z): does not throw', () => {
    const path = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 3 }];
    expect(() => sweepProfile(path, [layerFrom(rect(-0.1, 0.1))])).not.toThrow();
  });

  test('empty profile layers: returns empty array', () => {
    const path = [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }];
    expect(sweepProfile(path, [])).toEqual([]);
  });

  test('degenerate all-zero path throws a descriptive error or returns finite vertices', () => {
    const points = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }];
    const shapes = [{ points: [{ x: -0.05, y: 0 }, { x: 0.05, y: 0 }, { x: 0.05, y: 0.1 }, { x: -0.05, y: 0.1 }], materialId: 'mat', width: 0.1, function: 'structure' }];
    // Should throw (zero-length path produces degenerate geometry) or return empty
    // Either is acceptable — must not silently produce NaN vertices
    let result;
    try {
      result = sweepProfile(points, shapes);
    } catch (e) {
      expect(e.message).toBeTruthy();
      return;
    }
    // If it didn't throw, verify no NaN values in vertices
    for (const mesh of result) {
      expect(Array.from(mesh.vertices).every(isFinite)).toBe(true);
    }
  });

  test('closed path (first point == last): does not throw, produces finite vertices', () => {
    // Closed rectangular path — start and end coincide
    const path = [
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 4, y: 3, z: 0 },
      { x: 0, y: 3, z: 0 },
      { x: 0, y: 0, z: 0 },  // same as first
    ];
    expect(() => sweepProfile(path, [layerFrom(rect(-0.1, 0.1))])).not.toThrow();
    const [mesh] = sweepProfile(path, [layerFrom(rect(-0.1, 0.1))]);
    expect(Array.from(mesh.vertices).every(isFinite)).toBe(true);
    expect(Array.from(mesh.normals).every(isFinite)).toBe(true);
  });

  test('L-shaped path: intermediate node is mitered, not collapsed to centreline', () => {
    // Without miter tangents the ring at the corner node is oriented to the
    // outgoing segment, making both wall sides lie on the path centreline (y=0).
    // With miter tangents the ring sits on the angle bisector so each side is
    // offset from the centreline in Y.
    const path = [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },  // 90° corner — turns north
      { x: 2, y: 2, z: 0 },
    ];
    const [mesh] = sweepProfile(path, [layerFrom(rect(-0.1, 0.1))]);

    // Tube vertices at frame 1 (4 verts, starting at index 4 in the grid)
    // Expected miter binormal = normalize(cross(normalize((1,1,0)), (0,0,1)))
    //   = (0.707, -0.707, 0)
    // p.x=-0.1 → y offset = (-0.1)×(-0.707) = +0.0707
    // p.x= 0.1 → y offset = ( 0.1)×(-0.707) = -0.0707
    const ys = [];
    for (let vi = 4; vi < 8; vi++) ys.push(mesh.vertices[vi * 3 + 1]);

    expect(Math.max(...ys)).toBeCloseTo( 0.0707, 2);
    expect(Math.min(...ys)).toBeCloseTo(-0.0707, 2);
  });

  test('path with sharp corner (~170° turn): all normals are finite', () => {
    // Nearly-reverse path — tangent almost reverses at the second point
    const path = [
      { x: 0,   y: 0,    z: 0 },
      { x: 5,   y: 0,    z: 0 },
      { x: 5.1, y: 0.05, z: 0 },  // sharp ~170° turn
    ];
    expect(() => sweepProfile(path, [layerFrom(rect(-0.1, 0.1))])).not.toThrow();
    const [mesh] = sweepProfile(path, [layerFrom(rect(-0.1, 0.1))]);
    expect(Array.from(mesh.normals).every(isFinite)).toBe(true);
  });

  test('real wall: terraced-house north wall, cavity-250 profile, 4 layers', () => {
    const pathPoints = [
      { x: 0.0, y: 8.5, z: 0.0 },
      { x: 5.4, y: 8.5, z: 0.0 },
    ];
    const layers = [
      { materialId: 'mat-brick-common',    points: [{ x: -0.145, y: 0 }, { x: -0.043, y: 0 }, { x: -0.043, y: 2.7 }, { x: -0.145, y: 2.7 }] },
      { materialId: 'mat-pir-insulation',  points: [{ x: -0.043, y: 0 }, { x:  0.032, y: 0 }, { x:  0.032, y: 2.7 }, { x: -0.043, y: 2.7 }] },
      { materialId: 'mat-dense-aggregate', points: [{ x:  0.032, y: 0 }, { x:  0.132, y: 0 }, { x:  0.132, y: 2.7 }, { x:  0.032, y: 2.7 }] },
      { materialId: 'mat-gypsum-plaster',  points: [{ x:  0.132, y: 0 }, { x:  0.145, y: 0 }, { x:  0.145, y: 2.7 }, { x:  0.132, y: 2.7 }] },
    ];
    const meshes = sweepProfile(pathPoints, layers);
    expect(meshes).toHaveLength(4);
    // Each mesh: (N+2)*M vertices = 16
    for (const mesh of meshes) {
      expect(mesh.vertices.length / 3).toBe(16);
    }
    // materialIds preserved in order
    expect(meshes[0].materialId).toBe('mat-brick-common');
    expect(meshes[3].materialId).toBe('mat-gypsum-plaster');
  });
});

// ─── element options (#98): offsets, caps, sweep modes ──────────────────────

import { offsetPolyline, sweepOptionsFromElement } from './sweep.js';

const P = (x, y, z = 0) => ({ x, y, z });
const bounds = (verts, axis) => {
  const v = [];
  for (let i = axis; i < verts.length; i += 3) v.push(verts[i]);
  return [Math.min(...v), Math.max(...v)];
};

describe('offsetPolyline', () => {
  test('positive offsets shorten each end along the path', () => {
    const out = offsetPolyline([P(0, 0), P(10, 0)], 1, 2);
    expect(out[0].x).toBeCloseTo(1);
    expect(out.at(-1).x).toBeCloseTo(8);
  });
  test('negative offsets extend along the end tangents', () => {
    const out = offsetPolyline([P(0, 0), P(10, 0)], -1, -0.5);
    expect(out[0].x).toBeCloseTo(-1);
    expect(out.at(-1).x).toBeCloseTo(10.5);
  });
  test('offsets walk round corners and drop the points they pass', () => {
    const out = offsetPolyline([P(0, 0), P(4, 0), P(4, 4)], 5, 0);
    expect(out[0].x).toBeCloseTo(4);
    expect(out[0].y).toBeCloseTo(1);
    expect(out).toHaveLength(2);
  });
  test('zero offsets return the same points', () => {
    const pts = [P(0, 0), P(3, 0)];
    expect(offsetPolyline(pts, 0, 0)).toEqual(pts);
  });
  test('offsets that consume the whole path are ignored', () => {
    const pts = [P(0, 0), P(3, 0)];
    expect(offsetPolyline(pts, 2, 2)).toEqual(pts);
  });
  test('does not mutate the input', () => {
    const pts = [P(0, 0), P(3, 0)];
    offsetPolyline(pts, 1, 0);
    expect(pts[0].x).toBe(0);
  });
});

describe('sweepProfile — offsets', () => {
  test('start and end offsets shorten the mesh', () => {
    const path = [P(0, 0), P(10, 0)];
    const full = sweepProfile(path, [layerFrom(rect(-0.1, 0.1))])[0];
    const cut  = sweepProfile(path, [layerFrom(rect(-0.1, 0.1))], { startOffset: 1, endOffset: 2 })[0];
    expect(bounds(full.vertices, 0)).toEqual([0, 10]);
    const [a, b] = bounds(cut.vertices, 0);
    expect(a).toBeCloseTo(1); expect(b).toBeCloseTo(8);
  });
});

describe('sweepProfile — caps', () => {
  const path = [P(0, 0), P(4, 0)];
  const layer = [layerFrom(rect(-0.1, 0.1))];
  const count = (o) => sweepProfile(path, layer, o)[0];

  test('flat caps add two cap rings (default)', () => {
    expect(count({}).vertices.length / 3).toBe(2 * 4 + 2 * 4);
  });
  test('open start omits the start cap', () => {
    const m = count({ capStart: 'open' });
    expect(m.vertices.length / 3).toBe(2 * 4 + 4);
    expect(m.indices.length).toBe(1 * 4 * 6 + 2 * 3);
  });
  test('open at both ends leaves only the tube', () => {
    const m = count({ capStart: 'open', capEnd: 'open' });
    expect(m.vertices.length / 3).toBe(2 * 4);
    expect(m.indices.length).toBe(1 * 4 * 6);
  });
  test('angled and junction are capped like flat', () => {
    expect(count({ capStart: 'angled', capEnd: 'junction' }).indices.length).toBe(count({}).indices.length);
  });
});

describe('sweepProfile — sweep modes', () => {
  // A path that turns a right angle. The default frames follow the path.
  const path = [P(0, 0), P(4, 0), P(4, 4)];
  const layer = [layerFrom(rect(-0.1, 0.1))];

  test('perpendicular is the default and matches the old output', () => {
    const a = sweepProfile(path, layer)[0];
    const b = sweepProfile(path, layer, { sweepMode: 'perpendicular' })[0];
    expect(Array.from(b.vertices)).toEqual(Array.from(a.vertices));
  });
  test('fixed keeps the first frame orientation along the whole path', () => {
    const m = sweepProfile(path, layer, { sweepMode: 'fixed' })[0];
    // First segment runs +x, so the binormal is +/-y. With a fixed frame every
    // ring is offset in y only, so the y extent is 4 + 0.2 and x extent is 4.
    const [y0, y1] = bounds(m.vertices, 1);
    expect(y1 - y0).toBeCloseTo(4.2, 3);
    const [x0, x1] = bounds(m.vertices, 0);
    expect(x1 - x0).toBeCloseTo(4, 3);
  });
  test('twisted rotates the profile about the path', () => {
    const straight = [P(0, 0), P(4, 0)];
    const flat = sweepProfile(straight, [layerFrom(rect(-0.1, 0.1, 1))], { sweepMode: 'twisted', twistPerMetre: 0 })[0];
    const turned = sweepProfile(straight, [layerFrom(rect(-0.1, 0.1, 1))], { sweepMode: 'twisted', twistPerMetre: 22.5 })[0];
    // 4 m at 22.5 deg/m is a quarter turn: a tall thin profile ends up wide and flat.
    const zSpan = (m) => { const [a, b] = bounds(m.vertices.slice(m.vertices.length - 12), 2); return b - a; };
    expect(zSpan(flat)).toBeCloseTo(1, 3);
    expect(zSpan(turned)).toBeCloseTo(0.2, 3);
  });
  test('twisted with no rate does not rotate', () => {
    const straight = [P(0, 0), P(4, 0)];
    const a = sweepProfile(straight, layer, { sweepMode: 'twisted' })[0];
    const b = sweepProfile(straight, layer)[0];
    expect(bounds(a.vertices, 2)).toEqual(bounds(b.vertices, 2));
  });
});

describe('sweepOptionsFromElement', () => {
  test('maps the element fields', () => {
    expect(sweepOptionsFromElement({
      sweep_mode: 'fixed', cap_start: 'open', cap_end: 'angled', start_offset: 0.5, end_offset: 1, twist_per_metre: 3,
    })).toEqual({ sweepMode: 'fixed', capStart: 'open', capEnd: 'angled', startOffset: 0.5, endOffset: 1, twistPerMetre: 3 });
  });
  test('missing fields give the defaults', () => {
    expect(sweepOptionsFromElement({})).toEqual({
      sweepMode: 'perpendicular', capStart: 'flat', capEnd: 'flat', startOffset: 0, endOffset: 0, twistPerMetre: 0,
    });
    expect(sweepOptionsFromElement(undefined).sweepMode).toBe('perpendicular');
  });
});
