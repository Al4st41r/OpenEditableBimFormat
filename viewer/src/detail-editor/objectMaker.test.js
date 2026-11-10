import { describe, it, expect } from 'vitest';
import { nextSymbolId, blankPart, toFormPart, fromFormPart, formPartsOf, symbolProblems, buildSymbol, previewSvg } from './objectMaker.js';

const tie = {
  geometry_definition: 'parts',
  parts: [
    { name: 'Bar', shape: 'cylinder', axis: 'y', radius_m: 0.002, length_m: 0.2, material_id: 'm', offset_m: { x: 0, y: 0, z: 0 } },
    { name: 'Drip', shape: 'box', size_m: { x: 0.004, y: 0.03, z: 0.025 }, offset_m: { x: 0, y: 0, z: -0.0125 } },
  ],
};

describe('objectMaker', () => {
  it('makes a free symbol id from the name', () => {
    expect(nextSymbolId('Wall tie 200', [])).toBe('symbol-wall-tie-200');
    expect(nextSymbolId('Wall tie 200', ['symbol-wall-tie-200'])).toBe('symbol-wall-tie-200-2');
  });
  it('round-trips parts between metres and millimetres without drift', () => {
    for (const part of tie.parts) expect(fromFormPart(toFormPart(part))).toEqual(part);
  });
  it('turns a plain box symbol into one editable part', () => {
    const [p] = formPartsOf({ parameters: { width_m: 0.9, depth_m: 0.045, height_m: 2.1 } });
    expect(p).toMatchObject({ shape: 'box', size_mm: { x: 900, y: 45, z: 2100 } });
  });
  it('reports every problem that stops a save', () => {
    const bad = symbolProblems({ name: ' ', id: 'symbol-', parts: [] }, {});
    expect(bad).toEqual(['Give the object a name.', 'Add at least one part.']);
    const parts = [{ ...blankPart('cylinder'), radius_mm: 0, material_id: 'nope' }];
    const more = symbolProblems({ name: 'x', id: 'symbol-x', parts }, { materialIds: ['m'], existingIds: ['symbol-x'] });
    expect(more.some((m) => /already exists/.test(m))).toBe(true);
    expect(more.some((m) => /greater than zero/.test(m))).toBe(true);
    expect(more.some((m) => /not in the library/.test(m))).toBe(true);
    expect(symbolProblems({ name: 'x', id: 'symbol-x', parts }, { existingIds: ['symbol-x'], editing: true }).some((m) => /already exists/.test(m))).toBe(false);
  });
  it('builds a Symbol entity in metres, keeping what the maker does not edit', () => {
    const s = buildSymbol({ id: 'symbol-tie', name: 'Tie', description: '', ifcClass: 'IfcMechanicalFastener', parts: tie.parts.map(toFormPart) }, { parameters: { a: 1 }, ifc_predefined_type: 'ANCHORBOLT' });
    expect(s).toMatchObject({ type: 'Symbol', geometry_definition: 'parts', description: 'Tie', ifc_type: 'IfcMechanicalFastener', parameters: { a: 1 }, ifc_predefined_type: 'ANCHORBOLT' });
    expect(s.parts).toEqual(tie.parts);
  });
  it('draws a circle for a cylinder pointing along the line of sight, a rectangle otherwise', () => {
    const { front, side } = previewSvg(tie.parts.map(toFormPart));
    expect(front).toContain('<circle');           // the bar runs along y, which the front view looks down
    expect(front).toContain('<rect');             // the drip
    expect(side).not.toContain('<circle');        // from the side the bar is a long rectangle
  });
  it('an empty parts list previews as nothing', () => {
    expect(previewSvg([])).toEqual({ front: '', side: '' });
  });
});
