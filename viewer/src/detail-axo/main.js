/**
 * main.js — axonometric detail viewer page.
 *
 * Open a bundle (a folder, or the NMB example served with the viewer), pick a detail, and look at it as an
 * axonometric: members swept from their profiles, plus the detail's own regions, extruded. The right panel
 * lists the junctions that use the detail, so a detail can be traced back to where it is drawn in the model.
 *
 *   ?bundle=<name>   bundle folder served next to this page (default nmb-two-storey.oebf)
 *   ?detail=<id>     detail to select on load
 */

import { FsaAdapter } from '../editor/storageAdapter.js';
import { AxoViewer } from './axoScene.js';
import { buildAxoModel, materialsUsed, usagesOf, AXO_VIEWS } from './detailAxo.js';
import { httpReader, loadDetailData } from './loadDetailData.js';
import { buildDetailSvg } from '../detail-review/detailSvg.js';
import { createSelection, describeItem } from '../detail-review/selection.js';
import { buildSnapshot } from '../detail-editor/bundleSnapshot.js';
import { isTrustedReady, buildOpenerReply, parseSaved } from '../detail-editor/messages.js';
import { buildSheet, printHtml, sheetFileName } from '../detail-review/sheet.js';
import { diffDetails } from '../detail-review/detailDiff.js';
import { OVERLAYS, applyOverlay, tagsOf, carbonValues } from '../detail-review/overlays.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEMO_BUNDLE = params.get('bundle') ?? 'nmb-two-storey.oebf';

const viewer = new AxoViewer($('canvas'));
let data = null;
let selectedId = null;
let model = null;
const selection = createSelection();
const view2d = { on: true, scale: 5, hairline: false, overlay: '', carbonUnit: 'kg' };
let overlayResult = null;
let source = { kind: 'http', readJson: null, handle: null };
let editorTab = null;
const originals = new Map();  // detail id -> the detail as first loaded, kept once it has been edited
let showOriginal = false;
const edited = new Map();   // detail id -> JSON edited in this page but not written to disk

function status(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderList() {
  const q = $('filter').value.trim().toLowerCase();
  const list = $('list');
  list.innerHTML = '';
  for (const d of data?.details ?? []) {
    if (q && !`${d.id} ${d.description}`.toLowerCase().includes(q)) continue;
    const uses = usagesOf(d.id, data.junctions).length;
    const row = document.createElement('div');
    row.className = 'item' + (d.id === selectedId ? ' selected' : '');
    row.innerHTML = `<span>${esc(d.id.replace(/^detail-nmb-/, '').replace(/^detail-/, ''))}</span>` +
      `<span class="meta">${esc(d.plane ?? 'section')}${uses ? ` · ${uses}` : ''}</span>`;
    row.title = d.description;
    row.addEventListener('click', () => select(d.id));
    list.appendChild(row);
  }
}

function changeSummary(shown) {
  const original = originals.get(shown.id);
  if (!original) return '';
  const current = data.details.find((d) => d.id === shown.id);
  const lines = diffDetails(original, current);
  return `<h3>${showOriginal ? 'Showing the original' : 'Changes from the original'}</h3>` +
    (lines.length ? lines.map((l) => `<div class="use">${esc(l)}</div>`).join('') : '<div class="note">No difference from the original.</div>');
}

function syncCompare() {
  $('compare-btn').hidden = !originals.has(selectedId);
  $('compare-btn').classList.toggle('active', showOriginal);
  $('compare-btn').textContent = showOriginal ? 'Showing original' : 'Original';
}

function renderInfo(detail, model) {
  const uses = usagesOf(detail.id, data.junctions);
  const mats = [...materialsUsed(model)].map(([id, n]) => {
    const m = data.materials.get(id);
    return `<div class="item"><span class="swatch" style="background:${esc(m?.colour_hex ?? '#999')}"></span>` +
      `<span>${esc(m?.name ?? id)}</span><span class="meta">${esc(m?.properties?.nmb_item ?? '')}</span></div>`;
  }).join('');
  const warnings = [...model.warnings, ...model.skipped.map((r) => `Member "${r}" is a slab or roof profile: drawn by the regions instead.`)];
  $('info').innerHTML =
    `<div id="detail-title">${esc(detail.id)}</div>` +
    `<div class="note">${esc(detail.description)}</div>` +
    changeSummary(detail) +
    `<div id="selected"></div><div id="legend"></div>` +
    `<h3>Drawn at</h3>` +
    (uses.length
      ? uses.map((u) => `<div class="use"><code>${esc(u.id)}</code><br>axes ${esc(u.axes.join(' / '))}, level ${esc(u.level)}</div>`).join('')
      : '<div class="note">No junction in this bundle uses this detail.</div>') +
    `<h3>Members</h3>` +
    (detail.members ?? []).map((m) => `<div class="use"><code>${esc(m.role)}</code> (${esc(m.kind)}) ${esc(m.profile_id)}</div>`).join('') +
    `<h3>Materials</h3>${mats}` +
    (warnings.length ? `<h3>Notes</h3>${warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join('')}` : '');
}

function detailById(id) {
  return showOriginal && originals.has(id) ? originals.get(id) : data?.details.find((d) => d.id === id);
}
function currentDetail() { return detailById(selectedId); }

/** Recompute the overlay for the current model and push it to both panes and the legend. */
function applyOverlays() {
  overlayResult = model && view2d.overlay
    ? applyOverlay(view2d.overlay, model, { materials: data.materials, profiles: data.profiles, detail: currentDetail() }, { unit: view2d.carbonUnit })
    : null;
  viewer.setOverlay(overlayResult?.colours ?? null, selection.get());
  draw2d();
  const l = $('legend');
  l.innerHTML = overlayResult
    ? `<h3>${esc(OVERLAYS.find((o) => o.id === view2d.overlay).label)}</h3>` +
      overlayResult.legend.map((e) => `<div class="legend-row"><span class="swatch${e.colour ? '' : ' nodata'}" style="${e.colour ? `background:${esc(e.colour)}` : ''}"></span>` +
        `<span>${esc(e.label)}</span><span class="count">${e.count}</span></div>`).join('') +
      (overlayResult.noData ? `<div class="note">${overlayResult.noData} solid(s) have no data for this overlay.</div>` : '')
    : '';
}

function draw2d() {
  const out = model && view2d.on
    ? buildDetailSvg(model, { materials: data.materials, profiles: data.profiles, scale: view2d.scale, hairline: view2d.hairline, selectedId: selection.get(), fills: overlayResult?.colours })
    : { svg: '' };
  $('drawing').innerHTML = out.svg;
}

function tagLines(prism) {
  const { tags } = tagsOf(prism, { materials: data.materials, profiles: data.profiles, detail: currentDetail() });
  const rows = [];
  if (tags.package) rows.push(`package: ${tags.package}`);
  if (tags.barrier?.length) rows.push(`barrier: ${tags.barrier.join(', ')}`);
  if (tags.fire_role) rows.push(`fire: ${tags.fire_role}`);
  if (tags.shearing_layer) rows.push(`shearing layer: ${tags.shearing_layer}`);
  if (tags.sequence) rows.push(`sequence: step ${tags.sequence}`);
  const mat = data.materials.get(prism.materialId);
  if (mat?.properties?.fire) rows.push(`rating: ${mat.properties.fire}`);
  const cv = carbonValues(mat);
  if (cv.perKg !== null) rows.push(`carbon: ${Math.round(cv.perKg * 1000) / 1000} kgCO2e/kg` + (cv.perM3 !== null ? `, ${Math.round(cv.perM3)} kgCO2e/m3` : '') + (mat.carbon_match === 'proxy' ? ' (proxy)' : ''));
  else if (mat?.carbonbench_id) rows.push('carbon: no per-kg or per-m3 figure');
  return rows.length ? `<br>${rows.map(esc).join('<br>')}` : '';
}

function renderSelected() {
  const prism = model?.prisms.find((p) => p.id === selection.get());
  const d = describeItem(prism, { materials: data?.materials });
  $('selected').innerHTML = d
    ? `<h3>Selected</h3><div class="use"><strong>${esc(d.name)}</strong><br>${esc(d.category)}${d.function ? ` · ${esc(d.function)}` : ''}<br>` +
      `${esc(d.source)}<br>${d.sizeMm.width} × ${d.sizeMm.height} mm${tagLines(prism)}</div>`
    : '';
}

selection.subscribe((id, source) => {
  if (source !== '3d') viewer.setSelected(id);
  draw2d();
  renderSelected();
});

$('drawing').addEventListener('click', (e) => {
  if (justPanned) return;
  const el = e.target.closest?.('[data-item]');
  selection.toggle(el ? el.dataset.item : null, '2d');
});
// A click in 3D selects; a drag (orbit) does not.
let down = null;
$('canvas').addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
$('canvas').addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
  const id = viewer.pick(e.clientX, e.clientY);
  selection.toggle(id, '3d');
});
// ── 2D pane: zoom, pan and the divider ───────────────────────────────────────
const zoom2d = { k: 1, x: 0, y: 0 };
const applyZoom = () => { $('drawing').style.transform = `translate(${zoom2d.x}px, ${zoom2d.y}px) scale(${zoom2d.k})`; };
const resetZoom = () => { Object.assign(zoom2d, { k: 1, x: 0, y: 0 }); applyZoom(); };
$('pane-2d').addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = $('pane-2d').getBoundingClientRect();
  const p = { x: e.clientX - r.left, y: e.clientY - r.top };
  const k = Math.min(40, Math.max(0.2, zoom2d.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
  zoom2d.x = p.x - (p.x - zoom2d.x) * (k / zoom2d.k);
  zoom2d.y = p.y - (p.y - zoom2d.y) * (k / zoom2d.k);
  zoom2d.k = k;
  applyZoom();
}, { passive: false });
let pan = null;
let justPanned = false;
$('pane-2d').addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  pan = { x: e.clientX, y: e.clientY, zx: zoom2d.x, zy: zoom2d.y, moved: false };
});
window.addEventListener('pointermove', (e) => {
  if (!pan) return;
  const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
  if (!pan.moved && Math.hypot(dx, dy) < 4) return;
  pan.moved = true;
  $('pane-2d').classList.add('panning');
  zoom2d.x = pan.zx + dx; zoom2d.y = pan.zy + dy;
  applyZoom();
});
window.addEventListener('pointerup', () => {
  if (pan?.moved) { justPanned = true; setTimeout(() => { justPanned = false; }, 0); }  // the click that ends a pan selects nothing
  pan = null;
  $('pane-2d').classList.remove('panning');
});
$('pane-2d').addEventListener('dblclick', resetZoom);

let split = null;
$('divider').addEventListener('pointerdown', (e) => { split = true; $('divider').classList.add('drag'); e.preventDefault(); });
window.addEventListener('pointermove', (e) => {
  if (!split) return;
  const r = $('panes').getBoundingClientRect();
  const frac = Math.min(0.85, Math.max(0.15, (e.clientX - r.left) / r.width));
  $('pane-2d').style.flex = `0 0 ${frac * 100}%`;
  $('canvas-wrap').style.flex = '1 1 0';
  viewer.resize();
});
window.addEventListener('pointerup', () => { split = null; $('divider').classList.remove('drag'); });

$('pane2d-btn').addEventListener('click', () => {
  view2d.on = !view2d.on;
  $('pane2d-btn').classList.toggle('active', view2d.on);
  $('pane-2d').hidden = !view2d.on;
  $('divider').hidden = !view2d.on;
  viewer.resize();
  draw2d();
});
$('overlay-select').innerHTML = '<option value="">Materials (no overlay)</option>' + OVERLAYS.map((o) => `<option value="${o.id}">${o.label}</option>`).join('');
$('overlay-select').addEventListener('change', (e) => {
  view2d.overlay = e.target.value;
  $('carbon-unit').hidden = view2d.overlay !== 'carbon';
  applyOverlays();
});
$('carbon-unit').addEventListener('change', (e) => { view2d.carbonUnit = e.target.value; applyOverlays(); });
$('scale-select').addEventListener('change', (e) => { view2d.scale = Number(e.target.value); draw2d(); });
$('thin-btn').addEventListener('click', () => {
  view2d.hairline = !view2d.hairline;
  $('thin-btn').classList.toggle('active', view2d.hairline);
  draw2d();
});

function select(id) {
  if (id !== selectedId) { showOriginal = false; resetZoom(); }
  const detail = detailById(id);
  if (!detail) return;
  selectedId = id;
  selection.set(null);
  model = buildAxoModel(detail, { profiles: data.profiles });
  viewer.setModel(model, (mid) => data.materials.get(mid)?.colour_hex);
  $('empty').hidden = true;
  $('caption').hidden = false;
  $('caption').textContent = `${detail.plane ?? 'section'} detail · ${model.prisms.length} solids · Z up`;
  renderInfo(detail, model);
  applyOverlays(); // after renderInfo, which rebuilds the panel that holds the legend
  renderList();
  syncCompare();
  const url = new URL(location.href);
  url.searchParams.set('detail', id);
  history.replaceState(null, '', url);
  status('');
}

async function open(readJson, label, handle = null) {
  try {
    source = { kind: handle ? 'fsa' : 'http', readJson, handle };
    status('Loading…');
    data = await loadDetailData(readJson);
    $('project-name').textContent = data.projectName ?? label;
    if (!data.details?.some((d) => d.id === selectedId)) selectedId = null;
    renderList();
    if (!data.details.length) { status('This bundle has no details.', true); return; }
    $('edit-btn').disabled = false;
    const wanted = selectedId ?? params.get('detail');
    select(data.details.some((d) => d.id === wanted) ? wanted : data.details[0].id);
    if (data.warnings.length) status(`${data.warnings.length} file(s) could not be read; see the console.`, true);
    data.warnings.forEach((w) => console.warn('[OEBF]', w));
  } catch (err) {
    status(`Could not open ${label}: ${err.message}`, true);
  }
}

$('view-select').innerHTML = Object.entries(AXO_VIEWS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
$('view-select').addEventListener('change', (e) => viewer.setView(e.target.value));
for (const [btn, key] of [['members-btn', 'members'], ['regions-btn', 'regions'], ['edges-btn', 'edges']]) {
  $(btn).addEventListener('click', () => {
    const on = !viewer.show[key];
    $(btn).classList.toggle('active', on);
    viewer.setShow({ [key]: on });
  });
}
$('fit-btn').addEventListener('click', () => viewer.fit());
$('filter').addEventListener('input', renderList);
$('demo-btn').addEventListener('click', () => open(httpReader(import.meta.env.BASE_URL + DEMO_BUNDLE), DEMO_BUNDLE));
$('png-btn').addEventListener('click', async () => {
  const blob = await viewer.snapshot();
  if (!blob) { status('Could not save the view.', true); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${selectedId ?? 'detail'}-${viewer.view}.png`;
  a.click();
  URL.revokeObjectURL(a.href);
});
/** Barlow as @font-face rules with the font files inline, so an exported sheet looks the same on any machine. Cached. */
let fontCssPromise = null;
function embeddedFontCss() {
  fontCssPromise ??= Promise.all([[400, 'Barlow-Regular'], [700, 'Barlow-Bold']].map(async ([weight, file]) => {
    const res = await fetch(`${import.meta.env.BASE_URL}fonts/${file}.woff2`);
    if (!res.ok) throw new Error(`font ${file}: ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `@font-face{font-family:'Barlow';font-weight:${weight};src:url(data:font/woff2;base64,${btoa(bin)}) format('woff2')}`;
  })).then((rules) => rules.join('')).catch(() => { fontCssPromise = null; return ''; });   // no font: the sheet still exports, in a fallback face
  return fontCssPromise;
}

/** The 2D drawing as it stands (without the selection highlight), on a sheet with a title block. */
async function currentSheet() {
  if (!model) throw new Error('Pick a detail first.');
  const drawing = buildDetailSvg(model, { materials: data.materials, profiles: data.profiles, scale: view2d.scale, hairline: view2d.hairline, fills: overlayResult?.colours });
  const detail = currentDetail();
  const legend = overlayResult
    ? { title: OVERLAYS.find((o) => o.id === view2d.overlay).label, rows: overlayResult.legend, noData: overlayResult.noData }
    : null;
  return {
    sheet: buildSheet(drawing, {
      legend, fontCss: await embeddedFontCss(),
      paper: $('paper-select').value || undefined,
      title: detail.id, description: detail.description, project: data.projectName ?? '',
      date: new Date().toISOString().slice(0, 10),
    }),
    name: detail.id, scale: drawing.scale,
  };
}

$('export-select').addEventListener('change', async (e) => {
  const kind = e.target.value;
  e.target.value = '';
  if (!kind) return;
  try {
    const { sheet, name, scale } = await currentSheet();
    if (kind === 'svg') {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([sheet.svg], { type: 'image/svg+xml' }));
      a.download = sheetFileName(name, scale, 'svg');
      a.click();
      URL.revokeObjectURL(a.href);
      status(`Saved ${sheet.paper} sheet as SVG.`);
    } else {
      // PDF: print the sheet at real size from a hidden frame; choose "Save as PDF" in the print dialog
      const frame = document.createElement('iframe');
      frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
      frame.srcdoc = printHtml(sheet, sheetFileName(name, scale, 'pdf').replace(/\.pdf$/, ''));
      frame.onload = () => {
        frame.contentWindow.focus();
        frame.contentWindow.print();
        setTimeout(() => frame.remove(), 60000);
      };
      document.body.appendChild(frame);
      status(`Printing ${sheet.paper} sheet: choose "Save as PDF" as the printer.`);
    }
  } catch (err) { status(err.message, true); }
});

$('open-btn').addEventListener('click', async () => {
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    const adapter = new FsaAdapter(handle);
    await open((p) => adapter.readJson(p), handle.name, handle);
  } catch (err) {
    if (err.name !== 'AbortError') status(`Could not open the folder: ${err.message}`, true);
  }
});
if (!window.showDirectoryPicker) {
  $('open-btn').disabled = true;
  $('open-btn').title = 'Needs a Chromium-based browser; use the NMB example instead.';
}

// ── panels ───────────────────────────────────────────────────────────────────
for (const [btn, panel, key] of [['left-btn', 'left-panel', 'oebf-axo-left'], ['right-btn', 'right-panel', 'oebf-axo-right']]) {
  const set = (on) => {
    $(panel).hidden = !on;
    $(btn).classList.toggle('active', on);
    try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* storage unavailable */ }
    viewer.resize();
    draw2d();
  };
  $(btn).addEventListener('click', () => set($(panel).hidden));
  let saved = null;
  try { saved = localStorage.getItem(key); } catch { /* storage unavailable */ }
  if (saved === '0') set(false);
}
document.addEventListener('keydown', (e) => {
  if (e.target.matches?.('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '[') $('left-btn').click();
  if (e.key === ']') $('right-btn').click();
});

// ── editing ──────────────────────────────────────────────────────────────────
// The detail editor is its own page. This page is its opener: it answers the editor's ready message with
// the bundle (a folder handle, so the editor writes the file itself, or a snapshot for the served example)
// and takes the saved detail back to redraw both panes.
function snapshotOfData() {
  return buildSnapshot({
    projectName: data.projectName,
    details: data.details,
    profiles: Object.fromEntries(data.profiles),
    materials: Object.fromEntries(data.materials),
    junctions: data.junctions,
    elements: {},
  }, selectedId);
}

$('edit-btn').addEventListener('click', () => {
  if (!selectedId) return;
  if (editorTab && !editorTab.closed) { editorTab.focus(); return; }
  editorTab = window.open(import.meta.env.BASE_URL + 'detail-editor.html', 'oebf-detail-editor');
  if (!editorTab) status('The browser blocked the editor window. Allow pop-ups for this site.', true);
});

window.addEventListener('message', async (event) => {
  const own = window.location.origin;
  if (isTrustedReady(event, { ownOrigin: own, tab: editorTab })) {
    const reply = source.kind === 'fsa'
      ? buildOpenerReply({ adapterType: 'fsa', handle: source.handle, activeDetailId: selectedId })
      : buildOpenerReply({ adapterType: 'memory', snapshot: snapshotOfData(), activeDetailId: selectedId });
    editorTab.postMessage(reply, own);
    return;
  }
  const saved = parseSaved(event, { ownOrigin: own, tab: editorTab });
  if (!saved) return;
  const at = data.details.findIndex((d) => d.id === saved.id);
  if (at >= 0 && !originals.has(saved.id)) originals.set(saved.id, structuredClone(data.details[at]));
  showOriginal = false;
  if (at >= 0) data.details[at] = saved.json; else data.details.push(saved.json);
  data.details.sort((a, b) => a.id.localeCompare(b.id));
  if (!saved.persisted) {
    edited.set(saved.id, saved.json);
    $('download-btn').hidden = false;
  }
  if (saved.persisted && source.readJson) await open(source.readJson, data.projectName, source.handle);  // pick up new profiles
  else select(saved.id);
  status(saved.persisted ? `Saved ${saved.id}.` : `Updated ${saved.id} in this page only. The example is read-only: use Download edit to keep it.`);
});

$('compare-btn').addEventListener('click', () => {
  showOriginal = !showOriginal;
  select(selectedId);
});

$('download-btn').addEventListener('click', () => {
  const json = edited.get(selectedId);
  if (!json) { status('This detail has not been edited in this page.', true); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(json, null, 2) + '\n'], { type: 'application/json' }));
  a.download = `${selectedId}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// Load the example straight away when a detail is named in the URL, so a link opens the picture.
if (params.has('detail') || params.has('bundle')) $('demo-btn').click();
