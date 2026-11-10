import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { fatSegments } from './fatLine.js';

describe('fatSegments', () => {
  const pts = [0, 0, 0, 4, 0, 0, 4, 0, 0, 4, 3, 0];

  it('makes one instance per segment, with the width in pixels', () => {
    const line = fatSegments(pts, { color: 0xff0000, widthPx: 2 });
    expect(line.geometry.instanceCount).toBe(2);
    expect(line.material.linewidth).toBe(2);
    expect(line.material.worldUnits).toBe(false);
    expect(line.material.dashed).toBe(false);
  });

  it('a dashed line has distances along it, so the dashes run the length of the line', () => {
    const line = fatSegments([0, 0, 0, 10, 0, 0], { color: 0xff0000, dash: 0.5, gap: 0.25 });
    expect(line.material.dashed).toBe(true);
    expect(line.material.dashSize).toBe(0.5);
    expect(line.geometry.getAttribute('instanceDistanceEnd').getX(0)).toBeCloseTo(10);
  });

  it('draws over the model, in front of it, without depth testing (as the thin lines did)', () => {
    const line = fatSegments(pts, { color: 0 });
    expect(line.material.depthTest).toBe(false);
    expect(line.renderOrder).toBe(1);
  });

  it('takes its resolution from the renderer when it is drawn, so a resize needs nothing', () => {
    const line = fatSegments(pts, { color: 0 });
    line.onBeforeRender({ getDrawingBufferSize: (v) => v.set(1600, 900) });
    expect(line.material.resolution.toArray()).toEqual([1600, 900]);
    expect(line.material.resolution).toBeInstanceOf(THREE.Vector2);
  });
});
