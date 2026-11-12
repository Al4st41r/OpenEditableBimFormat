import { describe, it, expect } from 'vitest';
import { svgToDetail, scaleOfSvg, pathPoints, parseTransform, applyMatrix, arcCentre } from './svgImport.js';

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
  it('flattens a cubic curve to points on it, ending at its end point, and counts it', () => {
    const { subs, curves } = pathPoints('M0 0 C 0 3, 4 3, 4 0', { tolerance: 0.01 });
    expect(curves).toBe(1);
    const pts = subs[0].points;
    expect(pts.length).toBeGreaterThan(8);
    expect(pts.at(-1)).toEqual({ x: 4, y: 0 });
    const mid = pts.reduce((best, p) => (Math.abs(p.x - 2) < Math.abs(best.x - 2) ? p : best));
    expect(mid.y).toBeCloseTo(2.25, 1);                    // the curve's top, at t = 0.5
    expect(pathPoints('M0 0 C 0 3, 4 3, 4 0', { tolerance: 1 }).subs[0].points.length).toBeLessThan(pts.length);   // coarser
  });
  it('reflects the control point for S and T, and reads relative quadratics', () => {
    const s = pathPoints('M0 0 C0 1 1 1 1 0 S2 -1 2 0', { tolerance: 0.001 }).subs[0].points;
    expect(Math.min(...s.map((p) => p.y))).toBeLessThan(-0.5);   // the S half dips below
    const q = pathPoints('M0 0 q1 2 2 0 t2 0', { tolerance: 0.001 }).subs[0].points;
    expect(q.at(-1)).toEqual({ x: 4, y: 0 });
    expect(Math.max(...q.map((p) => p.y))).toBeCloseTo(1, 2);
    expect(Math.min(...q.map((p) => p.y))).toBeCloseTo(-1, 2);
  });
  it('flattens an elliptical arc onto its ellipse and keeps a single circular arc exact', () => {
    const { subs } = pathPoints('M10 0 A10 10 0 0 1 -10 0');
    for (const p of subs[0].points) expect(Math.hypot(p.x, p.y)).toBeCloseTo(10, 6);
    expect(subs[0].arc.centre.x).toBeCloseTo(0);
    expect(subs[0].arc.r).toBeCloseTo(10);
    expect(pathPoints('M10 0 A10 10 0 0 1 -10 0 L0 -5').subs[0].arc).toBeUndefined();
    expect(pathPoints('M10 0 A10 5 0 0 1 -10 0').subs[0].arc).toBeUndefined();   // elliptical: flattened only
  });
  it('reads arc flags written run together', () => {
    const { subs } = pathPoints('M0 0a5 5 0 105 5');   // flags 1 and 0, then 5 5
    expect(subs[0].points.at(-1)).toEqual({ x: 5, y: 5 });
  });
  it('stops at a command that runs out of numbers', () => {
    const { subs } = pathPoints('M0 0 L5 0 C1 1 2');
    expect(subs[0].points).toEqual([{ x: 0, y: 0 }, { x: 5, y: 0 }]);
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
    const r = svgToDetail(svg('<rect width="10" height="10"/>', '<svg width="10mm" viewBox="0 0 100 100">', '<svg>'), { scale: 1 });
    expect(r.scale).toBeCloseTo(0.0001);
    expect(r.scaleStated).toBe(true);
    const guess = svgToDetail('<svg><rect width="10" height="10"/></svg>', { scale: 0.001 });
    expect(guess.scaleStated).toBe(false);
    expect(guess.scale).toBe(0.001);
  });
  it('counts what it skips or approximates', () => {
    const r = svgToDetail(svg('<rect width="0" height="5"/><text x="1" y="1">hi</text><use href="#a"/><path d="M0 0 C1 1 2 1 3 0 L3 3 Z"/>'), { scale: 0.001 });
    expect(r.skipped).toMatchObject({ rect: 1, text: 1, use: 1 });
    expect(r.notes.join(' ')).toMatch(/1 curve\(s\) were drawn as short straight segments/);
  });
  it('applies transforms on the element and on the groups around it', () => {
    const r = svgToDetail(svg('<g transform="translate(100 0)"><g transform="scale(2)"><rect x="0" y="0" width="10" height="5" transform="translate(1,1)"/></g></g>'), { scale: 0.001 });
    const v = r.regions[0].vertices;
    expect(Math.min(...v.map((p) => p.x))).toBeCloseTo(0.102);   // (0 + 1) * 2 + 100
    expect(Math.max(...v.map((p) => p.x))).toBeCloseTo(0.122);
    expect(Math.max(...v.map((p) => p.y))).toBeCloseTo(-0.002);
    expect(Math.min(...v.map((p) => p.y))).toBeCloseTo(-0.012);
    expect(r.notes).toEqual([]);
  });
  it('a group transform ends with its group', () => {
    const r = svgToDetail(svg('<g transform="translate(50 0)"><line x1="0" y1="0" x2="1" y2="0"/></g><line x1="0" y1="0" x2="1" y2="0"/>', '<svg>'), { scale: 1 });
    expect(r.annotations.map((a) => a.points[0].x)).toEqual([50, 0]);
  });
  it('a rotated rect becomes a rotated region', () => {
    const r = svgToDetail(svg('<rect width="10" height="10" transform="rotate(45)"/>', '<svg>'), { scale: 1 });
    const v = r.regions[0].vertices;
    expect(Math.max(...v.map((p) => p.x))).toBeCloseTo(Math.SQRT2 * 5, 6);
    expect(Math.min(...v.map((p) => p.x))).toBeCloseTo(-Math.SQRT2 * 5, 6);
  });
  it('a circle scaled evenly stays a circle; stretched, it becomes a closed line', () => {
    const even = svgToDetail(svg('<circle cx="10" cy="10" r="5" transform="scale(2)"/>'), { scale: 0.001 });
    expect(even.annotations[0]).toMatchObject({ type: 'circle', centre: { x: 0.02, y: -0.02 }, radius_m: 0.01 });
    const odd = svgToDetail(svg('<circle r="5" transform="scale(2 1)"/><ellipse rx="4" ry="2"/>'), { scale: 0.001 });
    expect(odd.annotations.map((a) => a.type)).toEqual(['line', 'line']);
    expect(Math.max(...odd.annotations[0].points.map((p) => p.x))).toBeCloseTo(0.01);
    expect(odd.notes.join(' ')).toMatch(/2 ellipse/);
  });
  it('an open single circular arc in a path becomes an exact arc mark, anticlockwise after the y flip', () => {
    // in SVG (y down) this runs from (10, 0) through (0, 10) to (-10, 0): the lower half once y is flipped
    const r = svgToDetail(svg('<path d="M10 0 A10 10 0 0 1 -10 0"/>', '<svg>'), { scale: 1 });
    expect(r.annotations).toEqual([{ type: 'arc', centre: { x: 0, y: 0 }, radius_m: 10, start_deg: 180, end_deg: 0 }]);
    expect(r.notes).toEqual([]);
    const mirrored = svgToDetail(svg('<path transform="scale(-1 1)" d="M10 0 A10 10 0 0 1 -10 0"/>', '<svg>'), { scale: 1 });
    expect(mirrored.annotations[0]).toMatchObject({ start_deg: 180, end_deg: 0 });   // still the lower half
  });
  it('skips what is inside defs, and comments', () => {
    const r = svgToDetail(svg('<defs><rect width="5" height="5"/></defs><!-- <rect width="5" height="5"/> --><clipPath id="c"><rect width="1" height="1"/></clipPath>', '<svg>'), { scale: 1 });
    expect(r.regions).toHaveLength(0);
  });
  it('a self-intersecting closed shape becomes a mark, not a region', () => {
    const r = svgToDetail(svg('<polygon points="0,0 10,10 10,0 0,10"/>'), { scale: 0.001 });
    expect(r.regions).toHaveLength(0);
    expect(r.annotations).toHaveLength(1);
  });
});

describe('parseTransform', () => {
  const at = (t, p) => applyMatrix(parseTransform(t).matrix, p);
  it('reads each function and applies a list right to left', () => {
    expect(at('translate(5)', { x: 1, y: 1 })).toEqual({ x: 6, y: 1 });
    expect(at('scale(2, 3)', { x: 1, y: 1 })).toEqual({ x: 2, y: 3 });
    const r = at('rotate(90 10 10)', { x: 20, y: 10 });
    expect(r.x).toBeCloseTo(10); expect(r.y).toBeCloseTo(20);
    expect(at('matrix(1 0 0 1 3 4)', { x: 0, y: 0 })).toEqual({ x: 3, y: 4 });
    expect(at('translate(10,0) scale(2)', { x: 1, y: 0 })).toEqual({ x: 12, y: 0 });   // scale first, then translate
    expect(at('skewX(45)', { x: 0, y: 1 }).x).toBeCloseTo(1);
  });
  it('flags what it cannot read', () => {
    expect(parseTransform('translate(1 2 3)').bad).toBe(true);
    expect(parseTransform('perspective(2)').bad).toBe(true);
    expect(parseTransform('translate(1 2)').bad).toBe(false);
  });
});

describe('arcCentre', () => {
  it('finds the centre for each choice of the flags', () => {
    const p0 = { x: 0, y: 0 }, p1 = { x: 10, y: 0 };
    const a = arcCentre(p0, p1, 10, 10, 0, false, true);
    const b = arcCentre(p0, p1, 10, 10, 0, true, true);
    expect(a.cx).toBeCloseTo(5); expect(b.cx).toBeCloseTo(5);
    expect(Math.sign(a.cy)).toBe(-Math.sign(b.cy));
    expect(Math.abs(a.delta)).toBeLessThan(Math.PI);
    expect(Math.abs(b.delta)).toBeGreaterThan(Math.PI);
  });
  it('scales radii that are too small up to fit, and treats a zero radius as a line', () => {
    const a = arcCentre({ x: 0, y: 0 }, { x: 10, y: 0 }, 1, 1, 0, false, true);
    expect(a.rx).toBeCloseTo(5);
    expect(arcCentre({ x: 0, y: 0 }, { x: 10, y: 0 }, 0, 5, 0, false, true)).toBeNull();
  });
});
