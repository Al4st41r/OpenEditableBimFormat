import { describe, test, expect } from 'vitest';
import { readPairs, parseDxf, dxfToDetail, scaleFromUnits } from './dxfImport.js';
import { detailToDxf } from './dxfExport.js';
import { signedArea } from '../detail/regionGeometry.js';
import { addAnnotation } from './annotationOps.js';
import { exampleDetail, readExample } from './testUtils.js';

const dxf = (entities, header = '') => `0\nSECTION\n2\nHEADER\n${header}0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`;
const ent = (type, pairs, layer = '0') => `0\n${type}\n8\n${layer}\n${pairs.map(([c, v]) => `${c}\n${v}\n`).join('')}`;
const run = (text, scale = 0.001) => dxfToDetail(parseDxf(text).entities, { scale });

describe('parsing', () => {
  test('reads group pairs, ignoring a trailing odd line and CRLF', () => {
    expect(readPairs('0\r\nLINE\r\n8\r\nA\r\n9')).toEqual([[0, 'LINE'], [8, 'A']]);
  });
  test('reads the drawing units and only the ENTITIES section', () => {
    const t = dxf(ent('LINE', [[10, 0], [20, 0], [11, 1], [21, 1]]), '9\n$INSUNITS\n70\n4\n');
    const p = parseDxf(t);
    expect(p.units).toBe(4);
    expect(p.entities).toHaveLength(1);
    expect(scaleFromUnits(4)).toBe(0.001);
    expect(scaleFromUnits(6)).toBe(1);
    expect(scaleFromUnits(99)).toBeNull();
  });
  test('joins POLYLINE, VERTEX and SEQEND into one entity', () => {
    const t = dxf(ent('POLYLINE', [[66, 1], [70, 1]]) + ent('VERTEX', [[10, 0], [20, 0]]) + ent('VERTEX', [[10, 100], [20, 0]]) + ent('VERTEX', [[10, 100], [20, 50]]) + ent('SEQEND', []));
    const e = parseDxf(t).entities;
    expect(e).toHaveLength(1);
    expect(e[0].points).toHaveLength(3);
  });
  test('garbage text gives no entities rather than throwing', () => {
    expect(parseDxf('hello\nworld').entities).toEqual([]);
    expect(parseDxf('').entities).toEqual([]);
  });
});

describe('converting', () => {
  test('lines, arcs, circles and text become marks, scaled to metres', () => {
    const r = run(dxf(
      ent('LINE', [[10, 0], [20, 0], [11, 1000], [21, 0]]) + ent('ARC', [[10, 0], [20, 0], [40, 500], [50, 0], [51, 90]]) +
      ent('CIRCLE', [[10, 100], [20, 100], [40, 50]]) + ent('TEXT', [[10, 10], [20, 20], [40, 25], [1, 'DPC']]),
    ));
    expect(r.annotations.map((a) => a.type)).toEqual(['line', 'arc', 'circle', 'note']);
    expect(r.annotations[0].points[1]).toEqual({ x: 1, y: 0 });
    expect(r.annotations[1]).toMatchObject({ radius_m: 0.5, start_deg: 0, end_deg: 90 });
    expect(r.annotations[3]).toMatchObject({ text: 'DPC', at: { x: 0.01, y: 0.02 } });
  });
  test('a closed polyline is a counter-clockwise region; an open one is a line mark', () => {
    const sq = (flag, pts) => ent('LWPOLYLINE', [[90, pts.length], [70, flag], ...pts.flatMap(([x, y]) => [[10, x], [20, y]])]);
    const r = run(dxf(sq(1, [[0, 0], [0, 100], [100, 100], [100, 0]]) + sq(0, [[0, 0], [50, 0], [50, 50]])));   // the square is drawn clockwise
    expect(r.regions).toHaveLength(1);
    const v = r.regions[0].vertices;
    expect(v).toHaveLength(4);
    expect(signedArea(v)).toBeGreaterThan(0);                           // drawn clockwise, stored anticlockwise
    expect(r.annotations).toHaveLength(1);
    expect(r.annotations[0].points).toHaveLength(3);
  });
  test('a self-crossing closed shape and a bowed polyline degrade safely', () => {
    const bow = ent('LWPOLYLINE', [[90, 4], [70, 1], [10, 0], [20, 0], [10, 100], [20, 100], [10, 100], [20, 0], [10, 0], [20, 100]]);
    const r = run(dxf(bow));
    expect(r.regions).toHaveLength(0);
    expect(r.annotations).toHaveLength(1);                                // kept as a line
    const curved = ent('LWPOLYLINE', [[90, 3], [70, 1], [10, 0], [20, 0], [42, 0.5], [10, 100], [20, 0], [10, 100], [20, 100]]);
    expect(run(dxf(curved)).notes[0]).toMatch(/curved/);
  });
  test('unknown entities, degenerate shapes and empty text are counted, not read', () => {
    const r = run(dxf(
      ent('HATCH', []) + ent('LINE', [[10, 0], [20, 0], [11, 0], [21, 0]]) + ent('CIRCLE', [[10, 0], [20, 0], [40, 0]]) +
      ent('ARC', [[10, 0], [20, 0], [40, 5], [50, 0], [51, 360]]) + ent('TEXT', [[10, 0], [20, 0], [1, '  ']]) + ent('SPLINE', []),
    ));
    expect(r.annotations).toEqual([]);
    expect(r.skipped).toMatchObject({ HATCH: 1, LINE: 1, CIRCLE: 1, ARC: 1, TEXT: 1, SPLINE: 1 });
  });
  test('MTEXT formatting codes and paragraph breaks are cleaned', () => {
    const r = run(dxf(ent('MTEXT', [[10, 0], [20, 0], [1, '{\\fArial|b1;Cavity\\Ptray}']])));
    expect(r.annotations[0].text).toBe('Cavity tray');
  });
});

describe('round trip with the exporter', () => {
  test('what the editor exports reads back as the same marks and shapes, in metres', () => {
    let d = exampleDetail();
    d = addAnnotation(d, { type: 'line', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] });
    d = addAnnotation(d, { type: 'arc', centre: { x: 2, y: 2 }, radius_m: 0.5, start_deg: 10, end_deg: 100 });
    d = addAnnotation(d, { type: 'circle', centre: { x: 3, y: 3 }, radius_m: 0.1 });
    d = addAnnotation(d, { type: 'note', at: { x: 0.5, y: 0.5 }, text: 'DPC lapped' });
    const text = detailToDxf(d, { profiles: { 'profile-cavity-250': readExample('profiles/profile-cavity-250.json') } });
    const parsed = parseDxf(text);
    expect(parsed.units).toBe(4);
    const r = dxfToDetail(parsed.entities, { scale: scaleFromUnits(parsed.units) });
    const types = r.annotations.map((a) => a.type);
    expect(types).toEqual(expect.arrayContaining(['line', 'arc', 'circle', 'note']));
    expect(r.annotations.find((a) => a.type === 'arc')).toMatchObject({ centre: { x: 2, y: 2 }, radius_m: 0.5, start_deg: 10, end_deg: 100 });
    expect(r.annotations.find((a) => a.type === 'circle').radius_m).toBe(0.1);
    expect(r.annotations.find((a) => a.type === 'note').text).toBe('DPC lapped');
    expect(r.regions.length).toBeGreaterThan(4);                          // members and regions come back as closed shapes
    expect(Object.keys(r.skipped)).toEqual([]);
  });
});
