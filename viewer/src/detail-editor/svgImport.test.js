import { describe, it, expect } from 'vitest';
import { svgToDetail, scaleOfSvg, pathPoints } from './svgImport.js';

const svg = (body, root = '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">') => `${root}${body}</svg>`;

describe('scaleOfSvg', () => {
  it('reads metres per user unit from the width and the viewBox', () => {
    expect(scaleOfSvg(svg(''))).toBeCloseTo(0.001);
    expect(scaleOfSvg(svg('', '<svg width="210mm" viewBox="0 0 2100 1000">'))).toBeCloseTo(0.0001);
    expect(scaleOfSvg(svg('', '<svg width="2in" viewBox="0 0 2 2">'))).toBeCloseTo(0.0254);
  });
  it('is null when the root does not say', () => {
    expect(scaleOfSvg('<svg viewBox="0 0 10 10">')).toBeNull();
    expect(scaleOfSvg('<svg width="50%" viewBox="0 0 10 10">')).toBeNull();
    expect(scaleOfSvg('not svg')).toBeNull();
  });
});

describe('pathPoints', () => {
  it('reads absolute and relative lines, H and V, and a close', () => {
    const { subs } = pathPoints('M10 10 L30 10 v20 h-20 z');
    expect(subs).toHaveLength(1);
    expect(subs[0].closed).toBe(true);
    expect(subs[0].points).toEqual([{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }, { x: 10, y: 30 }]);
  });
  it('treats extra pairs after a move as line-tos, and an open path as open', () => {
    const { subs } = pathPoints('M0 0 5 0 5 5');
    expect(subs[0].points).toHaveLength(3);
    expect(subs[0].closed).toBe(false);
  });
  it('reads a curve as a line to its end point and counts it', () => {
    const { subs, curves } = pathPoints('M0 0 C 1 2, 3 2, 4 0');
    expect(curves).toBe(1);
    expect(subs[0].points.at(-1)).toEqual({ x: 4, y: 0 });
  });
  it('starts a second subpath at each move', () => {
    expect(pathPoints('M0 0 L1 0 L1 1 Z M5 5 L6 5 L6 6 Z').subs).toHaveLength(2);
  });
});

describe('svgToDetail', () => {
  it('turns a rect into a counter-clockwise region in metres, y flipped to run up', () => {
    const r = svgToDetail(svg('<rect x="10" y="20" width="30" height="40"/>'), { scale: 0.001 });
    expect(r.regions).toHaveLength(1);
    const v = r.regions[0].vertices;
    expect(Math.min(...v.map((p) => p.x))).toBeCloseTo(0.01);
    expect(Math.max(...v.map((p) => p.y))).toBeCloseTo(-0.02);   // svg y 20 is above svg y 60
    expect(Math.min(...v.map((p) => p.y))).toBeCloseTo(-0.06);
    const area = v.reduce((s, a, i) => { const b = v[(i + 1) % v.length]; return s + a.x * b.y - b.x * a.y; }, 0);
    expect(area).toBeGreaterThan(0);
  });
  it('closed paths and polygons are regions; lines and open paths are marks; circles are circles', () => {
    const r = svgToDetail(svg(`
      <polygon points="0,0 10,0 10,10"/><path d="M0 0 L5 0 L5 5 Z"/>
      <line x1="0" y1="0" x2="10" y2="0"/><polyline points="0,0 5,5 10,0"/><path d="M0 0 L9 9"/>
      <circle cx="50" cy="50" r="5"/>`), { scale: 0.001 });
    expect(r.regions).toHaveLength(2);
    expect(r.annotations.map((a) => a.type)).toEqual(['line', 'line', 'line', 'circle']);
    expect(r.annotations[3].radius_m).toBeCloseTo(0.005);
  });
  it('uses the scale the file states over the caller\'s guess, and says which it used', () => {
    const r = svgToDetail(svg('<rect width="10" height="10"/>', '<svg width="10mm" viewBox="0 0 100 100">'), { scale: 1 });
    expect(r.scale).toBeCloseTo(0.0001);
    expect(r.scaleStated).toBe(true);
    const guess = svgToDetail('<svg><rect width="10" height="10"/></svg>', { scale: 0.001 });
    expect(guess.scaleStated).toBe(false);
    expect(guess.scale).toBe(0.001);
  });
  it('counts what it skips or approximates', () => {
    const r = svgToDetail(svg('<rect width="0" height="5"/><text x="1" y="1">hi</text><path transform="scale(2)" d="M0 0 C1 1 2 1 3 0 L3 3 Z"/>'), { scale: 0.001 });
    expect(r.skipped).toMatchObject({ rect: 1, text: 1 });
    expect(r.notes.join(' ')).toMatch(/transform/);
    expect(r.notes.join(' ')).toMatch(/curved/);
  });
  it('a self-intersecting closed shape becomes a mark, not a region', () => {
    const r = svgToDetail(svg('<polygon points="0,0 10,10 10,0 0,10"/>'), { scale: 0.001 });
    expect(r.regions).toHaveLength(0);
    expect(r.annotations).toHaveLength(1);
  });
});
