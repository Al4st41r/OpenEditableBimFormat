/**
 * gridOverlayManager.js — Reference grid axis creation and 3D rendering.
 *
 * Each grid axis is rendered as:
 *   - Plan view: LineDashedMaterial pink line
 *   - 3D view:   translucent pink PlaneGeometry
 */

import * as THREE from 'three';
import { writeEntity } from './bundleWriter.js';
import { toDisplay, unitLabel, fromDisplay } from './units.js';
import { wireRow, makeRemoveButton } from './treeMenu.js';
import { axisEndpoints, axisPlaneGeometry, axisLabel } from '../grid/gridAxis.js';
import {
  loadGridSet, flattenAxes, activeGrid, setActiveGrid, addGrid as addGridTo, addAxis as addAxisTo,
  updateAxis as updateAxisIn, removeAxis as removeAxisFrom, serialiseGrid, commitGrid,
} from '../grid/gridSet.js';

const GRID_COLOUR   = 0xe87070;
const GRID_OPACITY  = 0.12;
const GRID_HEIGHT   = 10; // metres tall in 3D

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
    this._renderList();
  }

  /** Add a grid axis interactively (numeric input) to the active grid. */
  async addAxisNumeric() {
    const dir = window.prompt('Direction the axis runs (x = east-west, at a Y value; y = north-south, at an X value):', 'y');
    if (!dir || !['x','y'].includes(dir.toLowerCase())) return;
    const offStr = window.prompt(`Offset (${unitLabel()}):`, '0');
    if (offStr === null) return;
    const offset = fromDisplay(parseFloat(offStr));
    if (Number.isNaN(offset)) return;
    const label  = window.prompt('Label:', String.fromCharCode(65 + this._axes.length));
    if (!label) return;
    await this._add(label, dir.toLowerCase(), offset);
  }

  /** Add a grid axis at a specific offset (called from click-to-place tool). */
  async addAxisAtOffset(direction, offset_m) {
    const label = window.prompt('Grid axis label:', String.fromCharCode(65 + this._axes.length));
    if (!label) return;
    await this._add(label, direction, Math.round(offset_m * 10) / 10);
  }

  /** Start a new, empty grid (eg a secondary grid of mid-bay lines) and make it the one new axes go into. */
  async addGrid() {
    const name = window.prompt('Grid name:', 'Secondary grid');
    if (!name?.trim()) return;
    const grid = addGridTo(this._set, { name: name.trim() });
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
    const label = window.prompt('Label:', a.label);
    if (!label) return;
    const dir = window.prompt('Direction the axis runs (x = east-west, at a Y value; y = north-south, at an X value):', a.direction);
    if (!dir || !['x', 'y'].includes(dir.toLowerCase())) return;
    const offStr = window.prompt(`Offset (${unitLabel()}):`, String(toDisplay(a.offset_m)));
    if (offStr === null) return;
    const offset = fromDisplay(parseFloat(offStr));
    if (Number.isNaN(offset)) return;
    // The label is the axis id (junction locations refer to it), so a rename needs a free id in the grid.
    if (label !== a.id) {
      if (this.isAxisUsed?.(a.gridId, a.id)) { window.alert(`Junctions place details at axis ${a.id}. Move them first, then rename it.`); return; }
      const taken = this._axes.some(x => x.gridId === a.gridId && x.id === label);
      if (taken) { window.alert(`Grid ${a.gridId} already has an axis ${label}.`); return; }
    }
    this._overlayGroup.remove(a.object3d);
    const direction = dir.toLowerCase();
    updateAxisIn(this._set, a.gridId, a.id, { id: label, label, direction, offset_m: offset });
    Object.assign(a, { id: label, key: `${a.gridId}/${label}`, label, direction, offset_m: offset });
    a.object3d = this._buildAxisObject(a.direction, a.offset_m);
    a.object3d.visible = a.visible;
    this._overlayGroup.add(a.object3d);
    this._renderList();
    await this._saveGrid(a.gridId);
  }

  async removeAxis(key) {
    const i = this._axes.findIndex(x => x.key === key);
    if (i < 0) return;
    const a = this._axes[i];
    const used = this.isAxisUsed?.(a.gridId, a.id);
    if (!window.confirm(used ? `Junctions place details at axis ${a.label}. Remove it anyway?` : `Remove grid axis ${a.label}?`)) return;
    this._overlayGroup.remove(a.object3d);
    this._axes.splice(i, 1);
    removeAxisFrom(this._set, a.gridId, a.id);
    this._renderList();
    await this._saveGrid(a.gridId);
  }

  // ── Private ────────────────────────────────────────────────────────────────

  async _add(label, direction, offset_m) {
    const grid = activeGrid(this._set);
    try {
      addAxisTo(this._set, grid.id, { label, direction, offset_m });
    } catch (err) {
      window.alert(err.message);
      return;
    }
    this._drawAxis(grid.id, label, label, direction, offset_m, true);
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
    });
    const plane = new THREE.Mesh(axisPlaneGeometry(direction, offset_m, 100, GRID_HEIGHT), mat);
    group.add(plane);

    // Dashed line at Z=0 (plan view)
    const { a, b } = axisEndpoints(direction, offset_m, -50, 50);
    const points = [new THREE.Vector3(a.x, a.y, 0), new THREE.Vector3(b.x, b.y, 0)];
    const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
    const lineMat = new THREE.LineDashedMaterial({
      color: GRID_COLOUR, dashSize: 0.5, gapSize: 0.25, depthTest: false,
    });
    const line = new THREE.Line(lineGeo, lineMat);
    line.renderOrder = 1;
    line.computeLineDistances();
    group.add(line);

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
        nameSpan.textContent = `${a.label} (${coord}=${toDisplay(value)} ${unitLabel()})`;

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
