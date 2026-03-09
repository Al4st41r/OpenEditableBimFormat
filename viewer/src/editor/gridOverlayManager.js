/**
 * gridOverlayManager.js — Reference grid axis creation and 3D rendering.
 *
 * Each grid axis is rendered as:
 *   - Plan view: LineDashedMaterial pink line
 *   - 3D view:   translucent pink PlaneGeometry
 */

import * as THREE from 'three';
import { writeEntity } from './bundleWriter.js';

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
    this._dirHandle = null;
    this._gridId = 'grid-reference';
  }

  setDirHandle(h) { this._dirHandle = h; }

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
    const dir = window.prompt('Direction (x or y):', 'x');
    if (!dir || !['x','y'].includes(dir.toLowerCase())) return;
    const offStr = window.prompt('Offset (metres):', '0');
    if (offStr === null) return;
    const offset = parseFloat(offStr);
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

    // 3D translucent vertical plane
    const mat = new THREE.MeshBasicMaterial({
      color: GRID_COLOUR, transparent: true,
      opacity: GRID_OPACITY, side: THREE.DoubleSide, depthWrite: false,
    });
    const geo = new THREE.PlaneGeometry(100, GRID_HEIGHT);
    const plane = new THREE.Mesh(geo, mat);

    if (direction === 'x') {
      plane.position.x = offset_m;
      plane.rotation.y = Math.PI / 2;
      plane.position.z = GRID_HEIGHT / 2;
    } else {
      plane.position.y = offset_m;
      plane.position.z = GRID_HEIGHT / 2;
    }
    group.add(plane);

    // Dashed line at Z=0 (plan view)
    const points = direction === 'x'
      ? [new THREE.Vector3(offset_m, -50, 0), new THREE.Vector3(offset_m, 50, 0)]
      : [new THREE.Vector3(-50, offset_m, 0), new THREE.Vector3(50, offset_m, 0)];
    const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
    const lineMat = new THREE.LineDashedMaterial({
      color: GRID_COLOUR, dashSize: 0.5, gapSize: 0.25,
    });
    const line = new THREE.Line(lineGeo, lineMat);
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
      nameSpan.textContent = `${a.label} (${a.direction.toUpperCase()}=${a.offset_m}m)`;

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
    if (!this._dirHandle) return;
    await writeEntity(this._dirHandle, `grids/${this._gridId}.json`, {
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
}
