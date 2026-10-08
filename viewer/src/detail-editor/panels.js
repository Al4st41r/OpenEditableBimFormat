/**
 * panels.js — renders the detail editor's side panels from a panel model
 * (DOM layer, no logic). Every control calls an action; editor.js applies the
 * action to the document and re-renders.
 *
 * Inputs use `change`, not `input`, so one edit is one undo step. The
 * parameter preview sliders use `input` and only repaint the canvas.
 */

import { toDisplay, fromDisplay, unitLabel } from '../editor/units.js';
import { KINDS, PLANES, EXTENTS, DATUM_KINDS, DATUM_REFERENCES, RULES } from './detailConstants.js';
import { drawReference } from './reference.js';

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
const num = (metres, onChange, attrs = {}) => h('input', {
  type: 'number', value: metres === null || metres === undefined ? '' : toDisplay(metres), step: unitLabel() === 'mm' ? 1 : 0.001, ...attrs,
  onchange: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onChange(fromDisplay(v)); },
});
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
  left.replaceChildren(...leftPanel(pm, bundle, a));
  right.replaceChildren(...rightPanel(pm, bundle, a));
}

// ── left: members and regions ───────────────────────────────────────────────

function leftPanel(pm, bundle, a) {
  const kind = h('select', {}, options(KINDS, 'wall'));
  const profile = h('select', {}, options(bundle.profileIds, bundle.profileIds[0]));
  return [
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

  if (pm.selectedMember) out.push(...memberEditor(pm.selectedMember, bundle, a));
  if (pm.selectedRegion) out.push(...regionEditor(pm.selectedRegion, pm, bundle, a));

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
    row('Material', select(bundle.materialIds.includes(r.materialId) ? bundle.materialIds : [r.materialId, ...bundle.materialIds], r.materialId, (v) => a.setRegionMaterial(r.index, v))),
    h('div', { class: 'note' }, `Vertices (x, y in ${unitLabel()}). Bind a coordinate to a parameter to make it adjustable per junction.`),
    ...vertexRows,
    h('div', { class: 'row' }, h('button', { onclick: () => a.removeRegion(r.index) }, 'Remove region')),
  ];
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
