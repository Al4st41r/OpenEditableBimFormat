import { describe, test, expect } from 'vitest';
import { layerMap, remapDocLayers } from './layerRemap.js';

const prof = (...names) => ({ assembly: names.map((name, i) => ({ layer: i + 1, name })) });
const before = prof('Brick', 'PIR', 'Block', 'Plaster');

describe('layerMap', () => {
  test('a layer inserted in the middle shifts the ones after it', () => {
    expect([...layerMap(before, prof('Brick', 'PIR', 'Air', 'Block', 'Plaster'))]).toEqual([[1, 1], [2, 2], [3, 4], [4, 5]]);
  });
  test('a removed layer maps to null', () => {
    expect(layerMap(before, prof('Brick', 'Block', 'Plaster')).get(2)).toBeNull();
  });
  test('layers with the same name keep their order', () => {
    expect([...layerMap(prof('Ply', 'Ply'), prof('Ply', 'Air', 'Ply'))]).toEqual([[1, 1], [2, 3]]);
  });
});

describe('remapDocLayers', () => {
  const doc = {
    members: [
      { role: 'a', profile_id: 'p', insertion: { layer: 3, at: 'left-face' }, layer_ends: [{ layer: 1, near_m: 0.1 }, { layer: 3, near_m: 0.2 }], layer_units: [{ layer: 2, depth_m: 0.1, repeat_m: 0.11 }] },
      { role: 'b', profile_id: 'other', insertion: { layer: 3, at: 'left-face' } },
    ],
  };
  test('settings follow their layer; other profiles are untouched', () => {
    const r = remapDocLayers(doc, 'p', before, prof('Brick', 'Air', 'PIR', 'Block', 'Plaster'));
    expect(r.changed).toBe(true);
    const a = r.doc.members[0];
    expect(a.insertion.layer).toBe(4);
    expect(a.layer_ends.map((e) => e.layer)).toEqual([1, 4]);
    expect(a.layer_units[0].layer).toBe(3);
    expect(r.doc.members[1].insertion.layer).toBe(3);
    expect(doc.members[0].insertion.layer).toBe(3);        // the original is not changed
  });
  test('settings for a removed layer are dropped and counted', () => {
    const r = remapDocLayers(doc, 'p', before, prof('Brick', 'PIR', 'Plaster'));
    expect(r.doc.members[0].insertion).toBeUndefined();
    expect(r.doc.members[0].layer_ends).toHaveLength(1);
    expect(r.dropped).toBe(2);
  });
  test('no change when the layers are the same', () => {
    expect(remapDocLayers(doc, 'p', before, before)).toEqual({ doc, changed: false, dropped: 0 });
  });
});
