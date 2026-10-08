/**
 * editor.js — Detail Editor page orchestrator (DOM layer).
 *
 * All behaviour lives in tested pure modules:
 *   pageState (document, history, selection)   canvasController (pointer and key handling)
 *   canvasModel (what to draw, hit testing)    panelModel (what the panels show)
 *   detailStore (load and save)                messages / bundleSnapshot (handoff from the main editor)
 * This file only connects them to the DOM, the File System Access API and postMessage.
 */

import { FsaAdapter, MemoryAdapter } from '../editor/storageAdapter.js';
import { setUnit, getUnit } from '../editor/units.js';
import * as D from './detailDocument.js';
import { validateDetail } from './detailValidate.js';
import { createDetail } from './detailSerializer.js';
import { loadDetailContext, saveDetail } from './detailStore.js';
import { snapshotToContext } from './bundleSnapshot.js';
import { readyMessage, parseIncoming, savedMessage } from './messages.js';
import { createState, commit, undo, redo, select, setPreview, setTool, markSaved, isDirty, canUndo, canRedo } from './pageState.js';
import { buildCanvasModel, rulerTicks } from './canvasModel.js';
import { createController, setControllerTool, handleEvent } from './canvasController.js';
import { buildPanelModel } from './panelModel.js';
import { fitView, toDetail, zoomAt, panByPixels } from './viewTransform.js';
import { renderCanvas } from './render.js';
import { renderPanels } from './panels.js';
import { KINDS, PLANES } from './detailConstants.js';

const $ = (id) => document.getElementById(id);
const svg = $('canvas');
const wrap = $('canvas-wrap');

// ── state ────────────────────────────────────────────────────────────────────
let bundle = null;          // { ctx, adapter, source: 'fsa' | 'memory' | 'snapshot' }
let st = null;              // pageState
let display = null;         // transient document while dragging
let controller = createController('select');
let draft = null;
let view = { cx: 0, cy: 0, scale: 100 };
let size = { width: 800, height: 600 };

// ── units ────────────────────────────────────────────────────────────────────
{
  const stored = localStorage.getItem('oebf-units');
  if (stored === 'mm' || stored === 'm') { setUnit(stored); $('units-select').value = stored; }
}
$('units-select').addEventListener('change', () => {
  setUnit($('units-select').value);
  localStorage.setItem('oebf-units', getUnit());
  refresh();
});

// ── status ───────────────────────────────────────────────────────────────────
function status(text, isError = false) {
  const s = $('status');
  s.textContent = text;
  s.classList.toggle('error', isError);
}

// ── derived data ─────────────────────────────────────────────────────────────
const validationContext = () => ({ profileIds: bundle.ctx.profileIds, materialIds: bundle.ctx.materialIds });
const currentDoc = () => display ?? st.doc;

function canvasModelFor(doc, selection) {
  return buildCanvasModel(doc, { profiles: bundle.ctx.profiles, materials: bundle.ctx.materials, values: st.preview, selection });
}

function visibleSnap() {
  const span = size.width / view.scale;
  return Math.max(0.001, rulerTicks(0, span, 8).step / 10);
}

// ── painting ─────────────────────────────────────────────────────────────────
function paint() {
  if (!st) { svg.replaceChildren(); return; }
  renderCanvas(svg, canvasModelFor(currentDoc(), st.selection), view, size, { draft });
}

function refresh() {
  if (!bundle) return;
  const has = !!st;
  $('empty').hidden = has;
  $('save-btn').disabled = true;
  if (has) {
    const validation = validateDetail(st.doc, validationContext());
    const pm = buildPanelModel({
      doc: st.doc, selection: st.selection, validation, dirty: isDirty(st), canUndo: canUndo(st), canRedo: canRedo(st),
      profileIds: bundle.ctx.profileIds, materialIds: bundle.ctx.materialIds, junctions: bundle.ctx.junctions, elements: bundle.ctx.elements,
    });
    renderPanels({ left: $('left-panel'), right: $('right-panel') }, pm, {
      profileIds: bundle.ctx.profileIds, materialIds: bundle.ctx.materialIds, materials: bundle.ctx.materials, previewValues: st.preview,
    }, actions);
    $('save-btn').disabled = !pm.saveEnabled;
    $('undo-btn').disabled = !pm.canUndo;
    $('redo-btn').disabled = !pm.canRedo;
    $('dirty').hidden = !pm.dirty;
    updateDetailSelect();
    document.title = `${pm.dirty ? '● ' : ''}${st.doc.id} — OEBF Detail Editor`;
  } else {
    $('left-panel').replaceChildren(); $('right-panel').replaceChildren();
    $('undo-btn').disabled = $('redo-btn').disabled = true; $('dirty').hidden = true;
  }
  for (const t of ['select', 'rect', 'polygon']) $(`tool-${t}`).classList.toggle('active', st?.tool === t || (!st && t === 'select'));
  svg.style.cursor = st?.tool === 'select' || !st ? 'default' : 'crosshair';
  paint();
}

function fit() {
  if (!st) return;
  view = fitView(canvasModelFor(st.doc, null).viewBox, size);
  paint();
}

// ── applying edits ───────────────────────────────────────────────────────────
function apply(fn) {
  if (!st) return;
  try {
    st = commit(st, fn(st.doc));
    display = null;
    status('');
    refresh();
  } catch (err) {
    status(err.message, true);
  }
}

const actions = {
  select: (sel) => { st = select(st, sel); refresh(); },
  setDescription: (v) => apply((d) => D.setDescription(d, v)),
  setPlane: (v) => apply((d) => D.setPlane(d, v)),
  setDatum: (kind, reference) => apply((d) => D.setDatum(d, { kind, reference })),
  setExtrusion: (v) => apply((d) => D.setExtrusion(d, v)),
  addMember: (kind, profile) => apply((d) => D.addMember(d, { kind, profile_id: profile })),
  removeMember: (role) => apply((d) => D.removeMember(d, role)),
  renameMember: (role, to) => { apply((d) => D.renameMemberRole(d, role, to)); if (st.doc.members.some((m) => m.role === to)) { st = select(st, { type: 'member', role: to }); refresh(); } },
  setMemberKind: (role, v) => apply((d) => D.setMemberKind(d, role, v)),
  setMemberProfile: (role, v) => apply((d) => D.setMemberProfile(d, role, v)),
  setMemberExtent: (role, v) => apply((d) => D.setMemberExtent(d, role, v)),
  moveMember: (role, o) => apply((d) => D.moveMember(d, role, o)),
  rotateMember: (role, v) => apply((d) => D.rotateMember(d, role, v)),
  setRegionMaterial: (i, v) => apply((d) => D.setRegionMaterial(d, i, v)),
  removeRegion: (i) => apply((d) => D.removeRegion(d, i)),
  moveVertex: (r, v, c) => apply((d) => D.moveVertex(d, r, v, c)),
  bind: (r, v, axis, param) => apply((d) => D.bindCoordinate(d, r, v, axis, { param })),
  unbind: (r, v, axis) => apply((d) => D.unbindCoordinate(d, r, v, axis)),
  addParameter: (name, spec) => apply((d) => D.addParameter(d, name, spec)),
  updateParameter: (name, patch) => apply((d) => D.updateParameter(d, name, patch)),
  removeParameter: (name) => apply((d) => D.removeParameter(d, name)),
  renameParameter: (from, to) => apply((d) => D.renameParameter(d, from, to).doc),
  setConditionRule: (rule) => apply((d) => (rule === null ? D.setCondition(d, null) : D.setCondition(d, { ...(d.condition ?? {}), rule, member_count: d.members.length, member_kinds: d.members.map((m) => m.kind) }))),
  preview: (name, value) => {
    const next = { ...(st.preview ?? {}) };
    if (value === null) delete next[name]; else next[name] = value;
    st = setPreview(st, Object.keys(next).length ? next : null);
    paint();
  },
};

// ── undo / redo / tools ──────────────────────────────────────────────────────
function doUndo() { if (st && canUndo(st)) { st = undo(st); display = null; refresh(); } }
function doRedo() { if (st && canRedo(st)) { st = redo(st); display = null; refresh(); } }
$('undo-btn').addEventListener('click', doUndo);
$('redo-btn').addEventListener('click', doRedo);
$('fit-btn').addEventListener('click', fit);

function chooseTool(tool) {
  if (!st) return;
  st = setTool(st, tool);
  controller = setControllerTool(controller, tool);
  draft = null;
  refresh();
}
for (const t of ['select', 'rect', 'polygon']) $(`tool-${t}`).addEventListener('click', () => chooseTool(t));

// ── canvas interaction ───────────────────────────────────────────────────────
function controllerContext() {
  let model;
  return {
    doc: st.doc, selection: st.selection, snap: visibleSnap(), angleStep: 5, tolerance: 9 / view.scale,
    material: $('material-select').value || null,
    get model() { return (model ??= canvasModelFor(st.doc, st.selection)); },
  };
}

function applyEffects(effects) {
  let needsRefresh = false;
  for (const e of effects) {
    switch (e.type) {
      case 'doc':
        if (e.transient) display = e.doc;
        else { st = commit(st, e.doc); display = null; needsRefresh = true; status(''); }
        break;
      case 'select': st = select(st, e.selection); needsRefresh = true; break;
      case 'pan': view = panByPixels(view, e.dx, e.dy); break;
      case 'draft': draft = e.draft; break;
      case 'message': status(e.text, true); break;
      case 'cancel': display = null; needsRefresh = true; break;
    }
  }
  if (needsRefresh) refresh(); else paint();
}

function dispatch(type, e, key) {
  if (!st) return;
  const rect = svg.getBoundingClientRect();
  const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  const r = handleEvent(controller, { type, point: toDetail(view, size, screen), screen, key }, controllerContext());
  controller = r.state;
  applyEffects(r.effects);
}

svg.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  try { svg.setPointerCapture(e.pointerId); } catch { /* synthetic events have no active pointer */ }
  dispatch('down', e);
});
svg.addEventListener('pointermove', (e) => dispatch('move', e));
svg.addEventListener('pointerup', (e) => dispatch('up', e));
svg.addEventListener('dblclick', (e) => dispatch('dblclick', e));
svg.addEventListener('wheel', (e) => {
  if (!st) return;
  e.preventDefault();
  const rect = svg.getBoundingClientRect();
  view = zoomAt(view, size, { x: e.clientX - rect.left, y: e.clientY - rect.top }, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  paint();
}, { passive: false });

window.addEventListener('keydown', (e) => {
  const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName);
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); return; }
  if (typing || !st) return;
  const tools = { v: 'select', r: 'rect', p: 'polygon' };
  if (!mod && tools[e.key.toLowerCase()]) { chooseTool(tools[e.key.toLowerCase()]); return; }
  if (!mod && e.key.toLowerCase() === 'f') { fit(); return; }
  if (['Escape', 'Delete', 'Backspace', 'Enter'].includes(e.key)) {
    if (e.key !== 'Escape') e.preventDefault();
    dispatch('key', { clientX: 0, clientY: 0 }, e.key);
  }
});

new ResizeObserver(() => {
  const first = size.width === 800 && size.height === 600;
  size = { width: Math.max(1, wrap.clientWidth), height: Math.max(1, wrap.clientHeight) };
  if (first && st) fit(); else paint();
}).observe(wrap);

// ── opening bundles ──────────────────────────────────────────────────────────
function openContext(ctx, adapter, source, activeId = null) {
  bundle = { ctx, adapter, source };
  $('project-name').textContent = ctx.projectName;
  $('detail-select').disabled = false;
  $('new-btn').disabled = false;
  $('zip-btn').hidden = source !== 'memory';

  const mat = $('material-select');
  mat.replaceChildren(...ctx.materialIds.map((id) => Object.assign(document.createElement('option'), { value: id, textContent: id })));
  mat.disabled = ctx.materialIds.length === 0;

  st = null; display = null; draft = null; controller = createController('select');
  updateDetailSelect();
  const first = activeId && ctx.detailIds.includes(activeId) ? activeId : ctx.detailIds.length === 1 ? ctx.detailIds[0] : null;
  if (first) openDetail(first); else refresh();
  status(ctx.warnings.length ? `Opened with ${ctx.warnings.length} warning(s): ${ctx.warnings[0]}` : `Opened ${ctx.projectName}`);
}

function updateDetailSelect() {
  const sel = $('detail-select');
  const ids = [...bundle.ctx.detailIds];
  if (st && !ids.includes(st.doc.id)) ids.push(st.doc.id);
  sel.replaceChildren(
    Object.assign(document.createElement('option'), { value: '', textContent: '— select detail —' }),
    ...ids.map((id) => Object.assign(document.createElement('option'), { value: id, textContent: id })));
  sel.value = st?.doc.id ?? '';
}

function openDetail(id) {
  const doc = bundle.ctx.details.find((d) => d.id === id);
  if (!doc) { status(`Detail "${id}" is not in this bundle`, true); return; }
  st = createState(structuredClone(doc));
  display = null; draft = null; controller = createController('select');
  $('empty').hidden = true;
  fit();
  refresh();
  fit();
}

$('detail-select').addEventListener('change', () => {
  const id = $('detail-select').value;
  if (!id || (st && id === st.doc.id)) return;
  if (st && isDirty(st) && !window.confirm('Discard unsaved changes to this detail?')) { updateDetailSelect(); return; }
  openDetail(id);
});

async function openFolder() {
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    const adapter = new FsaAdapter(handle);
    openContext(await loadDetailContext(adapter), adapter, 'fsa');
  } catch (err) { if (err.name !== 'AbortError') status(`Could not open folder: ${err.message}`, true); }
}
async function openMemory(file) {
  try {
    const adapter = await MemoryAdapter.fromFile(file);
    openContext(await loadDetailContext(adapter), adapter, 'memory');
  } catch (err) { status(`Could not open archive: ${err.message}`, true); }
}
async function openDemo() {
  try {
    const resp = await fetch(import.meta.env.BASE_URL + 'terraced-house.oebfz');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    await openMemory(new File([await resp.blob()], 'terraced-house.oebfz'));
  } catch (err) { status(`Could not load the demo: ${err.message}`, true); }
}

if (!window.showDirectoryPicker) { $('open-btn').disabled = true; $('open-btn').title = 'Needs a Chromium-based browser; use Open .oebfz instead.'; }
$('open-btn').addEventListener('click', openFolder);
$('open-file-btn').addEventListener('click', () => $('oebfz-input').click());
$('oebfz-input').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) openMemory(f); e.target.value = ''; });
$('demo-btn').addEventListener('click', openDemo);
$('zip-btn').addEventListener('click', () => bundle?.adapter?.downloadZip?.());

// ── new detail ───────────────────────────────────────────────────────────────
$('new-btn').addEventListener('click', () => {
  const dlg = $('new-dialog');
  const mk = (tag, props = {}) => Object.assign(document.createElement(tag), props);
  const opts = (sel, values) => values.forEach((v) => sel.append(mk('option', { value: v, textContent: v })));
  const name = mk('input', { type: 'text', placeholder: 'eg Wall to slab at DPC' });
  const desc = mk('input', { type: 'text', placeholder: 'What this detail shows' });
  const plane = mk('select'); opts(plane, PLANES);
  const members = [0, 1].map((i) => { const k = mk('select'); opts(k, KINDS); const p = mk('select'); opts(p, bundle.ctx.profileIds); return { k, p, i }; });
  const rowOf = (label, ...controls) => { const r = mk('div', { className: 'row' }); r.append(mk('label', { textContent: label }), ...controls); return r; };
  const create = mk('button', { className: 'primary', textContent: 'Create' });
  const cancel = mk('button', { textContent: 'Cancel' });
  create.addEventListener('click', () => {
    try {
      const doc = createDetail({
        name: name.value, description: desc.value || name.value, plane: plane.value,
        members: members.map(({ k, p }) => ({ kind: k.value, profile_id: p.value })), existingIds: bundle.ctx.detailIds,
      });
      st = { ...createState(doc), saved: null };   // new, so dirty until first save
      display = null; draft = null; controller = createController('select');
      dlg.close(); refresh(); fit(); status('New detail. Add regions with the Rect or Polygon tool, then Save.');
    } catch (err) { status(err.message, true); }
  });
  cancel.addEventListener('click', () => dlg.close());
  dlg.replaceChildren(
    mk('h3', { textContent: 'New detail' }), rowOf('Name', name), rowOf('Description', desc), rowOf('View', plane),
    rowOf('Member 1', members[0].k, members[0].p), rowOf('Member 2', members[1].k, members[1].p),
    create, cancel);
  dlg.showModal();
});

// ── save ─────────────────────────────────────────────────────────────────────
async function save() {
  if (!st || !bundle) return;
  const problems = validateDetail(st.doc, validationContext());
  if (problems.length) { status(`Not saved: ${problems[0].message}`, true); return; }
  try {
    if (bundle.source === 'snapshot') {
      if (!window.opener || window.opener.closed) throw new Error('The editor window that opened this page has been closed.');
      window.opener.postMessage(savedMessage({ doc: st.doc }), window.location.origin);
    } else {
      await saveDetail(bundle.adapter, st.doc, validationContext());
      // Tell the main editor so it can refresh the 3D view (the file is already written).
      if (window.opener && !window.opener.closed) window.opener.postMessage(savedMessage({ doc: st.doc, persisted: true }), window.location.origin);
    }
    const saved = structuredClone(st.doc);
    const at = bundle.ctx.details.findIndex((d) => d.id === saved.id);
    if (at >= 0) bundle.ctx.details[at] = saved; else { bundle.ctx.details.push(saved); bundle.ctx.detailIds.push(saved.id); }
    st = markSaved(st);
    status(bundle.source === 'memory' ? 'Saved in memory. Use Download bundle to keep it.' : 'Saved');
    refresh();
  } catch (err) { status(`Save failed: ${err.message}`, true); }
}
$('save-btn').addEventListener('click', save);

window.addEventListener('beforeunload', (e) => { if (st && isDirty(st)) { e.preventDefault(); e.returnValue = ''; } });

// ── handoff from the main editor ─────────────────────────────────────────────
if (window.opener) {
  window.addEventListener('message', async (event) => {
    const msg = parseIncoming(event, { ownOrigin: window.location.origin, opener: window.opener });
    if (!msg) return;
    try {
      if (msg.type === 'bundle-handle') {
        const adapter = new FsaAdapter(msg.handle);
        openContext(await loadDetailContext(adapter), adapter, 'fsa', msg.activeDetailId);
      } else {
        openContext(snapshotToContext(msg.snapshot), null, 'snapshot', msg.activeDetailId ?? msg.snapshot.activeDetailId);
      }
    } catch (err) { status(`Could not load the bundle: ${err.message}`, true); }
  });
  window.opener.postMessage(readyMessage(), window.location.origin);
}

// ── demo mode (also used for headless checks) ────────────────────────────────
if (new URLSearchParams(window.location.search).has('demo')) openDemo();

// Read-only hook for headless checks and bug reports.
window.__detailEditor = { state: () => st, view: () => view, size: () => size, adapter: () => bundle?.adapter ?? null, status: () => $('status').textContent };
