import { describe, test, expect } from 'vitest';
import * as THREE from 'three';
import { buildJunctionDetailMeshes } from '../junction-renderer.js';
import { detailToGeometry } from './detailToGeometry.js';
import { makeDetail, makeJunction, ctx } from './fixtures.js';

const withGeometry = (id, extra = {}) => {
  const j = makeJunction(id, extra);
  j.detailGeometry = detailToGeometry(makeDetail(), j, ctx()).geometry;
  return j;
};
const matMap = new Map([['mat-a', new THREE.MeshBasicMaterial({ color: 0xff0000 })]]);

describe('buildJunctionDetailMeshes', () => {
  test('one group per junction that has detail geometry', () => {
    const groups = buildJunctionDetailMeshes([withGeometry('j1'), withGeometry('j2'), makeJunction('j3')], matMap);
    expect(groups).toHaveLength(2);
    for (const g of groups) expect(g).toBeInstanceOf(THREE.Group);
  });

  test('groups are tagged with junction and detail ids', () => {
    const [g] = buildJunctionDetailMeshes([withGeometry('j1')], matMap);
    expect(g.userData.junctionId).toBe('j1');
    expect(g.userData.detailId).toBe('detail-box');
  });

  test('uses the supplied material for the region material id', () => {
    const [g] = buildJunctionDetailMeshes([withGeometry('j1')], matMap);
    expect(g.children.length).toBeGreaterThan(0);
    expect(g.children[0].material).toBe(matMap.get('mat-a'));
  });

  test('mesh geometry has positions matching the detail volume', () => {
    const [g] = buildJunctionDetailMeshes([withGeometry('j1')], matMap);
    const box = new THREE.Box3().setFromObject(g);
    expect(box.min.x).toBeCloseTo(2.1, 5); expect(box.max.z).toBeCloseTo(5.7, 5);
  });

  test('junctions with a detail id but no geometry are skipped, not thrown', () => {
    expect(buildJunctionDetailMeshes([makeJunction('j1')], matMap)).toEqual([]);
  });

  test('empty or missing input returns an empty array', () => {
    expect(buildJunctionDetailMeshes([], matMap)).toEqual([]);
    expect(buildJunctionDetailMeshes(undefined, matMap)).toEqual([]);
  });

  test('does not collide with custom (rule: custom) junction rendering', () => {
    const custom = { id: 'jc', rule: 'custom', geomData: { junction_id: 'jc', vertices: [], faces: [] } };
    expect(buildJunctionDetailMeshes([custom], matMap)).toEqual([]);
  });
});
