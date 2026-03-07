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
import { buildThreeMesh }        from './scene/buildMesh.js';
import { applyJunctionClipping } from './junction-renderer.js';

// --- Renderer ---
const canvas = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
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
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 500);
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
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

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

document.getElementById('open-dir-btn').addEventListener('click', async () => {
  if (!window.showDirectoryPicker) {
    statusEl.textContent = 'File System Access API not supported in this browser — use Open .oebfz instead';
    return;
  }
  statusEl.textContent = 'Opening…';
  try {
    const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
    currentDirHandle = dirHandle;
    document.getElementById('edit-profiles-btn').disabled = false;
    statusEl.textContent = 'Loading…';
    _clearScene();

    const { meshes, manifest, junctions } = await loadBundle(dirHandle);
    currentGroup = new THREE.Group();
    currentGroup.name = manifest.project_name;
    for (const meshData of meshes) currentGroup.add(buildThreeMesh(meshData));
    applyJunctionClipping(currentGroup, junctions);
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
  } catch (err) {
    if (err.name !== 'AbortError') {
      statusEl.textContent = `Error: ${err.message}`;
      console.error(err);
    } else {
      statusEl.textContent = 'Viewer ready — open a .oebf folder to begin';
    }
  }
});

document.getElementById('open-file-btn').addEventListener('click', () => {
  statusEl.textContent = '.oebfz loading not yet implemented (planned after Task 11 — see issue #17)';
});

document.getElementById('edit-profiles-btn').addEventListener('click', () => {
  const tab = window.open('/profile-editor.html', '_blank');
  window.addEventListener('message', function handler(e) {
    if (e.data?.type === 'ready' && e.source === tab) {
      tab.postMessage({ type: 'bundle-handle', handle: currentDirHandle }, window.location.origin);
      window.removeEventListener('message', handler);
    }
  });
});

export { scene, renderer, camera, controls };
