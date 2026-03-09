/**
 * editorScene.js — Three.js scene setup for the OEBF editor.
 *
 * Sets up renderer, perspective camera, orthographic camera,
 * OrbitControls, lighting, and construction plane.
 * Exports helpers for switching between 3D and plan view.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function initEditorScene(canvas) {
  // ── Renderer ──────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);

  // ── Scene ─────────────────────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a1a);
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(10, 20, 10);
  scene.add(dirLight);

  // ── Perspective camera (Z-up) ─────────────────────────────────────────────
  const perspCamera = new THREE.PerspectiveCamera(
    45, canvas.clientWidth / canvas.clientHeight, 0.01, 1000
  );
  perspCamera.position.set(10, -10, 8);
  perspCamera.up.set(0, 0, 1);

  // ── Orthographic camera for plan view ────────────────────────────────────
  const aspect = canvas.clientWidth / canvas.clientHeight;
  const orthoSize = 20;
  const orthoCamera = new THREE.OrthographicCamera(
    -orthoSize * aspect, orthoSize * aspect,
    orthoSize, -orthoSize,
    0.01, 1000
  );
  orthoCamera.position.set(0, 0, 100);
  orthoCamera.up.set(0, 1, 0);
  orthoCamera.lookAt(0, 0, 0);

  // ── Controls ──────────────────────────────────────────────────────────────
  const controls = new OrbitControls(perspCamera, canvas);
  controls.target.set(0, 0, 0);
  controls.update();

  // ── Construction grid (visual) ────────────────────────────────────────────
  const constructionGrid = new THREE.GridHelper(50, 50, 0x333333, 0x2a2a2a);
  constructionGrid.rotation.x = Math.PI / 2; // XY plane (Z-up)
  constructionGrid.position.z = 0;
  scene.add(constructionGrid);

  // Invisible plane for raycasting
  const constructionPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(500, 500),
    new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
  );
  // PlaneGeometry is XY by default — correct for Z-up coordinate system
  scene.add(constructionPlane);

  // ── Model group (loaded entities) ─────────────────────────────────────────
  const modelGroup = new THREE.Group();
  modelGroup.name = 'model';
  scene.add(modelGroup);

  // ── Overlay group (guides, grids, storey planes) ──────────────────────────
  const overlayGroup = new THREE.Group();
  overlayGroup.name = 'overlays';
  scene.add(overlayGroup);

  // ── State ─────────────────────────────────────────────────────────────────
  let isPlanView = false;

  function setStoreyZ(z) {
    constructionGrid.position.z = z;
    constructionPlane.position.z = z;
  }

  function setPlanView(enabled) {
    isPlanView = enabled;
    controls.enabled = !enabled;
  }

  function getActiveCamera() {
    return isPlanView ? orthoCamera : perspCamera;
  }

  // ── Resize ────────────────────────────────────────────────────────────────
  function handleResize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h);
    perspCamera.aspect = w / h;
    perspCamera.updateProjectionMatrix();
    const a = w / h;
    orthoCamera.left   = -orthoSize * a;
    orthoCamera.right  =  orthoSize * a;
    orthoCamera.updateProjectionMatrix();
  }

  window.addEventListener('resize', handleResize);

  // ── Render loop ───────────────────────────────────────────────────────────
  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, getActiveCamera());
  }
  animate();

  return {
    renderer, scene, perspCamera, orthoCamera, controls,
    constructionPlane, constructionGrid, modelGroup, overlayGroup,
    setStoreyZ, setPlanView, getActiveCamera,
  };
}
