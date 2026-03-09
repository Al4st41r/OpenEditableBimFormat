/**
 * wallTool.js — Wall drawing tool for the OEBF editor.
 *
 * Wraps DrawingTool for click-to-place interaction. On commit:
 *   1. Generates path-<uuid> and element-<uuid>
 *   2. Writes paths/path-<id>.json and elements/element-<id>.json to the bundle
 *   3. Attempts to sweep a Three.js mesh using the default wall profile
 *      (skipped gracefully if profile loading or sweep fails)
 *   4. Calls onElementCreated({ id, pathId, profileId, pathData })
 *
 * Constructor opts:
 *   scene, getCamera, constructionPlane, canvas, modelGroup,
 *   dirHandle, getDefaultProfile, getStoreyZ, getStoreyId,
 *   readProfile, matMap, onElementCreated
 */

import * as THREE from 'three';
import { DrawingTool } from './drawingTool.js';
import { writeEntity } from './bundleWriter.js';
import { parsePath } from '../loader/loadPath.js';
import { buildProfileShape } from '../loader/loadProfile.js';
import { sweepProfile } from '../geometry/sweep.js';
import { buildThreeMesh } from '../scene/buildMesh.js';

export class WallTool {
  /**
   * @param {object} opts
   * @param {THREE.Scene}                   opts.scene
   * @param {() => THREE.Camera}            opts.getCamera
   * @param {THREE.Mesh}                    opts.constructionPlane
   * @param {HTMLCanvasElement}             opts.canvas
   * @param {THREE.Group}                   opts.modelGroup
   * @param {FileSystemDirectoryHandle}     opts.dirHandle
   * @param {() => string}                  opts.getDefaultProfile
   * @param {() => number}                  opts.getStoreyZ
   * @param {() => string|null}             opts.getStoreyId
   * @param {(path: string) => Promise<object>} opts.readProfile
   * @param {object}                        opts.matMap  materialId → material data
   * @param {(info: object) => void}        opts.onElementCreated
   */
  constructor(opts) {
    this._scene            = opts.scene;
    this._modelGroup       = opts.modelGroup;
    this._dirHandle        = opts.dirHandle;
    this._getDefaultProfile = opts.getDefaultProfile;
    this._getStoreyZ       = opts.getStoreyZ;
    this._getStoreyId      = opts.getStoreyId;
    this._readProfile      = opts.readProfile;
    this._matMap           = opts.matMap;
    this._onElementCreated = opts.onElementCreated;

    this._drawingTool = new DrawingTool(
      opts.scene,
      opts.getCamera,
      opts.constructionPlane,
      opts.canvas,
    );

    this._drawingTool.onCommit = (points) => this._onCommit(points);
    this._drawingTool.onCancel = () => {};
  }

  activate() {
    this._drawingTool.activate({ closeable: false });
  }

  deactivate() {
    this._drawingTool.deactivate();
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  async _onCommit(points) {
    if (points.length < 2) return;

    const pathId    = `path-${_uuid()}`;
    const elementId = `element-${_uuid()}`;
    const profileId = this._getDefaultProfile() || null;
    const storeyZ   = this._getStoreyZ();
    const storeyId  = this._getStoreyId();

    // Build path entity
    const segments = [];
    for (let i = 0; i < points.length - 1; i++) {
      segments.push({
        type: 'line',
        start: { x: points[i].x,     y: points[i].y,     z: storeyZ },
        end:   { x: points[i + 1].x, y: points[i + 1].y, z: storeyZ },
      });
    }

    const pathData = {
      id: pathId,
      type: 'Path',
      closed: false,
      segments,
    };

    // Build element entity
    const elementData = {
      '$schema':        'oebf://schema/0.1/element',
      id:               elementId,
      type:             'Element',
      ifc_type:         'IfcWall',
      path_id:          pathId,
      profile_id:       profileId,
      sweep_mode:       'perpendicular',
      cap_start:        'flat',
      cap_end:          'flat',
      parent_group_id:  storeyId || '',
      description:      'Wall',
    };

    // Write entities to bundle
    try {
      await writeEntity(this._dirHandle, `paths/${pathId}.json`,       pathData);
      await writeEntity(this._dirHandle, `elements/${elementId}.json`, elementData);
    } catch (e) {
      console.error('[WallTool] Failed to write entities:', e);
      return;
    }

    // Attempt mesh sweep (nice-to-have — skip gracefully on any failure)
    if (profileId) {
      try {
        const profileData   = await this._readProfile(`profiles/${profileId}.json`);
        const profileShapes = buildProfileShape(profileData);
        const { points: pathPoints } = parsePath(pathData);
        const layerMeshes   = sweepProfile(pathPoints, profileShapes);

        for (const layerData of layerMeshes) {
          const matData = this._matMap[layerData.materialId];
          const colour  = matData?.colour_hex ?? '#888888';
          const mesh = buildThreeMesh({
            vertices:    layerData.vertices,
            normals:     layerData.normals,
            indices:     layerData.indices,
            colour,
            elementId,
            description: 'Wall',
          });
          this._modelGroup.add(mesh);
        }
      } catch (e) {
        console.warn('[WallTool] Mesh sweep skipped:', e.message);
      }
    }

    if (this._onElementCreated) {
      this._onElementCreated({ id: elementId, pathId, profileId, pathData });
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
