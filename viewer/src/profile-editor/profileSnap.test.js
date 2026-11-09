import { describe, test, expect } from 'vitest';
import { snapTargets, snapToTargets } from './profileSnap.js';

const wall = [
  { name: 'Brick', thickness: 0.102 },
  { name: 'Cavity', thickness: 0.05 },
  { name: 'Block', thickness: 0.1 },
];

describe('snapTargets', () => {
  test('a wall has a face and a centre for each layer along x', () => {
    const t = snapTargets(wall);
    expect(t.x.map((a) => a.value)).toEqual([0, 0.102, 0.051, 0.102, 0.152, 0.127, 0.152, 0.252, 0.202]);
    expect(t.x.find((a) => a.value === 0.127).label).toBe('centre of Cavity');
    expect(t.y).toEqual([]);
  });
  test('a stacked slab runs its layers down y; a bottom-face slab counts up from the bottom', () => {
    const slab = [{ name: 'Screed', thickness: 0.05 }, { name: 'Deck', thickness: 0.15 }];
    expect(snapTargets(slab, { stacked: true, planWidth: 1 }).y.map((a) => a.value)).toEqual([0, 0.05, 0.025, 0.05, 0.2, 0.125]);
    expect(snapTargets(slab, { stacked: true, alignment: 'bottom-face' }).y.map((a) => a.value)).toEqual([0.15, 0.2, 0.175, 0, 0.15, 0.075]);
  });
  test('region corners are targets on both axes', () => {
    const t = snapTargets([{ type: 'region', name: 'Trim', vertices: [{ x: 0.01, y: 0.2 }, { x: 0.05, y: 0.4 }] }]);
    expect(t.x.map((a) => a.value)).toEqual([0.01, 0.05]);
    expect(t.y.map((a) => a.value)).toEqual([0.2, 0.4]);
  });
});

describe('snapToTargets', () => {
  const targets = snapTargets(wall).x;
  test('snaps to the nearest target within tolerance', () => {
    const r = snapToTargets(0.1285, targets, 0.003);
    expect(r.value).toBe(0.127);
    expect(r.target.label).toBe('centre of Cavity');
  });
  test('leaves the value alone outside tolerance', () => {
    expect(snapToTargets(0.1, targets, 0.0005).value).toBe(0.1);
    expect(snapToTargets(0.17, targets, 0.003).target).toBeNull();
  });
});
