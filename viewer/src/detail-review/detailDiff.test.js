import { describe, it, expect } from 'vitest';
import { diffDetails } from './detailDiff.js';

const base = { id: 'd', description: 'x', members: [{ role: 'wall', profile_id: 'p1' }], regions: [{ material_id: 'a', vertices: [[0, 0]] }] };

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
    const after = { ...base, regions: [{ material_id: 'a', vertices: [[1, 1]] }, { material_id: 'b', vertices: [] }] };
    expect(diffDetails(base, after)).toEqual(['Region 1 (a) changed.', 'Region 2 (b) added.']);
    expect(diffDetails(after, base)).toEqual(['Region 1 (a) changed.', 'Region 2 (b) removed.']);
  });
  it('reports other fields', () => {
    expect(diffDetails(base, { ...base, description: 'y' })).toEqual(['Field "description" changed.']);
  });
});
