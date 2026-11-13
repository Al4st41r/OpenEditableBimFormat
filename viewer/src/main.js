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
import { buildThreeMesh, resetDepthBias } from './scene/buildMesh.js';
import { applyJunctionClipping, buildCustomJunctionMesh, buildJunctionDetailMeshes } from './junction-renderer.js';
import { ensureDetailMaterials } from './detail/detailMaterials.js';
import { applyCsgJunctions } from './junction-csg.js';
import { buildObjectGroup, colourLookup } from './loader/loadObject.js';
import { cutOpenings, openingFaces } from './geometry/openingCut.js';
import { buildOpeningOutline } from './loader/loadOpening.js';
import { buildArrayGroup }       from './array/arrayRenderer.js';
import { buildSymbolGeometries, symbolMaterials } from './loader/loadSymbol.js';
import { buildGridLineSegments } from './loader/loadGrid.js';
import { renderIcons } from './ui/icons.js';
import { gridDrop } from './scene/renderMode.js';
import { fitPerspective } from './scene/fitCamera.js';

renderIcons();

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
const camera = new THREE.PerspectiveCamera(45, (canvas.clientWidth || window.innerWidth) / (canvas.clientHeight || window.innerHeight), 0.1, 300);
camera.position.set(10, -10, 8);
camera.up.set(0, 0, 1);

// --- Controls ---
const controls = new OrbitControls(camera, canvas);
controls.target.set(2.7, 4.25, 1.2);
controls.update();
window.__viewer = { camera, controls, scene: () => currentGroup };

// --- Ground grid (XY plane, 1 m cells, 20 m span) ---
const grid = new THREE.GridHelper(20, 20, 0x444444, 0x333333);
grid.rotation.x = Math.PI / 2;
scene.add(grid);
/** The bundle's grid axes, at Z 0: lowered under the ground slab each frame, as the ground grid is (#173). */
let referenceGrid = null;

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
  const drop = gridDrop(camera.position.distanceTo(controls.target));
  grid.position.z = -drop;   // under the ground slab's top face (#152)
  if (referenceGrid) referenceGrid.position.z = -drop;   // the bundle's grid axes too (#173)
  renderer.render(scene, camera);
}
animate();

// --- UI ---
const statusEl = document.getElementById('status');
statusEl.textContent = 'Viewer ready — open a .oebf folder to begin';

// --- Bundle loading ---

let currentGroup = null;
let currentDirHandle = null;
/** True while the demo is shown: View profiles then opens the same bundle, served beside the app, by URL. */
let demoLoaded = false;
const DEMO_BUNDLE = 'terraced-house.oebf';
const editProfilesBtn = document.getElementById('edit-profiles-btn');

function _clearScene() {
  if (!currentGroup) return;
  scene.remove(currentGroup);
  currentGroup.traverse(child => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
  });
  currentGroup = null;
}

function _buildScene(meshes, manifest, junctions, arrays, grids, openings = [], materials = [], objects = []) {
  _clearScene();

  currentGroup = new THREE.Group();
  currentGroup.name = manifest.project_name;
  resetDepthBias();
  for (const meshData of meshes) currentGroup.add(buildThreeMesh(meshData));
  applyJunctionClipping(currentGroup, junctions);
  applyCsgJunctions(currentGroup, junctions);

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

  // Junctions drawn from reusable details (junction.detailGeometry, see detail/loadDetails.js).
  // Own material map with a polygon offset so faces flush against a wall do not z-fight.
  const detailMatMap = new Map();
  ensureDetailMaterials(detailMatMap, junctions, materials, (hex) => new THREE.MeshLambertMaterial({
    color: new THREE.Color(hex), side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  for (const group of buildJunctionDetailMeshes(junctions, detailMatMap)) currentGroup.add(group);

  // Render arrays (InstancedMesh per symbol layer)
  for (const { arrayDef, pathPoints, symbolDef } of arrays) {
    try {
      const symMatMap = symbolMaterials(symbolDef, materials);
      const sourceGeometries = buildSymbolGeometries(symbolDef, symMatMap);
      const arrayGroup = buildArrayGroup(arrayDef, pathPoints, sourceGeometries);
      currentGroup.add(arrayGroup);
    } catch (err) {
      console.warn(`[OEBF] Skipping array render ${arrayDef.id}: ${err.message}`);
    }
  }

  // Render structural grids as subtle line segments
  referenceGrid = new THREE.Group();
  referenceGrid.name = 'reference-grid';
  currentGroup.add(referenceGrid);
  for (const grid of grids) {
    const { positions } = buildGridLineSegments(grid);
    if (positions.length === 0) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({ color: 0x555555, opacity: 0.5, transparent: true });
    const lines = new THREE.LineSegments(geometry, material);
    lines.userData.gridId = grid.id;
    referenceGrid.add(lines);
  }

  // doors and windows are holes in their walls
  cutOpenings(currentGroup, openings.filter((o) => o.opening).map(({ opening, pathData }) => ({ opening, pathData })));

  // Opening outlines (yellow), drawn on the wall faces round the hole now it is cut (#153)
  for (const { positions: onPath, openingId, opening, pathData } of openings) {
    const faces = opening ? openingFaces(currentGroup, opening, pathData) : null;
    const positions = faces ? buildOpeningOutline(opening, pathData, faces).positions : onPath;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const lines = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color: 0xddaa44, linewidth: 2 }),
    );
    lines.userData.openingId = openingId;
    currentGroup.add(lines);
  }

  const objectColour = colourLookup(materials);
  for (const { object, placement, parts } of objects) currentGroup.add(buildObjectGroup(placement, object.id, parts, objectColour));

  scene.add(currentGroup);

  // Frame the whole model (#159)
  const box = new THREE.Box3().setFromObject(currentGroup);
  if (!box.isEmpty()) {
    fitPerspective(camera, controls.target, box.getBoundingSphere(new THREE.Sphere()));
    controls.update();
  }

  statusEl.textContent = `${manifest.project_name} — ${meshes.length} mesh(es) loaded`;
}

document.getElementById('open-dir-btn').addEventListener('click', async () => {
  if (!window.showDirectoryPicker) {
    statusEl.textContent = 'Your browser does not support folder opening (Firefox). Use "Open archive" instead.';
    return;
  }
  statusEl.textContent = 'Opening…';
  try {
    const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
    currentDirHandle = dirHandle;
    demoLoaded = false;
    editProfilesBtn.disabled = false;
    statusEl.textContent = 'Loading…';
    const { meshes, manifest, junctions, arrays, grids, openings, objects, materials } = await loadBundle(dirHandle);
    _buildScene(meshes, manifest, junctions, arrays, grids, openings, materials, objects);
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
    _buildScene(result.meshes, result.manifest, result.junctions, result.arrays, result.grids, result.openings, result.materials, result.objects);
    currentDirHandle = null;
    demoLoaded = true;
    editProfilesBtn.disabled = false;
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    console.error(err);
  }
});

document.getElementById('open-file-btn').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.oebfz,.zip';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    statusEl.textContent = 'Loading…';
    try {
      const result = await loadBundleZstd(file);
      _buildScene(result.meshes, result.manifest, result.junctions, result.arrays, result.grids, result.openings, result.materials, result.objects);
      currentDirHandle = null;
      demoLoaded = false;
      editProfilesBtn.disabled = true;
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
      console.error(err);
    }
  };
  input.click();
});

editProfilesBtn.addEventListener('click', () => {
  if (demoLoaded) {
    // without an opener, the profile editor reads ?bundle= itself (and Save downloads the profile)
    window.open(`${import.meta.env.BASE_URL}profile-editor.html?bundle=${DEMO_BUNDLE}`, '_blank', 'noopener');
    return;
  }
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
