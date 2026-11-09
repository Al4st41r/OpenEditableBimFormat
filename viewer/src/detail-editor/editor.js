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
import { setUnit, getUnit, toDisplay, fromDisplay } from '../editor/units.js';
import * as D from './detailDocument.js';
import * as AN from './annotationOps.js';
import * as RF from './referenceOps.js';
import { HttpAdapter, BUNDLE_NAME } from './httpAdapter.js';
import { detailToDxf } from './dxfExport.js';
import { copySelection, parsePayload, pasteInto } from './clipboard.js';
import { defaultLayers, setLayer, applyLayers, blocked, keepSelection, layerOfSelection, editable, LAYER_LABELS } from './layers.js';
import { validateDetail } from './detailValidate.js';
import { createDetail, toJsonText } from './detailSerializer.js';
import { loadDetailContext, saveDetail } from './detailStore.js';
import { snapshotToContext } from './bundleSnapshot.js';
import { readyMessage, parseIncoming, savedMessage, focusMessage } from './messages.js';
import { buildBuildingReference } from './buildingReference.js';
import { DETAIL_FIELDS, applyJunctionFields, validateJunctionFields, junctionMessage } from './junctionFields.js';
import { assignDetail, unassignDetail, setOverride, setMirrored, setLocation, suggestLocation, validateLocation } from './junctionAssign.js';
import { regionIndices, selectionOfRegions } from './pageState.js';
import { createState, commit, undo, redo, select, setPreview, setTool, markSaved, isDirty, canUndo, canRedo } from './pageState.js';
import { buildCanvasModel, rulerTicks } from './canvasModel.js';
import { createController, setControllerTool, handleEvent } from './canvasController.js';
import { buildPanelModel } from './panelModel.js';
import { fitView, toDetail, zoomAt, panByPixels } from './viewTransform.js';
import { translateRegions, transformRegions, selectionCentre } from './canvasEdit.js';
import { renderCanvas } from './render.js';
import { primitiveStyle } from './drawStyle.js';
import { parseTypedPoint } from './typedPoint.js';
import { renderPanels } from './panels.js';
import { snapPoint, SNAP_KINDS } from '../snap/snapEngine.js';
import { buildTooltip } from '../snap/tooltip.js';
import { buildSnapScene } from './snapScene.js';
import { setRegionEdgeLength, setRegionSize } from './dimensionOps.js';
import { KINDS, PLANES, TOOLS, MARK_TOOLS } from './detailConstants.js';

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
// smart cursor (issue #105)
const SNAP_LABELS = {
  endpoint: 'Endpoint', intersection: 'Intersection', midpoint: 'Midpoint', perpendicular: 'Perpendicular', parallel: 'Parallel',
  angle: 'Angle', 'grid-axis': 'Drawing origin axes', alignment: 'Alignment', 'on-line': 'On line', step: 'Ruler step',
};
const snapState = { on: true, kinds: new Set(SNAP_KINDS), angleStep: 45 };
try {
  const saved = JSON.parse(localStorage.getItem('oebf-detail-snap') ?? 'null');
  if (saved) { snapState.on = saved.on !== false; snapState.kinds = new Set(saved.kinds ?? SNAP_KINDS); snapState.angleStep = saved.angleStep ?? 45; }
} catch { /* defaults */ }
const saveSnapState = () => { try { localStorage.setItem('oebf-detail-snap', JSON.stringify({ on: snapState.on, kinds: [...snapState.kinds], angleStep: snapState.angleStep })); } catch { /* optional */ } };
let hint = null;            // { snap, lastPoint } from the controller
let pointer = { x: 0, y: 0, alt: false };
const anchors = { edge: 'start', rect: 'bottom-left' };   // what stays put when a typed length or size is applied

let refLevel = null;        // building reference: level filter (null = all)
let refHighlight = null;    // building reference: the junction picked on the plan or in the list

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

// Layers: view state only; hidden things are not drawn, picked or snapped to, locked ones are drawn but not picked.
let layers = defaultLayers();

function canvasModelFor(doc, selection) {
  return applyLayers(buildCanvasModel(doc, { profiles: bundle.ctx.profiles, materials: bundle.ctx.materials, values: st.preview, selection }), layers);
}

function visibleSnap() {
  const span = size.width / view.scale;
  return Math.max(0.001, rulerTicks(0, span, 8).step / 10);
}

// ── painting ─────────────────────────────────────────────────────────────────
function paint() {
  if (!st) { svg.replaceChildren(); return; }
  renderCanvas(svg, canvasModelFor(currentDoc(), st.selection), view, size, { draft, hint, styleOf: (p) => primitiveStyle(p, { doc: currentDoc(), materials: bundle.ctx.materials, profiles: bundle.ctx.profiles }) });
  paintTip();
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
      grids: bundle.ctx.grids, levels: bundle.ctx.levels, elementPaths: bundle.ctx.elementPaths, previewValues: st.preview, profiles: bundle.ctx.profiles,
    });
    const reference = {
      data: buildBuildingReference({
        detailId: st.doc.id, details: bundle.ctx.detailIds, junctions: bundle.ctx.junctions, elementPaths: bundle.ctx.elementPaths,
        elements: bundle.ctx.elements, grids: bundle.ctx.grids, levels: bundle.ctx.levels, levelId: refLevel,
        candidateIds: pm.usage.candidates.map((c) => c.id),
      }),
      levels: bundle.ctx.levels, levelId: refLevel, highlight: refHighlight,
      canShow3D: !!window.opener && !window.opener.closed,
    };
    renderPanels({ left: $('left-panel'), right: $('right-panel') }, pm, {
      profileIds: bundle.ctx.profileIds, materialIds: bundle.ctx.materialIds, materials: bundle.ctx.materials, previewValues: st.preview, reference, anchors, layers,
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
  for (const t of TOOLS) $(`tool-${t}`).classList.toggle('active', st?.tool === t || (!st && t === 'select'));
  const mark = MARK_TOOLS.includes(st?.tool);
  $('marks-menu').classList.toggle('active', mark);
  $('marks-summary').textContent = mark ? `Marks: ${$(`tool-${st.tool}`).textContent}` : 'Marks';
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
  rerender: () => refresh(),
  select: (sel) => {
    const key = layerOfSelection(sel);
    if (!editable(layers, key)) { status(`The ${LAYER_LABELS[key].toLowerCase()} layer is hidden or locked.`, true); return; }
    st = select(st, sel); refresh();
  },
  setLayer: (key, field, value) => {
    layers = setLayer(layers, key, field, value);
    if (st) st = select(st, keepSelection(layers, st.selection));
    refresh();
  },
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
  // Numeric move, copy, rotate and mirror of every picked region, about the centre of the selection
  moveBy: (dx, dy, copy) => {
    const picked = regionIndices(st.selection);
    if (!picked.length) return;
    if (copy) {
      const n = st.doc.geometry.regions.length;
      apply((d) => D.duplicateRegions(d, picked, dx, dy));
      st = select(st, selectionOfRegions(picked.map((_, k) => n + k))); refresh();
      status(`Copied ${picked.length} region(s).`);
    } else {
      const r = translateRegions(st.doc, picked, dx, dy);
      apply(() => r.doc);
      if (r.locked.length) status('Coordinates bound to a parameter stay where they are.');
    }
  },
  transform: (op) => {
    const picked = regionIndices(st.selection);
    const about = selectionCentre(st.doc, picked);
    if (!about) { status('Nothing to transform: every vertex is bound to a parameter.', true); return; }
    const r = transformRegions(st.doc, picked, { ...op, about });
    apply(() => r.doc);
    if (r.locked.length) status(`${r.locked.length} vertex(es) bound to a parameter stayed where they are.`);
  },
  offsetRegion: (distance, copy) => {
    if (st.selection?.type !== 'region') return;
    const n = st.doc.geometry.regions.length;
    apply((d) => D.offsetRegion(d, st.selection.index, distance, { copy }));
    if (copy && st.doc.geometry.regions.length > n) { st = select(st, { type: 'region', index: n }); refresh(); }
  },
  cornerRegion: (vertex, size, mode) => {
    if (st.selection?.type !== 'region') return;
    apply((d) => D.cornerRegion(d, st.selection.index, vertex, size, mode));
    st = select(st, { type: 'region', index: st.selection.index }); refresh();   // the old vertex index may no longer exist
  },
  layerOnEdge: (edge, thickness) => {
    if (st.selection?.type !== 'region') return;
    const n = st.doc.geometry.regions.length;
    apply((d) => D.addLayerOnEdge(d, st.selection.index, edge, thickness));
    if (st.doc.geometry.regions.length > n) { st = select(st, { type: 'region', index: n }); refresh(); }
  },
  extendTo: (side, to) => {
    if (st.selection?.type !== 'region') return;
    apply((d) => D.extendRegion(d, st.selection.index, side, to));
  },
  trimBy: (by) => {
    if (st.selection?.type !== 'region') return;
    apply((d) => D.trimRegion(d, st.selection.index, by));
  },
  setRegionNumber: (i, f, v) => apply((d) => D.setRegionNumber(d, i, f, v)),
  setRegionTag: (i, k, v) => apply((d) => D.setRegionTag(d, i, k, v)),
  setLayerUnit: (role, layer, spec) => apply((d) => D.setLayerUnit(d, role, layer, spec)),
  setLayerStart: (role, layer, start) => apply((d) => D.setLayerStart(d, role, layer, start)),
  setMemberReference: (role, axis, id) => apply((d) => RF.setMemberReference(d, role, axis, id)),
  addReferenceLine: (line) => apply((d) => RF.addReferenceLine(d, line)),
  updateReferenceLine: (i, patch) => apply((d) => RF.updateReferenceLine(d, i, patch)),
  removeReferenceLine: (i) => apply((d) => RF.removeReferenceLine(d, i)),
  setClip: (patch) => apply((d) => RF.setClip(d, patch)),
  enableClip: () => {
    const b = canvasModelFor(st.doc, null).bounds;
    if (!b) { status('Nothing is drawn to clip to yet.', true); return; }
    apply((d) => RF.setClip(d, { x_min_m: b.min.x, x_max_m: b.max.x, y_min_m: b.min.y, y_max_m: b.max.y }));
  },
  updateAnnotation: (i, patch) => apply((d) => AN.updateAnnotation(d, i, patch)),
  removeAnnotation: (i) => { apply((d) => AN.removeAnnotation(d, i)); st = select(st, null); refresh(); },
  removeRegion: (i) => apply((d) => D.removeRegion(d, i)),
  moveVertex: (r, v, c) => apply((d) => D.moveVertex(d, r, v, c)),
  bind: (r, v, axis, param) => apply((d) => D.bindCoordinate(d, r, v, axis, { param })),
  unbind: (r, v, axis) => apply((d) => D.unbindCoordinate(d, r, v, axis)),
  addParameter: (name, spec) => apply((d) => D.addParameter(d, name, spec)),
  updateParameter: (name, patch) => apply((d) => D.updateParameter(d, name, patch)),
  removeParameter: (name) => apply((d) => D.removeParameter(d, name)),
  renameParameter: (from, to) => apply((d) => D.renameParameter(d, from, to).doc),
  setConditionRule: (rule) => apply((d) => (rule === null ? D.setCondition(d, null) : D.setCondition(d, { ...(d.condition ?? {}), rule, member_count: d.members.length, member_kinds: d.members.map((m) => m.kind) }))),
  notify: (text) => status(text, true),
  setAnchor: (kind, value) => { anchors[kind] = value; refresh(); },
  setEdgeLength: (r, edge, length) => apply((d) => setRegionEdgeLength(d, r, edge, length, anchors.edge, st.preview).doc),
  setRegionSize: (r, w, h) => apply((d) => setRegionSize(d, r, w, h, anchors.rect, st.preview).doc),
  referencePick: (id) => {
    refHighlight = refHighlight === id ? null : id;
    refresh();
    if (refHighlight) document.querySelector(`#right-panel [data-id="${CSS.escape(refHighlight)}"]`)?.scrollIntoView({ block: 'nearest' });
  },
  referenceLevel: (levelId) => { refLevel = levelId; refresh(); },
  referenceShow3D: (id) => {
    if (!window.opener || window.opener.closed) { status('Open this page from the main editor to show a junction in 3D.', true); return; }
    window.opener.postMessage(focusMessage({ junctionId: id }), window.location.origin);
    status(`Showing ${id} in the 3D editor.`);
  },
  junctionMirror: (id, v) => updateJunction(id, (j) => setMirrored(j, v)),
  junctionOverride: (id, name, value) => updateJunction(id, (j) => setOverride(j, st.doc, name, value)),
  junctionUnassign: (id) => updateJunction(id, (j) => unassignDetail(j)),
  junctionLocation: (id) => openLocationPicker(id, 'change'),
  junctionAssign: (id) => openLocationPicker(id, 'assign'),
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
  closeCmd();
  st = setTool(st, tool);
  controller = setControllerTool(controller, tool);
  draft = null;
  refresh();
}
for (const t of TOOLS) $(`tool-${t}`).addEventListener('click', () => { $('marks-menu').open = false; chooseTool(t); });

// ── canvas interaction ───────────────────────────────────────────────────────
function controllerContext() {
  let model;
  const getModel = () => (model ??= canvasModelFor(st.doc, st.selection));
  const step = visibleSnap();
  return {
    blocked: blocked(layers), doc: st.doc, selection: st.selection, snap: step, angleStep: 5, tolerance: 9 / view.scale,
    material: $('material-select').value || null,
    suspendSnap: pointer.alt,
    // The smart cursor: named snaps against everything drawn, in pixels converted to metres at this zoom.
    snapFn: snapState.on
      ? (point, extra) => snapPoint(point, buildSnapScene(getModel(), { exclude: extra.exclude, lastPoint: extra.lastPoint, step }), {
        tolerance: 9 / view.scale, kinds: snapState.kinds, angleStep: snapState.angleStep, suspend: extra.suspend,
      })
      : null,
    get model() { return getModel(); },
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
      case 'select': {
        // something just drawn on a hidden or locked layer brings that layer back, so it is not lost from view
        const key = layerOfSelection(e.selection);
        if (key && !editable(layers, key) && controller.tool !== 'select') layers = setLayer(setLayer(layers, key, 'visible', true), key, 'locked', false);
        st = select(st, keepSelection(layers, e.selection)); needsRefresh = true; break;
      }
      case 'pan': view = panByPixels(view, e.dx, e.dy); break;
      case 'draft': draft = e.draft; break;
      case 'hint': hint = e.hint; break;
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
  pointer = { x: screen.x, y: screen.y, alt: !!e.altKey };
  const r = handleEvent(controller, { type, point: toDetail(view, size, screen), screen, key, shift: !!e.shiftKey }, controllerContext());
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

// ── typed coordinates ────────────────────────────────────────────────────────
// With a drawing tool active, typing a digit, minus, @ or . opens a command box. Enter places the point exactly,
// with no snapping: 2400,1200 absolute, @300,0 relative, 500<45 polar, or a distance towards the cursor.
const DRAWING_TOOLS = TOOLS.filter((t) => t !== 'select');
function lastPoint() {
  const d = controller.draft;
  if (!d) return null;
  if (d.kind === 'polygon' || d.kind === 'line') return d.points.at(-1) ?? null;
  if (d.kind === 'note') return d.to;
  if (d.kind === 'arc' || d.kind === 'circle') return d.c;
  return d.a ?? null;
}
function cmdHint() {
  const d = controller.draft;
  const tool = st?.tool;
  if (tool === 'rect') return d ? 'Opposite corner: @w,h' : 'First corner: x,y';
  if (tool === 'polygon') return d ? 'Next point: @dx,dy or d<angle. Enter on empty closes.' : 'First point: x,y';
  if (tool === 'line') return d ? 'Next point: @dx,dy or d<angle. Enter on empty finishes.' : 'First point: x,y';
  if (tool === 'circle') return d ? 'Point on the circle: @dx,dy or d<angle' : 'Centre: x,y';
  if (tool === 'arc') return !d ? 'Centre: x,y' : d.stage === 1 ? 'Start point: @dx,dy or d<angle' : 'End point: @dx,dy or d<angle';
  if (tool === 'dim') return d?.stage === 2 ? 'Click to place the dimension line' : d ? 'Second point: @dx,dy or d<angle' : 'First point: x,y';
  if (tool === 'note') return d ? 'Text position: x,y' : 'Point to label: x,y';
  return d && !d.fixed ? 'Second point: @dx,dy or d<angle' : 'First point: x,y';
}
function openCmd(initial = '') {
  $('cmd').hidden = false;
  $('cmd-hint').textContent = cmdHint();
  const input = $('cmd-input');
  input.value = initial;
  input.focus();
}
function closeCmd() {
  if ($('cmd').hidden) return;
  $('cmd').hidden = true;
  $('cmd-input').blur();
}
function commitTyped(point) {
  const ctx = { ...controllerContext(), snapFn: null, snap: 0, suspendSnap: true };
  const screen = { x: 0, y: 0 };
  const kind = st.tool === 'rect' && controller.draft ? 'up' : 'down';
  const r = handleEvent(controller, { type: kind, point, screen }, ctx);
  controller = r.state;
  applyEffects(r.effects);
}
$('cmd-input').addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Escape') { closeCmd(); return; }
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const text = $('cmd-input').value.trim();
  if (text === '') {
    if ((st.tool === 'polygon' || st.tool === 'line') && controller.draft) { dispatch('key', { clientX: 0, clientY: 0 }, 'Enter'); closeCmd(); }
    return;
  }
  const res = parseTypedPoint(text, { last: lastPoint(), cursor: pointer.x || pointer.y ? toDetail(view, size, pointer) : null, unit: getUnit() });
  if (res.error) { status(res.error, true); return; }
  status('');
  commitTyped(res.point);
  $('cmd-input').value = '';
  $('cmd-hint').textContent = cmdHint();
  if (st.tool === 'rect' && !controller.draft) closeCmd();   // the rectangle is complete
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Alt') pointer.alt = true;
  if (st && DRAWING_TOOLS.includes(st.tool) && !e.ctrlKey && !e.metaKey && !e.altKey && /^[0-9@.\-]$/.test(e.key)
      && !['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) {
    e.preventDefault();
    openCmd(e.key);
    return;
  }
  const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName);
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); return; }
  if (typing || !st) return;
  const sel = st.selection;
  if (mod && e.key.toLowerCase() === 'a' && st.doc.geometry?.regions?.length && editable(layers, 'regions')) {
    e.preventDefault();
    st = select(st, selectionOfRegions(st.doc.geometry.regions.map((_, i) => i))); refresh();
    status(`${st.doc.geometry.regions.length} region(s) selected.`);
    return;
  }
  if (sel?.type === 'region') {
    const picked = regionIndices(sel);
    const n = st.doc.geometry.regions.length;
    const step = visibleSnap() * (e.shiftKey ? 10 : 1);
    const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (!mod && arrows[e.key]) {
      e.preventDefault();
      const r = translateRegions(st.doc, picked, ...arrows[e.key]);
      apply(() => r.doc);
      if (r.locked.length) status('Coordinates bound to a parameter stay where they are.');
      return;
    }
    if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      const off = visibleSnap() * 5;
      apply((d) => D.duplicateRegions(d, picked, off, -off));
      st = select(st, selectionOfRegions(picked.map((_, k) => n + k))); refresh();
      status(picked.length > 1 ? `Duplicated ${picked.length} regions. Drag or use the arrow keys to place them.` : 'Duplicated. Drag or use the arrow keys to place the copy.');
      return;
    }
    if (!mod && picked.length === 1 && (e.key === ']' || e.key === '[')) {
      const to = e.key === ']' ? Math.min(n - 1, sel.index + 1) : Math.max(0, sel.index - 1);
      if (to !== sel.index) { apply((d) => D.moveRegionTo(d, sel.index, to)); st = select(st, { type: 'region', index: to }); refresh(); }
      return;
    }
  }
  const tools = { v: 'select', r: 'rect', p: 'polygon', m: 'measure', l: 'line', a: 'arc', c: 'circle', d: 'dim', n: 'note' };
  if (!mod && tools[e.key.toLowerCase()]) { chooseTool(tools[e.key.toLowerCase()]); return; }
  if (!mod && e.key.toLowerCase() === 'f') { fit(); return; }
  if (!mod && e.key.toLowerCase() === 's') { toggleSnap(); return; }
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

// ── smart cursor: tooltip and snap controls ──────────────────────────────────
function paintTip() {
  const tip = $('tip');
  if (!hint?.snap || !snapState.on) { tip.hidden = true; return; }
  const t = buildTooltip({ snap: hint.snap, lastPoint: hint.lastPoint, unit: getUnit() });
  tip.replaceChildren();
  const add = (cls, text) => { const d = document.createElement('div'); if (cls) d.className = cls; d.textContent = text; tip.append(d); };
  if (t.title) add('t', t.title);
  for (const line of t.lines) add('', line);
  add('c', t.coords);
  tip.hidden = false;
  const room = { w: wrap.clientWidth, h: wrap.clientHeight };
  const x = pointer.x + 16 + tip.offsetWidth > room.w ? pointer.x - 16 - tip.offsetWidth : pointer.x + 16;
  const y = pointer.y + 18 + tip.offsetHeight > room.h ? pointer.y - 18 - tip.offsetHeight : pointer.y + 18;
  tip.style.left = `${Math.max(0, x)}px`; tip.style.top = `${Math.max(0, y)}px`;
}

svg.addEventListener('pointerleave', () => { if (hint) { hint = null; paint(); } });

function refreshSnapControls() {
  $('snap-btn').classList.toggle('active', snapState.on);
  const body = $('snap-menu-body');
  body.replaceChildren();
  for (const kind of SNAP_KINDS) {
    const label = document.createElement('label');
    const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: snapState.kinds.has(kind) });
    cb.addEventListener('change', () => { if (cb.checked) snapState.kinds.add(kind); else snapState.kinds.delete(kind); saveSnapState(); });
    label.append(cb, SNAP_LABELS[kind]);
    body.append(label);
  }
  const angle = document.createElement('label');
  const sel = document.createElement('select');
  for (const v of [0, 15, 30, 45, 90]) sel.append(Object.assign(document.createElement('option'), { value: v, textContent: v === 0 ? 'Angle snap off' : `Angle step ${v}°`, selected: v === snapState.angleStep }));
  sel.addEventListener('change', () => { snapState.angleStep = Number(sel.value); saveSnapState(); });
  angle.append(sel);
  body.append(angle);
}
function toggleSnap() { snapState.on = !snapState.on; saveSnapState(); hint = null; refreshSnapControls(); paint(); status(snapState.on ? 'Snapping on' : 'Snapping off'); }
$('snap-btn').addEventListener('click', toggleSnap);
refreshSnapControls();

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
  display = null; draft = null; controller = createController('select'); refHighlight = null;
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

// ── junctions: assign, relocate, override, mirror ────────────────────────────
/**
 * Change one junction's detail fields. `change` is a pure operation from
 * junctionAssign.js; the result is written to the bundle (or sent to the main
 * editor when this page was opened from a snapshot) and the local copy updated.
 */
async function updateJunction(junctionId, change) {
  if (!st || !bundle) return;
  if (isDirty(st)) { status('Save the detail before changing junctions.', true); return; }
  const live = bundle.ctx.junctions.find((j) => j.id === junctionId);
  if (!live) { status(`Junction "${junctionId}" is not in this bundle`, true); return; }
  try {
    const next = change(live);
    const fields = Object.fromEntries(DETAIL_FIELDS.map((k) => [k, next[k] ?? null]));
    const problems = validateJunctionFields(fields);
    if (problems.length) throw new Error(problems[0].message);

    if (bundle.source === 'snapshot') {
      if (!window.opener || window.opener.closed) throw new Error('The editor window that opened this page has been closed.');
      window.opener.postMessage(junctionMessage({ junctionId, fields, persisted: false }), window.location.origin);
    } else {
      const path = `junctions/${junctionId}.json`;
      await bundle.adapter.writeJson(path, applyJunctionFields(await bundle.adapter.readJson(path), fields));
      if (window.opener && !window.opener.closed) window.opener.postMessage(junctionMessage({ junctionId, fields, persisted: true }), window.location.origin);
    }
    for (const k of DETAIL_FIELDS) { if (next[k] !== undefined) live[k] = next[k]; else delete live[k]; }
    status(`Updated ${junctionId}.`);
    refresh();
  } catch (err) { status(err.message, true); }
}

/** Choose a grid location for a junction (assign a detail to it, or move it), pre-filled from where it is. */
function openLocationPicker(junctionId, mode) {
  const live = bundle.ctx.junctions.find((j) => j.id === junctionId);
  const { grids, levels } = bundle.ctx;
  const dlg = $('loc-dialog');
  const mk = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  const opt = (v, t = v) => mk('option', { value: v, textContent: t });
  const row = (label, control) => mk('div', { className: 'row' }, mk('label', { textContent: label }), control);

  if (grids.length === 0 || levels.length === 0) { status('This bundle has no grid or no storey to place a detail on. Add them in the main editor first.', true); return; }
  const start = (mode === 'change' ? live.location : null) ?? suggestLocation(live, bundle.ctx) ?? { grid_id: grids[0].id, axes: [], level_id: levels[0].id, level_offset_m: 0 };

  const grid = mk('select'); grids.forEach((g) => grid.append(opt(g.id))); grid.value = start.grid_id;
  const ns = mk('select'); const ew = mk('select');
  const level = mk('select'); levels.forEach((l) => level.append(opt(l.id, `${l.id} (${l.elevation} m)`)));  level.value = start.level_id;
  const offset = mk('input', { type: 'number', step: getUnit() === 'mm' ? 1 : 0.001, value: toDisplay(start.level_offset_m ?? 0) });
  const mirrored = mk('input', { type: 'checkbox' });
  const msg = mk('div', { className: 'note' });
  const ok = mk('button', { className: 'primary', textContent: mode === 'assign' ? 'Assign' : 'Move' });
  const cancel = mk('button', { textContent: 'Cancel' });

  const fillAxes = () => {
    const g = grids.find((x) => x.id === grid.value);
    const pick = (sel, dir, keep) => { sel.replaceChildren(...g.axes.filter((a) => a.direction === dir).map((a) => opt(a.id, `${a.id} (${dir === 'y' ? 'x' : 'y'} = ${toDisplay(a.offset_m)} ${getUnit()})`))); if (keep) sel.value = keep; };
    pick(ns, 'y', start.axes[0]); pick(ew, 'x', start.axes[1]);
  };
  const current = () => ({ grid_id: grid.value, axes: [ns.value, ew.value], level_id: level.value, level_offset_m: fromDisplay(parseFloat(offset.value) || 0) });
  const check = () => {
    const problems = ns.value && ew.value ? validateLocation(current(), bundle.ctx) : ['This grid needs a north-south and an east-west axis.'];
    msg.textContent = problems.join(' ');
    ok.disabled = problems.length > 0;
  };
  fillAxes(); check();
  grid.addEventListener('change', () => { fillAxes(); check(); });
  for (const c of [ns, ew, level, offset]) c.addEventListener('change', check);

  ok.addEventListener('click', () => {
    const loc = current();
    dlg.close();
    if (mode === 'assign') updateJunction(junctionId, (j) => assignDetail(j, st.doc, { location: loc, mirrored: mirrored.checked }));
    else updateJunction(junctionId, (j) => setLocation(j, loc));
  });
  cancel.addEventListener('click', () => dlg.close());

  dlg.replaceChildren(
    mk('h3', { textContent: mode === 'assign' ? `Assign ${st.doc.id} to ${junctionId}` : `Move ${junctionId}` }),
    mk('div', { className: 'note', textContent: start.exact === false ? 'Suggested from where the walls meet; the nearest grid point is more than 300 mm away, so check it.' : 'The grid point and level the junction sits at.' }),
    row('Grid', grid), row('N-S axis', ns), row('E-W axis', ew), row('Level', level), row(`Offset (${getUnit()})`, offset),
    ...(mode === 'assign' ? [row('Mirrored', mirrored)] : []),
    msg, ok, cancel);
  dlg.showModal();
}

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
    status(bundle.source === 'memory' ? 'Saved in memory. Use Zip to keep it.' : bundle.source === 'http' ? 'Saved in this page only. Export, Detail JSON keeps it.' : 'Saved');
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
// A link that opens a served example bundle on a detail:
//   ?bundle=nmb-two-storey.oebf&detail=detail-nmb-ew-slab-edge-section
//   ?bundle=terraced-house.oebf&detail=detail-corner-cavity-butt
async function openFromUrl(name, detailId) {
  try {
    if (!BUNDLE_NAME.test(name)) throw new Error(`"${name}" is not a bundle name`);
    const adapter = await HttpAdapter.open(`${import.meta.env.BASE_URL}${name}/`, name.replace(/\.oebf$/, ''));
    openContext(await loadDetailContext(adapter), adapter, 'http', detailId);
    if (detailId && !bundle.ctx.detailIds.includes(detailId)) status(`Detail "${detailId}" is not in ${name}`, true);
  } catch (err) { status(`Could not open ${name}: ${err.message}`, true); }
}
const query = new URLSearchParams(window.location.search);
if (query.has('bundle')) openFromUrl(query.get('bundle'), query.get('detail'));
else if (query.has('demo')) openDemo();

// Read-only hook for headless checks and bug reports.
window.__detailEditor = { snapState: () => snapState, hint: () => hint, state: () => st, view: () => view, size: () => size, adapter: () => bundle?.adapter ?? null, status: () => $('status').textContent };
// ── export ───────────────────────────────────────────────────────────────────
$('export-select').addEventListener('change', (e) => {
  const kind = e.target.value;
  e.target.value = '';
  if (!st) return;
  if (kind === 'json') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([toJsonText(st.doc)], { type: 'application/json' }));
    a.download = `${st.doc.id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    status('Saved the detail as JSON.');
    return;
  }
  if (kind !== 'dxf') return;
  const text = detailToDxf(st.doc, { profiles: bundle.ctx.profiles, materials: bundle.ctx.materials, values: st.preview ?? undefined });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/dxf' }));
  a.download = `${st.doc.id}.dxf`;
  a.click();
  URL.revokeObjectURL(a.href);
  status('Saved a DXF in millimetres.');
});

// ── clipboard ────────────────────────────────────────────────────────────────
// Uses the page's copy, cut and paste events, so it works through the system clipboard without a permission prompt.
let clipFrom = null, pasteCount = 0;   // the detail last copied from, and how many times it has been pasted back
const editingText = (e) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName);
function doCopy(e, cut) {
  if (!st || editingText(e) || !editable(layers, layerOfSelection(st.selection))) return;
  const payload = copySelection(st.doc, st.selection, st.preview ?? undefined);
  if (!payload) return;
  e.clipboardData.setData('text/plain', JSON.stringify(payload));
  e.preventDefault();
  clipFrom = st.doc.id; pasteCount = 0;
  const n = payload.regions.length + payload.annotations.length;
  status(`${cut ? 'Cut' : 'Copied'} ${n} item${n === 1 ? '' : 's'}.`);
  if (cut) {
    const sel = st.selection;
    apply((d) => (sel.type === 'region' ? D.removeRegions(d, regionIndices(sel)) : AN.removeAnnotation(d, sel.index)));
    st = select(st, null); refresh();
  }
}
document.addEventListener('copy', (e) => doCopy(e, false));
document.addEventListener('cut', (e) => doCopy(e, true));
document.addEventListener('paste', (e) => {
  if (!st || editingText(e)) return;
  const payload = parsePayload(e.clipboardData.getData('text/plain'));
  if (!payload) { status('The clipboard holds no regions or annotations from the detail editor.', true); return; }
  e.preventDefault();
  const again = clipFrom === st.doc.id;   // pasting back into the same detail would hide the copy, so step it aside
  const shift = again ? 0.05 * ++pasteCount : 0;
  try {
    const r = pasteInto(st.doc, payload, { dx: shift, dy: -shift, materialIds: bundle.ctx.materialIds });
    st = commit(st, r.doc); st = select(st, r.selection); display = null; refresh();
    status(`Pasted ${payload.regions.length + payload.annotations.length} item(s).`);
  } catch (err) { status(err.message, true); }
});
window.addEventListener('keyup', (e) => { if (e.key === 'Alt') pointer.alt = false; });
