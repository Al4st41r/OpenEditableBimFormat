# IFC4 Primer for Editing This Model

This primer covers the parts of IFC4 that the model uses, and how to change them by editing the file's text. It is
written for this file: the examples come from it, and the conventions it describes are the ones the file follows.

---

## 1. The File Format

The model is an ISO 10303-21 file (STEP physical file). After a short `HEADER` section, the `DATA` section holds one
entity instance per line:

```
#22=IFCWALL('3Gy7z22Uj9iv9bsdLqZA0f',$,'South external wall \X2\2014\X0\ ground floor',$,$,#64,#41,$,$);
```

- `#22` is the instance id. Ids are unique in the file. They need not be consecutive, and their order has no meaning.
- `IFCWALL` is the entity type. The values in brackets are its attributes, in the order the schema defines.
- `#64` is a reference to another instance.
- `$` means "not set". `*` means "derived" (used by some entities, eg units).
- Strings are in single quotes. A quote inside a string is written twice: `'it''s'`.
- Non-ASCII text is encoded: `\X2\2014\X0\` is an em dash (U+2014). Keep existing names exactly as they are.
- Real numbers always have a decimal point: `0.29`, `2.7`, `0.`, `-1.`. An integer where a real is expected is an error.
- Enumerations are written between dots: `.AREA.`, `.T.` (true), `.F.` (false), `.NEGATIVE.`.
- Lists are in brackets: `(#43,#45,#47,#49)`. A list of one item still has brackets: `(#22)`.
- Typed values are wrapped in their type: `IFCLABEL('REI 60')`, `IFCBOOLEAN(.T.)`, `IFCLENGTHMEASURE(0.9)`.

Every line ends with `);` and a line holds exactly one instance.

### GlobalIds

Rooted entities (elements, relationships, property sets, the project and spatial structure) start with a GlobalId: a
22-character string from the alphabet `0-9 A-Z a-z _ $`. Each must be unique in the file. When you add a rooted entity,
make up a new 22-character id in this alphabet, different from every other one in the file.

### Units

The file is in metres (`IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)`). All lengths below are metres.

---

## 2. Spatial Structure

```
IfcProject  -- IfcRelAggregates -->  IfcSite  -- IfcRelAggregates -->  IfcBuilding
IfcBuilding -- IfcRelAggregates -->  IfcBuildingStorey (one or more)
IfcBuildingStorey -- IfcRelContainedInSpatialStructure -->  the elements on that storey
```

- `IFCRELAGGREGATES(GlobalId,$,$,$,#parent,(#child,...))` links a parent to its parts. To add a storey, create the
  `IFCBUILDINGSTOREY` and add it to the building's aggregation list (or add a new `IFCRELAGGREGATES` from the
  building to it).
- `IFCBUILDINGSTOREY(GlobalId,$,Name,$,$,ObjectPlacement,$,$,$,Elevation)`: the last attribute is the storey's
  elevation in metres. In this file the storey has no placement of its own (`$`).
- `IFCRELCONTAINEDINSPATIALSTRUCTURE(GlobalId,$,$,$,(#element,...),#storey)` lists the elements on a storey. A new
  element must be added to the list of its storey, or to a new containment relationship for a new storey. An element
  is contained in one storey only.

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

A wall's placement puts its local origin at one end of its centreline, with local x running along the wall and local
z up. The south wall:

```
#64=IFCLOCALPLACEMENT($,#63);
#63=IFCAXIS2PLACEMENT3D(#60,#61,#62);
#60=IFCCARTESIANPOINT((5.4,0.,0.));     the wall starts at x = 5.4, y = 0
#61=IFCDIRECTION((0.,0.,1.));           local z is up
#62=IFCDIRECTION((-1.,0.,0.));          local x points west (-x): the wall runs from east to west
```

So in this wall's frame, local x = 1.0 is world x = 4.4. Check each wall's RefDirection before working in its frame:
the walls do not all run the same way.

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
- `IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#polyline)`: a closed outline; the slab uses one, an `IFCPOLYLINE` through
  `IFCCARTESIANPOINT((x,y))` points, ending at its first point.

### A wall's shape in this file

```
#39=IFCEXTRUDEDAREASOLID(#33,#37,#38,5.4);          depth 5.4: the wall's length
#33=IFCRECTANGLEPROFILEDEF(.AREA.,$,#32,0.29,2.7);  0.29 thick by 2.7 high
#37=IFCAXIS2PLACEMENT3D(#34,#35,#36);               the solid's frame: its z (the sweep) along the wall's local x
#34=IFCCARTESIANPOINT((-0.,0.,-0.));
#35=IFCDIRECTION((1.,0.,0.));
#36=IFCDIRECTION((0.,1.,0.));
#38=IFCDIRECTION((0.,0.,1.));
```

The wall is a rectangle (thickness by height) swept along the wall's length. The rectangle's 2D position decides where
the section sits around the centreline; in this file it is centred on it. A wall's thickness therefore appears in its
profile (`XDim`) and must agree with its material layers (section 5).

### Doors

A door's body is a box swept up from the floor: its profile is the leaf's width by its depth, and the sweep depth is
its height. Its `OverallHeight` and `OverallWidth` attributes, when set, must agree with the body.

---

## 5. Materials

A wall's build-up is a layer set, used along the wall:

```
#43=IFCMATERIALLAYER(#42,0.102,$,'External Brick Leaf',$,'Finish',$);       material, thickness, ...
#50=IFCMATERIALLAYERSET((#43,#45,#47,#49),$,$);                             the layers, in order
#51=IFCMATERIALLAYERSETUSAGE(#50,.AXIS2.,.NEGATIVE.,0.145,$);               how the set lies on the wall
#52=IFCRELASSOCIATESMATERIAL(GlobalId,$,$,$,(#22),#51);                     which elements use it
```

- `IFCMATERIALLAYER(Material, LayerThickness, IsVentilated, Name, Description, Category, Priority)`.
- `IFCMATERIALLAYERSETUSAGE(ForLayerSet, LayerSetDirection, DirectionSense, OffsetFromReferenceLine, $)`:
  - `LayerSetDirection` `.AXIS2.`: the layers are stacked across the wall (its local y).
  - `DirectionSense` `.NEGATIVE.`: the layers are laid from the offset towards local -y.
  - `OffsetFromReferenceLine`: where the first layer starts, measured from the centreline. For a set centred on the
    centreline it is half the total thickness.
- The sum of a set's layer thicknesses is the wall's thickness. When it changes, the wall's body must change to match,
  and the offset must change if the wall is to stay centred.
- In this file each wall has its own layer set, layers and materials, even where they are alike. A change meant for
  several walls must be made to each one.

Simple elements use a material directly: `IFCRELASSOCIATESMATERIAL(GlobalId,$,$,$,(#element),#material)`.

---

## 6. Openings, Doors and Windows

A hole in a wall is an `IFCOPENINGELEMENT`, related to the wall it cuts, and the door or window in it fills it:

```
#225=IFCOPENINGELEMENT(GlobalId,$,Name,$,$,#248,#239,$,$);
#243=IFCRELVOIDSELEMENT(GlobalId,$,$,$,#22,#225);       the opening cuts the wall #22
#249=IFCDOOR(GlobalId,$,Name,$,$,#271,#263,$,$,$,.DOOR.,$,$);
#272=IFCRELFILLSELEMENT(GlobalId,$,$,$,#225,#249);      the door fills the opening
```

- The opening has its own placement and a body: a box the size of the hole, swept through the wall's full thickness.
  In this file the opening's placement is relative to its wall's placement (`IFCLOCALPLACEMENT(#64,...)`), so its
  location is in the wall's frame (section 3), and its box is centred on that location along the wall.
- A door or window has its own placement and body. In this file the door's placement is in world coordinates.
- An opening and the door or window in it must agree in position and size. Moving or resizing one means changing the
  other.
- `IFCWINDOW(GlobalId,$,Name,$,$,Placement,Representation,$,OverallHeight,OverallWidth,PredefinedType,$,$)`, with
  `.WINDOW.` as its type. `IFCDOOR` has the same attribute order with `.DOOR.`.
- A door or window is contained in its storey like any element; the opening is not.

---

## 7. Properties

```
#53=IFCPROPERTYSET(GlobalId,$,'Pset_WallCommon',$,(#55,#56,#57,#58));
#54=IFCRELDEFINESBYPROPERTIES(GlobalId,$,$,$,(#22),#53);          the set applies to wall #22
#55=IFCPROPERTYSINGLEVALUE('FireRating',$,IFCLABEL('REI 60'),$);
#58=IFCPROPERTYSINGLEVALUE('ThermalTransmittance',$,IFCTHERMALTRANSMITTANCEMEASURE(0.18),$);
```

- A property is changed by replacing its `IFCPROPERTYSINGLEVALUE` line.
- In this file each element has its own property set and property instances. Check that a property instance is not
  shared before changing it; if it is, give the element its own.
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
