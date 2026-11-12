# Membranes and tapes: design note (round 1)

Issue #127. Date: 2026-11-12. Status: first round implemented for trial; questions for the next round at the end.

## The problem

Membranes (DPC, DPM, vapour control layer, breather membrane) and tapes are 0.2 to 1 mm thick. At any drawing
scale they are thinner than a pen, and in 3D they are thinner than a pixel. Three things go wrong today:

- **2D.** A 0.5 mm band at 1:5 is 0.1 mm on paper. The 0.5 mm outline of the block next to it covers it, and the
  function default gives membranes the lightest cut weight (0.18), so a DPC reads as nothing at all.
- **3D, coplanar faces.** A membrane drawn as a region inside another layer (a DPC through a brick leaf) has faces
  on the same plane as that layer. Two faces on one plane with similar depth bias z-fight.
- **3D, sub-pixel faces.** The exposed strip of a membrane (at a wall head or end) is 0.5 mm wide. At room scale it
  covers a fraction of a pixel and appears and disappears as the camera moves: another kind of flicker.

## Representation

**Recommended: a layer with its real nominal thickness and `function: "membrane"`.** A membrane in a wall is a band
layer of the profile (`thickness: 0.0005`), a DPC in one leaf is a region layer, a DPM laid as its own sheet is a
slab with `function: "membrane"`, and a tape in a detail is a region whose material has the category `membrane`.
Nothing new is needed to say *which* membrane it is: the material's `classification.barrier` already says
`water`, `vapour`, `air` or `breathable`.

A layer or solid is drawn as a membrane when its function is `membrane` **or** its material's category is
`membrane`, so a detail region (which has no function) and a library material work without extra fields.

Why keep a real thickness:

- the layer stack, the IFC layer set and quantities stay true (a 0.5 mm DPC is 0.5 mm);
- the schema already forbids zero thickness (`exclusiveMinimum: 0`), and a zero-thickness solid has no inside for
  sweeping, clipping or CSG;
- the drawing problem is a drawing problem, so it is solved in the renderers, not by distorting the model.

Alternatives considered:

| Option | For | Against |
|---|---|---|
| A. Real nominal thickness, drawn specially (recommended) | No new entity; IFC layer set is honest; works for bands, regions, slabs and detail regions alike | Region DPCs overlap the band they cross (counted twice in quantities) |
| B. Zero-thickness layer (`thickness: 0`) | Stack widths do not change | Schema change; no solid for 3D, CSG or IFC; breaks every "thickness > 0" assumption |
| C. A line entity in the profile or detail (a polyline with a pen and a nominal thickness) | Natural for laps, upstands and tapes that wrap corners | A second kind of geometry to edit, sweep and export; layers and lines would disagree about the stack |
| D. Display exaggeration (`display_thickness_m`) | Visible in 3D at any distance | The 3D model would no longer match the numbers; overlaps neighbours |

Option C is the likely next step for tapes and laps (see the questions). Option A stays the base either way.

## Drawing in 2D

A membrane is drawn **on top of every other line**, as its own outline stroked with a heavy pen:

- pen: `MEMBRANE_PEN_MM` = 0.5 mm, overridden by the layer's `outline_mm`; 0.25 mm in the "thin" display mode;
- ink: `MEMBRANE_INK` = `#1f6b6b`, a dark shade of the membrane function colour (`#6ec8c8`), so it is distinct from
  the black cut lines on screen and prints dark;
- because the stroke follows the shape's outline, a straight band becomes a line, and an L-shaped tape or an
  upstand becomes an L-shaped line, without working out a centreline.

Where it is drawn:

| View | How |
|---|---|
| Profile editor (`profileCanvas.js`) | A line along the middle of each membrane band; the outline of each membrane region. Drawn after the layers at a fixed pixel width, and clickable, since the band itself is too thin to click. |
| Detail review (`detailSvg.js`) | A `<g class="membranes">` group after the outlines. An overlay colour (barrier overlay) replaces the ink. |
| Detail editor (`render.js`, `drawStyle.js`) | A last pass over the shapes draws membranes at `membranePx`. |

## Drawing in 3D

Two measures, both in `scene/buildMesh.js`:

1. **Depth priority.** Every solid already gets its own polygon offset (factor 1, 2 to 17 units, one per
   element) so overlapping elements do not checkerboard. Unit 1 is now kept for membranes
   (`MEMBRANE_DEPTH_UNITS`). Where a membrane shares a plane with any other solid, the membrane is always at least
   one depth unit nearer, so it wins from every angle and does not flicker. Its faces are still pushed back by
   factor 1, so its own outline (drawn at true depth) shows over them, as edges do today.
2. **Outline always on.** A membrane's edge lines are shown in every render mode, in the membrane ink. A line is
   at least one pixel wide, so a sheet thinner than a pixel still reads as a steady line at a wall head, at the
   foot of a wall and along the edge of a DPM, instead of popping in and out.

`renderOrder` is not used: the depth test, not the draw order, decides between opaque faces.

Alternatives: drawing membranes with `depthTest: false` (they would show through walls); edges only, no faces (a
membrane seen face-on, such as a DPM from below, would be empty); exaggerated thickness (option D above).

## Schema changes (made)

- `slab.schema.json`: optional `function` (same enum as a profile layer). `"membrane"` marks a DPM or roofing sheet.
- `profile.schema.json`: descriptions only: `thickness` is the nominal thickness of a membrane, `function:
  membrane` is drawn on top, `outline_mm` is the weight of the membrane line.
- `materials.schema.json`: description of `category`: `air` and `membrane` change how a material is drawn.

No new required fields; every existing bundle is still valid.

## IFC mapping

| OEBF | IFC4 |
|---|---|
| Membrane band layer in a wall profile | `IfcMaterialLayer` with its nominal `LayerThickness` and `Category = "Membrane"` (other layers: `LoadBearing`, `Insulation`, `Finish`, `Service`) |
| Region layer (DPC in one leaf) | Not part of the layer set (it has no thickness to give). Left out of the export for now; see the questions |
| Slab with `function: "membrane"` (DPM) | `IfcCovering`, `PredefinedType = MEMBRANE` |
| Tape region in a detail | Not exported (details are not exported yet) |
| `classification.barrier` | Unchanged; already in the material data |

The exporter now skips region layers when it sums the wall width and builds the layer set (it used to fail on them).
Import is unchanged: an imported `IfcCovering` of type MEMBRANE is not yet read back as a membrane slab.

## The trial bundle

`example/membrane-trial.oebf` (also served as `viewer/public/membrane-trial.oebf`):

- `element-wall-timber-frame`: cladding, ventilated cavity, **breather membrane 0.5 mm**, OSB, studs and mineral
  wool, **VCL 0.2 mm**, service void, plasterboard. 3 m long, along x.
- `element-wall-cavity`: brick, cavity, PIR, block, plaster, with a **DPC region 0.5 mm** in each leaf 150 mm above
  the base. The DPCs overlap the leaves they cross, which is the coplanar case the depth priority must win.
- `slab-ground` (150 mm concrete) on `slab-dpm` (**DPM 0.3 mm**, `function: membrane`, at -0.15).
- `detail-timber-frame-corner`: a plan detail of two timber frame walls at a butt corner, with an L-shaped
  **VCL tape** region sealing the internal corner.

Open it in the viewer or the editor, in the profile editor, and in the detail editor with
`detail-editor.html?bundle=membrane-trial.oebf&detail=detail-timber-frame-corner`. Edit and save; the next round
reads the saved bundle.

## Known limits of round 1

- A membrane's faces are still sub-pixel in 3D; only its outline keeps it visible.
- In the corner detail the breather membrane and the VCL stop where each wall stops; they do not run round the
  corner. Layer ends (`layer_ends`) can extend them, but nothing joins two membranes into one.
- The detail editor picks shapes by geometry; a 0.3 mm tape may be hard to select there.
- Region DPCs are not exported to IFC.

## Questions for the next round

1. **Line or band.** Should a membrane always be drawn as a line, or as a band (with a fill) once it is thicker
   than some size, for example a 3 mm bituminous roofing membrane?
2. **Pen and ink.** Is 0.5 mm in dark teal right? Should the ink be black for print? Should the line style vary by
   barrier: for example a dashed line for a vapour control layer and a solid line for a DPC?
3. **Which side.** Should the line sit on the middle of the membrane, or on the face it is fixed to (the warm side of
   the insulation for a VCL)?
4. **Tapes and laps.** Is a region with a membrane material enough for a tape, or do you want a line entity in
   details (option C) with a width, lap length and a "wraps the corner" flag?
5. **Continuity at corners.** Should the editor join the membranes of two walls at a junction (the breather
   membrane and VCL run round the corner), or should the detail draw that?
6. **DPC as a region.** A region DPC overlaps the leaf it crosses. Is that acceptable, or should the leaf be split
   into two bands of course heights with the DPC between them?
7. **3D visibility.** Is the always-on outline enough, or should membranes be shown slightly thicker in 3D (a display
   thickness), or hidden by a layer toggle?
8. **IFC.** Should a region DPC export as its own `IfcCovering` (MEMBRANE) or as an `IfcBuildingElementProxy`, and
   should imported `IfcCovering` MEMBRANE come back as a membrane slab?
