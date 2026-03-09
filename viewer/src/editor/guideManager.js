/**
 * guideManager.js — Reference line (guide) management.
 *
 * Guide lines are Path entities with guide:true.
 * Rendered: blue dashed lines in plan, translucent blue vertical planes in 3D.
 */

import * as THREE from 'three';
import { writeEntity } from './bundleWriter.js';

const GUIDE_COLOUR  = 0x7090e8;
const GUIDE_OPACITY = 0.12;
const GUIDE_HEIGHT  = 10;

export class GuideManager {
  constructor(overlayGroup, listEl, onGuideAdded) {
    this._overlayGroup  = overlayGroup;
    this._listEl        = listEl;
    this._onGuideAdded  = onGuideAdded ?? null;
    this._guides        = [];
    this._dirHandle     = null;
  }

  setDirHandle(h) { this._dirHandle = h; }

  /** Idempotent load from bundle — clears before populating. */
  loadFromBundle(guidePaths) {
    // Clear existing
    for (const g of this._guides) {
      g.object3d.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
      this._overlayGroup.remove(g.object3d);
    }
    this._guides = [];

    for (const path of guidePaths) {
      this._addGuide(path.id, path.description ?? path.id, path.segments ?? [], true);
    }
  }

  /**
   * Add a guide from an array of THREE.Vector3 points.
   * Called by the drawing tool on commit (Task 37).
   */
  async addGuideFromPoints(points, name) {
    const id       = `guide-${(name ?? 'guide').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Date.now()}`;
    const segments = _pointsToSegments(points);
    this._addGuide(id, name ?? id, segments, true);
    if (this._dirHandle) {
      await writeEntity(this._dirHandle, `paths/${id}.json`, {
        '$schema': 'oebf://schema/0.1/path',
        id, type: 'Path', guide: true,
        description: name ?? id,
        closed: false, segments,
      });
    }
    if (this._onGuideAdded) this._onGuideAdded(id);
    return id;
  }

  toggleVisibility(id) {
    const g = this._guides.find(x => x.id === id);
    if (!g) return;
    g.visible = !g.visible;
    g.object3d.visible = g.visible;
    this._renderList();
  }

  getGuides() { return this._guides; }

  // ── Private ────────────────────────────────────────────────────────────────

  _addGuide(id, name, segments, visible) {
    const object3d = _buildGuideObject(segments);
    object3d.visible = visible;
    this._overlayGroup.add(object3d);
    this._guides.push({ id, name, segments, visible, object3d });
    this._renderList();
  }

  _renderList() {
    this._listEl.innerHTML = '';
    for (const g of this._guides) {
      const item = document.createElement('div');
      item.className = 'tree-item';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'tree-item-name';
      nameSpan.textContent = g.name;

      const eyeBtn = document.createElement('button');
      eyeBtn.className = 'tree-item-eye';
      eyeBtn.title = 'Toggle visibility';
      eyeBtn.textContent = g.visible ? '●' : '○';

      eyeBtn.addEventListener('click', e => {
        e.stopPropagation();
        this.toggleVisibility(g.id);
      });

      item.append(nameSpan, eyeBtn);
      this._listEl.appendChild(item);
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _buildGuideObject(segments) {
  const group = new THREE.Group();
  if (!segments.length) return group;

  // Collect line points from segments
  const pts3 = [];
  for (const seg of segments) {
    // Only 'line' segments rendered; arc/bezier/spline not yet supported for guides.
    if (seg.type === 'line') {
      pts3.push(new THREE.Vector3(seg.start.x, seg.start.y, seg.start.z ?? 0));
      pts3.push(new THREE.Vector3(seg.end.x,   seg.end.y,   seg.end.z   ?? 0));
    }
  }

  if (pts3.length >= 2) {
    // Dashed line in plan view
    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts3);
    const lineMat = new THREE.LineDashedMaterial({
      color: GUIDE_COLOUR, dashSize: 0.4, gapSize: 0.2,
    });
    const line = new THREE.LineSegments(lineGeo, lineMat);
    line.computeLineDistances();
    group.add(line);

    // Translucent blue plane spanning guide extent (3D view)
    const xs = pts3.map(p => p.x);
    const ys = pts3.map(p => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const len = Math.sqrt(
      (Math.max(...xs) - Math.min(...xs)) ** 2 +
      (Math.max(...ys) - Math.min(...ys)) ** 2
    ) || 1;
    const planeMat = new THREE.MeshBasicMaterial({
      color: GUIDE_COLOUR, transparent: true,
      opacity: GUIDE_OPACITY, side: THREE.DoubleSide, depthWrite: false,
    });
    const planeGeo = new THREE.PlaneGeometry(len, GUIDE_HEIGHT);
    const plane    = new THREE.Mesh(planeGeo, planeMat);
    const dx = pts3.at(-1).x - pts3[0].x;
    const dy = pts3.at(-1).y - pts3[0].y;
    const angle = Math.atan2(dy, dx);
    // Position plane centred on the guide, standing vertically at mid-height
    plane.position.set(cx, cy, GUIDE_HEIGHT / 2);
    plane.rotation.x = Math.PI / 2; // Make it stand vertically (Z-up)
    plane.rotation.z = angle;       // Align with guide direction
    group.add(plane);
  }

  return group;
}

function _pointsToSegments(points) {
  const segs = [];
  for (let i = 0; i < points.length - 1; i++) {
    segs.push({
      type: 'line',
      start: { x: points[i].x,     y: points[i].y,     z: points[i].z   ?? 0 },
      end:   { x: points[i+1].x,   y: points[i+1].y,   z: points[i+1].z ?? 0 },
    });
  }
  return segs;
}
