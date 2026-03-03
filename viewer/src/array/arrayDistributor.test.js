import { describe, it, expect } from 'vitest';
import {
  computeInstanceCount,
  computeInstanceDistances,
} from './arrayDistributor.js';

// Helper: array definition factory
const def = (mode, opts = {}) => ({
  mode,
  spacing: opts.spacing ?? 1.0,
  count: opts.count ?? null,
  start_offset: opts.start_offset ?? 0,
  end_offset: opts.end_offset ?? 0,
});

describe('computeInstanceCount', () => {
  describe('spacing mode', () => {
    it('places 6 posts on a 5 m path at 1 m spacing', () => {
      expect(computeInstanceCount(def('spacing', { spacing: 1 }), 5)).toBe(6);
    });

    it('places 4 posts on a 5.4 m path at 1.8 m spacing', () => {
      // 5.4 / 1.8 = 3, floor(3) + 1 = 4
      expect(computeInstanceCount(def('spacing', { spacing: 1.8 }), 5.4)).toBe(4);
    });

    it('respects start_offset', () => {
      // usable = 5 - 1 = 4, 4 / 1 = 4, +1 = 5
      expect(computeInstanceCount(def('spacing', { spacing: 1, start_offset: 1 }), 5)).toBe(5);
    });

    it('respects end_offset', () => {
      // usable = 5 - 0.5 = 4.5, floor(4.5) + 1 = 5
      expect(computeInstanceCount(def('spacing', { spacing: 1, end_offset: 0.5 }), 5)).toBe(5);
    });

    it('returns 0 when usable length is 0', () => {
      expect(computeInstanceCount(def('spacing', { spacing: 1, start_offset: 3, end_offset: 3 }), 5)).toBe(0);
    });
  });

  describe('count mode', () => {
    it('returns the exact count from the definition', () => {
      expect(computeInstanceCount(def('count', { count: 7 }), 10)).toBe(7);
    });
  });

  describe('fill mode', () => {
    it('fills 5 m with 1 m spacing → 5 instances (no +1)', () => {
      expect(computeInstanceCount(def('fill', { spacing: 1 }), 5)).toBe(5);
    });
  });
});

describe('computeInstanceDistances', () => {
  it('spacing mode: first instance at start_offset', () => {
    const distances = computeInstanceDistances(def('spacing', { spacing: 2, start_offset: 0.5 }), 10);
    expect(distances[0]).toBeCloseTo(0.5);
    expect(distances[1]).toBeCloseTo(2.5);
  });

  it('count mode: evenly spaced including both endpoints', () => {
    const distances = computeInstanceDistances(def('count', { count: 3 }), 6);
    expect(distances).toHaveLength(3);
    expect(distances[0]).toBeCloseTo(0);
    expect(distances[1]).toBeCloseTo(3);
    expect(distances[2]).toBeCloseTo(6);
  });

  it('count mode with single instance: placed at start_offset', () => {
    const distances = computeInstanceDistances(def('count', { count: 1, start_offset: 1 }), 10);
    expect(distances).toHaveLength(1);
    expect(distances[0]).toBeCloseTo(1);
  });

  it('returns empty array when count is 0', () => {
    const distances = computeInstanceDistances(
      def('spacing', { spacing: 1, start_offset: 5, end_offset: 5 }),
      5,
    );
    expect(distances).toHaveLength(0);
  });
});
