# IFC4 Primer for Editing This Model

This primer covers the parts of IFC4 that the model uses, and how to change them by editing the file's text. It is
written for this file: the examples come from it, and the conventions it describes are the ones the file follows.

---

## 1. The File Format

The model is an ISO 10303-21 file (STEP physical file). After a short `HEADER` section, the `DATA` section holds one
entity instance per line:

```
#137=IFCWALL('2o1x_nher9Xw7SMea1UKZ5',$,'South external wall, ground floor (NMB-EW-01)',$,$,#192,#156,$,$);
```

- `#137` is the instance id. Ids are unique in the file. They need not be consecutive, and their order has no meaning.
- `IFCWALL` is the entity type. The values in brackets are its attributes, in the order the schema defines.
- `#192` is a reference to another instance.
- `$` means "not set". `*` means "derived" (used by some entities, eg units).
- Strings are in single quotes. A quote inside a string is written twice: `'it''s'`.
- Non-ASCII text is encoded, eg `\X2\2014\X0\` for an em dash (U+2014). Keep existing names exactly as they are.
- Real numbers always have a decimal point: `0.582`, `2.85`, `0.`, `-1.`. An integer where a real is expected is an
  error.
- Enumerations are written between dots: `.AREA.`, `.T.` (true), `.F.` (false), `.NEGATIVE.`.
- Lists are in brackets: `(#158,#160,#162)`. A list of one item still has brackets: `(#137)`.
- Typed values are wrapped in their type: `IFCLABEL('REI 60')`, `IFCBOOLEAN(.T.)`, `IFCLENGTHMEASURE(0.9)`. Wrap a
  value only where the attribute accepts several types, such as a property's `NominalValue`. Where the attribute has
  one type, such as a storey's `Elevation`, write the plain value: `3.`, not `IFCLENGTHMEASURE(3.)`.

Every line ends with `);` and a line holds exactly one instance.

### GlobalIds

Rooted entities (elements, relationships, property sets, the project and spatial structure) start with a GlobalId: a
22-character string from the alphabet `0-9 A-Z a-z _ $`. It encodes a 128-bit number, so its first character must be
`0`, `1`, `2` or `3`. Each must be unique in the file. When you add a rooted entity, make up a new 22-character id
in this alphabet, starting with 0 to 3, different from every other one in the file.

### Units

The file is in metres (`IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)`). All lengths below are metres.

---

## 2. Spatial Structure

```
IfcProject  -- IfcRelAggregates -->  IfcSite  -- IfcRelAggregates -->  IfcBuilding
IfcBuilding -- IfcRelAggregates -->  IfcBuildingStorey (three: Ground Floor, First Floor, Roof)
IfcBuildingStorey -- IfcRelContainedInSpatialStructure -->  the elements on that storey
```

- `IFCRELAGGREGATES(GlobalId,$,$,$,#parent,(#child,...))` links a parent to its parts. To add a storey, create the
  `IFCBUILDINGSTOREY` and add it to the building's aggregation list (or add a new `IFCRELAGGREGATES` from the
  building to it).
- `IFCBUILDINGSTOREY(GlobalId,$,Name,$,$,ObjectPlacement,$,$,$,Elevation)`: the last attribute is the storey's
  elevation in metres. In this file the storeys have no placement of their own (`$`):

  ```
  #22=IFCBUILDINGSTOREY('1MOrVYdGT9HA2_Kkyb652q',$,'First Floor',$,$,$,$,$,$,3.);
  ```
- `IFCRELCONTAINEDINSPATIALSTRUCTURE(GlobalId,$,$,$,(#element,...),#storey)` lists the elements on a storey. A new
  element must be added to the list of its storey. An element is contained in one storey only.

Openings are not contained in a storey: they belong to the element they cut (section 6).

---

## 3. Placement

Every product has an `ObjectPlacement`, an `IFCLOCALPLACEMENT(PlacementRelTo, RelativePlacement)`:

- `PlacementRelTo` is `$` (the placement is in world coordinates) or another `IFCLOCALPLACEMENT` (the placement is
  in that placement's coordinate system).
- `RelativePlacement` is an `IFCAXIS2PLACEMENT3D(Location, Axis, RefDirection)`:
  - `Location`: an `IFCCARTESIANPOINT((x,y,z))`, the origin of the local system.
  - `Axis`: an `IFCDIRECTION`, the local z axis (`$` means world z).
  - `RefDirection`: an `IFCDIRECTION`, the local x axis (`$` means world x). The local y axis is z cross x.

### How this file places walls

A wall's placement puts its local origin at one end of its centreline, at the wall's base, with local x running along
the wall and local z up. The south wall on the ground floor:

```
#192=IFCLOCALPLACEMENT($,#191);
#191=IFCAXIS2PLACEMENT3D(#188,#189,#190);
#188=IFCCARTESIANPOINT((9.,0.,0.15));     the wall starts at x = 9, y = 0, its base at z = 0.15
#189=IFCDIRECTION((0.,0.,1.));            local z is up
#190=IFCDIRECTION((-1.,0.,0.));           local x points west (-x): the wall runs from east to west
```

So in this wall's frame, local x = 1.5 is world x = 7.5. Check each wall's RefDirection before working in its frame:
the walls do not all run the same way. Columns are modelled like a very short wall: placed at one face, with a
rectangle the column's height swept 0.36 along local x.

### Shared instances

Points, directions and placements may be shared by several instances. Before changing a shared point or direction,
check what else refers to it; if something else must stay where it is, add a new instance and refer to that instead.

---

## 4. Shape

```
IFCPRODUCTDEFINITIONSHAPE($,$,(#representation))
IFCSHAPEREPRESENTATION(#context,'Body','SweptSolid',(#solid))
IFCEXTRUDEDAREASOLID(#profile, #position, #direction, depth)
```

- The context is the file's model context (`#10`). Body shapes use it.
- An `IFCEXTRUDEDAREASOLID` sweeps a 2D profile along a direction (in the solid's own frame) by a depth.
- `position` is an `IFCAXIS2PLACEMENT3D` placing the solid in the product's local system.

Profiles used here:

- `IFCRECTANGLEPROFILEDEF(.AREA.,$,#position2d,XDim,YDim)`: a rectangle centred on its 2D position.
- `IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#polyline)`: a closed outline; the slabs and roofs use one, an `IFCPOLYLINE`
  through `IFCCARTESIANPOINT((x,y))` points, ending at its first point.

### A wall's shape in this file

```
#154=IFCEXTRUDEDAREASOLID(#148,#152,#153,9.);         depth 9: the wall's length
#148=IFCRECTANGLEPROFILEDEF(.AREA.,$,#147,0.582,2.85); 0.582 thick by 2.85 high
#147=IFCAXIS2PLACEMENT2D(#146,$);
#146=IFCCARTESIANPOINT((0.,1.425));                  half the height up, so the wall rises from its base
#152=IFCAXIS2PLACEMENT3D(#149,#150,#151);            the solid's frame: its z (the sweep) along the wall's local x
#149=IFCCARTESIANPOINT((-0.,0.,-0.));
#150=IFCDIRECTION((1.,0.,0.));
#151=IFCDIRECTION((0.,1.,0.));
#153=IFCDIRECTION((0.,0.,1.));
```

The wall is a rectangle (thickness by height) swept along the wall's length. The rectangle is centred on the
centreline across the wall. A wall's thickness therefore appears in its profile (`XDim`) and must agree with its
material layers (section 5).

### A slab's shape in this file

Each floor build-up is a stack of slabs, one per layer, each named after its build-up and layer. A slab is placed at
its top face and swept down by its thickness:

```
#1764=IFCLOCALPLACEMENT($,#1763);
#1763=IFCAXIS2PLACEMENT3D(#1760,#1761,#1762);
#1760=IFCCARTESIANPOINT((0.,0.,-0.12));               top face at z = -0.12
#1749=IFCEXTRUDEDAREASOLID(#1745,#1747,#1748,0.25);  0.25 thick
#1748=IFCDIRECTION((0.,0.,-1.));                     swept downwards
#1745=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#1744);  the outline in plan
```

---

## 5. Materials

A wall's build-up is a layer set, used along the wall:

```
#158=IFCMATERIALLAYER(#157,0.02,$,'Cladding (333)',$,'Finish',$);    material, thickness, ...
#177=IFCMATERIALLAYERSET((#158,#160,#162,#164,#166,#168,#170,#172,#174,#176),$,$);   the layers, in order
#178=IFCMATERIALLAYERSETUSAGE(#177,.AXIS2.,.NEGATIVE.,0.291,$);     how the set lies on the wall
#179=IFCRELASSOCIATESMATERIAL('2PIegjImjBFvdxvVfrSB87',$,$,$,(#137),#178);   which elements use it
```

- `IFCMATERIALLAYER(Material, LayerThickness, IsVentilated, Name, Description, Category, Priority)`.
- `IFCMATERIALLAYERSETUSAGE(ForLayerSet, LayerSetDirection, DirectionSense, OffsetFromReferenceLine, $)`:
  - `LayerSetDirection` `.AXIS2.`: the layers are stacked across the wall (its local y).
  - `DirectionSense` `.NEGATIVE.`: the layers are laid from the offset towards local -y.
  - `OffsetFromReferenceLine`: where the first layer starts, measured from the centreline. For a set centred on the
    centreline it is half the total thickness.
- The sum of a set's layer thicknesses is the wall's thickness. When it changes, the wall's body must change to match,
  and the offset must change if the wall is to stay centred.
- In this file each wall and column has its own layer set, layers and materials, even where they are alike. A change
  meant for several walls must be made to each one.

Slabs and roofs use a material directly: `IFCRELASSOCIATESMATERIAL(GlobalId,$,$,$,(#element),#material)`.

---

## 6. Openings

A hole in a wall is an `IFCOPENINGELEMENT`, related to the wall it cuts. In this file no door or window fills the
openings: the opening's name says what it is for.

```
#2051=IFCOPENINGELEMENT('0hLegBPOP5a8LCOyoJ4c7n',$,'Entrance door, south wall, ground floor, ...',$,$,#2074,#2065,$,$);
#2069=IFCRELVOIDSELEMENT('28zeaD8j55Rf_BNthWFswK',$,$,$,#137,#2051);   the opening cuts the wall #137
#2074=IFCLOCALPLACEMENT(#192,#2073);              placed relative to the wall's placement #192
#2073=IFCAXIS2PLACEMENT3D(#2070,#2071,#2072);
#2070=IFCCARTESIANPOINT((1.5,0.,-0.15));          1.5 along the wall, on the centreline, 0.15 below the wall's base
#2063=IFCEXTRUDEDAREASOLID(#2059,#2061,#2062,2.25);   2.25 high
#2059=IFCRECTANGLEPROFILEDEF(.AREA.,$,#2058,0.9,0.582);   0.9 wide by the wall's thickness
```

- The opening's body is a box the size of the hole, swept up from its sill through the wall's full thickness. Its
  rectangle is centred on the opening's location along the wall.
- The opening's placement is relative to its wall's placement, so its location is in the wall's frame (section 3).
  Its z is measured from the wall's base, which for the ground-floor external walls is 0.15 above the floor.
- An opening is not contained in a storey.

---

## 7. Properties

```
#1402=IFCPROPERTYSET('1aJrlHOaX6pvM881dgD6zG',$,'Pset_WallCommon',$,(#1404));
#1403=IFCRELDEFINESBYPROPERTIES('04sEzWEx1CYhEPGksq7SEV',$,$,$,(#1365),#1402);   the set applies to #1365
#1404=IFCPROPERTYSINGLEVALUE('FireRating',$,IFCLABEL('K2 60 + REI 60'),$);
```

- A property is changed by replacing its `IFCPROPERTYSINGLEVALUE` line.
- In this file each element with properties has its own property set and property instances. Check that a property
  instance is not shared before changing it; if it is, give the element its own.
- Most elements have no property set. To give one a property, add a property set, its properties and an
  `IFCRELDEFINESBYPROPERTIES` relating it to the element.
- Common values: `IFCLABEL('...')` for text, `IFCBOOLEAN(.T.)`, `IFCTHERMALTRANSMITTANCEMEASURE(0.18)` for a U-value in
  W/m²K, `IFCLENGTHMEASURE(...)` for lengths.

---

## 8. Adding and Removing

### Adding

- Use ids above the highest id in the file.
- A new element needs: the element, its placement (and the point and directions it uses), its shape (representation,
  solid, profile, positions, directions), its material association, any property sets, and its place in a storey's
  containment.
- You may refer to existing instances that suit as they are, eg the model context `#10`, a shared direction, or an
  existing material.

### Removing

- When you delete an instance, nothing else may still refer to it. Find every line that refers to it:
  - remove it from lists that hold it (containment, relationships with several related objects);
  - delete relationships that would be left with nothing to relate (eg an `IFCRELDEFINESBYPROPERTIES` whose only
    object is the deleted element) and what only they used (the property set and its properties);
  - delete its placement and shape instances if nothing else uses them.
- A reference to an id that no longer exists makes the file invalid.

---

## 9. Checks the Result Must Pass

The edited file is opened with IfcOpenShell and checked against the IFC4 schema: every attribute of the right type,
every reference to an existing instance of an allowed type, required attributes set. The geometry of every element
must then build. After that the result is compared with what the task asked for, and every element the task did not
concern must be unchanged.
