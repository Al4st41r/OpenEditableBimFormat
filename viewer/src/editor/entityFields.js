/**
 * entityFields.js — pure description of the editable fields of each entity,
 * with parsing, validation and the path / storey helpers the properties panel
 * needs (#83). No DOM, so it is unit-testable.
 *
 * A spec is { key, label, kind, options?, hint? } where kind is one of:
 *   'text' | 'ifc' | 'enum' | 'length' | 'number' | 'name'
 */

import { parseDimension } from '../snap/dimension.js';
import { parsePath } from '../loader/loadPath.js';

export const IFC_ELEMENT_TYPES = [
  'IfcWall', 'IfcWallStandardCase', 'IfcSlab', 'IfcBeam', 'IfcColumn', 'IfcMember',
  'IfcCovering', 'IfcRoof', 'IfcStair', 'IfcRailing', 'IfcFooting', 'IfcPlate', 'IfcBuildingElementProxy',
];

const SWEEP_MODES = ['perpendicular', 'fixed', 'twisted'];
const CAPS = ['flat', 'angled', 'open', 'junction'];

/** Fields of a swept element. The twist rate is only shown for twisted sweeps. */
export function elementFieldSpecs(element) {
  const specs = [
    { key: 'ifc_type',    label: 'IFC type',    kind: 'ifc' },
    { key: 'description', label: 'Description', kind: 'text' },
    { key: 'sweep_mode',  label: 'Sweep mode',  kind: 'enum', options: SWEEP_MODES },
  ];
  if (element?.sweep_mode === 'twisted') {
    specs.push({ key: 'twist_per_metre', label: 'Twist (deg/m)', kind: 'number' });
  }
  specs.push(
    { key: 'cap_start',    label: 'Start cap',    kind: 'enum', options: CAPS },
    { key: 'cap_end',      label: 'End cap',      kind: 'enum', options: CAPS },
    { key: 'start_offset', label: 'Start offset', kind: 'length', hint: 'Metres removed from the start; negative extends' },
    { key: 'end_offset',   label: 'End offset',   kind: 'length', hint: 'Metres removed from the end; negative extends' },
  );
  return specs;
}

/** Fields of a slab. material_id is chosen from the project's materials by the panel. */
export function slabFieldSpecs() {
  return [
    { key: 'ifc_type',    label: 'IFC type',    kind: 'ifc' },
    { key: 'description', label: 'Description', kind: 'text' },
    { key: 'material_id', label: 'Material',    kind: 'enum', options: null },
  ];
}

export function storeyFieldSpecs() {
  return [
    { key: 'name', label: 'Name',      kind: 'name' },
    { key: 'z_m',  label: 'Elevation', kind: 'length' },
  ];
}

/**
 * Parse a raw input string for a spec.
 * @returns {{ok:true, value:*}|{ok:false, error:string}}
 */
export function parseFieldValue(spec, raw, { unit = 'mm' } = {}) {
  const text = String(raw ?? '');
  switch (spec.kind) {
    case 'text': return { ok: true, value: text.trim() };
    case 'name': {
      const v = text.trim();
      return v ? { ok: true, value: v } : { ok: false, error: 'A name is required.' };
    }
    case 'ifc': {
      const v = text.trim();
      return /^Ifc[A-Za-z0-9]+$/.test(v) ? { ok: true, value: v } : { ok: false, error: 'An IFC type starts with "Ifc", for example IfcWall.' };
    }
    case 'enum': {
      const v = text.trim();
      if (spec.options && !spec.options.includes(v)) return { ok: false, error: `${spec.label} must be one of ${spec.options.join(', ')}.` };
      return v ? { ok: true, value: v } : { ok: false, error: `${spec.label} is required.` };
    }
    case 'length': {
      const m = parseDimension(text, { unit });
      return m === null ? { ok: false, error: `Could not read "${text}" as a length. Try 250, 0.25m or 100+150.` } : { ok: true, value: m };
    }
    case 'number': {
      const n = Number(text.trim());
      return text.trim() !== '' && Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: `Could not read "${text}" as a number.` };
    }
    default: return { ok: false, error: 'Unknown field.' };
  }
}

/** A copy of the entity with one field set. */
export function applyFieldValue(entity, key, value) {
  return { ...entity, [key]: value };
}

// ─── Paths ───────────────────────────────────────────────────────────────────

/**
 * Length and node list of a path. Each node names a segment end it can be
 * edited through: { x, y, z, segIdx, role }. A closed path does not repeat its
 * first node.
 */
export function pathSummary(pathData) {
  const segs = pathData?.segments ?? [];
  if (!segs.length) return { length: 0, nodes: [] };
  let length = 0;
  try {
    const pts = parsePath(pathData).points;
    for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, (pts[i].z ?? 0) - (pts[i - 1].z ?? 0));
  } catch { /* unreadable segment types give length 0 */ }

  const node = (p, segIdx, role) => ({ x: p.x, y: p.y, z: p.z ?? 0, segIdx, role });
  const nodes = segs.map((s, i) => node(s.start, i, 'start'));
  if (!pathData.closed) nodes.push(node(segs.at(-1).end, segs.length - 1, 'end'));
  return { length, nodes };
}

/**
 * Set one axis of a node, keeping the neighbouring segment end in step.
 * Mutates pathData.
 */
export function setPathNodeAxis(pathData, node, axis, metres) {
  const segs = pathData.segments;
  const { segIdx, role } = node;
  segs[segIdx][role][axis] = metres;
  if (role === 'start') {
    if (segIdx > 0) segs[segIdx - 1].end[axis] = metres;
    else if (pathData.closed) segs.at(-1).end[axis] = metres;
  } else if (segIdx < segs.length - 1) {
    segs[segIdx + 1].start[axis] = metres;
  }
  return pathData;
}

// ─── Storeys ─────────────────────────────────────────────────────────────────

/** Map of storey id to its height up to the next storey (null for the top one). */
export function storeyHeights(storeys) {
  const sorted = [...storeys].sort((a, b) => a.z_m - b.z_m);
  const out = new Map();
  sorted.forEach((s, i) => out.set(s.id, i < sorted.length - 1 ? sorted[i + 1].z_m - s.z_m : null));
  return out;
}
