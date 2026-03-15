/**
 * pathEditTool.js — Path node editing: move, insert, delete nodes.
 *
 * Activated by selecting a path (via element selection). Shows node handles
 * as small sphere meshes in the overlayGroup. Supports drag-to-move,
 * midpoint-click-to-insert, and Delete/Backspace-to-remove.
 */

import * as THREE from 'three';
import { writeEntity } from './bundleWriter.js';

const HANDLE_RADIUS   = 0.08; // metres
const MIDPOINT_RADIUS = 0.05;
const HANDLE_COLOUR   = 0x4488ff;
const MIDPOINT_COLOUR = 0x223355;
const SELECTED_COLOUR = 0xffaa22;

export class PathEditTool {
  /**
   * @param {THREE.Group}  overlayGroup
   * @param {THREE.Scene}  scene
   * @param {HTMLElement}  canvas
   * @param {Function}     getCameraFn  — () => THREE.Camera
   * @param {Function}     onNodeSelected — (nodeInfo|null) => void
   */
  constructor(overlayGroup, scene, canvas, getCameraFn, onNodeSelected) {
    this._overlayGroup   = overlayGroup;
    this._scene          = scene;
    this._canvas         = canvas;
    this._getCamera      = getCameraFn;
    this._onNodeSelected = onNodeSelected ?? (() => {});
    /** Called after every committed edit (mouseup, insert, delete). */
    this.onEditCommitted = null;
    this._raycaster      = new THREE.Raycaster();

    this._pathId     = null; // current path id
    this._pathData   = null; // current path JSON (mutable)
    this._adapter    = null;
    this._elementId  = null; // for writing back

    this._handles    = []; // { mesh, segIdx, role: 'start'|'end', pos }
    this._midHandles = []; // { mesh, segIdx, midPos }
    this._handleGroup = new THREE.Group();
    this._overlayGroup.add(this._handleGroup);

    this._dragging      = false;
    this._dragHandle    = null; // { segIdx, role }
    this._selectedHandle = null;

    this._active = false;

    this._boundMouseDown = this._onMouseDown.bind(this);
    this._boundMouseMove = this._onMouseMove.bind(this);
    this._boundMouseUp   = this._onMouseUp.bind(this);
    this._boundKeyDown   = this._onKeyDown.bind(this);
  }

  setAdapter(a) { this._adapter = a; }

  /**
   * Activate for a specific path.
   * @param {string} pathId
   * @param {object} pathData — full path JSON
   * @param {string} elementId — the element or slab id (for writing back)
   */
  activate(pathId, pathData, elementId) {
    this.deactivate(); // clean up previous
    this._pathId    = pathId;
    this._pathData  = JSON.parse(JSON.stringify(pathData)); // deep clone
    this._elementId = elementId;
    this._active    = true;
    this._buildHandles();
    this._canvas.addEventListener('mousedown', this._boundMouseDown);
    window.addEventListener('keydown',         this._boundKeyDown);
  }

  deactivate() {
    this._active = false;
    this._clearHandles();
    this._canvas.removeEventListener('mousedown', this._boundMouseDown);
    window.removeEventListener('mousemove',       this._boundMouseMove);
    window.removeEventListener('mouseup',         this._boundMouseUp);
    window.removeEventListener('keydown',         this._boundKeyDown);
    this._dragging   = false;
    this._dragHandle = null;
    this._selectedHandle = null;
    this._onNodeSelected(null);
  }

  dispose() {
    this.deactivate();
    this._overlayGroup.remove(this._handleGroup);
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _buildHandles() {
    this._clearHandles();
    const segs = this._pathData.segments ?? [];
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (seg.type !== 'line') continue;
      if (i === 0) this._addHandle(i, 'start', seg.start);
      this._addHandle(i, 'end', seg.end);
      // midpoint insert handle
      const mid = {
        x: (seg.start.x + seg.end.x) / 2,
        y: (seg.start.y + seg.end.y) / 2,
        z: (seg.start.z + seg.end.z) / 2,
      };
      this._addMidHandle(i, mid);
    }
  }

  _addHandle(segIdx, role, pos) {
    const geo  = new THREE.SphereGeometry(HANDLE_RADIUS, 8, 8);
    const mat  = new THREE.MeshBasicMaterial({ color: HANDLE_COLOUR, depthTest: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos.x, pos.y, pos.z ?? 0);
    mesh.renderOrder = 2;
    this._handleGroup.add(mesh);
    this._handles.push({ mesh, segIdx, role, pos: { ...pos } });
  }

  _addMidHandle(segIdx, midPos) {
    const geo  = new THREE.SphereGeometry(MIDPOINT_RADIUS, 6, 6);
    const mat  = new THREE.MeshBasicMaterial({ color: MIDPOINT_COLOUR, depthTest: false, transparent: true, opacity: 0.6 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(midPos.x, midPos.y, midPos.z ?? 0);
    mesh.renderOrder = 2;
    this._handleGroup.add(mesh);
    this._midHandles.push({ mesh, segIdx, midPos: { ...midPos } });
  }

  _clearHandles() {
    for (const { mesh } of this._handles) {
      mesh.geometry.dispose(); mesh.material.dispose();
      this._handleGroup.remove(mesh);
    }
    for (const { mesh } of this._midHandles) {
      mesh.geometry.dispose(); mesh.material.dispose();
      this._handleGroup.remove(mesh);
    }
    this._handles    = [];
    this._midHandles = [];
  }

  _onMouseDown(e) {
    if (e.button !== 0) return;
    const hit = this._hitTest(e);
    if (!hit) { this._deselect(); return; }

    if (hit.type === 'handle') {
      this._selectHandle(hit.index);
      this._dragging   = true;
      this._dragHandle = hit;
      this._canvas.style.cursor = 'grabbing';
      window.addEventListener('mousemove', this._boundMouseMove);
      window.addEventListener('mouseup',   this._boundMouseUp);
    } else if (hit.type === 'mid') {
      this._insertNode(hit.index);
    }
  }

  _onMouseMove(e) {
    if (!this._dragging || !this._dragHandle) return;
    const pos = this._getConstructionPlanePos(e);
    if (!pos) return;

    const { segIdx, role } = this._dragHandle;
    const seg = this._pathData.segments[segIdx];
    if (role === 'start') {
      seg.start.x = pos.x; seg.start.y = pos.y; seg.start.z = pos.z ?? 0;
      // Also update previous segment's end if it exists
      if (segIdx > 0) {
        const prev = this._pathData.segments[segIdx - 1];
        prev.end.x = pos.x; prev.end.y = pos.y; prev.end.z = pos.z ?? 0;
      }
    } else {
      seg.end.x = pos.x; seg.end.y = pos.y; seg.end.z = pos.z ?? 0;
      // Also update next segment's start if it exists
      if (segIdx < this._pathData.segments.length - 1) {
        const next = this._pathData.segments[segIdx + 1];
        next.start.x = pos.x; next.start.y = pos.y; next.start.z = pos.z ?? 0;
      }
    }
    // Move existing handle meshes in-place — no dispose/recreate during drag
    this._updateHandlePositions(segIdx);

    // Update selected handle after position refresh
    const newPos = role === 'start' ? seg.start : seg.end;
    this._onNodeSelected({ segIdx, role, pos: newPos });
  }

  _onMouseUp(e) {
    if (!this._dragging) return;
    this._dragging = false;
    this._dragHandle = null;
    this._canvas.style.cursor = '';
    window.removeEventListener('mousemove', this._boundMouseMove);
    window.removeEventListener('mouseup',   this._boundMouseUp);
    // Full handle rebuild once drag ends
    this._buildHandles();
    this._save();
    this.onEditCommitted?.();
  }

  /**
   * Update handle mesh positions in-place for `segIdx` and its neighbours,
   * without disposing or recreating any geometry. Called on every mousemove
   * during drag to avoid the cost of _buildHandles().
   */
  _updateHandlePositions(segIdx) {
    const segs = this._pathData.segments ?? [];

    // Update node handles whose segIdx or adjacency covers the moved point
    for (const h of this._handles) {
      const s = segs[h.segIdx];
      if (!s) continue;
      const p = h.role === 'start' ? s.start : s.end;
      h.mesh.position.set(p.x, p.y, p.z ?? 0);
      h.pos = { ...p };
    }

    // Update midpoint handles adjacent to the dragged segment
    for (const m of this._midHandles) {
      if (m.segIdx !== segIdx && m.segIdx !== segIdx - 1 && m.segIdx !== segIdx + 1) continue;
      const s = segs[m.segIdx];
      if (!s) continue;
      const mid = {
        x: (s.start.x + s.end.x) / 2,
        y: (s.start.y + s.end.y) / 2,
        z: (s.start.z + s.end.z) / 2,
      };
      m.mesh.position.set(mid.x, mid.y, mid.z);
      m.midPos = mid;
    }
  }

  _onKeyDown(e) {
    if (!this._selectedHandle) return;
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this._deleteSelectedNode();
    }
    if (e.key === 'Escape') {
      this._deselect();
    }
  }

  _selectHandle(index) {
    // Reset all colours
    for (const h of this._handles) h.mesh.material.color.setHex(HANDLE_COLOUR);
    this._handles[index].mesh.material.color.setHex(SELECTED_COLOUR);
    this._selectedHandle = this._handles[index];
    this._onNodeSelected({ segIdx: this._selectedHandle.segIdx, role: this._selectedHandle.role, pos: this._selectedHandle.pos });
  }

  _deselect() {
    for (const h of this._handles) h.mesh.material.color.setHex(HANDLE_COLOUR);
    this._selectedHandle = null;
    this._onNodeSelected(null);
  }

  _insertNode(midIdx) {
    const { segIdx, midPos } = this._midHandles[midIdx];
    const seg = this._pathData.segments[segIdx];
    const newSeg = {
      type:  'line',
      start: { ...midPos },
      end:   { ...seg.end },
    };
    seg.end = { ...midPos };
    this._pathData.segments.splice(segIdx + 1, 0, newSeg);
    this._buildHandles();
    this._save();
    this.onEditCommitted?.();
  }

  _deleteSelectedNode() {
    if (!this._selectedHandle) return;
    const { segIdx, role } = this._selectedHandle;
    const segs = this._pathData.segments;

    if (segs.length <= 1) return; // cannot delete only segment

    if (role === 'start' && segIdx === 0) {
      segs.shift(); // remove first segment
    } else if (role === 'end' && segIdx === segs.length - 1) {
      segs.pop(); // remove last segment
    } else {
      // Remove a middle node: heal the gap
      if (role === 'end') {
        // Remove current segment, patch next segment start
        if (segIdx + 1 < segs.length) {
          segs[segIdx + 1].start = { ...segs[segIdx].start };
        }
        segs.splice(segIdx, 1);
      } else {
        // start role (not first seg) — remove previous segment, patch
        segs[segIdx].start = { ...segs[segIdx - 1].start };
        segs.splice(segIdx - 1, 1);
      }
    }

    this._selectedHandle = null;
    this._onNodeSelected(null);
    this._buildHandles();
    this._save();
    this.onEditCommitted?.();
  }

  async _save() {
    if (!this._adapter || !this._pathId) return;
    await writeEntity(this._adapter, `paths/${this._pathId}.json`, this._pathData);
  }

  _hitTest(e) {
    const rect   = this._canvas.getBoundingClientRect();
    const mouse  = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width)  * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this._raycaster.setFromCamera(mouse, this._getCamera());

    // Test node handles first
    const handleMeshes = this._handles.map(h => h.mesh);
    const hHits = this._raycaster.intersectObjects(handleMeshes);
    if (hHits.length > 0) {
      const idx = this._handles.findIndex(h => h.mesh === hHits[0].object);
      return { type: 'handle', index: idx };
    }

    // Test midpoint handles
    const midMeshes = this._midHandles.map(h => h.mesh);
    const mHits = this._raycaster.intersectObjects(midMeshes);
    if (mHits.length > 0) {
      const idx = this._midHandles.findIndex(h => h.mesh === mHits[0].object);
      return { type: 'mid', index: idx };
    }

    return null;
  }

  _getConstructionPlanePos(e) {
    const rect   = this._canvas.getBoundingClientRect();
    const mouse  = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width)  * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    // Use a horizontal plane at z=0 (or current storey z)
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    this._raycaster.setFromCamera(mouse, this._getCamera());
    const pt   = new THREE.Vector3();
    const hit  = this._raycaster.ray.intersectPlane(plane, pt);
    return hit ? pt : null;
  }
}
