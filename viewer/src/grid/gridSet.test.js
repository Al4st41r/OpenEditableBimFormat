import { describe, test, expect } from 'vitest';
import {
  loadGridSet, flattenAxes, activeGrid, setActiveGrid, addGrid, addAxis, updateAxis, removeAxis, serialiseGrid, commitGrid,
} from './gridSet.js';

const structural = {
  $schema: 'oebf://schema/0.1/grid', id: 'grid-structural', type: 'Grid', description: 'Structural grid', ifc_type: 'IfcGrid',
  axes: [{ id: '1', direction: 'y', offset_m: 0 }, { id: 'A', direction: 'x', offset_m: 0 }, { id: 'R1', direction: 'radial', angle_deg: 30 }],
  elevations: [{ id: 'GF', z_m: 0 }, { id: 'FF', z_m: 3 }],
};
const secondary = {
  $schema: 'oebf://schema/0.1/grid', id: 'grid-secondary', type: 'Grid', description: 'Secondary grid', ifc_type: 'IfcGrid',
  axes: [{ id: '1', direction: 'y', offset_m: 0 }, { id: '1-2', direction: 'y', offset_m: 1.5 }],
};

describe('loadGridSet', () => {
  test('keeps each grid separate and draws only the orthogonal axes', () => {
    const set = loadGridSet([structural, secondary]);
    expect(set.grids.map((g) => g.id)).toEqual(['grid-structural', 'grid-secondary']);
    expect(set.grids[0].axes.map((a) => a.id)).toEqual(['1', 'A']);
    expect(set.activeId).toBe('grid-structural');
  });

  test('axes with the same id in two grids stay distinct when flattened', () => {
    const flat = flattenAxes(loadGridSet([structural, secondary]));
    expect(flat.map((a) => a.key)).toEqual(['grid-structural/1', 'grid-structural/A', 'grid-secondary/1', 'grid-secondary/1-2']);
  });

  test('no grids: nothing is drawn and the first axis makes a default grid', () => {
    const set = loadGridSet([]);
    expect(flattenAxes(set)).toEqual([]);
    expect(activeGrid(set).id).toBe('grid-reference');
    expect(set.grids).toHaveLength(1);
  });
});

describe('editing', () => {
  test('a new axis goes into the active grid; the active grid can be changed', () => {
    const set = loadGridSet([structural, secondary]);
    addAxis(set, activeGrid(set).id, { label: 'B', direction: 'x', offset_m: 6 });
    expect(set.grids[0].axes.map((a) => a.id)).toEqual(['1', 'A', 'B']);
    setActiveGrid(set, 'grid-secondary');
    addAxis(set, activeGrid(set).id, { label: '2-3', direction: 'y', offset_m: 4.5 });
    expect(set.grids[1].axes.map((a) => a.id)).toEqual(['1', '1-2', '2-3']);
  });

  test('rejects a duplicate id within a grid, a bad direction and a bad offset; allows the same id in another grid', () => {
    const set = loadGridSet([structural, secondary]);
    expect(() => addAxis(set, 'grid-structural', { label: '1', direction: 'y', offset_m: 3 })).toThrow(/already has/);
    expect(() => addAxis(set, 'grid-structural', { label: 'R1', direction: 'y', offset_m: 3 })).toThrow(/already has/);
    expect(() => addAxis(set, 'grid-structural', { label: 'Q', direction: 'radial', offset_m: 3 })).toThrow(/x or y/);
    expect(() => addAxis(set, 'grid-structural', { label: 'Q', direction: 'x', offset_m: NaN })).toThrow(/number/);
    expect(() => addAxis(set, 'grid-secondary', { label: 'A', direction: 'x', offset_m: 0 })).not.toThrow();
  });

  test('update and remove act on the named grid only', () => {
    const set = loadGridSet([structural, secondary]);
    updateAxis(set, 'grid-secondary', '1', { offset_m: 0.5 });
    expect(set.grids[0].axes[0].offset_m).toBe(0);
    expect(set.grids[1].axes[0].offset_m).toBe(0.5);
    removeAxis(set, 'grid-secondary', '1');
    expect(set.grids[1].axes.map((a) => a.id)).toEqual(['1-2']);
    expect(() => removeAxis(set, 'grid-secondary', 'nope')).toThrow(/not found/);
  });

  test('addGrid makes the grid active and gives it a unique id', () => {
    const set = loadGridSet([structural]);
    const g = addGrid(set, { name: 'Mid bays' });
    expect(g.id).toBe('grid-mid-bays');
    expect(set.activeId).toBe('grid-mid-bays');
    expect(addGrid(set, { name: 'Mid bays' }).id).toBe('grid-mid-bays-2');
  });
});

describe('serialiseGrid', () => {
  test('keeps description, elevations, IFC type and axes the editor cannot draw', () => {
    const set = loadGridSet([structural]);
    addAxis(set, 'grid-structural', { label: 'B', direction: 'x', offset_m: 6 });
    updateAxis(set, 'grid-structural', '1', { offset_m: 0.25 });
    const out = serialiseGrid(set, 'grid-structural');
    expect(out.description).toBe('Structural grid');
    expect(out.elevations).toEqual(structural.elevations);
    expect(out.ifc_type).toBe('IfcGrid');
    expect(out.axes).toContainEqual({ id: 'R1', direction: 'radial', angle_deg: 30 });
    expect(out.axes.filter((a) => a.direction !== 'radial')).toEqual([
      { id: '1', direction: 'y', offset_m: 0.25 }, { id: 'A', direction: 'x', offset_m: 0 }, { id: 'B', direction: 'x', offset_m: 6 },
    ]);
  });

  test('does not change the input, and another grid is untouched', () => {
    const before = JSON.stringify([structural, secondary]);
    const set = loadGridSet([structural, secondary]);
    addAxis(set, 'grid-structural', { label: 'B', direction: 'x', offset_m: 6 });
    serialiseGrid(set, 'grid-structural');
    expect(JSON.stringify([structural, secondary])).toBe(before);
    expect(serialiseGrid(set, 'grid-secondary')).toEqual(secondary);
  });

  test('a grid made in the editor serialises as a valid grid entity', () => {
    const set = loadGridSet([]);
    addAxis(set, activeGrid(set).id, { label: '1', direction: 'y', offset_m: 0 });
    expect(serialiseGrid(set, 'grid-reference')).toEqual({
      $schema: 'oebf://schema/0.1/grid', id: 'grid-reference', type: 'Grid', description: 'Reference grid', ifc_type: 'IfcGrid',
      axes: [{ id: '1', direction: 'y', offset_m: 0 }], elevations: [],
    });
  });

  test('commitGrid makes the written entity the baseline', () => {
    const set = loadGridSet([secondary]);
    addAxis(set, 'grid-secondary', { label: '3', direction: 'y', offset_m: 6 });
    commitGrid(set, 'grid-secondary');
    expect(set.grids[0].entity.axes.map((a) => a.id)).toEqual(['1', '1-2', '3']);
  });
});
