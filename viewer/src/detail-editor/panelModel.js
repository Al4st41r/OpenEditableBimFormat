/**
 * panelModel.js
 *
 * Everything the detail editor's side panels show, as plain data, so the DOM
 * layer only has to render rows. Derived from the document, the selection, the
 * validation messages and the bundle context.
 */

import { findUsages, findCandidates } from '../detail/detailUsage.js';
import { evaluateCoordinate } from './detailDocument.js';
import { edgeLengths, regionAsRect } from './dimensionOps.js';
import { applyOverrides } from '../detail/detailParams.js';
import { detailFit, suggestLocation } from './junctionAssign.js';

const tidy = (x) => Math.round(x * 1e9) / 1e9 + 0;
const boundParam = (c) => (c && typeof c === 'object' ? c.param : null);

function describeLocation(loc) {
  if (!loc) return null;
  const offset = loc.level_offset_m ? ` ${loc.level_offset_m > 0 ? '+' : ''}${loc.level_offset_m}` : '';
  return `${loc.axes.join(' / ')} @ ${loc.level_id}${offset}`;
}

/**
 * @param {{ doc, selection, validation, dirty, canUndo, canRedo, profileIds?: string[], materialIds?: string[], junctions?: object[], elements?: object,
 *   grids?: object[], levels?: object[], elementPaths?: object }} input   (grids, levels and elementPaths let candidates carry a suggested location)
 */
export function buildPanelModel({ doc, selection, validation, dirty, canUndo, canRedo, profileIds, materialIds, junctions = [], elements = {}, grids, levels, elementPaths, previewValues }) {
  const profileSet = profileIds ? new Set(profileIds) : null;
  const materialSet = materialIds ? new Set(materialIds) : null;
  const regions = doc.geometry?.regions ?? [];

  const members = (doc.members ?? []).map((m) => ({
    role: m.role, kind: m.kind, profileId: m.profile_id, extent: m.extent ?? 'centred',
    selected: selection?.type === 'member' && selection.role === m.role,
    profileMissing: profileSet ? !profileSet.has(m.profile_id) : false,
  }));

  const usedBy = {};
  const regionRows = regions.map((r, index) => {
    let boundCount = 0;
    for (const v of r.vertices ?? []) {
      for (const axis of ['x', 'y']) {
        const p = boundParam(v[axis]);
        if (p) { boundCount++; usedBy[p] = (usedBy[p] ?? 0) + 1; }
      }
    }
    return {
      index, materialId: r.material_id, vertexCount: r.vertices?.length ?? 0, boundCount,
      selected: selection?.type === 'region' && selection.index === index,
      materialMissing: materialSet ? !materialSet.has(r.material_id) : false,
    };
  });

  const parameters = Object.entries(doc.parameters ?? {}).map(([name, p]) => ({
    name, default: p.default, min: p.min, max: p.max, usedBy: usedBy[name] ?? 0,
  }));

  let selectedMember = null;
  if (selection?.type === 'member') {
    const m = (doc.members ?? []).find((x) => x.role === selection.role);
    if (m) {
      selectedMember = {
        role: m.role, kind: m.kind, profileId: m.profile_id, extent: m.extent ?? 'centred',
        offset_x_m: m.placement?.offset_x_m ?? 0, offset_y_m: m.placement?.offset_y_m ?? 0, rotation_deg: m.placement?.rotation_deg ?? 0,
      };
    }
  }

  let selectedRegion = null;
  if (selection?.type === 'region' && regions[selection.index]) {
    const r = regions[selection.index];
    const bound = (c) => c !== null && typeof c === 'object';
    const n = r.vertices.length;
    const vertexBound = r.vertices.map((v) => bound(v.x) || bound(v.y));
    const rect = regionAsRect(doc, selection.index, previewValues);
    selectedRegion = {
      index: selection.index, materialId: r.material_id,
      vertices: r.vertices.map((v, i) => ({
        x: tidy(evaluateCoordinate(v.x, doc.parameters, previewValues)), y: tidy(evaluateCoordinate(v.y, doc.parameters, previewValues)),
        boundX: boundParam(v.x), boundY: boundParam(v.y), selected: selection.vertex === i,
      })),
      edges: edgeLengths(doc, selection.index, previewValues).map((length, i) => ({
        index: i, length: tidy(length), bound: vertexBound[i] || vertexBound[(i + 1) % n],
      })),
      rect: rect ? { width: tidy(rect.width), height: tidy(rect.height), editable: !vertexBound.some(Boolean) } : null,
    };
  }

  const suggestionRow = (j) => {
    const s = suggestLocation(j, { grids, levels, elementPaths });
    return {
      id: j.id, rule: j.rule,
      suggestion: s ? describeLocation({ axes: s.axes, level_id: s.level_id, level_offset_m: s.level_offset_m }) : null,
      approximate: s ? !s.exact : false,
    };
  };
  const candidateRows = findCandidates(doc, junctions, elements).map(suggestionRow);
  const candidateIds = new Set(candidateRows.map((c) => c.id));

  return {
    title: doc.id, dirty, canUndo, canRedo,
    header: {
      description: doc.description, plane: doc.plane ?? 'section',
      datumKind: doc.datum?.kind, datumReference: doc.datum?.reference,
      extrusion_m: doc.geometry?.extrusion_m ?? null,
    },
    condition: doc.condition ?? null,
    members, regions: regionRows, parameters, selectedMember, selectedRegion,
    usage: {
      needsSave: dirty,
      junctions: findUsages(doc.id, junctions).map((j) => {
        const { values } = applyOverrides(doc, j.detail_overrides);
        return {
          id: j.id, location: describeLocation(j.location), overrides: j.detail_overrides ?? {}, mirrored: j.detail_mirrored === true,
          parameters: Object.entries(doc.parameters ?? {}).map(([name, p]) => ({
            name, value: values[name], overridden: name in (j.detail_overrides ?? {}), min: p.min, max: p.max,
          })),
          warnings: detailFit(doc, j, elements),
        };
      }),
      candidates: candidateRows,
      others: junctions
        .filter((j) => !j.detail_id && !candidateIds.has(j.id))
        .map((j) => suggestionRow(j)),
    },
    messages: validation.map((m) => ({ ...m, severity: 'error' })),
    saveEnabled: dirty && validation.length === 0,
  };
}
