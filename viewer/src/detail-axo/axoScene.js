/**
 * axoScene.js
 *
 * Three.js scene for the axonometric detail viewer: an orthographic camera, orbit controls and the
 * prisms from buildAxoModel extruded into meshes. Z is up in both plan and section details.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AXO_VIEWS, clipPolygon, guideSegments } from './detailAxo.js';
import { signedArea } from '../detail/regionGeometry.js';
import { NONE_COLOUR } from '../detail-review/overlays.js';

const FALLBACK_COLOUR = '#999999';

/** Extruded geometry for one prism, already in world space (matches toWorld). */
export function prismGeometry(plane, prism) {
  const shape = new THREE.Shape(prism.points.map((p) => new THREE.Vector2(p.x, p.y)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: prism.w1 - prism.w0, bevelEnabled: false });
  if (plane === 'plan') {
    geometry.translate(0, 0, prism.w0);
  } else {
    geometry.rotateX(Math.PI / 2);        // local y -> world z, local z -> world -y
    geometry.translate(0, -prism.w0, 0);
  }
  return geometry;
}

export class AxoViewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#f2f1ed');
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = false;
    this.controls.addEventListener('change', () => this.render());

    this.scene.add(new THREE.HemisphereLight('#ffffff', '#b8b4a8', 1.1));
    const sun = new THREE.DirectionalLight('#ffffff', 1.4);
    sun.position.set(-3, -5, 8);
    this.scene.add(sun);

    this.group = null;
    this.target = new THREE.Vector3();
    this.radius = 1;
    this.show = { members: true, regions: true, edges: true, guides: true, clip: true };
    this.guides = null;
    this.view = 'iso-se';
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  /** @param {object} model - from buildAxoModel; @param {(id: string) => string} colourOf */
  setModel(model, colourOf, keepCamera = false) {
    this.model = model; this.colourOf = colourOf;
    if (this.group) {
      this.scene.remove(this.group);
      this.group.traverse((o) => { o.geometry?.dispose(); if (o.material?.dispose) o.material.dispose(); });
    }
    this.group = new THREE.Group();
    const materials = new Map();
    const materialFor = (id, region) => {
      const key = `${id}|${region}`;
      if (!materials.has(key)) {
        materials.set(key, new THREE.MeshStandardMaterial({
          color: colourOf(id) ?? FALLBACK_COLOUR, roughness: 0.85, metalness: 0, side: THREE.DoubleSide,
          polygonOffset: region, polygonOffsetFactor: region ? -2 : 0, polygonOffsetUnits: region ? -2 : 0,
        }));
      }
      return materials.get(key);
    };
    const edgeMaterial = new THREE.LineBasicMaterial({ color: '#2a2a2a' });

    for (const prism of model.prisms) {
      if (!(prism.points.length >= 3) || !(prism.w1 > prism.w0)) continue;
      // The clip cuts the polygon itself, so the solid is closed at the cut line.
      const points = this.show.clip ? clipPolygon(prism.points, model.clip) : prism.points;
      if (points.length < 3) continue;
      const geometry = prismGeometry(model.plane, { ...prism, points });
      const mesh = new THREE.Mesh(geometry, materialFor(prism.materialId, prism.kind === 'region'));
      mesh.userData = { kind: prism.kind, edges: false, itemId: prism.id, baseMaterial: mesh.material, materialColour: mesh.material, area: Math.abs(signedArea(prism.points)) };
      this.group.add(mesh);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), edgeMaterial);
      edges.userData = { kind: prism.kind, edges: true };
      this.group.add(edges);
    }
    this.scene.add(this.group);
    this.setGuides(model);
    this.applyVisibility();

    if (keepCamera) { this.applyVisibility(); return; }
    const box = new THREE.Box3().setFromObject(this.group);
    if (box.isEmpty()) { this.target.set(0, 0, 0); this.radius = 1; } else {
      box.getCenter(this.target);
      this.radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.1);
    }
    this.setView(this.view);
  }

  /** Reference lines (red, dashed) and the clip box (grey) as 3D lines. Rebuilt with each model. */
  setGuides(model) {
    if (this.guides) { this.scene.remove(this.guides); this.guides.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); }); }
    this.guides = new THREE.Group();
    const { refs, clipBox } = guideSegments(model);
    const lines = (segs, material, kind) => {
      if (!segs.length) return;
      const pts = segs.flatMap((s) => [new THREE.Vector3(s.a.x, s.a.y, s.a.z), new THREE.Vector3(s.b.x, s.b.y, s.b.z)]);
      const l = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), material);
      l.computeLineDistances();
      l.userData = { guide: kind };
      this.guides.add(l);
    };
    const dash = (colour, dashSize, gapSize) => new THREE.LineDashedMaterial({ color: colour, dashSize, gapSize });
    const unit = Math.max(this.radius, 0.1) * 0.03;
    lines(refs, dash('#d33', unit * 3, unit), 'refs');
    lines(clipBox, dash('#777', unit * 2, unit * 1.5), 'clip');
    this.scene.add(this.guides);
  }

  /**
   * Colour every solid from an overlay (solid id -> colour, null = no data), or pass null to restore the material colours.
   * Keeps the selection highlight.
   */
  setOverlay(colours, selectedId = null) {
    this.overlayColours = colours;
    if (!this.group) return;
    this.overlayCache ??= new Map();
    const made = (key, make) => { if (!this.overlayCache.has(key)) this.overlayCache.set(key, make()); return this.overlayCache.get(key); };
    for (const o of this.group.children) {
      if (o.userData.edges || !o.isMesh) continue;
      if (!colours) { o.userData.baseMaterial = o.userData.materialColour; }
      else {
        const c = colours.get(o.userData.itemId);
        // Solids outside the overlay ("none") and with no data are faded, so the ones that matter show through.
        const faded = !c || c === NONE_COLOUR;
        o.userData.baseMaterial = made(c ?? 'nodata', () => new THREE.MeshStandardMaterial({
          color: c ?? '#cfcfcf', roughness: 0.85, metalness: 0, side: THREE.DoubleSide,
          transparent: faded, opacity: faded ? (c ? 0.22 : 0.5) : 1, depthWrite: !faded,
        }));
      }
    }
    this.setSelected(selectedId);
  }

  /** Highlight one item (by prism id), or none. */
  setSelected(id) {
    this.selectedId = id;
    if (!this.group) return;
    this.highlight ??= new THREE.MeshStandardMaterial({ color: '#e0523d', emissive: '#a02010', emissiveIntensity: 0.6, roughness: 0.6, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    for (const o of this.group.children) {
      if (o.userData.edges || !o.isMesh) continue;
      o.material = o.userData.itemId === id ? this.highlight : o.userData.baseMaterial;
    }
    this.render();
  }

  /** The id of the item under a pointer position, or null. Hidden items are skipped. */
  pick(clientX, clientY) {
    if (!this.group) return null;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1));
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const meshes = this.group.children.filter((o) => o.isMesh && o.visible);
    const hits = ray.intersectObjects(meshes, false);
    if (!hits.length) return null;
    // Overlapping solids (a region drawn over a member) have faces at the same depth: take the smallest, the most specific.
    const front = hits.filter((h) => h.distance <= hits[0].distance + 1e-3);
    front.sort((a, b) => a.object.userData.area - b.object.userData.area);
    return front[0].object.userData.itemId;
  }

  applyVisibility() {
    if (!this.group) return;
    for (const o of this.group.children) {
      const kindOn = o.userData.kind === 'region' ? this.show.regions : this.show.members;
      o.visible = kindOn && (!o.userData.edges || this.show.edges);
    }
    for (const g of this.guides?.children ?? []) g.visible = g.userData.guide === 'clip' ? this.show.clip : this.show.guides;
    this.render();
  }

  setShow(patch) {
    const reclip = 'clip' in patch && patch.clip !== this.show.clip && this.model;
    Object.assign(this.show, patch);
    if (reclip) {
      this.setModel(this.model, this.colourOf, true);   // the cut is in the geometry
      this.setOverlay(this.overlayColours ?? null, this.selectedId ?? null);   // the new meshes lost the overlay and highlight
    }
    this.applyVisibility();
  }

  setView(key) {
    const v = AXO_VIEWS[key] ?? AXO_VIEWS['iso-se'];
    this.view = key in AXO_VIEWS ? key : 'iso-se';
    const az = (v.azimuth * Math.PI) / 180, el = (v.elevation * Math.PI) / 180;
    const d = this.radius * 4;
    this.camera.position.set(
      this.target.x + d * Math.sin(az) * Math.cos(el),
      this.target.y - d * Math.cos(az) * Math.cos(el),
      this.target.z + d * Math.sin(el),
    );
    this.controls.target.copy(this.target);
    this.camera.near = -this.radius * 10;
    this.camera.far = this.radius * 10;
    this.camera.zoom = 1;
    this.fit();
  }

  fit() {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    const aspect = w > 0 && h > 0 ? w / h : 1;
    const half = this.radius * 1.15;
    this.camera.left = -half * Math.max(aspect, 1);
    this.camera.right = half * Math.max(aspect, 1);
    this.camera.top = half * Math.max(1 / aspect, 1);
    this.camera.bottom = -half * Math.max(1 / aspect, 1);
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.render();
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.fit();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /** PNG of the current view. */
  snapshot() {
    this.render();
    return new Promise((resolve) => this.canvas.toBlob(resolve, 'image/png'));
  }
}
