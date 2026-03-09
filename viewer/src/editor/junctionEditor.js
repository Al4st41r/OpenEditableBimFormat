/**
 * junctionEditor.js — Auto-detect element intersections and offer junction editing.
 */

import * as THREE from 'three';
import { writeEntity } from './bundleWriter.js';

const DETECT_RADIUS = 0.05;
const JUNCTION_RULES = ['butt', 'mitre', 'lap', 'halving', 'notch', 'custom'];

function _uuid() { return Math.random().toString(36).slice(2, 10); }

export class JunctionEditor {
  constructor(overlayGroup, propsPanel, dirHandle) {
    this._overlayGroup = overlayGroup;
    this._propsPanel   = propsPanel;
    this._dirHandle    = dirHandle;
    this._elements     = []; // { id, pathData }
    this._junctions    = []; // { id, elementIds, point, rule, sprite }
  }

  setDirHandle(h) { this._dirHandle = h; }

  /** Register an element path for junction detection. */
  addElement(elementId, pathData) {
    this._elements.push({ id: elementId, pathData });
    this._detectJunctions();
  }

  /** Load junctions from bundle. */
  loadJunctions(junctionEntities) {
    for (const j of junctionEntities) {
      const pt = new THREE.Vector3(0, 0, 0);
      this._addJunctionSprite(j.id, j.elements, pt, j.rule ?? 'butt');
    }
  }

  _detectJunctions() {
    for (let i = 0; i < this._elements.length; i++) {
      for (let j = i + 1; j < this._elements.length; j++) {
        const a = this._elements[i];
        const b = this._elements[j];
        const endpointsA = _getEndpoints(a.pathData);
        const endpointsB = _getEndpoints(b.pathData);
        for (const pa of endpointsA) {
          for (const pb of endpointsB) {
            if (pa.distanceTo(pb) < DETECT_RADIUS) {
              const existing = this._junctions.find(
                x => x.elementIds.includes(a.id) && x.elementIds.includes(b.id)
              );
              if (!existing) {
                const mid = pa.clone().add(pb).multiplyScalar(0.5);
                const id  = `junction-${_uuid()}`;
                this._addJunctionSprite(id, [a.id, b.id], mid, 'butt');
              }
            }
          }
        }
      }
    }
  }

  _addJunctionSprite(id, elementIds, point, rule) {
    const geo  = new THREE.PlaneGeometry(0.15, 0.15);
    const mat  = new THREE.MeshBasicMaterial({ color: 0xffcc00, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(point);
    mesh.rotation.z = Math.PI / 4;
    mesh.userData   = { junctionId: id, elementIds, rule };
    this._overlayGroup.add(mesh);
    this._junctions.push({ id, elementIds, point, rule, sprite: mesh });
  }

  /** Returns true if a junction sprite was clicked. */
  trySelectJunction(raycaster) {
    const sprites = this._junctions.map(j => j.sprite);
    const hits    = raycaster.intersectObjects(sprites);
    if (!hits.length) return false;
    const { junctionId, elementIds, rule } = hits[0].object.userData;
    this._showProps(junctionId, elementIds, rule);
    return true;
  }

  _showProps(id, elementIds, currentRule) {
    const junc = this._junctions.find(x => x.id === id);

    // Clear props panel and rebuild with createElement (no innerHTML with user data)
    while (this._propsPanel.firstChild) this._propsPanel.removeChild(this._propsPanel.firstChild);

    const h3 = document.createElement('h3');
    h3.textContent = 'Junction';
    this._propsPanel.appendChild(h3);

    // Elements row
    const elemsRow = document.createElement('div');
    elemsRow.className = 'prop-row';
    const elemsLabel = document.createElement('label');
    elemsLabel.textContent = 'Elements';
    const elemsVal = document.createElement('div');
    elemsVal.style.cssText = 'font-size:11px;opacity:0.7';
    elemsVal.textContent = elementIds.join(', ');
    elemsRow.append(elemsLabel, elemsVal);
    this._propsPanel.appendChild(elemsRow);

    // Rule row
    const ruleRow = document.createElement('div');
    ruleRow.className = 'prop-row';
    const ruleLabel = document.createElement('label');
    ruleLabel.textContent = 'Rule';
    const ruleSel = document.createElement('select');
    ruleSel.id = 'junction-rule';
    for (const r of JUNCTION_RULES) {
      const opt = document.createElement('option');
      opt.value = r;
      opt.textContent = r;
      if (r === currentRule) opt.selected = true;
      ruleSel.appendChild(opt);
    }
    ruleRow.append(ruleLabel, ruleSel);
    this._propsPanel.appendChild(ruleRow);

    // Apply button row
    const applyRow = document.createElement('div');
    applyRow.className = 'prop-row';
    const applyBtn = document.createElement('button');
    applyBtn.textContent = 'Apply';
    applyBtn.addEventListener('click', async () => {
      const rule = document.getElementById('junction-rule').value;
      if (junc) {
        junc.rule = rule;
        junc.sprite.userData.rule = rule;
      }
      if (this._dirHandle) {
        await writeEntity(this._dirHandle, `junctions/${id}.json`, {
          $schema:  'oebf://schema/0.1/junction',
          id,
          type:     'Junction',
          rule,
          elements: elementIds,
          priority: [],
          trim_planes: [],
          description: '',
        });
      }
    });
    applyRow.appendChild(applyBtn);
    this._propsPanel.appendChild(applyRow);
  }

  /** Clear all junction sprites and state. */
  clear() {
    for (const j of this._junctions) {
      j.sprite.geometry.dispose();
      j.sprite.material.dispose();
      this._overlayGroup.remove(j.sprite);
    }
    this._junctions = [];
    this._elements  = [];
  }
}

function _getEndpoints(pathData) {
  const segs = pathData.segments ?? [];
  if (!segs.length) return [];
  const first = segs[0].start;
  const last  = segs.at(-1).end;
  return [
    new THREE.Vector3(first.x, first.y, first.z ?? 0),
    new THREE.Vector3(last.x,  last.y,  last.z  ?? 0),
  ];
}
