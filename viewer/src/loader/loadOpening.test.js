import { describe, test, expect, vi } from 'vitest';

vi.mock('./loadPath.js', () => ({
  parsePath: (pathData) => {
    const pts = [pathData.segments[0].start];
    for (const seg of pathData.segments) pts.push(seg.end);
    return { points: pts };
  },
}));

import { buildOpeningOutline } from './loadOpening.js';

// South wall: runs west from (5.4,0,0) to (0,0,0)
const southWallPath = {
  id: 'path-wall-south-gf', type: 'Path', closed: false,
  segments: [{ type: 'line', start: { x: 5.4, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 } }],
};

const doorOpening = {
  id: 'opening-door-south-gf', type: 'Opening',
  host_element_id: 'element-wall-south-gf',
  path_id: 'path-wall-south-gf',
  path_position: 2.25, width_m: 0.9, height_m: 2.1, sill_height_m: 0,
};

describe('buildOpeningOutline', () => {
  test('returns Float32Array', () => {
    const { positions } = buildOpeningOutline(doorOpening, southWallPath);
    expect(positions).toBeInstanceOf(Float32Array);
  });

  test('produces 24 floats — 4 segments × 2 points × 3 components', () => {
    const { positions } = buildOpeningOutline(doorOpening, southWallPath);
    expect(positions.length).toBe(24);
  });

  test('bottom-left x is at path_position from start', () => {
    const { positions } = buildOpeningOutline(doorOpening, southWallPath);
    // Wall runs west: start x = 5.4 - path_position = 5.4 - 2.25 = 3.15
    expect(positions[0]).toBeCloseTo(3.15);
    expect(positions[1]).toBeCloseTo(0);   // y unchanged
    expect(positions[2]).toBeCloseTo(0);   // z = sill 0
  });

  test('bottom-right x is at path_position + width_m', () => {
    const { positions } = buildOpeningOutline(doorOpening, southWallPath);
    // x = 5.4 - 2.25 - 0.9 = 2.25
    expect(positions[3]).toBeCloseTo(2.25);
    expect(positions[5]).toBeCloseTo(0);   // z = sill 0
  });

  test('top corners reach sill_height_m + height_m', () => {
    const { positions } = buildOpeningOutline(doorOpening, southWallPath);
    // top-right z = positions[11] (segment 2, point 2, z)
    expect(positions[11]).toBeCloseTo(2.1);
    // top-left z = positions[17]
    expect(positions[17]).toBeCloseTo(2.1);
  });

  test('sill_height_m offsets bottom and top z', () => {
    const windowOpening = { ...doorOpening, sill_height_m: 0.9, height_m: 0.9 };
    const { positions } = buildOpeningOutline(windowOpening, southWallPath);
    expect(positions[2]).toBeCloseTo(0.9);   // bottom z
    expect(positions[11]).toBeCloseTo(1.8);  // top z = 0.9 + 0.9
  });

  test('returns correct openingId', () => {
    const { openingId } = buildOpeningOutline(doorOpening, southWallPath);
    expect(openingId).toBe('opening-door-south-gf');
  });

  test('multi-segment path: position spanning segment boundary', () => {
    const lPath = {
      id: 'l-path', type: 'Path', closed: false,
      segments: [
        { type: 'line', start: { x: 0, y: 0, z: 0 }, end: { x: 3, y: 0, z: 0 } },
        { type: 'line', start: { x: 3, y: 0, z: 0 }, end: { x: 3, y: 3, z: 0 } },
      ],
    };
    const opening = {
      id: 'o1', type: 'Opening', host_element_id: 'e1', path_id: 'l-path',
      path_position: 2.5, width_m: 1.0, height_m: 2.0, sill_height_m: 0,
    };
    const { positions } = buildOpeningOutline(opening, lPath);
    // Start: 2.5m along path — on first segment, x=2.5, y=0
    expect(positions[0]).toBeCloseTo(2.5);
    expect(positions[1]).toBeCloseTo(0);
    // End: 3.5m along path — 0.5m into second segment, x=3, y=0.5
    expect(positions[3]).toBeCloseTo(3);
    expect(positions[4]).toBeCloseTo(0.5);
  });
});
