/**
 * storeyManager.js — Storey creation, scene tree, and 3D plane management.
 */

import * as THREE from 'three';
import { writeEntity } from './bundleWriter.js';

const STOREY_PLANE_SIZE    = 60;
const STOREY_PLANE_OPACITY = 0.08;
const STOREY_PLANE_COLOUR  = 0x888888;

/**
 * @typedef {object} StoreyState
 * @property {string} id
 * @property {string} name
 * @property {number} z_m
 * @property {boolean} visible
 * @property {THREE.Mesh} plane  — 3D scene object
 */

export class StoreyManager {
  /**
   * @param {THREE.Group}                overlayGroup
   * @param {HTMLElement}                listEl        — #storeys-list
   * @param {function(number): void}     onActiveChange  — called with new Z when active storey changes
   */
  constructor(overlayGroup, listEl, onActiveChange) {
    this._overlayGroup    = overlayGroup;
    this._listEl          = listEl;
    this._onActiveChange  = onActiveChange;
    /** @type {StoreyState[]} */
    this._storeys         = [];
    this._activeId        = null;
    this._dirHandle       = null;
  }

  setDirHandle(dirHandle) {
    this._dirHandle = dirHandle;
  }

  /** Load storeys from an already-parsed bundle (from model.json). */
  loadFromBundle(storeyGroups) {
    for (const g of storeyGroups) {
      this._addStorey(g.id, g.name, g.z_m ?? 0, true);
    }
    if (this._storeys.length > 0) this._setActive(this._storeys[0].id);
  }

  /** Create a new storey interactively. */
  async createStorey() {
    const name = window.prompt('Storey name:', 'New Storey');
    if (!name) return;
    const zStr = window.prompt('Floor level Z (metres):', '0');
    if (zStr === null) return;
    const z = parseFloat(zStr) || 0;
    const id = `storey-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    this._addStorey(id, name, z, true);
    this._setActive(id);
    if (this._dirHandle) await this._writeStorey(id);
  }

  /** Update storey name or Z in properties panel. */
  async updateStorey(id, { name, z_m }) {
    const s = this._storeys.find(x => x.id === id);
    if (!s) return;
    if (name !== undefined) s.name = name;
    if (z_m  !== undefined) {
      s.z_m = z_m;
      s.plane.position.z = z_m;
    }
    this._renderList();
    if (id === this._activeId) this._onActiveChange(s.z_m);
    if (this._dirHandle) await this._writeStorey(id);
  }

  /** Toggle visibility of a storey plane. */
  toggleVisibility(id) {
    const s = this._storeys.find(x => x.id === id);
    if (!s) return;
    s.visible = !s.visible;
    s.plane.visible = s.visible;
    this._renderList();
  }

  getActive() {
    return this._storeys.find(x => x.id === this._activeId) ?? null;
  }

  getAll() { return this._storeys; }

  // ── Private ────────────────────────────────────────────────────────────────

  _addStorey(id, name, z_m, visible) {
    const geo  = new THREE.PlaneGeometry(STOREY_PLANE_SIZE, STOREY_PLANE_SIZE);
    const mat  = new THREE.MeshBasicMaterial({
      color: STOREY_PLANE_COLOUR, transparent: true,
      opacity: STOREY_PLANE_OPACITY, side: THREE.DoubleSide,
    });
    const plane = new THREE.Mesh(geo, mat);
    plane.position.z = z_m;
    plane.visible = visible;
    this._overlayGroup.add(plane);
    this._storeys.push({ id, name, z_m, visible, plane });
    this._renderList();
  }

  _setActive(id) {
    this._activeId = id;
    const s = this._storeys.find(x => x.id === id);
    if (s) this._onActiveChange(s.z_m);
    this._renderList();
  }

  _renderList() {
    this._listEl.innerHTML = '';
    for (const s of this._storeys) {
      const item = document.createElement('div');
      item.className = 'tree-item' + (s.id === this._activeId ? ' active' : '');
      item.innerHTML = `
        <span class="tree-item-name">${s.name} <small style="opacity:0.5">${s.z_m}m</small></span>
        <button class="tree-item-eye" title="Toggle visibility">${s.visible ? '👁' : '○'}</button>
      `;
      item.querySelector('.tree-item-name').addEventListener('click', () => this._setActive(s.id));
      item.querySelector('.tree-item-eye').addEventListener('click', e => {
        e.stopPropagation();
        this.toggleVisibility(s.id);
      });
      this._listEl.appendChild(item);
    }
  }

  async _writeStorey(id) {
    const s = this._storeys.find(x => x.id === id);
    if (!s) return;
    await writeEntity(this._dirHandle, `groups/${s.id}.json`, {
      id: s.id, type: 'Group', ifc_type: 'IfcBuildingStorey',
      name: s.name, z_m: s.z_m, description: '',
    });
  }
}
