/**
 * editor.js — OEBF Editor orchestrator
 *
 * Wires UI, scene, bundle loading, and tool dispatch.
 * Each feature (storeys, grids, drawing) is handled by its own module.
 */

import { initEditorScene } from './editorScene.js';

// ── DOM refs ─────────────────────────────────────────────────────────────────
const canvas      = document.getElementById('canvas');
const statusBar   = document.getElementById('status-bar');
const openBtn     = document.getElementById('open-btn');
const saveBtn     = document.getElementById('save-btn');
const view3dBtn   = document.getElementById('view-3d');
const viewPlanBtn = document.getElementById('view-plan');

// ── Scene ────────────────────────────────────────────────────────────────────
const editorScene = initEditorScene(canvas);

// ── State ────────────────────────────────────────────────────────────────────
let dirHandle = null;

// ── View toggle ───────────────────────────────────────────────────────────────
view3dBtn.addEventListener('click', () => {
  editorScene.setPlanView(false);
  view3dBtn.classList.add('active');
  viewPlanBtn.classList.remove('active');
});

viewPlanBtn.addEventListener('click', () => {
  editorScene.setPlanView(true);
  viewPlanBtn.classList.add('active');
  view3dBtn.classList.remove('active');
});

// ── Open bundle ───────────────────────────────────────────────────────────────
openBtn.addEventListener('click', async () => {
  if (!window.showDirectoryPicker) {
    statusBar.textContent = 'FSA not supported — use Chrome/Edge';
    return;
  }
  try {
    dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    statusBar.textContent = `Opened: ${dirHandle.name}`;
    saveBtn.disabled = false;
    // Bundle loading wired in Task 33
  } catch (e) {
    if (e.name !== 'AbortError') statusBar.textContent = `Error: ${e.message}`;
  }
});

// ── Save ──────────────────────────────────────────────────────────────────────
saveBtn.addEventListener('click', () => {
  statusBar.textContent = 'Save — not yet wired';
});

export { editorScene, dirHandle };
