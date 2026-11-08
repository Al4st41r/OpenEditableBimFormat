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

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEMO_BUNDLE = params.get('bundle') ?? 'nmb-two-storey.oebf';

const viewer = new AxoViewer($('canvas'));
let data = null;
let selectedId = null;
let model = null;
const selection = createSelection();
const view2d = { on: true, scale: 5, hairline: false };

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
    `<div id="selected"></div>` +
    `<h3>Drawn at</h3>` +
    (uses.length
      ? uses.map((u) => `<div class="use"><code>${esc(u.id)}</code><br>axes ${esc(u.axes.join(' / '))}, level ${esc(u.level)}</div>`).join('')
      : '<div class="note">No junction in this bundle uses this detail.</div>') +
    `<h3>Members</h3>` +
    (detail.members ?? []).map((m) => `<div class="use"><code>${esc(m.role)}</code> (${esc(m.kind)}) ${esc(m.profile_id)}</div>`).join('') +
    `<h3>Materials</h3>${mats}` +
    (warnings.length ? `<h3>Notes</h3>${warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join('')}` : '');
}

function draw2d() {
  const out = model && view2d.on
    ? buildDetailSvg(model, { materials: data.materials, profiles: data.profiles, scale: view2d.scale, hairline: view2d.hairline, selectedId: selection.get() })
    : { svg: '' };
  $('drawing').innerHTML = out.svg;
}

function renderSelected() {
  const prism = model?.prisms.find((p) => p.id === selection.get());
  const d = describeItem(prism, { materials: data?.materials });
  $('selected').innerHTML = d
    ? `<h3>Selected</h3><div class="use"><strong>${esc(d.name)}</strong><br>${esc(d.category)}${d.function ? ` · ${esc(d.function)}` : ''}<br>` +
      `${esc(d.source)}<br>${d.sizeMm.width} × ${d.sizeMm.height} mm</div>`
    : '';
}

selection.subscribe((id, source) => {
  if (source !== '3d') viewer.setSelected(id);
  draw2d();
  renderSelected();
});

$('drawing').addEventListener('click', (e) => {
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
$('pane2d-btn').addEventListener('click', () => {
  view2d.on = !view2d.on;
  $('pane2d-btn').classList.toggle('active', view2d.on);
  $('pane-2d').hidden = !view2d.on;
  viewer.resize();
  draw2d();
});
$('scale-select').addEventListener('change', (e) => { view2d.scale = Number(e.target.value); draw2d(); });
$('thin-btn').addEventListener('click', () => {
  view2d.hairline = !view2d.hairline;
  $('thin-btn').classList.toggle('active', view2d.hairline);
  draw2d();
});

function select(id) {
  const detail = data?.details.find((d) => d.id === id);
  if (!detail) return;
  selectedId = id;
  selection.set(null);
  model = buildAxoModel(detail, { profiles: data.profiles });
  viewer.setModel(model, (mid) => data.materials.get(mid)?.colour_hex);
  draw2d();
  $('empty').hidden = true;
  $('caption').hidden = false;
  $('caption').textContent = `${detail.plane ?? 'section'} detail · ${model.prisms.length} solids · Z up`;
  renderInfo(detail, model);
  renderList();
  const url = new URL(location.href);
  url.searchParams.set('detail', id);
  history.replaceState(null, '', url);
  status('');
}

async function open(readJson, label) {
  try {
    status('Loading…');
    data = await loadDetailData(readJson);
    $('project-name').textContent = data.projectName ?? label;
    selectedId = null;
    renderList();
    if (!data.details.length) { status('This bundle has no details.', true); return; }
    const wanted = params.get('detail');
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
$('open-btn').addEventListener('click', async () => {
  try {
    const handle = await window.showDirectoryPicker({ mode: 'read' });
    const adapter = new FsaAdapter(handle);
    await open((p) => adapter.readJson(p), handle.name);
  } catch (err) {
    if (err.name !== 'AbortError') status(`Could not open the folder: ${err.message}`, true);
  }
});
if (!window.showDirectoryPicker) {
  $('open-btn').disabled = true;
  $('open-btn').title = 'Needs a Chromium-based browser; use the NMB example instead.';
}

// Load the example straight away when a detail is named in the URL, so a link opens the picture.
if (params.has('detail') || params.has('bundle')) $('demo-btn').click();
