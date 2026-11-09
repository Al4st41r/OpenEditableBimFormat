import { describe, it, expect } from 'vitest';
import { diffDetails } from './detailDiff.js';

const base = { id: 'd', description: 'x', members: [{ role: 'wall', profile_id: 'p1' }], geometry: { extrusion_m: 1, regions: [{ material_id: 'a', vertices: [[0, 0]] }] } };

describe('diffDetails', () => {
  it('reports no change for identical details', () => {
    expect(diffDetails(base, structuredClone(base))).toEqual([]);
  });
  it('reports added, removed and changed members', () => {
    const after = { ...base, members: [{ role: 'wall', profile_id: 'p2' }, { role: 'slab', profile_id: 'p3' }] };
    expect(diffDetails(base, after)).toEqual(['Member "wall" changed.', 'Member "slab" added (p3).']);
    expect(diffDetails(after, base)).toEqual(['Member "wall" changed.', 'Member "slab" removed.']);
  });
  it('reports regions by position', () => {
    const after = { ...base, geometry: { extrusion_m: 1, regions: [{ material_id: 'a', vertices: [[1, 1]] }, { material_id: 'b', vertices: [] }] } };
    expect(diffDetails(base, after)).toEqual(['Region 1 (a) changed.', 'Region 2 (b) added.']);
    expect(diffDetails(after, base)).toEqual(['Region 1 (a) changed.', 'Region 2 (b) removed.']);
  });
  it('reports other fields', () => {
    expect(diffDetails(base, { ...base, description: 'y' })).toEqual(['Field "description" changed.']);
  });
  it('reports extrusion, annotations and parameters', () => {
    const after = {
      ...base, geometry: { ...base.geometry, extrusion_m: 2 },
      annotations: [{ type: 'note', at: { x: 0, y: 0 }, text: 'DPC' }, { type: 'line', points: [] }],
      parameters: { w: { default: 1 } },
    };
    expect(diffDetails(base, after)).toEqual(['Extrusion changed.', 'Note 1 ("DPC") added.', 'Line 2 added.', 'Parameter "w" added.']);
    expect(diffDetails(after, base)).toContain('Parameter "w" removed.');
  });
  it('does not report an edit to a region as an unknown field', () => {
    const after = structuredClone(base);
    after.geometry.regions[0].material_id = 'b';
    expect(diffDetails(base, after)).toEqual(['Region 1 (b) changed.']);
  });
});

describe('diffDetails ignores how defaults are written', () => {
  it('a parameter with scale 1 and offset 0 written in full or short form is no change', () => {
    const detail = (coord) => ({ id: 'd', members: [], geometry: { extrusion_m: 1, regions: [{ material_id: 'a', vertices: [{ x: 0, y: coord }] }] }, parameters: { w: { default: 1 } } });
    expect(diffDetails(detail({ param: 'w', scale: 1, offset: 0 }), detail({ param: 'w' }))).toEqual([]);
    expect(diffDetails(detail({ param: 'w', scale: 1, offset: 0 }), detail({ param: 'w', offset: 0.1 }))).toEqual(['Region 1 (a) changed.']);
  });
});
