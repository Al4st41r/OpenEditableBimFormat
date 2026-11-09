import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildDetailSheet } from './sheetExport.js';

const root = new URL('../../../example/nmb-two-storey.oebf/', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
function pilot() {
  const detail = read('details/detail-nmb-ew-slab-edge-section.json');
  const materials = Object.fromEntries(read('materials/library.json').materials.map((m) => [m.id, m]));
  const profiles = Object.fromEntries(detail.members.map((m) => [m.profile_id, read(`profiles/${m.profile_id}.json`)]));
  return { detail, materials, profiles };
}

describe('buildDetailSheet', () => {
  test('builds a sheet from a detail, with plain objects for profiles and materials (the editor passes those)', () => {
    const { sheet, name, scale } = buildDetailSheet({ ...pilot(), scale: 5, project: 'NMB' });
    expect(name).toBe('detail-nmb-ew-slab-edge-section');
    expect(scale).toBe(5);
    expect(sheet.svg).toContain('1:5 at ' + sheet.paper);
    expect(sheet.svg).toContain('NMB');
  });
  test('passes the paper and font through, and Maps work as well as objects', () => {
    const p = pilot();
    const r = buildDetailSheet({ ...p, profiles: new Map(Object.entries(p.profiles)), materials: new Map(Object.entries(p.materials)), paper: 'A2', fontCss: '@font-face{font-family:x}' });
    expect(r.sheet.paper).toBe('A2');
    expect(r.sheet.svg).toContain('@font-face{font-family:x}');
  });
  test('says so when there is nothing to draw, instead of exporting a blank sheet', () => {
    const p = pilot();
    expect(() => buildDetailSheet({ ...p, detail: { ...p.detail, members: [], geometry: { extrusion_m: 1, regions: [] } } })).toThrow(/nothing to draw/);
  });
  test('shows a clip, reference lines and marks from the detail', () => {
    const p = pilot();
    const detail = { ...p.detail, clip: { x_max_m: 0.3 }, reference_lines: [{ kind: 'custom', name: 'Cill', axis: 'y', offset_m: 0.1 }], annotations: [{ type: 'note', at: { x: 0, y: 0 }, text: 'Hello' }] };
    const { sheet } = buildDetailSheet({ ...p, detail });
    expect(sheet.svg).toContain('clip-fade');
    expect(sheet.svg).toContain('>Cill<');
    expect(sheet.svg).toContain('>Hello<');
  });
});
