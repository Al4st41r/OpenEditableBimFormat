/**
 * drawingTool.js — Shared click-to-place drawing interaction.
 *
 * Handles raycasting to the construction plane, snap indicator rendering,
 * live preview line, and commit/cancel events.
 *
 * Usage:
 *   const tool = new DrawingTool(scene, camera, constructionPlane, canvas);
 *   tool.onCommit = (points) => { ... };
 *   tool.activate();
 *   // ... user clicks ...
 *   tool.deactivate();
 */

import * as THREE from 'three';

const SNAP_RADIUS = 0.1; // metres
const Z_FIGHT_OFFSET = 0.001; // metres — lifts preview above construction plane

export class DrawingTool {
  constructor(scene, getCameraFn, constructionPlane, canvas) {
    this._scene             = scene;
    this._getCamera         = getCameraFn;
    this._constructionPlane = constructionPlane;
    this._canvas            = canvas;
    this._raycaster         = new THREE.Raycaster();
    this._mouse             = new THREE.Vector2();

    /** @type {THREE.Vector3[]} placed points */
    this._points     = [];
    /** @type {THREE.Vector3|null} current cursor position on plane */
    this._cursorPos  = null;
    this._active     = false;
    this._closeable  = false; // true for floor polygon mode

    // Preview objects
    this._previewGroup = new THREE.Group();
    this._previewGroup.name = 'drawing-preview';
    this._scene.add(this._previewGroup);

    // Snap indicator (small cross)
    this._snapIndicator = _makeSnapIndicator();
    this._snapIndicator.visible = false;
    this._scene.add(this._snapIndicator);

    // Callbacks
    this.onCommit = null; // (points: THREE.Vector3[]) => void
    this.onCancel = null; // () => void

    this._boundMouseMove = this._onMouseMove.bind(this);
    this._boundClick     = this._onClick.bind(this);
    this._boundDblClick  = this._onDblClick.bind(this);
    this._boundKeyDown   = this._onKeyDown.bind(this);
  }

  activate({ closeable = false } = {}) {
    if (this._active) return;
    this._active    = true;
    this._closeable = closeable;
    this._points    = [];
    this._canvas.style.cursor = 'crosshair';
    this._canvas.addEventListener('mousemove', this._boundMouseMove);
    this._canvas.addEventListener('click',     this._boundClick);
    this._canvas.addEventListener('dblclick',  this._boundDblClick);
    window.addEventListener('keydown',         this._boundKeyDown);
  }

  deactivate() {
    this._active = false;
    this._points = [];
    this._canvas.style.cursor = '';
    this._canvas.removeEventListener('mousemove', this._boundMouseMove);
    this._canvas.removeEventListener('click',     this._boundClick);
    this._canvas.removeEventListener('dblclick',  this._boundDblClick);
    window.removeEventListener('keydown',         this._boundKeyDown);
    this._clearPreview();
    this._snapIndicator.visible = false;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _getWorldPos(event) {
    const rect = this._canvas.getBoundingClientRect();
    this._mouse.x =  ((event.clientX - rect.left) / rect.width)  * 2 - 1;
    this._mouse.y = -((event.clientY - rect.top)  / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(this._mouse, this._getCamera());
    const hits = this._raycaster.intersectObject(this._constructionPlane);
    return hits.length > 0 ? hits[0].point.clone() : null;
  }

  _onMouseMove(e) {
    const pos = this._getWorldPos(e);
    if (!pos) return;
    this._cursorPos = pos;
    this._snapIndicator.position.copy(pos);
    this._snapIndicator.visible = true;
    this._updatePreview();
  }

  _onClick(e) {
    const pos = this._getWorldPos(e);
    if (!pos) return;

    // Close polygon if clicking near first point
    if (this._closeable && this._points.length >= 3) {
      const dist = pos.distanceTo(this._points[0]);
      if (dist < SNAP_RADIUS) {
        this._commit(true);
        return;
      }
    }

    this._points.push(pos);
    this._updatePreview();
  }

  _onDblClick(e) {
    // Browsers fire two click events before dblclick — remove both
    // Require at least 4 points: 2 real + 2 from the double-click clicks
    if (this._points.length >= 4) {
      this._points.splice(-2);
      this._commit(false);
    }
  }

  _onKeyDown(e) {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'Enter' && this._points.length >= 2) {
      this._commit(false);
    }
    if (e.key === 'Escape') {
      this._clearPreview();
      if (this.onCancel) this.onCancel();
    }
    if (e.key === 'c' || e.key === 'C') {
      if (this._closeable && this._points.length >= 3) this._commit(true);
    }
  }

  _commit(closed) {
    const pts = [...this._points];
    if (closed && pts.length >= 3) pts.push(pts[0].clone()); // close the loop
    this.deactivate();
    if (this.onCommit) this.onCommit(pts, closed);
  }

  _updatePreview() {
    this._clearPreview();
    if (!this._cursorPos) return;

    const allPts = [...this._points, this._cursorPos];
    if (allPts.length < 2) return;

    const pts3 = allPts.map(p => new THREE.Vector3(p.x, p.y, p.z + Z_FIGHT_OFFSET));
    const geo  = new THREE.BufferGeometry().setFromPoints(pts3);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0x44aaff, linewidth: 1,
    }));
    this._previewGroup.add(line);
  }

  _clearPreview() {
    for (const child of this._previewGroup.children) {
      child.geometry.dispose();
      child.material.dispose();
    }
    this._previewGroup.clear();
  }

  dispose() {
    this.deactivate();
    this._scene.remove(this._previewGroup);
    this._scene.remove(this._snapIndicator);
    this._snapIndicator.geometry.dispose();
    this._snapIndicator.material.dispose();
  }
}

function _makeSnapIndicator() {
  const pts = [
    new THREE.Vector3(-0.05, 0, 0), new THREE.Vector3(0.05, 0, 0),
    new THREE.Vector3(0, -0.05, 0), new THREE.Vector3(0, 0.05, 0),
  ];
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xffffff }));
}
