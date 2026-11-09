/**
 * panels.js — renders the detail editor's side panels from a panel model
 * (DOM layer, no logic). Every control calls an action; editor.js applies the
 * action to the document and re-renders.
 *
 * Inputs use `change`, not `input`, so one edit is one undo step. The
 * parameter preview sliders use `input` and only repaint the canvas.
 */

import { toDisplay, unitLabel, getUnit } from '../editor/units.js';
import { parseDimension } from '../snap/dimension.js';
import { KINDS, PLANES, EXTENTS, DATUM_KINDS, DATUM_REFERENCES, RULES } from './detailConstants.js';
import { PACKAGES, BARRIERS, FIRE_ROLES, SHEARING_LAYERS } from '../detail-review/classification.js';
import { drawReference } from './reference.js';
import { LINE_STYLES } from './annotationOps.js';
import { REFERENCE_KINDS, AXES, CLIP_SIDES } from './referenceOps.js';
import { LAYERS, LAYER_LABELS } from './layers.js';

function h(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== undefined && c !== null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}

const options = (values, current) => values.map((v) => h('option', { value: v, selected: v === current }, v));
const select = (values, current, onChange, attrs = {}) => h('select', { ...attrs, onchange: (e) => onChange(e.target.value) }, options(values, current));
const row = (label, control) => h('div', { class: 'row' }, h('label', {}, label), control);
const text = (value, onChange, attrs = {}) => h('input', { type: 'text', value, ...attrs, onchange: (e) => onChange(e.target.value) });
let notify = () => {};   // set by renderPanels: shows a message in the status line

/**
 * A length field. Accepts a plain number in the display unit, or a typed
 * dimension with units and arithmetic ("2.4m", "1200+300"); see snap/dimension.js.
 */
const num = (metres, onChange, attrs = {}) => {
  const shown = metres === null || metres === undefined ? '' : String(toDisplay(metres));
  return h('input', {
    type: 'text', inputmode: 'decimal', value: shown, title: 'Type a value: 2400, 2.4m or 1200+300', ...attrs,
    onchange: (e) => {
      const raw = e.target.value;
      const m = parseDimension(raw, { unit: getUnit() });
      if (m === null) { notify(`Could not read "${raw}" as a length. Try 2400, 2.4m or 1200+300.`); e.target.value = shown; return; }
      onChange(m);
    },
  });
};
const plain = (value, onChange, attrs = {}) => h('input', {
  type: 'number', value: value ?? '', step: 'any', ...attrs,
  onchange: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onChange(v); },
});

/**
 * @param {{ left: HTMLElement, right: HTMLElement }} roots
 * @param {object} pm - buildPanelModel() result
 * @param {{ profileIds: string[], materialIds: string[], materials: object, previewValues: object|null }} bundle
 * @param {object} a - actions
 */
export function renderPanels({ left, right }, pm, bundle, a) {
  notify = a.notify ?? (() => {});
  // a conditional that gives null or false would otherwise print as the text "null"
  const real = (nodes) => nodes.filter((n) => n !== null && n !== undefined && n !== false);
  left.replaceChildren(...real(leftPanel(pm, bundle, a)));
  right.replaceChildren(...real(rightPanel(pm, bundle, a)));
}

// ── left: members and regions ───────────────────────────────────────────────

function leftPanel(pm, bundle, a) {
  const kind = h('select', {}, options(KINDS, 'wall'));
  const profile = h('select', {}, options(bundle.profileIds, bundle.profileIds[0]));
  return [
    h('h3', {}, 'Layers'),
    ...LAYERS.map((key) => {
      const l = bundle.layers[key];
      return h('div', { class: 'layer' },
        h('button', { class: l.visible ? 'on' : '', title: l.visible ? 'Hide' : 'Show', onclick: () => a.setLayer(key, 'visible', !l.visible) }, l.visible ? 'Shown' : 'Hidden'),
        h('button', { class: l.locked ? 'on' : '', title: l.locked ? 'Unlock' : 'Lock: drawn and snapped to, but not picked', onclick: () => a.setLayer(key, 'locked', !l.locked) }, l.locked ? 'Locked' : 'Open'),
        h('span', { class: l.visible ? '' : 'off' }, LAYER_LABELS[key]));
    }),
    h('h3', {}, 'Members'),
    ...pm.members.map((m) => h('div', { class: `item${m.selected ? ' selected' : ''}`, onclick: () => a.select({ type: 'member', role: m.role }) },
      h('span', {}, m.role),
      h('span', { class: `meta${m.profileMissing ? ' warn' : ''}` }, m.profileMissing ? `${m.profileId} missing` : `${m.kind} · ${m.profileId}`))),
    h('div', { class: 'row' }, kind, profile,
      h('button', { disabled: bundle.profileIds.length === 0, onclick: () => a.addMember(kind.value, profile.value) }, '+')),

    h('h3', {}, 'Regions'),
    ...(pm.regions.length === 0 ? [h('div', { class: 'note' }, 'None yet. Use the Rect or Polygon tool.')] : []),
    ...pm.regions.map((r) => h('div', { class: `item${r.selected ? ' selected' : ''}`, onclick: () => a.select({ type: 'region', index: r.index }) },
      h('span', { class: 'swatch', style: `background:${bundle.materials[r.materialId]?.colour_hex ?? '#888'}` }),
      h('span', {}, `Region ${r.index}`),
      h('span', { class: `meta${r.materialMissing ? ' warn' : ''}` }, r.materialMissing ? `${r.materialId} missing` : `${r.vertexCount} pts${r.boundCount ? ` · ${r.boundCount} bound` : ''}`))),
    ...(pm.marks.length ? [h('h3', {}, 'Marks')] : []),
    ...pm.marks.map((m) => h('div', { class: `item${m.selected ? ' selected' : ''}`, onclick: () => a.select({ type: 'annotation', index: m.index }) },
      h('span', {}, m.label))),
  ];
}

// ── right: properties, selection, parameters, usage ─────────────────────────

function rightPanel(pm, bundle, a) {
  const out = [];
  const hd = pm.header;

  out.push(
    h('h3', {}, 'Detail'),
    row('Description', text(hd.description, a.setDescription)),
    row('View', select(PLANES, hd.plane, a.setPlane)),
    row('Datum', h('div', { class: 'row', style: 'flex:1;margin:0' },
      select(DATUM_KINDS, hd.datumKind, (v) => a.setDatum(v, hd.datumReference)),
      select(DATUM_REFERENCES, hd.datumReference, (v) => a.setDatum(hd.datumKind, v)))),
    row(`Extrusion (${unitLabel()})`, num(hd.extrusion_m, a.setExtrusion, { min: 0 })),
    h('div', { class: 'note' }, hd.plane === 'plan'
      ? 'Plan: regions rise from the level by the extrusion.'
      : 'Section: regions run along the primary member, centred.'),
  );

  out.push(...referenceEditor(pm, a), ...clipEditor(pm, a));

  if (pm.selectedMember) out.push(...memberEditor(pm.selectedMember, bundle, a));
  if (pm.selectedRegion) out.push(...regionEditor(pm.selectedRegion, pm, bundle, a), ...dimensionEditor(pm.selectedRegion, bundle, a));

  if (pm.selectedAnnotation) out.push(...annotationEditor(pm.selectedAnnotation, a));

  out.push(h('h3', {}, 'Parameters'));
  if (pm.parameters.length === 0) out.push(h('div', { class: 'note' }, 'None. Add one, then bind a vertex coordinate to it.'));
  for (const p of pm.parameters) out.push(parameterBox(p, bundle, a));
  out.push(newParameterForm(a));

  out.push(h('h3', {}, 'Condition'), ...conditionEditor(pm, a));

  out.push(h('h3', {}, 'Used at'), ...referenceSection(bundle.reference, a), ...usageSection(pm, bundle.reference?.highlight ?? null, a));

  out.push(h('h3', {}, 'Checks'));
  if (pm.messages.length === 0) out.push(h('div', { class: 'note' }, 'No problems found.'));
  for (const m of pm.messages) out.push(h('div', { class: 'msg err' }, h('span', { class: 'note' }, `${m.path || 'detail'}: `), m.message));
  return out;
}

function referenceSection(ref, a) {
  if (!ref) return [];
  const d = ref.data;
  const out = [];
  if (ref.levels.length > 1) {
    out.push(h('div', { class: 'row' }, h('label', {}, 'Level'),
      h('select', { onchange: (e) => a.referenceLevel(e.target.value || null) },
        h('option', { value: '', selected: !ref.levelId }, 'All levels'),
        ref.levels.map((l) => h('option', { value: l.id, selected: l.id === ref.levelId }, `${l.id} (${l.elevation} m)`)))));
  }
  out.push(h('div', { class: 'ref' }, drawReference(d, { highlight: ref.highlight, onPick: a.referencePick })));
  out.push(h('div', { class: 'legend' },
    d.legend.map((l) => h('span', { class: 'lg', title: l.current ? 'The detail being edited' : 'Another detail' },
      h('i', { style: `background:${l.colour}` }), `${l.detailId} (${l.count})`)),
    h('span', { class: 'lg' }, h('i', { class: 'hollow' }), `no detail (${d.unassigned})`)));
  if (d.unplaced.length) out.push(h('div', { class: 'note warn' }, `No position for: ${d.unplaced.map((u) => u.id).join(', ')}`));
  if (ref.highlight) {
    out.push(h('div', { class: 'row' }, h('strong', {}, ref.highlight),
      h('button', { style: 'margin-left:auto', disabled: !ref.canShow3D, title: ref.canShow3D ? 'Select it and frame it in the 3D editor' : 'Open this page from the main editor to use this',
        onclick: () => a.referenceShow3D(ref.highlight) }, 'Show in 3D editor')));
  } else {
    out.push(h('div', { class: 'note' }, 'Click a marker to find it in the list below.'));
  }
  return out;
}

function usageSection(pm, highlight, a) {
  const u = pm.usage;
  const locked = u.needsSave;
  const out = [];
  if (locked) out.push(h('div', { class: 'note warn' }, 'Save the detail before assigning it to junctions or changing their settings.'));
  if (u.junctions.length === 0) out.push(h('div', { class: 'note' }, 'No junction uses this detail yet.'));

  for (const j of u.junctions) {
    out.push(h('div', { class: `box${j.id === highlight ? ' hl' : ''}`, 'data-id': j.id, onclick: () => a.referencePick(j.id) },
      h('div', { class: 'row' }, h('strong', {}, j.id), h('span', { class: 'note', style: 'margin-left:auto' }, j.location ?? 'no location')),
      h('div', { class: 'row' },
        h('button', { disabled: locked, onclick: () => a.junctionLocation(j.id) }, 'Change location'),
        h('button', { disabled: locked, onclick: () => a.junctionUnassign(j.id) }, 'Unassign'),
        h('label', { style: 'flex:1;display:flex;gap:4px;align-items:center;font-size:12px;opacity:1' },
          h('input', { type: 'checkbox', checked: j.mirrored, disabled: locked, onchange: (e) => a.junctionMirror(j.id, e.target.checked) }), 'Mirrored')),
      ...j.parameters.map((p) => h('div', { class: 'row' },
        h('label', { title: `${p.min ?? ''} to ${p.max ?? ''}` }, p.name),
        h('input', { type: 'number', step: 'any', value: p.value, min: p.min, max: p.max, disabled: locked,
          onchange: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) a.junctionOverride(j.id, p.name, v); } }),
        p.overridden ? h('button', { disabled: locked, title: 'Back to the detail default', onclick: () => a.junctionOverride(j.id, p.name, null) }, 'Reset') : h('span', { class: 'note' }, 'default'))),
      ...j.warnings.map((w) => h('div', { class: 'msg warn' }, w))));
  }

  if (u.candidates.length) {
    out.push(h('h3', {}, 'Could also apply to'));
    for (const c of u.candidates) {
      out.push(h('div', { class: `item${c.id === highlight ? ' selected' : ''}`, 'data-id': c.id, onclick: () => a.referencePick(c.id) },
        h('span', {}, c.id),
        h('span', { class: 'meta' }, c.suggestion ? `${c.suggestion}${c.approximate ? ' (approx)' : ''}` : 'no suggestion'),
        h('button', { disabled: locked, onclick: () => a.junctionAssign(c.id) }, 'Assign…')));
    }
  }
  if (u.others.length) {
    const pick = h('select', {}, u.others.map((o) => h('option', { value: o.id }, `${o.id} (${o.rule})`)));
    out.push(
      h('h3', {}, 'Other junctions'),
      h('div', { class: 'note' }, 'These do not match the detail\'s condition, but you can still assign it.'),
      h('div', { class: 'row' }, pick, h('button', { disabled: locked, onclick: () => a.junctionAssign(pick.value) }, 'Assign…')));
  }
  return out;
}

function memberEditor(m, bundle, a) {
  const role = m.role;
  return [
    h('h3', {}, `Member: ${role}`),
    row('Role', text(role, (v) => a.renameMember(role, v))),
    row('Kind', select(KINDS, m.kind, (v) => a.setMemberKind(role, v))),
    row('Profile', select(bundle.profileIds.includes(m.profileId) ? bundle.profileIds : [m.profileId, ...bundle.profileIds], m.profileId, (v) => a.setMemberProfile(role, v))),
    row('Plan extent', select(EXTENTS, m.extent, (v) => a.setMemberExtent(role, v))),
    row(`Offset x (${unitLabel()})`, num(m.offset_x_m, (v) => a.moveMember(role, { offset_x_m: v }))),
    row(`Offset y (${unitLabel()})`, num(m.offset_y_m, (v) => a.moveMember(role, { offset_y_m: v }))),
    row('Rotation (deg)', plain(m.rotation_deg, (v) => a.rotateMember(role, v))),
    h('div', { class: 'row' }, h('button', { onclick: () => a.removeMember(role) }, 'Remove member')),
  ];
}

function regionEditor(r, pm, bundle, a) {
  const params = pm.parameters.map((p) => p.name);
  const vertexRows = r.vertices.map((v, i) => h('div', { class: `vtx${v.selected ? ' selected' : ''}`, onclick: () => a.select({ type: 'region', index: r.index, vertex: i }) },
    h('span', { class: 'note' }, i),
    axisCell(v.x, v.boundX, params, (val) => a.moveVertex(r.index, i, { x: val }), (p) => a.bind(r.index, i, 'x', p), () => a.unbind(r.index, i, 'x')),
    axisCell(v.y, v.boundY, params, (val) => a.moveVertex(r.index, i, { y: val }), (p) => a.bind(r.index, i, 'y', p), () => a.unbind(r.index, i, 'y'))));
  return [
    h('h3', {}, `Region ${r.index}`),
    r.pickedCount > 1 ? h('div', { class: 'note warn' }, `${r.pickedCount} regions are selected. Changes here apply to region ${r.index} only.`) : null,
    row('Material', select(bundle.materialIds.includes(r.materialId) ? bundle.materialIds : [r.materialId, ...bundle.materialIds], r.materialId, (v) => a.setRegionMaterial(r.index, v))),
    ...regionTransformEditor(r, a),
    ...regionOffsetEditor(r, pm, a),
    ...regionCornerEditor(r, a),
    ...regionRepeatEditor(r, a),
    ...regionTagEditor(r, a),
    h('div', { class: 'note' }, `Vertices (x, y in ${unitLabel()}). Bind a coordinate to a parameter to make it adjustable per junction.`),
    ...vertexRows,
    h('div', { class: 'row' }, h('button', { onclick: () => a.removeRegion(r.index) }, 'Remove region')),
  ];
}

/** Offset a region, stand a layer on one of its edges, or trim it by another region. Acts on the first selected region. */
const offsetDraft = { distance: 0.01, thickness: 0.05, edge: 0, by: 0, side: 'right' };
function regionOffsetEditor(r, pm, a) {
  const n = r.vertices.length;
  const others = pm.regions.filter((o) => o.index !== r.index);
  const edge = Math.min(offsetDraft.edge, n - 1);
  const by = others.some((o) => o.index === offsetDraft.by) ? offsetDraft.by : others[0]?.index;
  return [h('details', { class: 'fold' },
    h('summary', {}, 'Offset, layer, trim'),
    row(`Distance (${unitLabel()})`, num(offsetDraft.distance, (m) => { offsetDraft.distance = m; })),
    h('div', { class: 'row' },
      h('button', { title: 'Grow the region by the distance', onclick: () => a.offsetRegion(offsetDraft.distance, false) }, 'Offset out'),
      h('button', { title: 'Shrink the region by the distance', onclick: () => a.offsetRegion(-offsetDraft.distance, false) }, 'Offset in'),
      h('button', { title: 'Keep the region and add the grown copy', onclick: () => a.offsetRegion(offsetDraft.distance, true) }, 'Copy out')),
    row('Edge', select(Array.from({ length: n }, (_, i) => String(i)), String(edge), (v) => { offsetDraft.edge = Number(v); })),
    row(`Thickness (${unitLabel()})`, num(offsetDraft.thickness, (m) => { offsetDraft.thickness = m; })),
    h('div', { class: 'row' }, h('button', { title: 'Add a region of this thickness outside the chosen edge (vertex n to n+1)', onclick: () => a.layerOnEdge(offsetDraft.edge, offsetDraft.thickness) }, 'Add layer on edge')),
    others.length
      ? row('Trim by', select(others.map((o) => String(o.index)), String(by), (v) => { offsetDraft.by = Number(v); }))
      : h('div', { class: 'note' }, 'Add another region to trim by it.'),
    others.length ? h('div', { class: 'row' },
      h('button', { title: 'Cut away the part of this region that the other covers (rectangles only)', onclick: () => a.trimBy(by) }, 'Trim'),
      select(['left', 'right', 'bottom', 'top'], offsetDraft.side, (v) => { offsetDraft.side = v; }, { title: 'Side to extend' }),
      h('button', { title: 'Run that side out to the nearest face of the other region (rectangles only)', onclick: () => a.extendTo(offsetDraft.side, by) }, 'Extend to')) : null,
    h('div', { class: 'note' }, 'Offset and trim need plain-number vertices. Trim and extend work on rectangles for now.'))];
}

/** Round or chamfer corners of the selected region. The corner defaults to the selected vertex. */
const cornerDraft = { size: 0.02, vertex: null };
function regionCornerEditor(r, a) {
  const n = r.vertices.length;
  const picked = r.vertices.findIndex((v) => v.selected);
  const vertex = cornerDraft.vertex !== null && cornerDraft.vertex < n ? cornerDraft.vertex : Math.max(0, picked);
  return [h('details', { class: 'fold' },
    h('summary', {}, 'Round or chamfer corners'),
    row(`Size (${unitLabel()})`, num(cornerDraft.size, (m) => { cornerDraft.size = m; })),
    row('Corner', select(['all', ...Array.from({ length: n }, (_, i) => String(i))], cornerDraft.vertex === 'all' ? 'all' : String(vertex), (v) => { cornerDraft.vertex = v === 'all' ? 'all' : Number(v); })),
    h('div', { class: 'row' },
      h('button', { title: 'Replace the corner with an arc of this radius', onclick: () => a.cornerRegion(cornerDraft.vertex === 'all' ? 'all' : vertex, cornerDraft.size, 'fillet') }, 'Round'),
      h('button', { title: 'Cut the corner off, this far back along each edge', onclick: () => a.cornerRegion(cornerDraft.vertex === 'all' ? 'all' : vertex, cornerDraft.size, 'chamfer') }, 'Chamfer')),
    h('div', { class: 'note' }, 'A rounded corner is drawn as short straight segments. Needs plain-number vertices.'))];
}

/** Numeric move, copy, rotate and mirror. Acts on every selected region; rotate and mirror turn about the selection's centre. */
const transformDraft = { dx: 0, dy: 0, deg: 90 };
function regionTransformEditor(r, a) {
  const scope = r.pickedCount > 1 ? `${r.pickedCount} regions` : 'this region';
  return [h('details', { class: 'fold' },
    h('summary', {}, 'Move, copy, rotate, mirror'),
    row(`Move x (${unitLabel()})`, num(transformDraft.dx, (m) => { transformDraft.dx = m; })),
    row(`Move y (${unitLabel()})`, num(transformDraft.dy, (m) => { transformDraft.dy = m; })),
    h('div', { class: 'row' },
      h('button', { onclick: () => a.moveBy(transformDraft.dx, transformDraft.dy, false) }, 'Move'),
      h('button', { onclick: () => a.moveBy(transformDraft.dx, transformDraft.dy, true) }, 'Copy')),
    row('Angle (deg)', plain(transformDraft.deg, (v) => { transformDraft.deg = v; })),
    h('div', { class: 'row' },
      h('button', { onclick: () => a.transform({ rotate_deg: transformDraft.deg }) }, 'Rotate left'),
      h('button', { onclick: () => a.transform({ rotate_deg: -transformDraft.deg }) }, 'Rotate right')),
    h('div', { class: 'row' },
      h('button', { onclick: () => a.transform({ mirror: 'x' }) }, 'Mirror left-right'),
      h('button', { onclick: () => a.transform({ mirror: 'y' }) }, 'Mirror top-bottom')),
    h('div', { class: 'note' }, `Applies to ${scope}. Rotate and mirror turn about the centre of the selection.`))];
}

/** Depth and repeat of a region: one unit is drawn, repeated at a pitch (brick 210 deep every 220, tile 90 deep on 98). */
function regionRepeatEditor(r, a) {
  const n = r.numbers;
  const len = (field, label, title) => row(label, num(n[field], (m) => a.setRegionNumber(r.index, field, m), { title, placeholder: '-' }));
  const count = (field, label) => row(label, h('input', {
    type: 'number', min: 1, step: 1, value: n[field] ?? '', placeholder: '-',
    onchange: (e) => a.setRegionNumber(r.index, field, e.target.value === '' ? null : parseInt(e.target.value, 10)),
  }));
  const used = Object.values(n).some((v) => v !== null);
  return [h('details', { class: 'fold', open: used },
    h('summary', {}, 'Depth and repeat'),
    len('depth_m', `Depth (${unitLabel()})`, 'How far the unit extends in plan or section'),
    len('repeat_x_m', `Pitch x (${unitLabel()})`, 'Distance between units along x, from start to start'),
    len('repeat_y_m', `Pitch y (${unitLabel()})`, 'Distance between units along y'),
    count('count_x', 'Count x'), count('count_y', 'Count y'),
    len('stagger_x_m', `Stagger x (${unitLabel()})`, 'Shift of each row along x, for bond'),
    h('div', { class: 'note' }, 'The vertices draw one unit; the gap to the next is left empty.'))];
}

/** Classification tags on a region: an override of its material's defaults. */
function regionTagEditor(r, a) {
  const t = r.tags;
  const pick = (label, key, values) => row(label, h('select', { onchange: (e) => a.setRegionTag(r.index, key, e.target.value || null) },
    h('option', { value: '' }, 'from material'), ...values.map((v) => h('option', { value: v, selected: v === t[key] }, v))));
  const barrier = h('div', { class: 'row' }, h('label', {}, 'Barrier'), h('div', {}, ...BARRIERS.map((b) => h('label', { style: 'margin-right:8px;font-size:12px' },
    h('input', { type: 'checkbox', checked: (t.barrier ?? []).includes(b), onchange: (e) => {
      const set = new Set(t.barrier ?? []);
      if (e.target.checked) set.add(b); else set.delete(b);
      a.setRegionTag(r.index, 'barrier', [...set]);
    } }), ` ${b}`))));
  return [h('details', { class: 'fold', open: Object.keys(t).length > 0 },
    h('summary', {}, 'Tags'),
    pick('Package', 'package', PACKAGES), barrier, pick('Fire', 'fire_role', FIRE_ROLES), pick('Shearing', 'shearing_layer', SHEARING_LAYERS),
    row('Sequence', h('input', {
      type: 'number', min: 1, max: 99, step: 1, value: t.sequence ?? '', placeholder: 'from material',
      onchange: (e) => a.setRegionTag(r.index, 'sequence', e.target.value === '' ? null : parseInt(e.target.value, 10)),
    })),
    h('div', { class: 'note' }, 'A tag here overrides the material for this region only.'))];
}

/** A length that may be left blank: blank gives null, otherwise the parsed value in metres. */
const optionalLength = (metres, onChange, attrs = {}) => {
  const shown = metres === null || metres === undefined ? '' : String(toDisplay(metres));
  return h('input', {
    type: 'text', inputmode: 'decimal', value: shown, placeholder: 'not clipped', ...attrs,
    onchange: (e) => {
      const raw = e.target.value.trim();
      if (raw === '') { onChange(null); return; }
      const m = parseDimension(raw, { unit: getUnit() });
      if (m === null) { notify(`Could not read "${raw}" as a length.`); e.target.value = shown; return; }
      onChange(m);
    },
  });
};

const refDraft = { kind: 'level', axis: 'y', offset: 0 };
/** Named lines the drawing is set out from: grid, FFL, level or custom. */
function referenceEditor(pm, a) {
  const rows = pm.referenceLines.map((l, i) => h('div', { class: 'refline' },
    select(REFERENCE_KINDS, l.kind, (v) => a.updateReferenceLine(i, { kind: v })),
    select(AXES, l.axis, (v) => a.updateReferenceLine(i, { axis: v }), { title: 'x: a vertical line at that x. y: a horizontal line at that y.' }),
    num(l.offset_m, (m) => a.updateReferenceLine(i, { offset_m: m }), { title: 'Position' }),
    text(l.name ?? '', (v) => a.updateReferenceLine(i, { name: v.trim() === '' ? undefined : v.trim() }), { placeholder: 'name', title: 'Label; blank uses the kind' }),
    h('button', { title: 'Remove this line', onclick: () => a.removeReferenceLine(i) }, '×')));
  return [h('details', { class: 'fold', open: pm.referenceLines.length > 0 },
    h('summary', {}, 'Reference lines'),
    pm.referenceLines.length ? rows : h('div', { class: 'note' }, `Showing the implied ${pm.impliedLines.join(' and ')} through the origin. Add a line to set your own.`),
    h('div', { class: 'row' },
      select(REFERENCE_KINDS, refDraft.kind, (v) => { refDraft.kind = v; }),
      select(AXES, refDraft.axis, (v) => { refDraft.axis = v; }),
      num(refDraft.offset, (m) => { refDraft.offset = m; }),
      h('button', { onclick: () => a.addReferenceLine({ kind: refDraft.kind, axis: refDraft.axis, offset_m: refDraft.offset }) }, 'Add')),
    h('div', { class: 'note' }, `Offsets are in ${unitLabel()}. Lines are drawn only; they do not change the geometry.`))];
}

/** The part of the detail to show. The 3D view cuts to it and the drawings fade the rest. */
function clipEditor(pm, a) {
  const labels = { x_min_m: 'Left (x min)', x_max_m: 'Right (x max)', y_min_m: 'Bottom (y min)', y_max_m: 'Top (y max)' };
  return [h('details', { class: 'fold', open: !!pm.clip },
    h('summary', {}, 'Clip region'),
    ...CLIP_SIDES.map((side) => row(`${labels[side]}`, optionalLength(pm.clip?.[side], (m) => a.setClip({ [side]: m })))),
    h('div', { class: 'row' },
      h('button', { title: 'Start from the extent of the drawing, then drag the CLIP handles or type values', onclick: () => a.enableClip() }, 'Clip to drawing'),
      h('button', { disabled: !pm.clip, onclick: () => a.setClip({ x_min_m: null, x_max_m: null, y_min_m: null, y_max_m: null }) }, 'Clear')),
    h('div', { class: 'note' }, 'Drag a CLIP handle on the canvas, or type a value. The 3D view and the drawings show only what is inside.'))];
}

/** Properties of the selected line, dimension or note. */
function annotationEditor(n, a) {
  const title = { line: 'Line', arc: 'Arc', circle: 'Circle', dimension: 'Dimension', note: 'Note' }[n.type];
  const out = [h('h3', {}, `${title} ${n.index}`)];
  if (n.type === 'line') {
    out.push(row('Style', select(LINE_STYLES, n.style, (v) => a.updateAnnotation(n.index, { style: v === 'solid' ? undefined : v }))),
      h('div', { class: 'note' }, `${n.points} points. Drag a point to move it.`));
  } else if (n.type === 'arc' || n.type === 'circle') {
    out.push(row('Style', select(LINE_STYLES, n.style, (v) => a.updateAnnotation(n.index, { style: v === 'solid' ? undefined : v }))),
      row(`Radius (${unitLabel()})`, num(n.radius_m, (v) => a.updateAnnotation(n.index, { radius_m: v }), { min: 0 })));
    if (n.type === 'arc') {
      out.push(row('Start (deg)', plain(n.start_deg, (v) => a.updateAnnotation(n.index, { start_deg: v }))),
        row('End (deg)', plain(n.end_deg, (v) => a.updateAnnotation(n.index, { end_deg: v }))),
        h('div', { class: 'note' }, 'Anticlockwise from start to end. Drag a handle to change it.'));
    }
  } else if (n.type === 'dimension') {
    out.push(row(`Length (${unitLabel()})`, h('input', { type: 'text', value: String(Math.round(toDisplay(n.length) * 1000) / 1000), disabled: true })),
      row(`Line offset (${unitLabel()})`, num(n.offset_m, (v) => a.updateAnnotation(n.index, { offset_m: v }))),
      h('div', { class: 'note' }, 'Measured between the two points. A negative offset puts the line on the other side.'));
  } else {
    out.push(row('Text', text(n.text, (v) => a.updateAnnotation(n.index, { text: v }))),
      n.hasLeader ? row('Leader', h('button', { onclick: () => a.updateAnnotation(n.index, { leader_to: undefined }) }, 'Remove leader')) : null);
  }
  out.push(h('button', { class: 'danger', onclick: () => a.removeAnnotation(n.index) }, `Delete ${title.toLowerCase()}`));
  return out;
}

/** Edge lengths and rectangle size for the selected region, typed directly (issue #105). */
function dimensionEditor(r, bundle, a) {
  const anchors = bundle.anchors ?? { edge: 'start', rect: 'bottom-left' };
  const out = [h('h3', {}, `Dimensions: region ${r.index}`)];

  if (r.rect) {
    out.push(
      row(`Width (${unitLabel()})`, num(r.rect.width, (v) => a.setRegionSize(r.index, v, undefined), { disabled: !r.rect.editable, min: 0 })),
      row(`Height (${unitLabel()})`, num(r.rect.height, (v) => a.setRegionSize(r.index, undefined, v), { disabled: !r.rect.editable, min: 0 })),
      row('Resize about', select(['bottom-left', 'bottom-right', 'top-left', 'top-right', 'centre'], anchors.rect, (v) => a.setAnchor('rect', v))),
      r.rect.editable ? null : h('div', { class: 'note' }, 'A vertex is driven by a parameter: unbind it to resize by size.'));
  }
  out.push(
    h('div', { class: 'note' }, 'Edge lengths (the edge from each vertex to the next):'),
    ...r.edges.map((e) => row(`Edge ${e.index} (${unitLabel()})`, num(e.length, (v) => a.setEdgeLength(r.index, e.index, v), { disabled: e.bound, min: 0, title: e.bound ? 'An end vertex is driven by a parameter' : undefined }))),
    row('Hold fixed', select(['start', 'end', 'centre'], anchors.edge, (v) => a.setAnchor('edge', v))));
  return out;
}

function axisCell(value, boundParam, params, onValue, onBind, onUnbind) {
  if (boundParam) {
    return h('div', {}, h('span', { class: 'bound' }, `${boundParam} `), h('span', { class: 'note' }, `= ${toDisplay(value)} `), h('button', { onclick: (e) => { e.stopPropagation(); onUnbind(); } }, 'Unbind'));
  }
  const bind = params.length
    ? h('select', { title: 'Bind to a parameter', onchange: (e) => { if (e.target.value) onBind(e.target.value); } }, h('option', { value: '' }, 'bind…'), options(params))
    : null;
  return h('div', {}, num(value, onValue, { style: 'width:100%' }), bind);
}

function parameterBox(p, bundle, a) {
  const live = bundle.previewValues?.[p.name] ?? p.default;
  const label = h('span', { class: 'note' }, `preview ${live}`);
  const slider = (p.min !== undefined && p.max !== undefined)
    ? h('input', {
      type: 'range', min: p.min, max: p.max, step: (p.max - p.min) / 100, value: live,
      oninput: (e) => { label.textContent = `preview ${e.target.value}`; a.preview(p.name, parseFloat(e.target.value)); },
      onchange: (e) => { if (parseFloat(e.target.value) === p.default) a.preview(p.name, null); },
    })
    : null;
  return h('div', { class: 'param' },
    h('div', { class: 'row' }, h('strong', {}, p.name), h('span', { class: 'note', style: 'margin-left:auto' }, `used by ${p.usedBy}`)),
    row('Default', plain(p.default, (v) => a.updateParameter(p.name, { default: v }))),
    row('Min', plain(p.min, (v) => a.updateParameter(p.name, { min: v }))),
    row('Max', plain(p.max, (v) => a.updateParameter(p.name, { max: v }))),
    slider, slider ? label : null,
    h('div', { class: 'row' },
      h('button', { onclick: () => { const n = window.prompt('New name (snake_case):', p.name); if (n && n !== p.name) a.renameParameter(p.name, n); } }, 'Rename'),
      h('button', { onclick: () => a.removeParameter(p.name) }, 'Remove')));
}

function newParameterForm(a) {
  const name = h('input', { type: 'text', placeholder: 'name_m', style: 'flex:1' });
  const def = h('input', { type: 'number', step: 'any', placeholder: 'default', style: 'width:70px' });
  const min = h('input', { type: 'number', step: 'any', placeholder: 'min', style: 'width:60px' });
  const max = h('input', { type: 'number', step: 'any', placeholder: 'max', style: 'width:60px' });
  const val = (i) => (i.value === '' ? undefined : parseFloat(i.value));
  return h('div', { class: 'row' }, name, def, min, max, h('button', { onclick: () => a.addParameter(name.value.trim(), { default: val(def), min: val(min), max: val(max) }) }, 'Add'));
}

function conditionEditor(pm, a) {
  const doc = pm.condition;
  return [
    h('div', { class: 'note' }, 'Advisory only: describes where the detail is meant to be used, so the editor can suggest junctions.'),
    h('div', { class: 'row' },
      h('label', {}, 'Rule'),
      select(['(none)', ...RULES], doc?.rule ?? '(none)', (v) => a.setConditionRule(v === '(none)' ? null : v))),
    doc ? h('div', { class: 'note' }, `${doc.member_count ?? '?'} members: ${(doc.member_kinds ?? []).join(', ')} (kept in step with the members)`) : null,
  ];
}
