import { describe, it, expect } from 'vitest';
import { addGuide, removeGuide, getGuides, clearGuides } from './profileGuidelines.js';

describe('addGuide', () => {
  it('adds a horizontal guide and returns an id', () => {
    clearGuides();
    const id = addGuide('h', 1.35);
    const guides = getGuides();
    expect(guides).toHaveLength(1);
    expect(guides[0]).toMatchObject({ id, axis: 'h', value: 1.35 });
  });

  it('adds a vertical guide', () => {
    clearGuides();
    const id = addGuide('v', 0.1);
    expect(getGuides()[0]).toMatchObject({ id, axis: 'v', value: 0.1 });
  });

  it('assigns unique ids', () => {
    clearGuides();
    const id1 = addGuide('h', 1.0);
    const id2 = addGuide('h', 2.0);
    expect(id1).not.toBe(id2);
  });
});

describe('removeGuide', () => {
  it('removes by id', () => {
    clearGuides();
    const id = addGuide('h', 0.5);
    removeGuide(id);
    expect(getGuides()).toHaveLength(0);
  });

  it('is a no-op for unknown id', () => {
    clearGuides();
    addGuide('h', 0.5);
    removeGuide('nonexistent');
    expect(getGuides()).toHaveLength(1);
  });
});

describe('getGuides', () => {
  it('returns a copy — mutations do not affect internal state', () => {
    clearGuides();
    addGuide('h', 0.5);
    const guides = getGuides();
    guides.push({ id: 'x', axis: 'h', value: 99 });
    expect(getGuides()).toHaveLength(1);
  });
});
