/**
 * axoScene.js
 *
 * Three.js scene for the axonometric detail viewer: an orthographic camera, orbit controls and the
 * prisms from buildAxoModel extruded into meshes. Z is up in both plan and section details.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AXO_VIEWS } from './detailAxo.js';

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
    this.show = { members: true, regions: true, edges: true };
    this.view = 'iso-se';
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  /** @param {object} model - from buildAxoModel; @param {(id: string) => string} colourOf */
  setModel(model, colourOf) {
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
      const geometry = prismGeometry(model.plane, prism);
      const mesh = new THREE.Mesh(geometry, materialFor(prism.materialId, prism.kind === 'region'));
      mesh.userData = { kind: prism.kind, edges: false };
      this.group.add(mesh);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), edgeMaterial);
      edges.userData = { kind: prism.kind, edges: true };
      this.group.add(edges);
    }
    this.scene.add(this.group);
    this.applyVisibility();

    const box = new THREE.Box3().setFromObject(this.group);
    if (box.isEmpty()) { this.target.set(0, 0, 0); this.radius = 1; } else {
      box.getCenter(this.target);
      this.radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.1);
    }
    this.setView(this.view);
  }

  applyVisibility() {
    if (!this.group) return;
    for (const o of this.group.children) {
      const kindOn = o.userData.kind === 'region' ? this.show.regions : this.show.members;
      o.visible = kindOn && (!o.userData.edges || this.show.edges);
    }
    this.render();
  }

  setShow(patch) {
    Object.assign(this.show, patch);
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
