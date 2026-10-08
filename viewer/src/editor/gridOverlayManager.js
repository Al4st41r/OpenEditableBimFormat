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
import { axisEndpoints, axisPlaneGeometry, axisLabel } from '../grid/gridAxis.js';

const GRID_COLOUR   = 0xe87070;
const GRID_OPACITY  = 0.12;
const GRID_HEIGHT   = 10; // metres tall in 3D

/**
 * @typedef {object} GridAxis
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
    this._gridId = 'grid-reference';
  }

  setAdapter(a) { this._adapter = a; }

  /** Load axes from existing Grid entities. */
  loadFromBundle(gridEntities) {
    // Clear existing (idempotent)
    for (const a of this._axes) {
      this._overlayGroup.remove(a.object3d);
    }
    this._axes = [];
    this._gridId = 'grid-reference';

    for (const grid of gridEntities) {
      this._gridId = grid.id;
      for (const axis of (grid.axes ?? [])) {
        this._addAxis(axis.id ?? axis.label, axis.label ?? axis.id, axis.direction, axis.offset_m, true);
      }
    }
  }

  /** Add a grid axis interactively (numeric input). */
  async addAxisNumeric() {
    const dir = window.prompt('Direction the axis runs (x = east-west, at a Y value; y = north-south, at an X value):', 'y');
    if (!dir || !['x','y'].includes(dir.toLowerCase())) return;
    const offStr = window.prompt(`Offset (${unitLabel()}):`, '0');
    if (offStr === null) return;
    const offset = fromDisplay(parseFloat(offStr));
    if (Number.isNaN(offset)) return;
    const label  = window.prompt('Label:', String.fromCharCode(65 + this._axes.length));
    if (!label) return;
    this._addAxis(label, label, dir.toLowerCase(), offset, true);
    await this._saveGrid();
  }

  /** Add a grid axis at a specific offset (called from click-to-place tool). */
  async addAxisAtOffset(direction, offset_m) {
    const label = window.prompt('Grid axis label:', String.fromCharCode(65 + this._axes.length));
    if (!label) return;
    const snapped = Math.round(offset_m * 10) / 10;
    this._addAxis(label, label, direction, snapped, true);
    await this._saveGrid();
  }

  toggleVisibility(id) {
    const a = this._axes.find(x => x.id === id);
    if (!a) return;
    a.visible = !a.visible;
    a.object3d.visible = a.visible;
    this._renderList();
  }

  getAxes() { return this._axes; }

  // ── Private ────────────────────────────────────────────────────────────────

  _addAxis(id, label, direction, offset_m, visible) {
    const object3d = this._buildAxisObject(direction, offset_m);
    object3d.visible = visible;
    this._overlayGroup.add(object3d);
    this._axes.push({ id, label, direction, offset_m, visible, object3d });
    this._renderList();
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
    for (const a of this._axes) {
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
        this.toggleVisibility(a.id);
      });

      item.append(nameSpan, eyeBtn);
      this._listEl.appendChild(item);
    }
  }

  async _saveGrid() {
    if (!this._adapter) return;
    await writeEntity(this._adapter, `grids/${this._gridId}.json`, {
      '$schema': 'oebf://schema/0.1/grid',
      id: this._gridId, type: 'Grid',
      description: 'Reference grid',
      ifc_type: 'IfcGrid',
      axes: this._axes.map(a => ({
        id: a.id, direction: a.direction, offset_m: a.offset_m,
      })),
      elevations: [],
    });
    // Notify editor to register this grid id in model.json
    if (this._onGridRegistered) this._onGridRegistered(this._gridId);
  }

  refreshList() { this._renderList(); }
}
