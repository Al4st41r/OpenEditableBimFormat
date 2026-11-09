/**
 * dxfExport.js
 *
 * A detail as an ASCII DXF drawing (AutoCAD R12, which every CAD package reads), in millimetres.
 *
 * Layers: OEBF-MEMBER-<role> for member layers, OEBF-REGION for regions (one layer per material would hide
 * which regions belong together, so the material goes in the layer name: OEBF-REGION-<material>), OEBF-MARKS for
 * annotations and OEBF-TEXT for note and dimension text. Shapes are closed polylines; hatches are not exported.
 * Dimensions are written as plain lines and text rather than DIMENSION entities, which need extra blocks.
 */

import { buildCanvasModel } from './canvasModel.js';
import { dimensionGeometry } from './annotationOps.js';

const MM = 1000;
const NOTE_HEIGHT_MM = 25;
const DIM_HEIGHT_MM = 20;

/** A DXF layer name: upper case letters, digits, dash and underscore only. */
export const layerName = (s) => String(s).toUpperCase().replace(/[^A-Z0-9_-]+/g, '_').slice(0, 60) || '0';
const f = (n) => String(Math.round(n * MM * 1e4) / 1e4);
const deg = (n) => String(Math.round(n * 1e6) / 1e6);

/** @param {object} doc - Detail  @param {{ profiles?: object, materials?: object, values?: object }} [ctx] */
export function detailToDxf(doc, ctx = {}) {
  const model = buildCanvasModel(doc, { profiles: ctx.profiles ?? {}, materials: ctx.materials ?? {}, values: ctx.values });
  const layers = new Set(['OEBF-MARKS']);
  const body = [];
  const pair = (code, value) => body.push(`${code}\n${value}`);
  const entity = (type, layer, pairs) => { layers.add(layer); pair(0, type); pair(8, layer); for (const [c, v] of pairs) pair(c, v); };

  const polyline = (layer, points, closed) => {
    entity('POLYLINE', layer, [[66, 1], [70, closed ? 1 : 0]]);
    for (const p of points) { pair(0, 'VERTEX'); pair(8, layer); pair(10, f(p.x)); pair(20, f(p.y)); }
    pair(0, 'SEQEND'); pair(8, layer);
  };
  const line = (layer, a, b) => entity('LINE', layer, [[10, f(a.x)], [20, f(a.y)], [11, f(b.x)], [21, f(b.y)]]);
  const text = (layer, at, height, value, rotation = 0) => entity('TEXT', layer, [[10, f(at.x)], [20, f(at.y)], [40, height], [1, String(value).replace(/[\r\n]+/g, ' ')], ...(rotation ? [[50, deg(rotation)]] : [])]);

  for (const p of model.primitives) {
    const layer = p.kind === 'region' ? layerName(`OEBF-REGION-${p.materialId ?? ''}`) : layerName(`OEBF-MEMBER-${p.ref.role}`);
    polyline(layer, p.points, true);
  }
  for (const { ann: a } of model.annotations) {
    if (a.type === 'line') polyline('OEBF-MARKS', a.points, false);
    else if (a.type === 'circle') entity('CIRCLE', 'OEBF-MARKS', [[10, f(a.centre.x)], [20, f(a.centre.y)], [40, f(a.radius_m)]]);
    else if (a.type === 'arc') entity('ARC', 'OEBF-MARKS', [[10, f(a.centre.x)], [20, f(a.centre.y)], [40, f(a.radius_m)], [50, deg(((a.start_deg % 360) + 360) % 360)], [51, deg(((a.end_deg % 360) + 360) % 360)]]);
    else if (a.type === 'dimension') {
      const g = dimensionGeometry(a);
      for (const e of g.extensions) line('OEBF-MARKS', e.a, e.b);
      line('OEBF-MARKS', g.line.a, g.line.b);
      let angle = g.angle * 180 / Math.PI;
      if (angle > 90) angle -= 180; else if (angle < -90) angle += 180;
      text('OEBF-TEXT', g.mid, DIM_HEIGHT_MM, String(Math.round(g.length * MM * 10) / 10), angle);
    } else {
      if (a.leader_to) line('OEBF-MARKS', a.at, a.leader_to);
      text('OEBF-TEXT', a.at, NOTE_HEIGHT_MM, a.text);
    }
  }

  const head = [
    '0\nSECTION\n2\nHEADER', '9\n$ACADVER\n1\nAC1009', '9\n$INSUNITS\n70\n4', '0\nENDSEC',
    '0\nSECTION\n2\nTABLES',
    '0\nTABLE\n2\nLTYPE\n70\n1', '0\nLTYPE\n2\nCONTINUOUS\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0', '0\nENDTAB',
    `0\nTABLE\n2\nLAYER\n70\n${layers.size}`,
    ...[...layers].map((l) => `0\nLAYER\n2\n${l}\n70\n0\n62\n7\n6\nCONTINUOUS`),
    '0\nENDTAB', '0\nENDSEC',
    '0\nSECTION\n2\nENTITIES',
  ];
  return [...head, ...body, '0\nENDSEC', '0\nEOF'].join('\n') + '\n';
}
