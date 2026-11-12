/**
 * membrane.js — How membranes and tapes are drawn (issue #127; design: docs/plans/2026-11-12-membranes-design.md).
 *
 * A membrane (DPC, DPM, vapour control layer, breather membrane, tape) is a layer a fraction of a millimetre thick.
 * It keeps its real nominal thickness in the model, so quantities and the layer stack stay true, but it is drawn
 * so that it can always be seen:
 *
 *   2D (profile editor, detail editor, detail review): its outline is stroked with a heavy pen on top of every
 *   other line, so a 0.5 mm sheet reads as one heavy line at any scale.
 *   3D: its faces get the smallest depth bias (every other solid is pushed further back), so where a membrane
 *   shares a plane with another solid the membrane wins, and its outline is always shown so it is visible when
 *   its faces are thinner than a pixel.
 *
 * A layer or solid is a membrane when its function is 'membrane' or its material's category is 'membrane'.
 */

import { PEN_SERIES } from './lineweights.js';

/** Default pen for a membrane line, in millimetres at print scale. A layer's `outline_mm` overrides it. */
export const MEMBRANE_PEN_MM = 0.5;

/** Pen for a membrane line in the "thin" display mode: lighter than the default, still heavier than a hairline. */
export const MEMBRANE_THIN_PEN_MM = 0.25;

/** Ink for membrane lines in 2D and 3D: a dark shade of the membrane function colour (#6ec8c8). */
export const MEMBRANE_INK = '#1f6b6b';

/** The polygon-offset units a membrane's faces get in 3D. Every other solid gets more (buildMesh.depthBiasUnits). */
export const MEMBRANE_DEPTH_UNITS = 1;

/**
 * @param {{ function?: string, material?: { category?: string } }} [item]
 * @returns {boolean}
 */
export function isMembrane({ function: fn, material } = {}) {
  return fn === 'membrane' || material?.category === 'membrane';
}

/**
 * The pen weight of a membrane line, in millimetres: the layer's `outline_mm` when it is a pen in the series,
 * otherwise MEMBRANE_PEN_MM (MEMBRANE_THIN_PEN_MM in thin mode).
 *
 * @param {{ layer?: { outline_mm?: number }, thin?: boolean }} [opts]
 */
export function membranePenMm({ layer, thin = false } = {}) {
  if (thin) return MEMBRANE_THIN_PEN_MM;
  return PEN_SERIES.includes(layer?.outline_mm) ? layer.outline_mm : MEMBRANE_PEN_MM;
}

const r6 = (x) => Math.round(x * 1e6) / 1e6;

/**
 * Where the profile editor draws each membrane layer: a line along the middle of a band layer, or the outline
 * of a region layer. Coordinates are the profile canvas's own (x across the profile from the left face, y as
 * the canvas has it).
 *
 * @param {Array<object>} layers - profile assembly layers
 * @param {object} matMap - material id -> material
 * @param {{ stacked?: boolean, alignment?: string, planWidth?: number, wallHeight?: number }} [opts]
 *   stacked: a face-aligned slab profile, whose bands run across the canvas and whose regions are not drawn
 *   (see profileCanvas._renderStacked)
 * @returns {Array<{ index: number, closed: boolean, points: Array<{x:number,y:number}> }>}
 */
export function profileMembraneMarks(layers, matMap = {}, { stacked = false, alignment, planWidth = 1, wallHeight = 2.7 } = {}) {
  const marks = [];
  const bands = layers.filter((l) => l.type !== 'region');
  const total = r6(bands.reduce((s, l) => s + (l.thickness ?? 0), 0));
  let cursor = 0;
  layers.forEach((layer, index) => {
    const membrane = isMembrane({ function: layer.function, material: matMap[layer.material_id] });
    if (layer.type === 'region') {
      if (membrane && !stacked && Array.isArray(layer.vertices) && layer.vertices.length >= 3) {
        marks.push({ index, closed: true, points: layer.vertices.map((v) => ({ x: v.x, y: v.y })) });
      }
      return;
    }
    const t = layer.thickness ?? 0;
    const mid = r6(cursor + t / 2);
    cursor = r6(cursor + t);
    if (!membrane) return;
    if (stacked) {
      const y = alignment === 'bottom-face' ? r6(total - mid) : mid;
      marks.push({ index, closed: false, points: [{ x: 0, y }, { x: planWidth > 0 ? planWidth : 1, y }] });
    } else {
      marks.push({ index, closed: false, points: [{ x: mid, y: 0 }, { x: mid, y: wallHeight }] });
    }
  });
  return marks;
}
