# NMB example: detail coverage review and plan

**Date:** 2026-10-20
**Bundle:** `example/nmb-two-storey.oebf`

## 1. Review

The bundle holds 31 details traced from the New Model Building drawings. Six are placed on junctions (23 junctions). The other 25 have no junction, because the model did not contain the condition they are drawn at.

A junction needs two wall-type elements and a location (a grid point and a level). The detail is oriented by the primary wall's direction of travel. That gives three rules for what the model can hold:

- A detail can only be placed where two elements meet. Where the second member is a slab, a roof or a pipe, the junction names the wall above and the wall below instead (the floor or roof sits between them).
- Columns, upstands and parapets must be real elements to be junction members. A column is a short wall element with a square profile; an upstand is a short wall element below the facade.
- A roof detail needs a roof level. A roof storey is added to the model.

### Gap list

| Group | Details | What the model lacked | Fill |
|---|---|---|---|
| Ground slab | external wall on upstand, CLT wall on slab, glulam column on slab | upstands, a column | upstand elements under the ground floor walls, CLT walls and one column |
| Columns | column at facade (section), column at corner (plan) | glulam columns | one interior column, one facade column, two corner columns, both storeys |
| Balcony | connection (plan, section), door threshold (plan, section) | balcony, balcony doors | a deck over south bays 2-3 and 3-4, two balcony doors replacing the first floor window |
| Windows | full height window, window jambs in plan | a full height opening, windows flanking a CLT wall | a full height window in the east wall, two ground floor windows either side of the grid line 2 CLT wall |
| Roof | parapet, party wall | a parapet, a roof level | parapet elements above the first floor walls, a roof storey, junctions at the roof |
| Penetrations | party wall, shaft, internal wall and slab (plan and section), facade (three), roof (soil vent pipe, rainwater pipe) | a riser, services | a riser wall (IW-05-A) at each storey, junctions at the service positions |
| Cannot fill | internal corner with column, roof meeting an external wall, core wall through the roof | a re-entrant corner, a terrace beside a taller wall, a core | none: see below |

### Not filled

- **Internal corner with column.** A re-entrant corner needs an L-shaped or stepped footprint. The example is a 9 m by 6 m rectangle by design.
- **Roof or terrace against an external wall.** This needs a lower roof beside a taller wall.
- **Core wall through the roof.** The example has no lift or stair core.

Adding a setback or a core to make these appear would change the brief (a two storey building on a 3 m by 6 m grid), so they stay as library details. The axonometric viewer still shows them, and the condition on each says what junction would use them.

## 2. Plan

### Model changes

1. **Ground floor.** Add a masonry upstand under each ground floor external wall (150 mm above floor level, closed cell insulation and concrete behind the masonry). The ground floor walls start at the top of the upstand and the door cill drops by 150 mm so the threshold stays level.
2. **CLT walls.** Add a masonry upstand under each ground floor CLT wall. The CLT walls start 30 mm above floor level (DPC).
3. **Columns.** Glulam columns as short wall elements, 360 mm square with encapsulation:
   - one interior column at the centre of bay 3-4, both storeys, on an upstand at ground floor;
   - one facade column inside the north wall at bay 3-4, both storeys;
   - corner columns at the north-west and south-east corners, both storeys.
4. **Balcony.** A deck over south bays 2-3 and 3-4 (non-combustible system, 120 mm). The first floor south window becomes two full height balcony doors.
5. **Windows.** A full height window in the first floor east wall. Two ground floor south windows either side of the grid line 2 CLT wall, so the jamb detail applies.
6. **Roof.** A roof storey at the roof structure's top face. Parapet elements above the first floor external walls.
7. **Riser.** A riser wall (IW-05-A) at each storey.
8. **Grid.** Mid-bay lines on both axes so details can be placed away from the corners.

### Junctions

Every junction is at a distinct grid point and level, so no two details overlap. A test checks this. Corner junctions at the north-west and south-east corners use the column plan detail (the through wall arrives at the corner, which is how the detail is drawn). The others keep the butt corner detail.

### Checks

- `oebf validate` passes.
- Every junction detail resolves to geometry inside the building footprint.
- No two junction details share a location.
- The axonometric viewer opens each detail.
- Full Vitest suite and pytest pass.

## 3. Outcome

- 28 of the 31 details are placed on 41 junctions. The three in "Not filled" remain library details.
- The model gained: 4 external and 2 CLT upstands, 4 glulam columns (8 storey pieces, with 4 ground floor upstands), a riser wall at each storey, 4 parapets, a balcony deck and two balcony doors, a roof storey, a full height window, and two more ground floor windows.
- While adding the roof storey, two level errors in the earlier model were found and fixed: the first floor CLT walls started 223 mm too high (they now stand on the CLT floor at 2.917 m), and the roof levels were derived from a wrong formula (the roof panel now runs 5.694 m to 5.902 m, with the build-up to 6.252 m).
- A test checks that no two junction details share a grid point, level and offset, that the three unplaced details are exactly those named above, and that every element and slab loads into a mesh.

## 4. Editor review

The example must be something a person can make in the editor, not only something the viewer can show. The bundle was opened in the real editor (headless Chromium, Playwright) and a blank bundle was built up to the same kinds of content. The review found problems that the viewer checks could not.

### Found and fixed

| Problem | Effect | Fix |
|---|---|---|
| The grid manager merged every grid into one list and wrote all axes to the last grid, with `elevations: []` and a fixed description | Editing any axis of a bundle with two grids, or with elevations, destroyed data | Grids are kept whole (`viewer/src/grid/gridSet.js`). Each grid keeps its description, elevations and radial axes. A "G" button starts another grid, and a grid name in the tree makes it the active one |
| Storeys were read only from `groups/*.json` | A bundle that describes its levels in `model.json` (both examples) showed no storeys, so nothing could be drawn at a level | Storeys are read from the hierarchy as well. An edit goes back into the hierarchy |
| New storeys, grids and elements were registered in `model.json` only on Save | Anything that reloaded the bundle from its files before Save dropped them | Storeys register at once. The model writer is shared by Save and by anything that reloads |
| Slab thickness was fixed at 200 mm and the top face at the storey level, neither editable | The floor, roof and ground slab layers could not be made | Thickness and top face Z are fields on a slab |
| No way to make an opening | Doors and windows could not be authored | A wall's properties list its openings with editable position, size and cill, plus Add door and Add window. Outlines are drawn in the 3D view |
| Junctions were created only where two path ends meet | Stacked walls, a partition meeting a facade mid-wall, and a column beside a wall could not be made | A Junctions list, and a dialog to make one: elements, primary member, rule, a place on a grid at a level with an offset, and an optional detail |
| The auto-created default wall profile had no `svg_file` | Every blank bundle failed `oebf validate` as soon as a wall was drawn | The profile gets an SVG; the folder adapter gained `writeRaw` |
| Member shapes drew a top-face slab profile as vertical strips | Floor members in the detail editor looked wrong | Top-face and bottom-face slab profiles stack their layers |

### Checked and passing

- The bundle opens with every element and slab rendered, 41 junction markers, 3D groups for each placed detail, 31 details in the tree, and no page errors.
- The detail editor opens all 31 details without a validation error.
- Editing a grid, a storey height, adding a junction with a detail and adding a door each save a bundle that passes `oebf validate`.
- A blank bundle built in the editor passes `oebf validate`: storeys at a height, two grids, stacked walls, a column (IFC type edit), a start offset, a slab with its own thickness and top face, a door and a window, and a junction at a grid location.

### Fixed afterwards

- **Material properties (#110).** The Add material dialog takes a category, an IFC material name and a `key: value` specification list, so `nmb_item`, fire and density can be entered by hand.
- **Missing placeholder material.** The editor's defaults (the first wall profile, a stub detail profile, a new slab) named `mat-unset`, which was in no library, so a bundle with any material library failed `oebf validate`. The editor now adds an "Unassigned" placeholder to the library when it writes those defaults. Found by adding a material to the blank-bundle check.
- **Homepage tests.** They now open `launch.html`, where the cards are.
- **Slab profiles in the profile editor (#111).** A slab can now be aligned to its top or bottom face. Its layers stack as horizontal bands across a nominal plan width, the profile keeps its width, total thickness (as `height`) and alignment, and the SVG is written stacked. Before, resaving one wrote the layer sum as the width, reset the alignment to centre and drew vertical strips. A test writes every stacked NMB profile back and compares the result.
- **Folder mode (#112).** A Playwright test replaces the native picker with an origin-private folder (a real directory handle), opens the example through "Open .oebf folder", edits a storey, a material and a grid axis, saves, and validates the folder.
- **Screenshot baseline (#113).** The failure was a stale baseline, not rendering: the view framing had changed. The baseline is updated.
- **Flicker (#114).** The editor and viewer cameras used a near plane of 0.01 m, which leaves very little depth precision for faces that sit on each other. Near is now 0.1 m (far 300 m), and the polygon offset on detail meshes is doubled. This is reasoned from the depth buffer, not measured on a GPU.

### Not fixed

- **Floor build-up overlap (#114, partly).** Detail floor regions still lie inside the real slab layers. The depth precision change should stop the flicker; if it does not on a real GPU, the next step is to hide the slab layers under a placed detail.
