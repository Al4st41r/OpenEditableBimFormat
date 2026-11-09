/**
 * clipboard.js
 *
 * Copy and paste of regions and annotations between details (or within one). The payload is plain JSON text, so it
 * also works through the system clipboard and in a text editor. Members are not copied: they come from profiles and
 * belong to the detail.
 *
 * Coordinates driven by a parameter are written out as the numbers they have now, because the other detail may not
 * have that parameter.
 */

import { DetailEditError, evaluateCoordinate } from './detailDocument.js';
import { regionIndices } from './pageState.js';
import { checkAnnotation, moveAnnotation } from './annotationOps.js';
import { translateRegions } from './canvasEdit.js';

export const CLIPBOARD_KIND = 'oebf-detail-clipboard';
const clone = (x) => structuredClone(x);

/**
 * The payload for the current selection, or null when nothing copyable is selected.
 * @param {object} doc
 * @param {object|null} selection
 * @param {Object<string, number>} [values] parameter values to write out (defaults otherwise)
 */
export function copySelection(doc, selection, values) {
  if (selection?.type === 'region') {
    const regions = regionIndices(selection).map((i) => {
      const r = clone(doc.geometry.regions[i]);
      r.vertices = r.vertices.map((v) => ({
        x: evaluateCoordinate(v.x, doc.parameters, values), y: evaluateCoordinate(v.y, doc.parameters, values),
      }));
      return r;
    });
    return { kind: CLIPBOARD_KIND, version: 1, regions, annotations: [] };
  }
  if (selection?.type === 'annotation') {
    const a = doc.annotations?.[selection.index];
    return a ? { kind: CLIPBOARD_KIND, version: 1, regions: [], annotations: [clone(a)] } : null;
  }
  return null;
}

/** Read clipboard text; returns the payload or null when it is not ours. Never throws. */
export function parsePayload(text) {
  let p;
  try { p = JSON.parse(text); } catch { return null; }
  if (!p || p.kind !== CLIPBOARD_KIND || p.version !== 1) return null;
  const regions = Array.isArray(p.regions) ? p.regions : [];
  const annotations = Array.isArray(p.annotations) ? p.annotations : [];
  const okRegion = (r) => r && typeof r.material_id === 'string' && Array.isArray(r.vertices) && r.vertices.length >= 3
    && r.vertices.every((v) => Number.isFinite(v?.x) && Number.isFinite(v?.y));
  if (!regions.every(okRegion) || !annotations.every((a) => checkAnnotation(a).length === 0)) return null;
  if (regions.length + annotations.length === 0) return null;
  return { kind: CLIPBOARD_KIND, version: 1, regions, annotations };
}

/**
 * Add the payload to a document, shifted by (dx, dy). Returns the new document and the selection for what was added.
 * Regions whose material is not in `materialIds` (when given) are refused with an error naming them.
 */
export function pasteInto(doc, payload, { dx = 0, dy = 0, materialIds = null } = {}) {
  if (materialIds) {
    const missing = [...new Set(payload.regions.map((r) => r.material_id).filter((m) => !materialIds.includes(m)))];
    if (missing.length) throw new DetailEditError(`This detail's bundle has no material ${missing.join(', ')}`);
  }
  let d = clone(doc);
  d.geometry ??= { extrusion_m: 1, regions: [] };
  d.geometry.regions ??= [];
  const first = d.geometry.regions.length;
  d.geometry.regions.push(...clone(payload.regions));
  const added = payload.regions.map((_, k) => first + k);
  if (added.length && (dx || dy)) d = translateRegions(d, added, dx, dy).doc;
  d.annotations ??= [];
  const firstMark = d.annotations.length;
  d.annotations.push(...clone(payload.annotations));
  if (dx || dy) payload.annotations.forEach((_, k) => { d = moveAnnotation(d, firstMark + k, dx, dy); });
  if (!d.annotations.length) delete d.annotations;
  const selection = added.length
    ? { type: 'region', index: added[0], ...(added.length > 1 ? { also: added.slice(1) } : {}) }
    : { type: 'annotation', index: firstMark };
  return { doc: d, selection };
}
