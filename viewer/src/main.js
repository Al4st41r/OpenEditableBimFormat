/**
 * main.js — OEBF Viewer entry point
 *
 * Sets up the Three.js scene, camera, lights, orbit controls, and resize
 * handling. Bundle loading (Tasks 11, 17) wires into loadBundle() / loadBundleZstd().
 *
 * Coordinate system: right-hand, Z-up (matches OEBF convention).
 * Camera.up is set to Z; the grid lies in the XY plane.
 *
 * renderer.localClippingEnabled = true is required for junction trim planes
 * (material.clippingPlanes) to function — see junction-trimmer.js and
 * docs/decisions/2026-03-02-junction-trim-algorithm.md
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadBundle }           from './loader/loadBundle.js';
import { loadBundleZstd }       from './loader/loadBundleZstd.js';
import { buildThreeMesh }        from './scene/buildMesh.js';
import { applyJunctionClipping, buildCustomJunctionMesh } from './junction-renderer.js';
import { buildArrayGroup }       from './array/arrayRenderer.js';
import { buildSymbolGeometries } from './loader/loadSymbol.js';
import { buildGridLineSegments } from './loader/loadGrid.js';

// --- Renderer ---
const canvas = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.localClippingEnabled = true; // required for junction trim planes

// --- Scene ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a);
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(10, 20, 10);
scene.add(dirLight);

// --- Camera (Z-up) ---
const camera = new THREE.PerspectiveCamera(45, (canvas.clientWidth || window.innerWidth) / (canvas.clientHeight || window.innerHeight), 0.01, 500);
camera.position.set(10, -10, 8);
camera.up.set(0, 0, 1);

// --- Controls ---
const controls = new OrbitControls(camera, canvas);
controls.target.set(2.7, 4.25, 1.2);
controls.update();

// --- Ground grid (XY plane, 1 m cells, 20 m span) ---
const grid = new THREE.GridHelper(20, 20, 0x444444, 0x333333);
grid.rotation.x = Math.PI / 2;
scene.add(grid);

// --- Resize ---
// ResizeObserver prevents the WebGL drawArraysInstanced viewport warning
// caused by a mismatch between canvas drawingBuffer and viewport size.
function _handleResize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(() => _handleResize()).observe(canvas);
_handleResize(); // ensure correct size on first frame

// --- Render loop ---
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

// --- UI ---
const statusEl = document.getElementById('status');
statusEl.textContent = 'Viewer ready — open a .oebf folder to begin';

// --- Bundle loading ---

let currentGroup = null;
let currentDirHandle = null;

function _clearScene() {
  if (!currentGroup) return;
  scene.remove(currentGroup);
  currentGroup.traverse(child => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
  });
  currentGroup = null;
}

function _buildScene(meshes, manifest, junctions, arrays, grids) {
  _clearScene();

  currentGroup = new THREE.Group();
  currentGroup.name = manifest.project_name;
  for (const meshData of meshes) currentGroup.add(buildThreeMesh(meshData));
  applyJunctionClipping(currentGroup, junctions);

  // Build material map for custom junction rendering
  const matMap = new Map();
  for (const meshData of meshes) {
    if (meshData.materialId && !matMap.has(meshData.materialId)) {
      matMap.set(meshData.materialId, new THREE.MeshLambertMaterial({
        color: new THREE.Color(meshData.colour ?? '#888888'),
        side: THREE.DoubleSide,
      }));
    }
  }
  for (const junction of junctions) {
    if (junction.rule === 'custom' && junction.geomData) {
      const customMesh = buildCustomJunctionMesh(junction.geomData, matMap);
      currentGroup.add(customMesh);
    }
  }

  // Render arrays (InstancedMesh per symbol layer)
  for (const { arrayDef, pathPoints, symbolDef } of arrays) {
    try {
      const symMatMap = new Map();
      const sourceGeometries = buildSymbolGeometries(symbolDef, symMatMap);
      const arrayGroup = buildArrayGroup(arrayDef, pathPoints, sourceGeometries);
      currentGroup.add(arrayGroup);
    } catch (err) {
      console.warn(`[OEBF] Skipping array render ${arrayDef.id}: ${err.message}`);
    }
  }

  // Render structural grids as subtle line segments
  for (const grid of grids) {
    const { positions } = buildGridLineSegments(grid);
    if (positions.length === 0) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({ color: 0x555555, opacity: 0.5, transparent: true });
    const lines = new THREE.LineSegments(geometry, material);
    lines.userData.gridId = grid.id;
    currentGroup.add(lines);
  }

  scene.add(currentGroup);

  // Fit camera to loaded geometry
  const box    = new THREE.Box3().setFromObject(currentGroup);
  const centre = box.getCenter(new THREE.Vector3());
  const size   = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  camera.position.copy(centre).add(new THREE.Vector3(maxDim, -maxDim, maxDim * 0.8));
  controls.target.copy(centre);
  controls.update();

  statusEl.textContent = `${manifest.project_name} — ${meshes.length} mesh(es) loaded`;
}

document.getElementById('open-dir-btn').addEventListener('click', async () => {
  if (!window.showDirectoryPicker) {
    statusEl.textContent = 'Your browser does not support folder opening (Firefox). Use "Open .oebfz" instead.';
    return;
  }
  statusEl.textContent = 'Opening…';
  try {
    const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
    currentDirHandle = dirHandle;
    document.getElementById('edit-profiles-btn').disabled = false;
    statusEl.textContent = 'Loading…';
    const { meshes, manifest, junctions, arrays, grids } = await loadBundle(dirHandle);
    _buildScene(meshes, manifest, junctions, arrays, grids);
  } catch (err) {
    if (err.name !== 'AbortError') {
      statusEl.textContent = `Error: ${err.message}`;
      console.error(err);
    } else {
      statusEl.textContent = 'Viewer ready — open a .oebf folder to begin';
    }
  }
});

document.getElementById('load-demo-btn').addEventListener('click', async () => {
  statusEl.textContent = 'Loading demo…';
  try {
    const resp = await fetch(import.meta.env.BASE_URL + 'terraced-house.oebfz');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    const file = new File([blob], 'terraced-house.oebfz');
    const result = await loadBundleZstd(file);
    _buildScene(result.meshes, result.manifest, result.junctions, result.arrays, result.grids);
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    console.error(err);
  }
});

document.getElementById('open-file-btn').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.oebfz';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    statusEl.textContent = 'Loading…';
    try {
      const result = await loadBundleZstd(file);
      _buildScene(result.meshes, result.manifest, result.junctions, result.arrays, result.grids);
      currentDirHandle = null;
      document.getElementById('edit-profiles-btn').disabled = true;
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
      console.error(err);
    }
  };
  input.click();
});

document.getElementById('edit-profiles-btn').addEventListener('click', () => {
  if (!currentDirHandle) {
    statusEl.textContent = 'Profile editor requires an .oebf folder — not available for .oebfz files.';
    return;
  }
  const tab = window.open(import.meta.env.BASE_URL + 'profile-editor.html', '_blank');
  window.addEventListener('message', function handler(e) {
    if (e.data?.type === 'ready' && e.source === tab) {
      tab.postMessage({ type: 'bundle-handle', handle: currentDirHandle }, window.location.origin);
      window.removeEventListener('message', handler);
    }
  });
});

export { scene, renderer, camera, controls };
