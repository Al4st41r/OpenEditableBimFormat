import { describe, it, expect } from 'vitest';
import {
  computePathLength,
  samplePathAtDistance,
} from './pathSampler.js';

const LINE = [
  { x: 0, y: 0, z: 0 },
  { x: 3, y: 0, z: 0 },
  { x: 3, y: 4, z: 0 },
];
// segment 1: length 3, segment 2: length 4, total 7

describe('computePathLength', () => {
  it('returns 0 for a single point', () => {
    expect(computePathLength([{ x: 0, y: 0, z: 0 }])).toBe(0);
  });

  it('returns 7 for the L-shaped polyline', () => {
    expect(computePathLength(LINE)).toBeCloseTo(7, 5);
  });
});

describe('samplePathAtDistance', () => {
  it('returns start point at distance 0', () => {
    const { position } = samplePathAtDistance(LINE, 0);
    expect(position).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('returns midpoint of first segment at distance 1.5', () => {
    const { position } = samplePathAtDistance(LINE, 1.5);
    expect(position.x).toBeCloseTo(1.5);
    expect(position.y).toBeCloseTo(0);
    expect(position.z).toBeCloseTo(0);
  });

  it('returns start of second segment at distance 3', () => {
    const { position } = samplePathAtDistance(LINE, 3);
    expect(position.x).toBeCloseTo(3);
    expect(position.y).toBeCloseTo(0);
    expect(position.z).toBeCloseTo(0);
  });

  it('returns midpoint of second segment at distance 5', () => {
    const { position } = samplePathAtDistance(LINE, 5);
    expect(position.x).toBeCloseTo(3);
    expect(position.y).toBeCloseTo(2);
    expect(position.z).toBeCloseTo(0);
  });

  it('clamps to end point when distance exceeds path length', () => {
    const { position } = samplePathAtDistance(LINE, 100);
    expect(position).toEqual(LINE[LINE.length - 1]);
  });

  it('returns correct tangent for first segment', () => {
    const { tangent } = samplePathAtDistance(LINE, 1);
    expect(tangent.x).toBeCloseTo(1);
    expect(tangent.y).toBeCloseTo(0);
    expect(tangent.z).toBeCloseTo(0);
  });

  it('returns correct tangent for second segment', () => {
    const { tangent } = samplePathAtDistance(LINE, 4);
    expect(tangent.x).toBeCloseTo(0);
    expect(tangent.y).toBeCloseTo(1);
    expect(tangent.z).toBeCloseTo(0);
  });
});
