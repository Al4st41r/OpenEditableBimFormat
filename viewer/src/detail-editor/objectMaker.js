/**
 * objectMaker.js — Pure logic for the object maker: building a multi-part Symbol (a screw, a brick tie, a cavity tray).
 *
 * A Symbol's parts are boxes and cylinders in the symbol's frame (x along the wall, y across it, z up, origin at the
 * centre of the bottom face); each can have its own material. The maker works in millimetres and writes metres.
 * No DOM, so it is unit-testable.
 */

import { symbolParts } from '../loader/symbolParts.js';

export const IFC_CLASSES = ['IfcMechanicalFastener', 'IfcDiscreteAccessory', 'IfcBuildingElementProxy'];
export const SHAPES = ['box', 'cylinder'];
export const AXES = ['x', 'y', 'z'];

const MM = 1000;
const r = (v) => Math.round(v * 1e6) / 1e6;
const mm = (v) => r(v / MM);

export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** A free `symbol-<name>` id. */
export function nextSymbolId(name, existingIds = []) {
  const base = `symbol-${slug(name)}`;
  const taken = new Set(existingIds);
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** A part as the maker's form holds it: millimetres. */
export function blankPart(shape = 'box') {
  return shape === 'cylinder'
    ? { shape, name: '', material_id: '', axis: 'y', radius_mm: 2, length_mm: 100, offset_mm: { x: 0, y: 0, z: 0 } }
    : { shape, name: '', material_id: '', size_mm: { x: 10, y: 10, z: 10 }, offset_mm: { x: 0, y: 0, z: 5 } };
}

/** A form part from a stored part (metres) and back. */
export function toFormPart(part) {
  const o = part.offset_m ?? { x: 0, y: 0, z: 0 };
  const base = { shape: part.shape, name: part.name ?? '', material_id: part.material_id ?? '', offset_mm: { x: o.x * MM, y: o.y * MM, z: o.z * MM } };
  return part.shape === 'cylinder'
    ? { ...base, axis: part.axis ?? 'z', radius_mm: part.radius_m * MM, length_mm: part.length_m * MM }
    : { ...base, size_mm: { x: part.size_m.x * MM, y: part.size_m.y * MM, z: part.size_m.z * MM } };
}

export function fromFormPart(p) {
  const out = { ...(p.name && { name: p.name }), shape: p.shape, ...(p.material_id && { material_id: p.material_id }), offset_m: { x: mm(p.offset_mm.x), y: mm(p.offset_mm.y), z: mm(p.offset_mm.z) } };
  if (p.shape === 'cylinder') return { ...out, axis: p.axis ?? 'z', radius_m: mm(p.radius_mm), length_m: mm(p.length_mm) };
  return { ...out, size_m: { x: mm(p.size_mm.x), y: mm(p.size_mm.y), z: mm(p.size_mm.z) } };
}

/** The form parts of a symbol being edited (a plain box symbol becomes one box part). */
export function formPartsOf(symbol) {
  return symbolParts(symbol).map(toFormPart);
}

/** Problems that stop a symbol being saved; empty when it is fine. */
export function symbolProblems({ name, id, parts }, { materialIds = [], existingIds = [], editing = false } = {}) {
  const out = [];
  if (!String(name ?? '').trim() || !slug(name ?? '')) out.push('Give the object a name.');
  if (!editing && existingIds.includes(id)) out.push(`"${id}" already exists.`);
  if (!parts.length) out.push('Add at least one part.');
  parts.forEach((p, i) => {
    const label = p.name || `Part ${i + 1}`;
    const nums = p.shape === 'cylinder' ? [p.radius_mm, p.length_mm] : [p.size_mm?.x, p.size_mm?.y, p.size_mm?.z];
    if (nums.some((n) => !(n > 0))) out.push(`${label}: every size must be greater than zero.`);
    if (p.material_id && materialIds.length && !materialIds.includes(p.material_id)) out.push(`${label}: material "${p.material_id}" is not in the library.`);
  });
  return out;
}

/** The Symbol entity to write. `existing` keeps fields the maker does not edit. */
export function buildSymbol({ id, name, description, ifcClass, parts }, existing = {}) {
  const { parameters: _p, ...rest } = existing;
  return {
    ...rest,
    $schema: 'oebf://schema/0.1/symbol', id, type: 'Symbol',
    description: description?.trim() || name.trim(),
    ifc_type: ifcClass, geometry_definition: 'parts', parameters: existing.parameters ?? {},
    parts: parts.map(fromFormPart),
  };
}

// ── preview ──────────────────────────────────────────────────────────────────

/** [x0, y0, x1, y1] of a part in a view, in mm, or a circle { cx, cy, r }. `view` is 'front' (x across, z up) or 'side' (y across, z up). */
function shapeInView(p, view) {
  const h = view === 'front' ? 'x' : 'y';          // the horizontal axis of this view
  const o = p.offset_mm;
  if (p.shape === 'box') {
    const w = p.size_mm[h], t = p.size_mm.z;
    return { rect: [o[h] - w / 2, o.z - t / 2, o[h] + w / 2, o.z + t / 2] };
  }
  const axis = p.axis ?? 'z', rad = p.radius_mm, len = p.length_mm;
  const lineOfSight = h === 'x' ? 'y' : 'x';
  if (axis === lineOfSight) {
    // the cylinder points along the axis we are looking down: a circle
    return { circle: { cx: o[h], cy: o.z, r: rad } };
  }
  if (axis === 'z') return { rect: [o[h] - rad, o.z - len / 2, o[h] + rad, o.z + len / 2] };
  return { rect: [o[h] - len / 2, o.z - rad, o[h] + len / 2, o.z + rad] };   // along the horizontal axis of this view
}

/**
 * Two small SVG elevations of the parts, front (looking along y) and side (looking along x), z up, drawn to a common
 * scale in millimetres. A cylinder along the line of sight is a circle.
 *
 * @param {object[]} parts - form parts (millimetres)
 * @param {(materialId: string) => string|undefined} [colourOf]
 * @returns {{ front: string, side: string }} SVG markup
 */
export function previewSvg(parts, colourOf = () => undefined) {
  const views = { front: parts.map((p) => shapeInView(p, 'front')), side: parts.map((p) => shapeInView(p, 'side')) };
  const xs = [], zs = [];
  for (const shapes of Object.values(views)) for (const s of shapes) {
    if (s.rect) { xs.push(s.rect[0], s.rect[2]); zs.push(s.rect[1], s.rect[3]); }
    else { xs.push(s.circle.cx - s.circle.r, s.circle.cx + s.circle.r); zs.push(s.circle.cy - s.circle.r, s.circle.cy + s.circle.r); }
  }
  if (!xs.length) return { front: '', side: '' };
  const pad = 4;   // mm of margin round the parts
  const draw = (shapes) => {
    const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, z0 = Math.min(...zs) - pad, z1 = Math.max(...zs) + pad;
    const body = shapes.map((s, i) => {
      const fill = colourOf(parts[i].material_id) ?? '#9aa3ab';
      const style = `fill="${fill}" fill-opacity="0.7" stroke="#222" stroke-width="${Math.max(x1 - x0, z1 - z0) / 300}"`;
      if (s.circle) return `<circle cx="${r(s.circle.cx)}" cy="${r(-s.circle.cy)}" r="${r(s.circle.r)}" ${style}/>`;
      const [ax, az, bx, bz] = s.rect;
      return `<rect x="${r(ax)}" y="${r(-bz)}" width="${r(bx - ax)}" height="${r(bz - az)}" ${style}/>`;
    }).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r(x0)} ${r(-z1)} ${r(x1 - x0)} ${r(z1 - z0)}" preserveAspectRatio="xMidYMid meet">${body}</svg>`;
  };
  return { front: draw(views.front), side: draw(views.side) };
}
