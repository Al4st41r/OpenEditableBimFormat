/**
 * Shared synthetic fixtures for junction detail tests.
 *
 * World: grid axis '1' is north-south at x = 2, axis 'A' is east-west at y = 3,
 * so location ['1','A'] resolves to (2, 3). Storey 'storey-ff' is at z = 3.
 */

export const GRID = {
  id: 'grid-t', axes: [
    { id: '1', direction: 'y', offset_m: 2 },
    { id: 'A', direction: 'x', offset_m: 3 },
  ],
};

export const MODEL = {
  details: ['detail-box'],
  hierarchy: { type: 'Project', id: 'p', children: [
    { type: 'Storey', id: 'storey-gf', elevation: 0.0, children: [] },
    { type: 'Storey', id: 'storey-ff', elevation: 3.0, children: [] },
  ] },
};

/** Primary member path direction -> map of element id to polyline. */
export const elementPaths = (dir = [1, 0]) => new Map([
  ['element-a', [{ x: 2, y: 3, z: 0 }, { x: 2 + dir[0] * 6, y: 3 + dir[1] * 6, z: 0 }]],
  ['element-b', [{ x: 2, y: 3, z: 0 }, { x: 2 - dir[1] * 4, y: 3 + dir[0] * 4, z: 0 }]],
]);

export const rect = (x0, y0, x1, y1) => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];

export function makeDetail(overrides = {}) {
  return {
    $schema: 'oebf://schema/0.1/detail',
    id: 'detail-box', type: 'Detail', description: 'Test box',
    members: [
      { role: 'a', kind: 'wall', profile_id: 'p1', placement: { offset_x_m: 0, offset_y_m: 0, rotation_deg: 0 } },
      { role: 'b', kind: 'wall', profile_id: 'p1', placement: { offset_x_m: 0, offset_y_m: 0, rotation_deg: 90 } },
    ],
    datum: { kind: 'storey', reference: 'elevation' },
    plane: 'plan',
    geometry: {
      extrusion_m: 2.7,
      regions: [{ material_id: 'mat-a', vertices: rect(0.1, 0.2, 0.3, 0.5) }],
    },
    parameters: { w: { default: 0.2, min: 0.1, max: 0.4 } },
    ...overrides,
  };
}

export function makeJunction(id = 'junction-1', extra = {}) {
  return {
    $schema: 'oebf://schema/0.1/junction', id, type: 'Junction',
    elements: ['element-a', 'element-b'], rule: 'butt', priority: ['element-a'],
    detail_id: 'detail-box',
    location: { grid_id: 'grid-t', axes: ['1', 'A'], level_id: 'storey-ff' },
    ...extra,
  };
}

export const ctx = (dir) => ({ model: MODEL, grids: [GRID], elementPaths: elementPaths(dir) });

/** Structural check mirroring junction-geometry.schema.json (no ajv in the viewer). */
export function assertValidGeometry(g) {
  const errs = [];
  if (!/^[a-z0-9][a-z0-9-]*-geometry$/.test(g.id)) errs.push(`bad id ${g.id}`);
  if (g.type !== 'JunctionGeometry') errs.push('bad type');
  if (typeof g.description !== 'string') errs.push('no description');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(g.junction_id)) errs.push('bad junction_id');
  if (!Array.isArray(g.vertices) || g.vertices.length < 3) errs.push('too few vertices');
  if (!Array.isArray(g.faces) || g.faces.length < 1) errs.push('no faces');
  for (const v of g.vertices ?? []) {
    if (![v.x, v.y, v.z].every(Number.isFinite)) errs.push('non-finite vertex');
    if (Object.keys(v).sort().join() !== 'x,y,z') errs.push('extra vertex keys');
  }
  for (const f of g.faces ?? []) {
    if (!Array.isArray(f.indices) || f.indices.length < 3) errs.push('face < 3 indices');
    if (f.indices.some((i) => !Number.isInteger(i) || i < 0 || i >= g.vertices.length)) errs.push('index out of range');
  }
  return errs;
}

export function bbox(g) {
  const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const v of g.vertices) {
    [v.x, v.y, v.z].forEach((c, i) => { b.min[i] = Math.min(b.min[i], c); b.max[i] = Math.max(b.max[i], c); });
  }
  return b;
}

/** Signed volume of the face soup (fan-triangulated). Positive = outward winding. */
export function signedVolume(g) {
  let vol = 0;
  for (const f of g.faces) {
    const p0 = g.vertices[f.indices[0]];
    for (let i = 1; i < f.indices.length - 1; i++) {
      const a = p0, b = g.vertices[f.indices[i]], c = g.vertices[f.indices[i + 1]];
      vol += (a.x * (b.y * c.z - b.z * c.y) - a.y * (b.x * c.z - b.z * c.x) + a.z * (b.x * c.y - b.y * c.x)) / 6;
    }
  }
  return vol;
}
