import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  makeGeometryKey,
  getCachedGeometry,
  setCachedGeometry,
  clearGeometryCache,
  getCacheStats,
} from './geometryCache.js';

beforeEach(() => {
  clearGeometryCache();
});

describe('makeGeometryKey', () => {
  it('produces a stable string key', () => {
    const key = makeGeometryKey('profile-cavity-250', 5.4, 'perpendicular');
    expect(key).toBe('profile-cavity-250:5.4000:perpendicular');
  });

  it('rounds path length to 4 decimal places', () => {
    const key = makeGeometryKey('p', 1.23456789, 'fixed');
    expect(key).toBe('p:1.2346:fixed');
  });
});

describe('getCachedGeometry / setCachedGeometry', () => {
  it('returns null for a cache miss', () => {
    expect(getCachedGeometry('missing:0.0000:perpendicular')).toBeNull();
  });

  it('returns the stored geometry on cache hit', () => {
    const geom = new THREE.BufferGeometry();
    const key = makeGeometryKey('p', 1, 'perpendicular');
    setCachedGeometry(key, geom);
    expect(getCachedGeometry(key)).toBe(geom);
  });

  it('stores independent entries for different keys', () => {
    const g1 = new THREE.BufferGeometry();
    const g2 = new THREE.BufferGeometry();
    const k1 = makeGeometryKey('p', 1, 'perpendicular');
    const k2 = makeGeometryKey('p', 2, 'perpendicular');
    setCachedGeometry(k1, g1);
    setCachedGeometry(k2, g2);
    expect(getCachedGeometry(k1)).toBe(g1);
    expect(getCachedGeometry(k2)).toBe(g2);
  });
});

describe('clearGeometryCache', () => {
  it('removes all entries', () => {
    const key = makeGeometryKey('p', 1, 'perpendicular');
    setCachedGeometry(key, new THREE.BufferGeometry());
    clearGeometryCache();
    expect(getCachedGeometry(key)).toBeNull();
  });
});

describe('getCacheStats', () => {
  it('reports size 0 when empty', () => {
    expect(getCacheStats().size).toBe(0);
  });

  it('reports correct size after insertions', () => {
    setCachedGeometry(makeGeometryKey('p', 1, 'perpendicular'), new THREE.BufferGeometry());
    setCachedGeometry(makeGeometryKey('p', 2, 'perpendicular'), new THREE.BufferGeometry());
    expect(getCacheStats().size).toBe(2);
  });
});
