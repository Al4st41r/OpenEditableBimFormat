# Sloping wall tops: design note

Issue #180 (a). Date: 2026-11-13. Status: options for a decision; nothing has been added to the schema.

## The problem

A gable wall, a wall under a mono-pitch roof or a parapet that follows a slope has a top that is not level. IFC
writes this as the wall's body clipped by a half-space whose plane is tilted (an `IfcBooleanClippingResult` with an
`IfcHalfSpaceSolid` on an `IfcPlane`, sometimes an `IfcPolygonalBoundedHalfSpace` so only part of the wall is cut).
Archicad, Revit and BlenderBIM all write gable walls this way.

OEBF has nowhere to store it. A wall's height is one number, the profile's `height_limit_m` (the IFC importer puts a
level top clip there), and a path's points carry `z` but those move the whole section up, not the top alone. So
today the importer drops a sloping clip with the warning "a sloping clip was left out", and the wall comes in at its
full rectangular height.

What the answer has to cover:

- **IFC import:** read a tilted half-space (bounded or not) into it, without guessing.
- **IFC export:** write it back as a half-space clip, so other tools see the same wall.
- **Viewer sweep:** cut the swept wall to it. The sweep (`viewer/src/geometry/sweep.js`) builds each band as a ring
  of points at every path node and joins them; a top that varies along the wall must change the band's top edge from
  node to node, or be cut after sweeping.
- **Editor and LLM editing:** easy to read and to change in the JSON ("lower the eaves to 2.4 m").

## Options

### A. A top plane on the element

```json
"top": { "type": "plane", "height_at_start_m": 2.4, "height_at_end_m": 5.1 }
```

or, for a plane that does not run with the wall (a hip, a slope across the wall's thickness):

```json
"top": { "type": "plane", "point": { "x": 0, "y": 0, "z": 2.4 }, "normal": { "x": -0.45, "y": 0, "z": 0.89 } }
```

Heights are measured from the path. The first form is the common case (the slope runs along the wall) and is the
easiest to read and edit; the second is the general one and maps one-to-one onto IFC.

- **IFC:** one unbounded half-space per element. Import: a tilted plane becomes `point` and `normal` (or the
  start/end form when the plane's normal lies in the vertical plane through the wall's run). Export: an `IfcPlane`
  through `point` with that normal, `AgreementFlag` FALSE, as the angled ends are written now.
- **Viewer:** the band's top edge is lowered, node by node, to the plane's height at that node; a straight wall has
  two nodes, so the top is exact. A path of several legs needs a node where the plane's height crosses the profile
  top, but the plane is linear along each straight leg, so lowering the two end nodes of each leg is exact too. Faces
  stay planar.
- **Cost:** one optional field on the element schema, one function in the sweep. A gable (two slopes meeting at a
  ridge) needs a list of planes (`"top": [ ... ]`, the lowest wins), which is the same thing applied twice.

### B. A height at each path node

```json
"segments": [{ "type": "line", "start": { "x": 0, "y": 0, "z": 0, "top_m": 2.4 }, "end": { "x": 5, "y": 0, "z": 0, "top_m": 5.1 } }]
```

The wall's height is given at each point of its path; between points it runs straight.

- **IFC:** import has to work out the height at each node from the clip plane (it can, for an unbounded plane) and
  export has to turn per-node heights back into planes: one plane per segment, which for a gable is two clips, and
  for heights that do not lie on one plane per segment is not a plane at all (the export would have to fall back to
  a faceted BREP).
- **Viewer:** the most direct fit for the sweep, which already works node by node.
- **Cost:** it puts a wall property on the path, which is shared: a path used by a wall and by a beam or a slab edge
  would carry a height that means nothing to the others. It also splits a straight wall into extra segments at every
  change of slope, which the editor treats as corners.

### C. A separate clip entity

```json
{ "type": "Clip", "id": "clip-gable-west", "elements": ["wall-west-gf", "wall-west-ff"],
  "plane": { "point": { "x": 0, "y": 0, "z": 5.1 }, "normal": { "x": 0, "y": -0.45, "z": 0.89 } },
  "boundary": [ { "x": 0, "y": -1 }, { "x": 0, "y": 9 }, ... ] }
```

A clip is its own file in `clips/`, listed in `model.json`, and cuts every element it names. It may carry a plan
boundary (an `IfcPolygonalBoundedHalfSpace`).

- **IFC:** the closest match to how IFC models it, including bounded clips, and the one place one roof plane cuts
  several walls (both storeys of a gable, the party walls under the same roof). Export writes one half-space per
  element it cuts; import has to recognise half-spaces on several walls that share a plane to merge them, else it
  writes one clip per wall.
- **Viewer:** the hardest: the sweep cannot lower node heights for a bounded clip, so the cut is a CSG step after
  sweeping (`three-bvh-csg`, tracked in #18), with its cost and its fragility on thin layers (membranes).
- **Cost:** a new entity type, schema, loader, editor UI and validation of the cross-references.

## Recommendation

**Option A, a top plane (or a short list of planes) on the element**, with the start/end-height form as the one the
editor and the guide teach and the point/normal form for everything else:

- it is a property of the wall, so it lives on the wall, and a shared path stays clean;
- each plane is one IFC half-space either way, with no guessing on import and no fallback on export;
- the viewer can apply it exactly by moving the top of each band at each node, with no CSG;
- it reads well in JSON and an LLM can change it with one number.

Bounded clips (only part of a wall cut) stay a warning under A, as now, and become option C later if they turn out
to matter; A and C can live together (C would then be the general case, A the easy one).

The importer would keep warning for anything A cannot hold (a bounded or curved clip) and the exporter would write
the planes after the angled-end clips, so a wall's `IfcBooleanClippingResult` chain keeps its order.

## Questions for the user

1. Is option A right, or do you want clips as their own entity (C) from the start, for one roof plane cutting
   several walls?
2. Should the top live on the **element** (each wall carries its own) or on the **profile**, next to
   `height_limit_m` (every wall of that build-up shares it)? The note assumes the element, since slopes differ from
   wall to wall while build-ups do not.
3. Is the start/end-height form enough for the editor, with point/normal only for import and hand editing, or should
   the editor offer the general plane too?
4. Gables: a list of planes (lowest wins), or a dedicated `"ridge"` form (two heights and a ridge position along
   the wall)?
5. Should a sloping top also be allowed to rise above the profile's `height_limit_m` (the plane alone sets the
   height), or does `height_limit_m` stay a ceiling the plane can only cut down from?
