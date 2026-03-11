/**
 * floorTool.js — Floor drawing tool for the OEBF editor.
 *
 * Two sub-modes toggled by Shift:
 *
 *   Polygon mode (default, closeable:true):
 *     Click to place boundary vertices. Commit when polygon closed (click near
 *     first point, press C, or double-click). Writes a closed Path entity and a
 *     Slab entity. Renders a slab mesh via buildSlabMeshData if available.
 *
 *   Path mode (Shift toggles):
 *     Click to place a polyline. Commits on Enter or double-click. Writes an
 *     open Path entity and an Element entity with the chosen slab profile.
 *     Renders a swept mesh the same way as WallTool.
 *
 * Constructor opts:
 *   scene, getCamera, constructionPlane, canvas, modelGroup,
 *   adapter, getDefaultSlabProfile, getStoreyZ, getStoreyId,
 *   readProfile, matMap, onElementCreated
 *
 * onElementCreated is called with { id, pathId, type: 'slab'|'element' }.
 */

import * as THREE from 'three';
import { DrawingTool } from './drawingTool.js';
import { writeEntity } from './bundleWriter.js';
import { parsePath } from '../loader/loadPath.js';
import { buildProfileShape } from '../loader/loadProfile.js';
import { sweepProfile } from '../geometry/sweep.js';
import { buildThreeMesh } from '../scene/buildMesh.js';
import { buildSlabMeshData } from '../loader/loadSlab.js';

export class FloorTool {
  /**
   * @param {object} opts
   * @param {THREE.Scene}                       opts.scene
   * @param {() => THREE.Camera}                opts.getCamera
   * @param {THREE.Mesh}                        opts.constructionPlane
   * @param {HTMLCanvasElement}                 opts.canvas
   * @param {THREE.Group}                       opts.modelGroup
   * @param {FsaAdapter|MemoryAdapter}          opts.adapter
   * @param {() => string}                      opts.getDefaultSlabProfile
   * @param {() => number}                      opts.getStoreyZ
   * @param {() => string|null}                 opts.getStoreyId
   * @param {(path: string) => Promise<object>} opts.readProfile
   * @param {object}                            opts.matMap  materialId -> material data
   * @param {(info: object) => void}            opts.onElementCreated
   */
  constructor(opts) {
    this._scene                 = opts.scene;
    this._modelGroup            = opts.modelGroup;
    this._adapter             = opts.adapter;
    this._getDefaultSlabProfile = opts.getDefaultSlabProfile;
    this._getStoreyZ            = opts.getStoreyZ;
    this._getStoreyId           = opts.getStoreyId;
    this._readProfile           = opts.readProfile;
    this._matMap                = opts.matMap;
    this._onElementCreated      = opts.onElementCreated;

    /** @type {boolean} true = path+Element mode; false = polygon+Slab mode */
    this._pathMode = false;

    this._drawingTool = new DrawingTool(
      opts.scene,
      opts.getCamera,
      opts.constructionPlane,
      opts.canvas,
    );

    this._drawingTool.onCommit = (points, closed) => this._onCommit(points, closed);
    this._drawingTool.onCancel = () => {};

    // Shift key listener — stored so it can be removed on deactivate
    this._boundKeyDown = this._onKeyDown.bind(this);
  }

  activate() {
    this._pathMode = false;
    window.addEventListener('keydown', this._boundKeyDown);
    this._drawingTool.activate({ closeable: true });
  }

  deactivate() {
    window.removeEventListener('keydown', this._boundKeyDown);
    this._drawingTool.deactivate();
  }

  dispose() {
    this.deactivate();
    this._drawingTool.dispose();
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  _onKeyDown(e) {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.key !== 'Shift') return;
    if (this._drawingTool._points.length > 0) return; // don't discard placed points
    // Toggle path mode; re-activate DrawingTool with appropriate closeable flag
    this._pathMode = !this._pathMode;
    this._drawingTool.deactivate();
    this._drawingTool.activate({ closeable: !this._pathMode });
  }

  async _onCommit(points, closed) {
    if (this._pathMode) {
      await this._commitPathMode(points);
    } else {
      await this._commitPolygonMode(points, closed);
    }
  }

  async _commitPolygonMode(points, closed) {
    // Need at least 3 unique points for a polygon
    if (points.length < 3) return;

    const pathId  = `path-${_uuid()}`;
    const slabId  = `slab-${_uuid()}`;
    const storeyZ = this._getStoreyZ();
    const storeyId = this._getStoreyId();

    // Build segments from the committed points. When closed is true the last
    // point is a copy of the first (added by DrawingTool._commit); strip it so
    // we don't emit a zero-length final segment before the explicit closing one.
    const rawPts = closed && points.length > 1
      ? points.slice(0, -1)
      : points;

    const segments = [];
    for (let i = 0; i < rawPts.length; i++) {
      const a = rawPts[i];
      const b = rawPts[(i + 1) % rawPts.length];
      segments.push({
        type:  'line',
        start: { x: a.x, y: a.y, z: storeyZ },
        end:   { x: b.x, y: b.y, z: storeyZ },
      });
    }

    const pathData = {
      '$schema':  'oebf://schema/0.1/path',
      id:         pathId,
      type:       'Path',
      closed:     true,
      segments,
    };

    const slabData = {
      '$schema':         'oebf://schema/0.1/slab',
      id:                slabId,
      type:              'Slab',
      ifc_type:          'IfcSlab',
      boundary_path_id:  pathId,
      thickness_m:       0.2,
      elevation_m:       storeyZ,
      material_id:       '',
      parent_group_id:   storeyId || '',
      description:       'Floor slab',
    };

    // Write entities to bundle
    try {
      await writeEntity(this._adapter, `paths/${pathId}.json`, pathData);
      await writeEntity(this._adapter, `slabs/${slabId}.json`, slabData);
    } catch (e) {
      console.error('[FloorTool] Failed to write entities:', e);
      return;
    }

    // Attempt slab mesh rendering
    try {
      const meshData = buildSlabMeshData(slabData, pathData);
      const colour = '#c8a96e'; // default finish colour from style guide
      const mesh = buildThreeMesh({
        vertices:    meshData.vertices,
        normals:     meshData.normals,
        indices:     meshData.indices,
        colour:      meshData.materialId ? (this._matMap[meshData.materialId]?.colour_hex ?? colour) : colour,
        elementId:   slabId,
        description: 'Floor slab',
      });
      this._modelGroup.add(mesh);
    } catch (e) {
      console.warn('[FloorTool] Slab mesh skipped:', e.message);
    }

    if (this._onElementCreated) {
      this._onElementCreated({ id: slabId, pathId, type: 'slab' });
    }
  }

  async _commitPathMode(points) {
    if (points.length < 2) return;

    const pathId    = `path-${_uuid()}`;
    const elementId = `element-${_uuid()}`;
    const profileId = this._getDefaultSlabProfile() || null;
    const storeyZ   = this._getStoreyZ();
    const storeyId  = this._getStoreyId();

    const segments = [];
    for (let i = 0; i < points.length - 1; i++) {
      segments.push({
        type:  'line',
        start: { x: points[i].x,     y: points[i].y,     z: storeyZ },
        end:   { x: points[i + 1].x, y: points[i + 1].y, z: storeyZ },
      });
    }

    const pathData = {
      '$schema':  'oebf://schema/0.1/path',
      id:         pathId,
      type:       'Path',
      closed:     false,
      segments,
    };

    const elementData = {
      '$schema':        'oebf://schema/0.1/element',
      id:               elementId,
      type:             'Element',
      ifc_type:         'IfcSlab',
      path_id:          pathId,
      profile_id:       profileId,
      sweep_mode:       'perpendicular',
      cap_start:        'flat',
      cap_end:          'flat',
      parent_group_id:  storeyId || '',
      description:      'Floor slab',
    };

    // Write entities to bundle
    try {
      await writeEntity(this._adapter, `paths/${pathId}.json`,       pathData);
      await writeEntity(this._adapter, `elements/${elementId}.json`, elementData);
    } catch (e) {
      console.error('[FloorTool] Failed to write entities:', e);
      return;
    }

    // Attempt swept mesh (same pattern as WallTool)
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
            description: 'Floor slab',
          });
          this._modelGroup.add(mesh);
        }
      } catch (e) {
        console.warn('[FloorTool] Mesh sweep skipped:', e.message);
      }
    }

    if (this._onElementCreated) {
      this._onElementCreated({ id: elementId, pathId, type: 'element' });
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
