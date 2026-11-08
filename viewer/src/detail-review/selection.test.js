import { describe, it, expect, vi } from 'vitest';
import { createSelection, describeItem } from './selection.js';

describe('selection', () => {
  it('notifies subscribers with the id and source, and ignores a repeat', () => {
    const s = createSelection();
    const fn = vi.fn();
    s.subscribe(fn);
    expect(s.set('item-1', '2d')).toBe(true);
    expect(fn).toHaveBeenCalledWith('item-1', '2d');
    expect(s.set('item-1', '3d')).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('toggles and clears', () => {
    const s = createSelection();
    s.toggle('a');
    expect(s.get()).toBe('a');
    s.toggle('a');
    expect(s.get()).toBeNull();
    s.set('b'); s.set(undefined);
    expect(s.get()).toBeNull();
  });
  it('can unsubscribe', () => {
    const s = createSelection();
    const fn = vi.fn();
    const off = s.subscribe(fn);
    off();
    s.set('x');
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('describeItem', () => {
  const prism = { id: 'item-2', kind: 'member', role: 'through-wall', layer: 3, function: 'insulation', materialId: 'm',
    points: [{ x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 0.1, y: 0.5 }, { x: 0, y: 0.5 }] };
  it('names the material and size in millimetres', () => {
    const d = describeItem(prism, { materials: new Map([['m', { name: 'Mineral wool', category: 'insulation' }]]) });
    expect(d).toMatchObject({ id: 'item-2', name: 'Mineral wool', category: 'insulation', function: 'insulation', sizeMm: { width: 100, height: 500 } });
    expect(d.source).toContain('through-wall');
  });
  it('copes with a missing material and null', () => {
    expect(describeItem(prism).name).toBe('m');
    expect(describeItem(null)).toBeNull();
  });
});
