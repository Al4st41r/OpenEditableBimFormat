/**
 * gridOverlayManager.js — Reference grid axis creation and 3D rendering.
 *
 * Each grid axis is rendered as:
 *   - Plan view: dashed pink fat line (fatLine.js)
 *   - 3D view:   translucent pink PlaneGeometry
 */

import * as THREE from 'three';
import { writeEntity } from './bundleWriter.js';
import { toDisplay, unitLabel, fromDisplay } from './units.js';
import { wireRow, makeRemoveButton, treeItemMeta } from './treeMenu.js';
import { askForm, ask, confirmDialog, notify } from '../ui/dialog.js';
import { fatSegments } from './fatLine.js';
import { axisEndpoints, axisPlaneGeometry, axisPlaneExtent, axisLabel } from '../grid/gridAxis.js';
import {
  loadGridSet, flattenAxes, activeGrid, setActiveGrid, addGrid as addGridTo, addAxis as addAxisTo,
  updateAxis as updateAxisIn, removeAxis as removeAxisFrom, serialiseGrid, commitGrid,
} from '../grid/gridSet.js';

const GRID_COLOUR   = 0xe87070;
const GRID_OPACITY  = 0.05;   // faint: a dozen planes add up
const GRID_LINE_PX  = 1.5;    // width of the dashed axis line, screen pixels
const GRID_HEIGHT   = 8;      // metres tall in 3D

/**
 * @typedef {object} GridAxis
 * @property {string} key       unique across grids: `<gridId>/<id>`
 * @property {string} gridId
 * @property {string} id
 * @property {string} label
 * @property {'x'|'y'} direction
 * @property {number} offset_m
 * @property {boolean} visible
 * @property {THREE.Object3D} object3d
 */

export class GridOverlayManager {
  constructor(overlayGroup, listEl, onGridRegistered) {
    this._overlayGroup = overlayGroup;
    this._listEl       = listEl;
    this._onGridRegistered = onGridRegistered ?? null;
    /** @type {GridAxis[]} */
    this._axes = [];
    this._adapter = null;
    this._set = loadGridSet([]);
    /** (gridId, axisId) => boolean, set by the editor: junction locations that name the axis. */
    this.isAxisUsed = null;
    this._planes = localStorage.getItem('oebf-grid-planes') !== 'off';
  }

  /** Show or hide the translucent 3D planes (the lines stay). */
  setPlanesVisible(on) {
    this._planes = on;
    localStorage.setItem('oebf-grid-planes', on ? 'on' : 'off');
    for (const a of this._axes) a.object3d.traverse((o) => { if (o.userData.gridPlane) o.visible = on; });
  }

  get planesVisible() { return this._planes; }

  /** Redraw every axis: a plane's length depends on the other axes, so any change to the set can change it. */
  _rebuildAll() {
    for (const a of this._axes) {
      this._overlayGroup.remove(a.object3d);
      a.object3d = this._buildAxisObject(a.direction, a.offset_m);
      a.object3d.visible = a.visible;
      this._overlayGroup.add(a.object3d);
    }
  }

  setAdapter(a) { this._adapter = a; }

  /** Load every Grid entity; each stays a grid of its own (see grid/gridSet.js). */
  loadFromBundle(gridEntities) {
    // Clear existing (idempotent)
    for (const a of this._axes) {
      this._overlayGroup.remove(a.object3d);
    }
    this._axes = [];
    this._set = loadGridSet(gridEntities);

    for (const a of flattenAxes(this._set)) {
      this._drawAxis(a.gridId, a.id, a.label, a.direction, a.offset_m, true);
    }
    this._rebuildAll();
    this._renderList();
  }

  /**
   * The fields of the axis dialog. A label is the axis id (junction locations refer to it), so it must be free in its
   * grid; `own` is the axis being edited, whose own label is allowed.
   */
  _axisFields(gridId, { label, direction, offset }, own = null) {
    const taken = (l) => l !== own && this._axes.some((x) => x.gridId === gridId && x.id === l);
    return [
      { name: 'label', label: 'Label', value: label, required: true, hint: 'Junction locations name the axis by this label.',
        validate: (v) => (taken(v.trim()) ? `This grid already has an axis ${v.trim()}.` : null) },
      { name: 'direction', label: 'Runs', type: 'select', value: direction, options: [
        { value: 'y', label: 'North-south (placed at an X value)' },
        { value: 'x', label: 'East-west (placed at a Y value)' },
      ] },
      { name: 'offset', label: `Offset (${unitLabel()})`, type: 'number', value: offset, required: true },
    ];
  }

  _nextLabel() { return String.fromCharCode(65 + this._axes.length); }

  /** Add a grid axis interactively (numeric input) to the active grid. */
  async addAxisNumeric() {
    const grid = activeGrid(this._set);
    const v = await askForm({
      title: `Add axis to ${grid.entity?.description ?? grid.id}`,
      ok: 'Add',
      fields: this._axisFields(grid.id, { label: this._nextLabel(), direction: 'y', offset: '0' }),
    });
    if (!v) return;
    await this._add(v.label, v.direction, fromDisplay(Number(v.offset)));
  }

  /** Add a grid axis at a specific offset (called from click-to-place tool). */
  async addAxisAtOffset(direction, offset_m) {
    const grid = activeGrid(this._set);
    const label = await ask('Grid axis label', this._nextLabel(), {
      title: 'Add grid axis',
      validate: (v) => (this._axes.some((x) => x.gridId === grid.id && x.id === v.trim()) ? `This grid already has an axis ${v.trim()}.` : null),
    });
    if (!label) return;
    await this._add(label, direction, Math.round(offset_m * 10) / 10);
  }

  /** Start a new, empty grid (eg a secondary grid of mid-bay lines) and make it the one new axes go into. */
  async addGrid() {
    const name = await ask('Grid name', 'Secondary grid', { title: 'Add grid', ok: 'Add' });
    if (!name) return;
    const grid = addGridTo(this._set, { name });
    this._renderList();
    await this._saveGrid(grid.id);
  }

  setActiveGrid(gridId) {
    setActiveGrid(this._set, gridId);
    this._renderList();
  }

  getGrids() { return this._set.grids.map((g) => ({ id: g.id, description: g.entity.description ?? g.id, axes: g.axes.length })); }

  getActiveGridId() { return this._set.activeId; }

  toggleVisibility(key) {
    const a = this._axes.find(x => x.key === key);
    if (!a) return;
    a.visible = !a.visible;
    a.object3d.visible = a.visible;
    this._renderList();
  }

  getAxes() { return this._axes; }

  /** Prompt for new label, direction and offset of an axis, then save. */
  async editAxis(key) {
    const a = this._axes.find(x => x.key === key);
    if (!a) return;
    const v = await askForm({
      title: `Edit axis ${a.label}`,
      ok: 'Save',
      fields: this._axisFields(a.gridId, { label: a.label, direction: a.direction, offset: String(toDisplay(a.offset_m)) }, a.id),
    });
    if (!v) return;
    const label = v.label;
    const dir = v.direction;
    const offset = fromDisplay(Number(v.offset));
    if (label !== a.id && this.isAxisUsed?.(a.gridId, a.id)) {
      await notify(`Junctions place details at axis ${a.id}. Move them first, then rename it.`, { title: 'Axis in use' });
      return;
    }
    this._overlayGroup.remove(a.object3d);
    const direction = dir;
    updateAxisIn(this._set, a.gridId, a.id, { id: label, label, direction, offset_m: offset });
    Object.assign(a, { id: label, key: `${a.gridId}/${label}`, label, direction, offset_m: offset });
    this._rebuildAll();
    this._renderList();
    await this._saveGrid(a.gridId);
  }

  async removeAxis(key) {
    const i = this._axes.findIndex(x => x.key === key);
    if (i < 0) return;
    const a = this._axes[i];
    const used = this.isAxisUsed?.(a.gridId, a.id);
    const message = used ? `Junctions place details at axis ${a.label}. Remove it anyway?` : `Remove grid axis ${a.label}?`;
    if (!await confirmDialog(message, { ok: 'Remove', danger: true })) return;
    this._overlayGroup.remove(a.object3d);
    this._axes.splice(i, 1);
    removeAxisFrom(this._set, a.gridId, a.id);
    this._rebuildAll();
    this._renderList();
    await this._saveGrid(a.gridId);
  }

  // ── Private ────────────────────────────────────────────────────────────────

  async _add(label, direction, offset_m) {
    const grid = activeGrid(this._set);
    try {
      addAxisTo(this._set, grid.id, { label, direction, offset_m });
    } catch (err) {
      await notify(err.message, { title: 'Axis not added' });
      return;
    }
    this._drawAxis(grid.id, label, label, direction, offset_m, true);
    this._rebuildAll();
    this._renderList();
    await this._saveGrid(grid.id);
  }

  _drawAxis(gridId, id, label, direction, offset_m, visible) {
    const object3d = this._buildAxisObject(direction, offset_m);
    object3d.visible = visible;
    this._overlayGroup.add(object3d);
    this._axes.push({ key: `${gridId}/${id}`, gridId, id, label, direction, offset_m, visible, object3d });
  }

  _buildAxisObject(direction, offset_m) {
    const group = new THREE.Group();

    // 3D translucent vertical plane (world-space geometry; see grid/gridAxis.js)
    const mat = new THREE.MeshBasicMaterial({
      color: GRID_COLOUR, transparent: true,
      opacity: GRID_OPACITY, side: THREE.DoubleSide, depthWrite: false,
      // Axes sit on wall faces and slab edges. Pushed behind the model (whose bias is +1) so that coplanar
      // faces always show the model, instead of fighting the plane and flickering as the camera moves.
      polygonOffset: true, polygonOffsetFactor: 3, polygonOffsetUnits: 3,
    });
    const { min, max } = axisPlaneExtent(direction, this._axes);
    const geometry = axisPlaneGeometry(direction, offset_m, max - min, GRID_HEIGHT);
    geometry.translate(direction === 'x' ? (min + max) / 2 : 0, direction === 'y' ? (min + max) / 2 : 0, 0);
    const plane = new THREE.Mesh(geometry, mat);
    plane.renderOrder = -1;   // drawn before the model, so transparent sorting cannot make the planes and the model swap as the camera moves
    plane.userData.gridPlane = true;
    plane.visible = this._planes;
    group.add(plane);

    // Dashed line at Z=0 (plan view), a fixed number of pixels wide at any zoom
    const { a, b } = axisEndpoints(direction, offset_m, -50, 50);
    group.add(fatSegments([a.x, a.y, 0, b.x, b.y, 0], { color: GRID_COLOUR, widthPx: GRID_LINE_PX, dash: 0.5, gap: 0.25 }));

    return group;
  }

  _renderList() {
    this._listEl.innerHTML = '';
    const several = this._set.grids.length > 1;
    for (const g of this._set.grids) {
      if (several) {
        const head = document.createElement('div');
        head.className = 'tree-item' + (g.id === this._set.activeId ? ' active' : '');
        head.title = 'New axes go into the active grid';
        const name = document.createElement('span');
        name.className = 'tree-item-name';
        name.style.fontWeight = '700';
        name.textContent = `${g.entity.description ?? g.id} (${g.axes.length})`;
        name.addEventListener('click', () => this.setActiveGrid(g.id));
        head.appendChild(name);
        this._listEl.appendChild(head);
      }
      for (const a of this._axes.filter(x => x.gridId === g.id)) {
        const item = document.createElement('div');
        item.className = 'tree-item';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'tree-item-name';
        const { coord, value } = axisLabel(a.direction, a.offset_m);
        nameSpan.append(`${a.label} `, treeItemMeta(`(${coord}=${toDisplay(value)} ${unitLabel()})`));

        const eyeBtn = document.createElement('button');
        eyeBtn.className = 'tree-item-eye';
        eyeBtn.title = 'Toggle visibility';
        eyeBtn.textContent = a.visible ? '●' : '○';

        eyeBtn.addEventListener('click', e => {
          e.stopPropagation();
          this.toggleVisibility(a.key);
        });

        item.append(nameSpan, eyeBtn, makeRemoveButton(() => this.removeAxis(a.key)));
        wireRow(item, { onEdit: () => this.editAxis(a.key), onRemove: () => this.removeAxis(a.key) });
        this._listEl.appendChild(item);
      }
    }
  }

  /** Write one grid: its own fields and non-orthogonal axes are kept as found (see grid/gridSet.js). */
  async _saveGrid(gridId) {
    if (!this._adapter) return;
    await writeEntity(this._adapter, `grids/${gridId}.json`, serialiseGrid(this._set, gridId));
    commitGrid(this._set, gridId);
    // Notify editor to register this grid id in model.json
    if (this._onGridRegistered) this._onGridRegistered(gridId);
  }

  refreshList() { this._renderList(); }
}
