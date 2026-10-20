/**
 * openingModel.js — pure helpers for authoring Opening entities in the editor (doors and windows cut into a wall).
 *
 * An opening sits on a host element: `path_position` metres from the start of the element's path, `width_m` along
 * the path, `height_m` up, and `sill_height_m` above the path (below it when negative, eg a door through an upstand).
 * No DOM, so it is unit-testable.
 */

export const OPENING_IFC_TYPES = ['IfcDoor', 'IfcWindow', 'IfcOpeningElement'];

/** Starting sizes by IFC type: width, height and sill in metres. */
export const OPENING_DEFAULTS = {
  IfcDoor: { width_m: 0.9, height_m: 2.1, sill_height_m: 0 },
  IfcWindow: { width_m: 1.2, height_m: 1.2, sill_height_m: 0.9 },
  IfcOpeningElement: { width_m: 1.0, height_m: 1.0, sill_height_m: 0 },
};

export function openingFieldSpecs() {
  return [
    { key: 'ifc_type',        label: 'IFC type',    kind: 'enum', options: OPENING_IFC_TYPES },
    { key: 'description',     label: 'Description', kind: 'text' },
    { key: 'path_position',   label: 'Position',    kind: 'length', hint: 'Metres from the start of the wall path' },
    { key: 'width_m',         label: 'Width',       kind: 'length', positive: true },
    { key: 'height_m',        label: 'Height',      kind: 'length', positive: true },
    { key: 'sill_height_m',   label: 'Cill height', kind: 'length', hint: 'Above the wall path; negative cuts below it' },
  ];
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** A free id of the form `opening-<kind>-<host>[-n]`, eg opening-door-wall-south-gf. */
export function nextOpeningId(existingIds, hostId, ifcType) {
  const kind = ifcType === 'IfcDoor' ? 'door' : ifcType === 'IfcWindow' ? 'window' : 'opening';
  const host = slug(hostId).replace(/^element-/, '');
  const base = `opening-${kind}-${host}`;
  const taken = new Set(existingIds ?? []);
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/**
 * A new Opening entity centred on the given distance along the host's path (or its middle).
 * @param {{ id: string, hostId: string, pathId: string, pathLength: number, ifcType?: string, centre?: number }} args
 */
export function newOpening({ id, hostId, pathId, pathLength, ifcType = 'IfcDoor', centre }) {
  const d = OPENING_DEFAULTS[ifcType] ?? OPENING_DEFAULTS.IfcOpeningElement;
  const c = centre ?? pathLength / 2;
  const position = Math.max(0, Math.min(c - d.width_m / 2, Math.max(0, pathLength - d.width_m)));
  return {
    $schema: 'oebf://schema/0.1/opening', id, type: 'Opening',
    description: ifcType === 'IfcDoor' ? 'Door' : ifcType === 'IfcWindow' ? 'Window' : 'Opening',
    host_element_id: hostId, path_id: pathId, path_position: round(position),
    width_m: d.width_m, height_m: d.height_m, sill_height_m: d.sill_height_m, ifc_type: ifcType,
  };
}

const round = (v) => Math.round(v * 1e6) / 1e6;

/**
 * Problems with an opening against the length of its host path (empty when it is fine). The editor still saves a
 * flagged opening and shows the messages, so a wall that is shortened later does not lose its doors.
 *
 * @returns {string[]}
 */
export function openingProblems(opening, pathLength) {
  const out = [];
  if (!(opening.width_m > 0)) out.push('Width must be greater than zero.');
  if (!(opening.height_m > 0)) out.push('Height must be greater than zero.');
  if (!(opening.path_position >= 0)) out.push('Position cannot be before the start of the wall.');
  if (pathLength !== undefined && opening.path_position + opening.width_m > pathLength + 1e-9) {
    out.push(`Runs ${round(opening.path_position + opening.width_m - pathLength)} m past the end of the wall.`);
  }
  return out;
}

/** Openings of a host element, left to right along its path. */
export function openingsOf(openings, hostId) {
  return (openings ?? []).filter((o) => o.host_element_id === hostId).sort((a, b) => a.path_position - b.path_position);
}

/** Two openings on the same wall that overlap along the path, as pairs of ids. */
export function overlappingOpenings(openings) {
  const out = [];
  for (let i = 0; i < openings.length; i++) {
    for (let j = i + 1; j < openings.length; j++) {
      const a = openings[i], b = openings[j];
      if (a.host_element_id !== b.host_element_id) continue;
      if (a.path_position < b.path_position + b.width_m - 1e-9 && b.path_position < a.path_position + a.width_m - 1e-9) out.push([a.id, b.id]);
    }
  }
  return out;
}

/** model.json with an opening id added (once) or removed. */
export function withOpeningRegistered(model, id) {
  return { ...model, openings: [...new Set([...(model.openings ?? []), id])] };
}

export function withOpeningUnregistered(model, id) {
  return { ...model, openings: (model.openings ?? []).filter((x) => x !== id) };
}
