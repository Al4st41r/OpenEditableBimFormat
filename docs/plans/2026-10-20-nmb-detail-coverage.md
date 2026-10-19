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
