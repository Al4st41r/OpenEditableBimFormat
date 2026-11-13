/**
 * editorScene.js — Three.js scene setup for the OEBF editor.
 *
 * Sets up renderer, perspective camera, orthographic camera,
 * OrbitControls, lighting, and construction plane.
 * Exports helpers for switching between 3D and plan view.
 */

import { applyRenderMode, gridColours, gridDrop } from '../scene/renderMode.js';
import { fitPerspective, fitPlan } from '../scene/fitCamera.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createRenderScheduler, watchSceneGraph } from './renderScheduler.js';

export function initEditorScene(canvas) {
  // ── Renderer ──────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  renderer.localClippingEnabled = true;
  renderer.toneMapping         = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace    = THREE.SRGBColorSpace;

  // ── Scene ─────────────────────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a1a);

  // RoomEnvironment provides realistic indirect (IBL) lighting — replaces AmbientLight
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const roomEnv = new RoomEnvironment();
  scene.environment = pmremGenerator.fromScene(roomEnv).texture;
  roomEnv.dispose();
  pmremGenerator.dispose();

  // Single directional light — warm tint complements the IBL
  const dirLight = new THREE.DirectionalLight(0xfff4e0, 1.2);
  dirLight.position.set(5, 3, 10);
  scene.add(dirLight);

  // ── Perspective camera (Z-up) ─────────────────────────────────────────────
  const perspCamera = new THREE.PerspectiveCamera(
    45, canvas.clientWidth / canvas.clientHeight, 0.1, 300
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

  // Orthographic pan controls (plan view only — no rotation)
  const orthoControls = new OrbitControls(orthoCamera, canvas);
  orthoControls.enableRotate = false;
  orthoControls.enablePan   = true;
  orthoControls.enabled     = false;
  orthoControls.update();

  // ── Construction grid (visual) ────────────────────────────────────────────
  // rebuilt when the render mode changes its colours (a GridHelper's colours are fixed when it is made)
  function makeGrid(mode, z = 0) {
    const grid = new THREE.GridHelper(50, 50, ...gridColours(mode));
    grid.rotation.x = Math.PI / 2; // XY plane (Z-up)
    grid.position.z = z - gridDrop();   // just under a floor at this level, not in it (#152); see the render loop
    scene.add(grid);
    return grid;
  }
  let constructionGrid = makeGrid('solid+edges');

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
  let activeStoreyZ = 0;

  function setStoreyZ(z) {
    activeStoreyZ = z;
    constructionGrid.position.z = z - gridDrop();
    constructionPlane.position.z = z;
  }

  function getStoreyZ() {
    return activeStoreyZ;
  }

  // ── Render mode ───────────────────────────────────────────────────────────
  let _renderMode = 'solid+edges';
  let _gridMode = 'solid+edges';
  let _xray = false;   // objects inside walls drawn over them (#172)
  const _renderModeGroups = [];

  function setRenderMode(mode) {
    _renderMode = mode;
    scene.background.setHex(mode === 'lines' ? 0xf5f5f0 : 0x1a1a1a);

    applyRenderMode(modelGroup, mode, { xray: _xray });   // overlays and the construction plane are outside modelGroup
    for (const g of _renderModeGroups) applyRenderMode(g, mode, { xray: _xray });
    if (gridColours(mode)[0] !== gridColours(_gridMode)[0]) {
      const visible = constructionGrid.visible;
      scene.remove(constructionGrid);
      constructionGrid.geometry.dispose(); constructionGrid.material.dispose();
      constructionGrid = makeGrid(mode, activeStoreyZ);
      constructionGrid.visible = visible;
      _gridMode = mode;
    }
  }

  /** Further groups that follow the render mode, eg the editor's objects (doors, windows) in the overlay group. */
  function addRenderModeGroup(group) { _renderModeGroups.push(group); applyRenderMode(group, _renderMode, { xray: _xray }); }

  /** X-ray (#172): show objects hidden inside walls (ties, doors with no opening) through them. */
  function setXray(on) { _xray = !!on; setRenderMode(_renderMode); }
  function getXray() { return _xray; }

  function getRenderMode() { return _renderMode; }

  function setPlanView(enabled) {
    isPlanView = enabled;
    controls.enabled      = !enabled;
    orthoControls.enabled =  enabled;
  }

  function getActiveCamera() {
    return isPlanView ? orthoCamera : perspCamera;
  }

  /**
   * Frame the model (#159). `plan` picks the camera (the active one by default); with `keepDirection` the 3D view keeps
   * the angle it is seen from, otherwise it looks from the south-east. Returns false when there is nothing to frame.
   */
  function fitView({ plan = isPlanView, keepDirection = false } = {}) {
    const box = new THREE.Box3().setFromObject(modelGroup);
    if (box.isEmpty()) return false;
    if (plan) {
      fitPlan(orthoCamera, orthoControls.target, box);
      orthoControls.update();
    } else {
      const direction = keepDirection ? perspCamera.position.clone().sub(controls.target) : undefined;
      fitPerspective(perspCamera, controls.target, box.getBoundingSphere(new THREE.Sphere()), direction);
      controls.update();
    }
    return true;
  }

  // ── Resize ────────────────────────────────────────────────────────────────
  // Read dimensions from the viewport container, not the canvas. renderer.setSize()
  // pins the canvas with inline pixel styles, so observing the canvas itself would
  // never fire after the first call — the viewport is what actually changes on resize.
  const viewport = canvas.parentElement;

  function handleResize() {
    const w = viewport.clientWidth;
    const h = viewport.clientHeight;
    renderer.setSize(w, h);
    perspCamera.aspect = w / h;
    perspCamera.updateProjectionMatrix();
    const a = w / h;
    orthoCamera.left   = -orthoSize * a;
    orthoCamera.right  =  orthoSize * a;
    orthoCamera.updateProjectionMatrix();
  }

  const resizeObserver = new ResizeObserver(() => handleResize());
  resizeObserver.observe(viewport);
  handleResize(); // ensure correct size on first frame

  // ── Render loop ───────────────────────────────────────────────────────────
  // Draw only when something changes (issue #165): an idle editor draws nothing, which matters on software GL.
  // Frames are asked for by camera moves, input (with one trailing frame for work an input awaits), resizes, objects
  // added or removed anywhere in the scene, render-mode, storey and view switches, and requestRender() for anything
  // else that changes the scene in place without input.
  const scheduler = createRenderScheduler(() => {
    // the further off the camera, the further under the floor the grid must be to stay hidden by it (#152)
    constructionGrid.position.z = activeStoreyZ - gridDrop(isPlanView ? 0 : perspCamera.position.distanceTo(controls.target));
    renderer.render(scene, getActiveCamera());
  });
  const requestRender = scheduler.request;
  controls.addEventListener('change', requestRender);
  orthoControls.addEventListener('change', requestRender);
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'keyup', 'focus', 'message']) {
    window.addEventListener(type, scheduler.afterInput, { passive: true, capture: true });
  }
  new ResizeObserver(requestRender).observe(viewport);   // after handleResize's observer, so the new size is drawn
  watchSceneGraph(scene, requestRender);
  const andRender = (fn) => (...args) => { const r = fn(...args); requestRender(); return r; };
  requestRender();

  return {
    renderer, scene, perspCamera, orthoCamera, controls,
    constructionPlane, modelGroup, overlayGroup,
    get constructionGrid() { return constructionGrid; },   // replaced when the render mode changes its colours
    setStoreyZ: andRender(setStoreyZ), getStoreyZ, setPlanView: andRender(setPlanView), getActiveCamera, fitView: andRender(fitView),
    setRenderMode: andRender(setRenderMode), getRenderMode, setXray: andRender(setXray), getXray, addRenderModeGroup: andRender(addRenderModeGroup),
    requestRender,
    get renderFrames() { return scheduler.frames; },   // frames drawn so far, for headless checks
  };
}
