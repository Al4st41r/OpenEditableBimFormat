/**
 * junction-csg.js
 *
 * CSG-based junction trimming for OEBF building elements with spline paths.
 *
 * Junctions that cannot be trimmed with planar clip planes carry
 * `trim_method: "csg"` and have an empty `trim_planes` array. This module
 * detects those junctions and applies a mesh-mesh boolean subtraction via
 * `three-bvh-csg`, replacing the subordinate element's geometry in-place.
 *
 * Usage: call applyCsgJunctions(sceneRoot, junctions) once after the scene
 * group is populated and after applyJunctionClipping() has run.
 *
 * Priority rules:
 *   - Elements listed in junction.priority are dominant (not trimmed).
 *   - Elements NOT in junction.priority are subordinate (get trimmed).
 *   - If all elements are in priority, no subordinates exist; junction is
 *     skipped with a warning.
 *
 * Performance: CSG time is logged per junction via console.log.
 * Target < 5 ms on M2 MacBook Air (runs once at load time, not per frame).
 *
 * See: docs/decisions/2026-03-02-junction-trim-algorithm.md
 *      Issue #18: v0.2 CSG spline junction trim
 */

import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Apply CSG trimming to junctions that carry `trim_method: "csg"`.
 *
 * @param {THREE.Object3D} sceneRoot - root object whose descendants include
 *   element meshes (each with mesh.userData.elementId set)
 * @param {Array<object>} junctions - array of parsed junction JSON objects
 */
export function applyCsgJunctions(sceneRoot, junctions) {
  const csgJunctions = junctions.filter(j => j.trim_method === 'csg');
  if (csgJunctions.length === 0) return;

  // Build elementId → THREE.Mesh map from the scene
  const meshMap = new Map();
  sceneRoot.traverse(obj => {
    if (obj instanceof THREE.Mesh && obj.userData.elementId) {
      meshMap.set(obj.userData.elementId, obj);
    }
  });

  const evaluator = new Evaluator();

  for (const junction of csgJunctions) {
    const t0 = performance.now();
    try {
      _applyOneCsgJunction(evaluator, junction, meshMap);
    } catch (err) {
      console.warn(`[OEBF] CSG failed for junction ${junction.id}: ${err.message}`);
    }
    const dt = performance.now() - t0;
    console.log(`[OEBF] CSG junction ${junction.id}: ${dt.toFixed(1)} ms`);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Apply CSG trim for a single junction.
 *
 * @param {Evaluator} evaluator
 * @param {object} junction
 * @param {Map<string, THREE.Mesh>} meshMap
 */
function _applyOneCsgJunction(evaluator, junction, meshMap) {
  const prioritySet = new Set(junction.priority ?? []);
  const dominantIds = junction.elements.filter(id => prioritySet.has(id));
  const subordinateIds = junction.elements.filter(id => !prioritySet.has(id));

  if (subordinateIds.length === 0) {
    console.warn(
      `[OEBF] CSG junction ${junction.id}: no subordinate elements ` +
      `(all elements are in priority list). Skipping.`
    );
    return;
  }

  for (const subId of subordinateIds) {
    const subMesh = meshMap.get(subId);
    if (!subMesh) {
      console.warn(
        `[OEBF] CSG junction ${junction.id}: subordinate element "${subId}" ` +
        `not found in scene. Skipping.`
      );
      continue;
    }

    for (const domId of dominantIds) {
      const domMesh = meshMap.get(domId);
      if (!domMesh) {
        console.warn(
          `[OEBF] CSG junction ${junction.id}: dominant element "${domId}" ` +
          `not found in scene. Skipping.`
        );
        continue;
      }

      subMesh.updateWorldMatrix(true, false);
      domMesh.updateWorldMatrix(true, false);

      // three-bvh-csg requires Brush instances (which extend THREE.Mesh and
      // add prepareGeometry()). We create lightweight Brush wrappers that
      // share the existing geometry and material without cloning them.
      const brushA = new Brush(subMesh.geometry, subMesh.material);
      brushA.matrix.copy(subMesh.matrixWorld);
      brushA.matrixWorld.copy(subMesh.matrixWorld);
      brushA.updateMatrixWorld(false);

      const brushB = new Brush(domMesh.geometry, domMesh.material);
      brushB.matrix.copy(domMesh.matrixWorld);
      brushB.matrixWorld.copy(domMesh.matrixWorld);
      brushB.updateMatrixWorld(false);

      const resultBrush = evaluator.evaluate(brushA, brushB, SUBTRACTION);

      subMesh.geometry.dispose();
      subMesh.geometry = resultBrush.geometry;
    }
  }
}
