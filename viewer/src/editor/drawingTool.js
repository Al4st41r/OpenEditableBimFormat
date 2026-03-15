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
import { fromDisplay, toDisplay, unitLabel } from './units.js';

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

    // Coordinate HUD
    this._hudEl = document.createElement('div');
    this._hudEl.style.cssText = [
      'position:fixed', 'pointer-events:none', 'z-index:200',
      'background:rgba(0,0,0,0.65)', 'color:#7090e8', 'font-family:monospace',
      'font-size:11px', 'padding:2px 8px', 'border-radius:3px', 'display:none',
    ].join(';');
    document.body.appendChild(this._hudEl);

    // Coord input overlay (created lazily)
    this._coordOverlay  = null;
    this._coordInputEl  = null;
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
    this._hudEl.style.display = 'none';
    this._hideCoordOverlay();
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

    this._hudEl.style.display = 'block';
    this._hudEl.textContent = `X: ${toDisplay(pos.x)} ${unitLabel()}  Y: ${toDisplay(pos.y)} ${unitLabel()}`;
    this._hudEl.style.left = (e.clientX + 14) + 'px';
    this._hudEl.style.top  = (e.clientY - 24) + 'px';
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
    // Trigger coordinate entry on 'x' or 'y' when no overlay is shown
    if ((e.key === 'x' || e.key === 'y' || e.key === 'X' || e.key === 'Y') && !this._isCoordOverlayVisible()) {
      const tag = e.target?.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        e.preventDefault();
        this._showCoordOverlay(e.key.toLowerCase());
        return;
      }
    }

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

  _isCoordOverlayVisible() {
    return this._coordOverlay && this._coordOverlay.style.display !== 'none';
  }

  _showCoordOverlay(initialChar) {
    if (!this._coordOverlay) {
      this._coordOverlay = document.createElement('div');
      this._coordOverlay.style.cssText = [
        'position:fixed', 'bottom:48px', 'left:50%', 'transform:translateX(-50%)',
        'background:#1a1a1a', 'border:1px solid #4a8aaa', 'border-radius:4px',
        'padding:6px 10px', 'z-index:300', 'display:flex', 'align-items:center', 'gap:8px',
      ].join(';');
      const label = document.createElement('span');
      label.textContent = 'Go to:';
      label.style.cssText = 'color:#888; font-size:11px; font-family:monospace;';
      this._coordInputEl = document.createElement('input');
      this._coordInputEl.type = 'text';
      this._coordInputEl.placeholder = `x0${unitLabel()}y0${unitLabel()}`;
      this._coordInputEl.style.cssText = [
        'background:#2a2a2a', 'color:#ddd', 'border:1px solid #555',
        'border-radius:3px', 'padding:3px 6px', 'font-size:11px', 'font-family:monospace',
        'width:160px',
      ].join(';');
      this._coordOverlay.appendChild(label);
      this._coordOverlay.appendChild(this._coordInputEl);
      document.body.appendChild(this._coordOverlay);

      this._coordInputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this._commitCoordInput();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          this._hideCoordOverlay();
        }
        e.stopPropagation(); // prevent drawingTool keydown from also firing
      });
    }
    this._coordOverlay.style.display = 'flex';
    this._coordInputEl.value = initialChar;
    this._coordInputEl.focus();
  }

  _hideCoordOverlay() {
    if (this._coordOverlay) this._coordOverlay.style.display = 'none';
    if (this._coordInputEl) this._coordInputEl.value = '';
  }

  _commitCoordInput() {
    const raw = this._coordInputEl?.value ?? '';
    this._hideCoordOverlay();

    // Parse format: x<num>y<num>, x<num>, y<num>
    const xMatch = raw.match(/x(-?[\d.]+)/i);
    const yMatch = raw.match(/y(-?[\d.]+)/i);

    if (!xMatch && !yMatch) return; // nothing parseable

    const cursorX = this._cursorPos?.x ?? 0;
    const cursorY = this._cursorPos?.y ?? 0;
    const z       = this._cursorPos?.z ?? 0;

    const xMetres = xMatch ? fromDisplay(parseFloat(xMatch[1])) : cursorX;
    const yMetres = yMatch ? fromDisplay(parseFloat(yMatch[1])) : cursorY;

    if (!Number.isFinite(xMetres) || !Number.isFinite(yMetres)) return;

    const pt = new THREE.Vector3(xMetres, yMetres, z);
    this._points.push(pt);
    this._cursorPos = pt;
    this._updatePreview();
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
    this._hudEl.remove();
    if (this._coordOverlay) this._coordOverlay.remove();
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
