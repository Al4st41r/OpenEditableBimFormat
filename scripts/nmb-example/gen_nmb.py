#!/usr/bin/env python3
"""Generate example/nmb-two-storey.oebf: two storeys on a 3 m x 6 m grid using NMB build-ups."""
import json, shutil, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import nmb_details

ROOT = Path(sys.argv[1])
OUT = ROOT / "example/nmb-two-storey.oebf"
SRC = ROOT / "example/terraced-house.oebf"
if OUT.exists():
    shutil.rmtree(OUT)
for d in ["paths", "profiles", "elements", "slabs", "junctions", "grids", "details", "materials", "openings"]:
    (OUT / d).mkdir(parents=True)


def w(rel, data):
    (OUT / rel).write_text(json.dumps(data, indent=2) + "\n")


def schema(kind):
    return f"oebf://schema/0.1/{kind}"


# ---- geometry constants -------------------------------------------------
XS = [0.0, 3.0, 6.0, 9.0]   # grid lines 1-4 (direction y, running north-south)
YS = [0.0, 6.0]             # grid lines A-B (direction x, running east-west)
W, D = XS[-1], YS[-1]
STOREY_H = 3.0
EW_T = 0.582                # NMB-EW-01 total thickness
HALF = EW_T / 2
FF_FINISH = 0.083           # NMB-FL-01 finish + screedboard + insulation + acoustic matting
CLT_FLOOR = 0.140
CLT_ROOF = 0.208
CLT_WALL_H = STOREY_H - FF_FINISH - CLT_FLOOR   # 2.777 m, below the first floor CLT
ROOF_BUILDUP = 0.350
CLT_FLOOR_TOP = STOREY_H - FF_FINISH                              # 2.917 m
ROOF_TOP = CLT_FLOOR_TOP + CLT_WALL_H + CLT_ROOF + ROOF_BUILDUP  # 6.252 m: first floor CLT wall top 5.694, roof panel to 5.902, build-up to 6.252
UP = 0.15                   # top of the masonry upstand above floor level
CLT_BASE = 0.03             # ground floor CLT walls and columns sit on the upstand plus a DPC
ROOF_STRUCT_TOP = round(ROOF_TOP - ROOF_BUILDUP, 3)   # 5.902 m, roof storey level
PARAPET_H = 0.66
COL_W = 0.36                # glulam column with encapsulation, square

# ---- materials (NMB item numbers from the Performance Specification) -------
def mat(id_, name, cat, colour, item=None, **props):
    p = dict(props)
    if item:
        p["nmb_item"] = item
    return {"id": id_, "type": "Material", "name": name, "category": cat, "colour_hex": colour,
            "ifc_material_name": name, "properties": p, "interactions": {}}


MATS = [
    mat("mat-nmb-clt", "CLT panel (wall, floor and roof)", "timber", "#D9B36B", "301/302/363",
        fire="Euroclass D-s2, d0; fully encapsulated (REI via encapsulation)",
        fixing="Steel anchor bolts and straps screw fixed to CLT panel"),
    mat("mat-nmb-glulam", "Glulam column / beam", "timber", "#C9A25A", "303/305",
        fire="Euroclass D-s2, d0; fully encapsulated"),
    mat("mat-nmb-wall-lining-board", "Wall lining board (fire board)", "plasterboard", "#E6E6E0", "311",
        fire="K2 60 encapsulation; Euroclass A2-s3, d2 or better; minimum 2 layers",
        fixing="Mechanically fixed to LSF or wall lining system"),
    mat("mat-nmb-skim", "Skim and paint", "plaster", "#F7F7F2"),
    mat("mat-nmb-wall-lining-system", "Wall lining system (318) with insulation between studs (317)", "insulation",
        "#E5E0B8", "317/318", fire="N/A"),
    mat("mat-nmb-lsf", "Light steel framing system (321) with insulation (322)", "steel", "#9AA7B5", "321/322",
        depth_mm=150),
    mat("mat-nmb-rainscreen-insulation", "Rainscreen insulation", "insulation", "#D8D26A", "332",
        thickness_mm=300),
    mat("mat-nmb-breather-membrane", "Breather membrane", "membrane", "#4FA8B0", "351"),
    mat("mat-nmb-vapour-barrier", "Vapour barrier (AVCL)", "membrane", "#6EC8C8", "352",
        note="Sealed to the engineered timber for continuous airtightness"),
    mat("mat-nmb-sheathing-board", "Sheathing board", "board", "#B8A98A", "323"),
    mat("mat-nmb-fixing-system", "Cladding fixing system / ventilated cavity", "cavity", "#CFE3EA", "331"),
    mat("mat-nmb-cladding", "Cladding", "cladding", "#8B6B4A", "333",
        note="Thickness varies by cladding choice; 20 mm assumed in this example"),
    mat("mat-nmb-floor-finish", "Internal floor finish allowance", "finish", "#BFA98C"),
    mat("mat-nmb-screedboard", "Screedboard", "board", "#C9C9C0", "FL-01"),
    mat("mat-nmb-ufh-insulation", "Rigid insulation with underfloor heating", "insulation", "#E3D98A", "FL-01"),
    mat("mat-nmb-acoustic-matting", "Acoustic matting", "acoustic", "#7B8FA3", "FL-01"),
    mat("mat-nmb-screed", "Screed (bonded)", "screed", "#B5B5AD", "FL-02"),
    mat("mat-nmb-concrete", "Reinforced concrete (in-situ)", "concrete", "#9A9A9A", "FL-02",
        note="To structural engineer design and specification"),
    mat("mat-nmb-ground-insulation", "Rigid closed cell insulation", "insulation", "#E8DC7E", "FL-02"),
    mat("mat-nmb-roof-buildup", "BROOF (t4) roof build up", "roofing", "#5E6670", "361",
        fire="BROOF(t4); minimum 30 minutes REI where part of a means of escape"),
]
MATS += nmb_details.EXTRA_MATS
w("materials/library.json", {"$schema": schema("materials"), "materials": MATS})

# ---- profiles -----------------------------------------------------------
def svg_for(layers, height, colours):
    total = sum(t for _, _, t, _ in layers)
    x, rects = 0.0, []
    for name, mid, t, _ in layers:
        rects.append(f'  <!-- {name}: {x*1000:.0f}-{(x+t)*1000:.0f} mm -->\n'
                     f'  <rect x="{x:.3f}" y="0" width="{t:.3f}" height="{height:.3f}" fill="{colours[mid]}" '
                     f'stroke="#888" stroke-width="0.002"/>')
        x += t
    return (f'<?xml version="1.0" encoding="UTF-8"?>\n'
            f'<svg xmlns="http://www.w3.org/2000/svg"\n     viewBox="0 0 {total:.3f} {height:.3f}"\n'
            f'     width="{total*1000:.0f}mm" height="{height*1000:.0f}mm">\n' + "\n".join(rects) +
            f'\n  <circle cx="{total/2:.3f}" cy="0" r="0.005" fill="red"/>\n'
            f'  <line x1="{total/2:.3f}" y1="-0.020" x2="{total/2:.3f}" y2="0.020" stroke="red" stroke-width="0.002"/>\n'
            f'</svg>\n')


COLOURS = {m["id"]: m["colour_hex"] for m in MATS}

# (name, material, thickness_m, function), listed exterior to interior
EW01 = [
    ("Cladding (333)", "mat-nmb-cladding", 0.020, "finish"),
    ("Fixing system (331)", "mat-nmb-fixing-system", 0.065, "service"),
    ("Rainscreen insulation (332)", "mat-nmb-rainscreen-insulation", 0.300, "insulation"),
    ("Breather membrane (351)", "mat-nmb-breather-membrane", 0.001, "membrane"),
    ("Sheathing board (323)", "mat-nmb-sheathing-board", 0.012, "structure"),
    ("Light steel framing (321) with insulation (322)", "mat-nmb-lsf", 0.150, "structure"),
    ("Vapour barrier (352)", "mat-nmb-vapour-barrier", 0.001, "membrane"),
    ("Wall lining board (311)", "mat-nmb-wall-lining-board", 0.015, "finish"),
    ("Wall lining board (311)", "mat-nmb-wall-lining-board", 0.015, "finish"),
    ("Skim and paint", "mat-nmb-skim", 0.003, "finish"),
]
IW01 = [
    ("Skim and paint", "mat-nmb-skim", 0.003, "finish"),
    ("Wall lining board (311)", "mat-nmb-wall-lining-board", 0.015, "finish"),
    ("Wall lining board (311)", "mat-nmb-wall-lining-board", 0.015, "finish"),
    ("Wall lining system (318) with insulation (317)", "mat-nmb-wall-lining-system", 0.050, "insulation"),
    ("CLT wall panel (301)", "mat-nmb-clt", 0.180, "structure"),
    ("Wall lining system (318) with insulation (317)", "mat-nmb-wall-lining-system", 0.050, "insulation"),
    ("Wall lining board (311)", "mat-nmb-wall-lining-board", 0.015, "finish"),
    ("Wall lining board (311)", "mat-nmb-wall-lining-board", 0.015, "finish"),
    ("Skim and paint", "mat-nmb-skim", 0.003, "finish"),
]
assert abs(sum(t for _, _, t, _ in EW01) - EW_T) < 1e-9


def profile(id_, desc, layers, height):
    total = round(sum(t for _, _, t, _ in layers), 6)
    w(f"profiles/{id_}.json", {
        "$schema": schema("profile"), "id": id_, "type": "Profile", "description": desc,
        "svg_file": f"profiles/{id_}.svg", "width": total, "height": None,
        "origin": {"x": round(total / 2, 6), "y": 0.0}, "alignment": "center",
        "profile_type": "wall", "height_limit_m": round(height, 3),
        "assembly": [{"layer": i + 1, "name": n, "material_id": m, "thickness": t, "function": f}
                     for i, (n, m, t, f) in enumerate(layers)],
    })
    (OUT / f"profiles/{id_}.svg").write_text(svg_for(layers, height, COLOURS))


profile("profile-nmb-ew-01-gf",
        "NMB-EW-01 external wall, ground floor: LSF facade, 60 minutes REI, 582 mm overall",
        EW01, STOREY_H - UP)
profile("profile-nmb-ew-01-ff",
        "NMB-EW-01 external wall, first floor: as ground floor, raised to the roof build-up top",
        EW01, ROOF_TOP - STOREY_H)
profile("profile-nmb-iw-01-a",
        "NMB-IW-01-A internal CLT wall, apartment/apartment: K2 60 + REI 60, 346 mm overall",
        IW01, CLT_WALL_H)

profile("profile-nmb-iw-01-a-gf",
        "NMB-IW-01-A internal CLT wall, ground floor: seated on a masonry upstand and DPC",
        IW01, CLT_WALL_H - CLT_BASE)
profile("profile-nmb-ew-01-parapet",
        "NMB-EW-01 parapet above the roof build-up: no timber, cavity barrier at the head, coping over",
        EW01, PARAPET_H)
profile("profile-nmb-glulam-column-gf",
        "NMB glulam column (303), ground floor: seated on a masonry upstand and DPC",
        nmb_details.WALL_TYPES["profile-nmb-glulam-column"][1], CLT_WALL_H - CLT_BASE)
profile("profile-nmb-upstand-ext",
        "Masonry and concrete upstand under a ground floor external wall: 150 mm above floor level, closed cell insulation (327) inside the masonry",
        [("Masonry upstand outer leaf", "mat-nmb-upstand-masonry", 0.098, "structure"),
         ("Closed cell perimeter insulation (327)", "mat-nmb-closed-cell-insulation", 0.310, "insulation"),
         ("Concrete upstand", "mat-nmb-concrete", 0.174, "structure")], UP + 0.12)
profile("profile-nmb-upstand-int",
        "Masonry upstand under a ground floor CLT wall: DPC on top",
        [("Masonry upstand", "mat-nmb-upstand-masonry", 0.200, "structure")], CLT_BASE + 0.12 - 0.01)
profile("profile-nmb-upstand-col",
        "Masonry upstand under a ground floor glulam column: DPC on top",
        [("Masonry upstand", "mat-nmb-upstand-masonry", COL_W, "structure")], CLT_BASE + 0.12 - 0.01)

nmb_details.build_types(w, lambda rel, text: (OUT / rel).write_text(text), COLOURS, schema, profile)

# ---- grid -----------------------------------------------------------------
w("grids/grid-structural.json", {
    "$schema": schema("grid"), "id": "grid-structural", "type": "Grid",
    "description": "Structural grid: four lines at 3 m (1-4) and two at 6 m (A-B)",
    "ifc_type": "IfcGrid",
    "axes": [{"id": str(i + 1), "direction": "y", "offset_m": x} for i, x in enumerate(XS)] +
            [{"id": "AB"[i], "direction": "x", "offset_m": y} for i, y in enumerate(YS)],
    "elevations": [
        {"id": "GF", "z_m": 0.0, "description": "Ground floor, finished floor level"},
        {"id": "FF", "z_m": STOREY_H, "description": "First floor, finished floor level"},
        {"id": "RF", "z_m": round(ROOF_TOP - ROOF_BUILDUP, 3), "description": "Roof structure, top face (roof detail datum)"},
    ],
})

# ---- paths, elements ------------------------------------------------------
def pt(x, y, z=0.0):
    return {"x": x, "y": y, "z": z}


def path(id_, desc, pts, closed=False, tags=()):
    segs = [{"type": "line", "start": pts[i], "end": pts[(i + 1) % len(pts)]}
            for i in range(len(pts) if closed else len(pts) - 1)]
    w(f"paths/{id_}.json", {"$schema": schema("path"), "id": id_, "type": "Path", "description": desc,
                              "closed": closed, "segments": segs, "tags": list(tags)})


STOREYS = [("gf", "Ground Floor", 0.0, "profile-nmb-ew-01-gf"),
           ("ff", "First Floor", STOREY_H, "profile-nmb-ew-01-ff")]
elements, junctions = [], []
walls = {}

def element(eid, desc, ifc, path_id, profile_id, storey, cap="flat", start=0.0, end=0.0, props=None):
    w(f"elements/{eid}.json", {
        "$schema": schema("element"), "id": eid, "type": "Element", "description": desc,
        "ifc_type": ifc, "path_id": path_id, "profile_id": profile_id,
        "sweep_mode": "perpendicular", "cap_start": cap, "cap_end": cap,
        "start_offset": start, "end_offset": end, "parent_group_id": f"storey-{storey}",
        "properties": props or {},
    })
    elements.append((eid, storey))
    return eid


def perimeter(z):
    """Clockwise from above, so the cladding faces outwards."""
    return {
        "north": [pt(0, D, z), pt(W, D, z)],
        "east": [pt(W, D, z), pt(W, 0, z)],
        "south": [pt(W, 0, z), pt(0, 0, z)],
        "west": [pt(0, 0, z), pt(0, D, z)],
    }


def wall_offset(side):
    # east/west walls run through and are extended by half a wall; north/south stop at their inner faces
    return -HALF if side in ("east", "west") else HALF


EXT_PROPS = {"nmb_wall_type": "NMB-EW-01", "fire_rating": "REI 60", "load_bearing": False,
             "note": "Facade is non-structural; bottom supported by the slab, restrained at the head"}
upstands = {}
for sid, sname, z, ew_profile in STOREYS:
    zw = z + (UP if sid == "gf" else 0.0)       # ground floor walls stand on the upstand
    for side, pts in perimeter(zw).items():
        pid, eid = f"path-wall-{side}-{sid}", f"element-wall-{side}-{sid}"
        path(pid, f"{side.capitalize()} external wall, {sname.lower()}", pts, tags=["external", sid])
        off = wall_offset(side)
        element(eid, f"{side.capitalize()} external wall, {sname.lower()} (NMB-EW-01)", "IfcWall", pid, ew_profile,
                sid, cap="junction", start=off, end=off, props=EXT_PROPS)
        walls[(side, sid)] = eid

    # internal CLT walls on grid lines 2 and 3, A to B; first floor walls stand on the CLT floor
    zc = CLT_BASE if sid == "gf" else CLT_FLOOR_TOP
    for gl in (2, 3):
        pid, eid = f"path-wall-clt-{gl}-{sid}", f"element-wall-clt-{gl}-{sid}"
        path(pid, f"Internal CLT wall on grid line {gl}, {sname.lower()}",
             [pt(XS[gl - 1], 0, zc), pt(XS[gl - 1], D, zc)], tags=["internal", "structure", sid])
        element(eid, f"Internal CLT wall on grid line {gl}, {sname.lower()} (NMB-IW-01-A)", "IfcWall", pid,
                "profile-nmb-iw-01-a-gf" if sid == "gf" else "profile-nmb-iw-01-a", sid, start=HALF, end=HALF,
                props={"nmb_wall_type": "NMB-IW-01-A", "fire_rating": "K2 60 + REI 60", "load_bearing": True})

# ground floor upstands: 150 mm above floor level under the external walls, 30 mm (DPC) under CLT walls and columns
UP_Z = -0.12
for side, pts in perimeter(UP_Z).items():
    pid, eid = f"path-upstand-{side}", f"element-upstand-{side}"
    path(pid, f"Masonry upstand under the {side} external wall", pts, tags=["upstand", "gf"])
    off = wall_offset(side)
    upstands[side] = element(eid, f"Masonry upstand under the {side} external wall, to 150 mm above floor level",
                             "IfcWall", pid, "profile-nmb-upstand-ext", "gf", cap="junction", start=off, end=off,
                             props={"min_height_above_ground_m": 0.15})
for gl in (2, 3):
    pid, eid = f"path-upstand-clt-{gl}", f"element-upstand-clt-{gl}"
    path(pid, f"Masonry upstand under the CLT wall on grid line {gl}",
         [pt(XS[gl - 1], 0, UP_Z), pt(XS[gl - 1], D, UP_Z)], tags=["upstand", "gf"])
    upstands[f"clt-{gl}"] = element(eid, f"Masonry upstand under the CLT wall on grid line {gl}", "IfcWall", pid,
                                    "profile-nmb-upstand-int", "gf", start=HALF, end=HALF)

# glulam columns (303): short elements, 360 mm square with encapsulation. The interior column stands in bay 3-4;
# the others stand against the inside of the facade (centre 436 mm from the wall centre line, as drawn)
IN = HALF + 0.145                                    # 436 mm
COLUMNS = {"int": (7.5, 3.0), "north": (7.5, D - IN), "nw": (IN, D - IN), "se": (W - IN, IN)}
column_el = {}
for name, (cx, cy) in COLUMNS.items():
    for sid, zb, prof in (("gf", CLT_BASE, "profile-nmb-glulam-column-gf"), ("ff", CLT_FLOOR_TOP, "profile-nmb-glulam-column")):
        pid, eid = f"path-column-{name}-{sid}", f"element-column-{name}-{sid}"
        path(pid, f"Glulam column {name}, {sid.upper()}", [pt(cx - COL_W / 2, cy, zb), pt(cx + COL_W / 2, cy, zb)],
             tags=["column", sid])
        column_el[(name, sid)] = element(eid, f"Glulam column {name}, {sid.upper()} (303)", "IfcColumn", pid, prof, sid,
                                         props={"load_bearing": True, "material": "glulam"})
    pid, eid = f"path-upstand-column-{name}", f"element-upstand-column-{name}"
    path(pid, f"Masonry upstand under glulam column {name}",
         [pt(cx - COL_W / 2, cy, UP_Z), pt(cx + COL_W / 2, cy, UP_Z)], tags=["upstand", "gf"])
    upstands[f"column-{name}"] = element(eid, f"Masonry upstand under glulam column {name}", "IfcWall", pid,
                                         "profile-nmb-upstand-col", "gf")

# riser walls (NMB-IW-05-A): CLT with shaft lining, from mid-depth to the north wall at x = 1.5 m
shaft = {}
for sid, zs in (("gf", 0.0), ("ff", CLT_FLOOR_TOP)):
    pid, eid = f"path-wall-shaft-{sid}", f"element-wall-shaft-{sid}"
    path(pid, f"Riser wall, {sid.upper()}", [pt(1.5, 3.8, zs), pt(1.5, D, zs)], tags=["riser", sid])
    shaft[sid] = element(eid, f"Riser wall, {sid.upper()} (NMB-IW-05-A)", "IfcWall", pid, "profile-nmb-iw-05-a", sid,
                         end=HALF, props={"nmb_wall_type": "NMB-IW-05-A", "fire_rating": "K2 60 + REI 60"})

# parapets above the first floor external walls, standing on the roof build-up
parapets = {}
for side, pts in perimeter(ROOF_TOP).items():
    pid, eid = f"path-parapet-{side}", f"element-parapet-{side}"
    path(pid, f"{side.capitalize()} parapet", pts, tags=["parapet", "roof"])
    off = wall_offset(side)
    parapets[side] = element(eid, f"{side.capitalize()} parapet (NMB-EW-01), no timber", "IfcWall", pid,
                             "profile-nmb-ew-01-parapet", "roof", cap="junction", start=off, end=off,
                             props={"nmb_wall_type": "NMB-EW-01", "note": "Parapets must not be built from CLT or other timber"})

# ---- corner junctions (butt: east/west walls run through) -------------------
CORNERS = [("sw", "south", "west", "1", "A"), ("se", "south", "east", "4", "A"),
           ("nw", "north", "west", "1", "B"), ("ne", "north", "east", "4", "B")]
w("details/detail-nmb-ew-corner-butt.json", {
    "$schema": schema("detail"), "id": "detail-nmb-ew-corner-butt", "type": "Detail",
    "description": "Plan detail: NMB-EW-01 external wall corner, east/west wall running through, north/south wall butting. Source: NMB Details v1.0 (2023), pp. 34-37. Checklist: timber encapsulation REI 60 and K2-60 (311) fitted before the internal lining; intumescent sealant at plasterboard junctions (312); AVCL sealed to the engineered timber (352)",
    "condition": {"rule": "butt", "member_count": 2, "member_kinds": ["wall", "wall"]},
    "members": [
        {"role": "through-wall", "kind": "wall", "profile_id": "profile-nmb-ew-01-gf",
         "placement": {"offset_x_m": 0.0, "offset_y_m": 0.0, "rotation_deg": 0}, "extent": "forward"},
        {"role": "butting-wall", "kind": "wall", "profile_id": "profile-nmb-ew-01-gf",
         "placement": {"offset_x_m": 0.0, "offset_y_m": -HALF, "rotation_deg": 90}, "extent": "backward"},
    ],
    "datum": {"kind": "storey", "reference": "elevation"},
    "plane": "plan", "view_direction": "along_path",
    "geometry": {"extrusion_m": 3.0, "regions": [
        nmb_details.prect("mat-nmb-cavity-barrier-vertical", -.046, .042, -.250, .094),
        nmb_details.prect("mat-nmb-gap-sealer", .291, .306, .291, .306)]},
    "tags": ["nmb", "junction", "corner"],
})
for sid, sname, z, _ in STOREYS:
    for tag, butting, through, ax_x, ax_y in CORNERS:
        jid = f"junction-{tag}-corner-{sid}"
        w(f"junctions/{jid}.json", {
            "$schema": schema("junction"), "id": jid, "type": "Junction",
            "description": f"{tag.upper()} corner, {sname.lower()}: {butting} wall butts into {through} wall",
            "elements": [walls[(butting, sid)], walls[(through, sid)]],
            "detail_id": "detail-nmb-ew-column-plan" if tag in ("nw", "se") else "detail-nmb-ew-corner-butt",
            "location": {"grid_id": "grid-structural", "axes": [ax_x, ax_y], "level_id": f"storey-{sid}",
                         "level_offset_m": 0.0},
            "rule": "butt", "priority": [walls[(through, sid)]], "trim_method": "none",
        })
        junctions.append(jid)

# ---- slabs ----------------------------------------------------------------
path("path-slab-perimeter", "Slab boundary on the grid perimeter, clockwise",
     [pt(0, 0), pt(0, D), pt(W, D), pt(W, 0)], closed=True, tags=["slab"])
slabs = []


def slab(id_, desc, storey, thick, mat_id, top, ifc="IfcSlab", slab_type="FLOOR", boundary="path-slab-perimeter", **props):
    slabs.append(id_)
    w(f"slabs/{id_}.json", {
        "$schema": schema("slab"), "id": id_, "type": "Slab", "description": desc, "ifc_type": ifc,
        "boundary_path_id": boundary, "thickness_m": round(thick, 3), "material_id": mat_id,
        "elevation_m": round(top, 3), "parent_group_id": storey,
        "properties": {"slab_type": slab_type, **props}, "tags": ["slab", "nmb"],
    })


# NMB-FL-02 ground floor slab, top of the finish at 0.000
gf_fin, gf_scr, gf_rc, gf_ins = 0.025, 0.095, 0.250, 0.205
slab("slab-gf-finish", "NMB-FL-02: internal floor finish allowance, 25 mm", "storey-gf", gf_fin,
     "mat-nmb-floor-finish", 0.0, slab_type="FINISH")
slab("slab-gf-screed", "NMB-FL-02: bonded screed, 95 mm", "storey-gf", gf_scr,
     "mat-nmb-screed", -gf_fin, slab_type="SCREED")
slab("slab-gf-rc", "NMB-FL-02: in-situ reinforced concrete ground slab, 250 mm (to SE design)", "storey-gf",
     gf_rc, "mat-nmb-concrete", -gf_fin - gf_scr, slab_type="GROUND", load_bearing=True)
slab("slab-gf-insulation", "NMB-FL-02: rigid closed cell insulation, 205 mm", "storey-gf", gf_ins,
     "mat-nmb-ground-insulation", -gf_fin - gf_scr - gf_rc, slab_type="INSULATION")

# NMB-FL-01 party floor, finished floor level at 3.000, CLT underneath
ff_layers = [("slab-ff-finish", "internal floor finish allowance, 20 mm", 0.020, "mat-nmb-floor-finish", "FINISH"),
             ("slab-ff-screedboard", "screedboard, 20 mm", 0.020, "mat-nmb-screedboard", "SCREED"),
             ("slab-ff-insulation", "rigid insulation with underfloor heating, 35 mm", 0.035,
              "mat-nmb-ufh-insulation", "INSULATION"),
             ("slab-ff-acoustic", "acoustic matting, 8 mm", 0.008, "mat-nmb-acoustic-matting", "ACOUSTIC")]
top = STOREY_H
for sid_, desc, t, m, st in ff_layers:
    slab(sid_, f"NMB-FL-01: {desc}", "storey-ff", t, m, top, slab_type=st)
    top -= t
slab("slab-ff-clt", "NMB-FL-01: CLT floor panel, 140 mm, 60 minutes REI", "storey-ff", CLT_FLOOR,
     "mat-nmb-clt", CLT_FLOOR_TOP, slab_type="FLOOR", load_bearing=True, fire_rating="REI 60")

# NMB-RF-01 flat roof
slab("slab-roof-clt", "NMB-RF-01: CLT roof panel, 208 mm", "storey-ff", CLT_ROOF, "mat-nmb-clt",
     ROOF_TOP - ROOF_BUILDUP, ifc="IfcRoof", slab_type="ROOF", load_bearing=True)
slab("slab-roof-buildup", "NMB-RF-01: BROOF (t4) roof build up, 350 mm", "storey-ff", ROOF_BUILDUP,
     "mat-nmb-roof-buildup", ROOF_TOP, ifc="IfcRoof", slab_type="ROOF")

# ---- openings --------------------------------------------------------------
openings = []


def opening(id_, desc, host, path_id, pos, wd, ht, sill, ifc):
    openings.append(id_)
    w(f"openings/{id_}.json", {"$schema": schema("opening"), "id": id_, "type": "Opening", "description": desc,
                                 "host_element_id": host, "path_id": path_id, "path_position": pos,
                                 "width_m": wd, "height_m": ht, "sill_height_m": sill, "ifc_type": ifc})


# balcony deck over the south bays 2-3 and 3-4, below the door cills
path("path-slab-balcony", "Balcony deck boundary, south of the first floor, clockwise",
     [pt(3.0, -1.5), pt(3.0, -HALF), pt(W, -HALF), pt(W, -1.5)], closed=True, tags=["slab", "balcony"])
slab("slab-balcony-ff", "Non-combustible balcony deck, 120 mm, thermally broken from the structure", "storey-ff", 0.12,
     "mat-nmb-balcony-deck", STOREY_H - 0.15, slab_type="BALCONY", boundary="path-slab-balcony")


def south_pos(xc, wd):
    return round(W - xc - wd / 2, 3)        # the south wall runs east to west


def north_pos(xc, wd):
    return round(xc - wd / 2, 3)            # the north wall runs west to east


# opening sills are measured from the wall path: 0.15 m above floor level for ground floor walls
opening("opening-door-south-gf", "Entrance door, south wall, ground floor, centre x = 7.5 m, level threshold through the upstand",
        "element-wall-south-gf", "path-wall-south-gf", south_pos(7.5, 0.9), 0.9, 2.1 + UP, -UP, "IfcDoor")
opening("opening-window-south-gf-1", "Window, south wall, ground floor, centre x = 1.894 m, 506 mm from the grid line 2 CLT wall",
        "element-wall-south-gf", "path-wall-south-gf", south_pos(3 - 1.106, 1.2), 1.2, 1.2, 0.75, "IfcWindow")
opening("opening-window-south-gf-2", "Window, south wall, ground floor, centre x = 4.106 m, 506 mm from the grid line 2 CLT wall",
        "element-wall-south-gf", "path-wall-south-gf", south_pos(3 + 1.106, 1.2), 1.2, 1.2, 0.75, "IfcWindow")
opening("opening-window-north-gf", "Window, north wall, ground floor, centre x = 4.5 m, head at 2.6 m",
        "element-wall-north-gf", "path-wall-north-gf", north_pos(4.5, 1.8), 1.8, 1.7, 0.75, "IfcWindow")
opening("opening-window-north-ff", "Window, north wall, first floor, centre x = 4.5 m, above the ground floor window",
        "element-wall-north-ff", "path-wall-north-ff", north_pos(4.5, 1.8), 1.8, 1.2, 0.9, "IfcWindow")
opening("opening-door-balcony-south-ff-1", "Balcony door, south wall, first floor, centre x = 4.5 m",
        "element-wall-south-ff", "path-wall-south-ff", south_pos(4.5, 1.2), 1.2, 2.1, 0.0, "IfcDoor")
opening("opening-door-balcony-south-ff-2", "Balcony door, south wall, first floor, centre x = 7.5 m",
        "element-wall-south-ff", "path-wall-south-ff", south_pos(7.5, 1.2), 1.2, 2.1, 0.0, "IfcDoor")
opening("opening-window-east-ff", "Full height window, east wall, first floor, centre y = 1.5 m",
        "element-wall-east-ff", "path-wall-east-ff", round(D - 1.5 - 0.6, 3), 1.2, 2.1, 0.0, "IfcWindow")

# ---- secondary grid and the junctions the NMB details are drawn at -------------
w("grids/grid-secondary.json", {
    "$schema": schema("grid"), "id": "grid-secondary", "type": "Grid",
    "description": "Secondary grid: the structural lines plus mid-bay lines (1-2, 2-3, 3-4) and mid-depth lines (A-M at 1.5 m, "
                   "A-B at 3 m, M-B at 4.5 m), so details can be placed away from the corners",
    "ifc_type": "IfcGrid",
    "axes": [{"id": str(i + 1), "direction": "y", "offset_m": x} for i, x in enumerate(XS)] +
            [{"id": f"{i + 1}-{i + 2}", "direction": "y", "offset_m": (XS[i] + XS[i + 1]) / 2} for i in range(3)] +
            [{"id": "A", "direction": "x", "offset_m": YS[0]}, {"id": "A-M", "direction": "x", "offset_m": 1.5},
             {"id": "A-B", "direction": "x", "offset_m": D / 2}, {"id": "M-B", "direction": "x", "offset_m": 4.5},
             {"id": "B", "direction": "x", "offset_m": YS[1]}],
})


placed = {}


def detail_junction(id_, desc, detail_id, elements_, axes, sid, offset=0.0):
    key = (tuple(axes), sid, offset)
    assert key not in placed, f"{id_} shares a location with {placed[key]}"
    placed[key] = id_
    junctions.append(id_)
    w(f"junctions/{id_}.json", {
        "$schema": schema("junction"), "id": id_, "type": "Junction", "description": desc,
        "elements": elements_, "detail_id": detail_id,
        "location": {"grid_id": "grid-secondary", "axes": axes, "level_id": f"storey-{sid}", "level_offset_m": offset},
        "rule": "butt", "priority": [elements_[0]], "trim_method": "none",
    })


S, N, E, Wst = "south", "north", "east", "west"
wl = lambda side, sid: walls[(side, sid)]
clt = lambda gl, sid: f"element-wall-clt-{gl}-{sid}"
D_ = lambda name: f"detail-nmb-{name}"

# external wall stack at the first floor edge: FF wall over GF wall, one per facade
for side, axes in ((S, ["1-2", "A"]), (N, ["1-2", "B"]), (E, ["4", "A-B"]), (Wst, ["1", "A-B"])):
    detail_junction(f"junction-slab-edge-{side}-ff", f"{side.capitalize()} facade at the first floor edge: FF wall over GF wall",
                    D_("ew-slab-edge-section"), [wl(side, "ff"), wl(side, "gf")], axes, "ff")

# internal CLT wall meeting an external wall, plan
for side, gl, sid in ((S, 3, "gf"), (N, 2, "gf"), (N, 2, "ff"), (N, 3, "gf"), (N, 3, "ff")):
    detail_junction(f"junction-slab-edge-plan-{side}-{gl}-{sid}",
                    f"CLT wall on grid line {gl} meets the {side} external wall, {sid.upper()}",
                    D_("ew-slab-edge-plan"), [wl(side, sid), clt(gl, sid)], [str(gl), "A" if side == S else "B"], sid)

# windows
detail_junction("junction-window-north-ff", "North facade, bay 2-3: GF window head and FF window cill either side of the floor",
                D_("ew-window-section"), [wl(N, "ff"), wl(N, "gf")], ["2-3", "B"], "ff")
detail_junction("junction-window-plan-south-2-gf", "South facade: windows 506 mm either side of the grid line 2 CLT wall, plan",
                D_("ew-window-plan"), [wl(S, "gf"), clt(2, "gf")], ["2", "A"], "gf")
detail_junction("junction-window-full-height-east-ff", "East facade: full height window over the first floor edge, y = 1.5 m",
                D_("ew-window-full-height-section"), [wl(E, "ff"), wl(E, "gf")], ["4", "A-M"], "ff")

# CLT walls through the first floor
detail_junction("junction-core-floor-clt-2-ff", "CLT wall on grid line 2 through the first floor, mid-depth",
                D_("core-floor-section"), [clt(2, "ff"), clt(2, "gf")], ["2", "A-B"], "ff")
detail_junction("junction-core-floor-plan-clt-3-ff", "CLT wall on grid line 3 at the first floor, mid-depth, plan",
                D_("core-floor-plan"), [clt(3, "ff"), clt(3, "gf")], ["3", "A-B"], "ff")

# ground floor: facade and CLT wall on upstands, interior column on an upstand
detail_junction("junction-gs-external-wall-south-gf", "South facade on the ground floor upstand, bay 2-3",
                D_("gs-external-wall-section"), [wl(S, "gf"), upstands[S]], ["2-3", "A"], "gf")
detail_junction("junction-gs-clt-wall-2-gf", "CLT wall on grid line 2 on its upstand, mid-depth",
                D_("gs-clt-wall-section"), [clt(2, "gf"), upstands["clt-2"]], ["2", "A-B"], "gf")
detail_junction("junction-gs-column-int-gf", "Interior glulam column on its upstand, bay 3-4 at mid-depth",
                D_("gs-glulam-column-section"), [column_el[("int", "gf")], upstands["column-int"]], ["3-4", "A-B"], "gf")

# glulam column against the north facade (section)
detail_junction("junction-column-north-ff", "Glulam column against the north facade at the first floor edge, bay 3-4",
                D_("ew-column-section"), [wl(N, "ff"), column_el[("north", "ff")]], ["3-4", "B"], "ff")

# balcony over the south bays 2-3 and 3-4
detail_junction("junction-balcony-door-section-ff", "South facade, bay 2-3: balcony door threshold, section",
                D_("balcony-door-section"), [wl(S, "ff"), wl(S, "gf")], ["2-3", "A"], "ff")
detail_junction("junction-balcony-door-plan-ff", "South facade, bay 3-4: balcony door threshold, plan",
                D_("balcony-door-plan"), [wl(S, "ff"), wl(S, "gf")], ["3-4", "A"], "ff")
detail_junction("junction-balcony-connection-plan-2-ff", "Balcony connection at the grid line 2 CLT wall, plan",
                D_("balcony-connection-plan"), [wl(S, "ff"), clt(2, "ff")], ["2", "A"], "ff")
detail_junction("junction-balcony-connection-section-3-ff", "Balcony connection at the grid line 3 CLT wall, section",
                D_("balcony-connection-section"), [wl(S, "ff"), clt(3, "ff")], ["3", "A"], "ff")

# roof
detail_junction("junction-roof-parapet-north", "North parapet over the first floor wall, bay 2-3",
                D_("roof-parapet-section"), [parapets[N], wl(N, "ff")], ["2-3", "B"], "roof")
detail_junction("junction-roof-party-wall-3", "CLT wall on grid line 3 at the roof, mid-depth",
                D_("roof-party-wall-section"), [clt(3, "ff"), clt(3, "gf")], ["3", "A-B"], "roof")
detail_junction("junction-roof-rwp-south", "Rainwater outlet near the south parapet, bay 3-4",
                D_("penetration-roof-rwp-section"), [parapets[S], wl(S, "ff")], ["3-4", "A"], "roof")
detail_junction("junction-roof-svp-riser", "Soil vent pipe through the roof in the riser",
                D_("penetration-roof-svp-section"), [shaft["ff"], shaft["gf"]], ["1-2", "M-B"], "roof")

# penetrations
detail_junction("junction-pen-party-wall-2-ff", "Services through the grid line 2 CLT wall beneath the first floor, y = 1.5 m",
                D_("penetration-party-wall-section"), [clt(2, "ff"), clt(2, "gf")], ["2", "A-M"], "ff")
detail_junction("junction-pen-shaft-ff", "Riser wall through the first floor",
                D_("penetration-shaft-section"), [shaft["ff"], shaft["gf"]], ["1-2", "M-B"], "ff")
detail_junction("junction-pen-internal-plan-3-ff", "Services boxed in at the grid line 3 CLT wall, plan, y = 4.5 m",
                D_("penetration-internal-slab-plan"), [clt(3, "ff"), clt(3, "gf")], ["3", "M-B"], "ff")
detail_junction("junction-pen-internal-section-3-ff", "Services through the grid line 3 CLT wall and first floor, y = 1.5 m",
                D_("penetration-internal-slab-section"), [clt(3, "ff"), clt(3, "gf")], ["3", "A-M"], "ff")
for name, side, axes, det in (("fire-collar", Wst, ["1", "A-M"], "facade-fire-collar-section"),
                              ("cavity-closed", Wst, ["1", "M-B"], "facade-cavity-closed-section"),
                              ("fire-duct", E, ["4", "M-B"], "facade-fire-duct-section")):
    detail_junction(f"junction-pen-facade-{name}", f"{side.capitalize()} facade: service penetration at 1.0 m above floor level",
                    D_(f"penetration-{det}"), [wl(side, "gf"), wl(side, "ff")], axes, "gf", 1.0)

detail_ids = nmb_details.build_details(w, schema)

# ---- model.json, manifest, support files -----------------------------------
by_storey = {sid: [e for e, s in elements if s == sid] for sid in ("gf", "ff", "roof")}
slab_by_storey = {"gf": [s for s in slabs if s.startswith("slab-gf")],
                  "ff": [s for s in slabs if not s.startswith("slab-gf")]}
w("model.json", {
    "hierarchy": {
        "type": "Project", "id": "project-root", "description": "NMB two-storey example",
        "children": [{"type": "Site", "id": "site-main", "children": [{
            "type": "Building", "id": "building-main",
            "children": [
                {"type": "Storey", "id": f"storey-{sid}", "description": name, "elevation": z,
                 "children": by_storey.get(sid, []) + slab_by_storey.get(sid, [])}
                for sid, name, z, _ in STOREYS + [("roof", "Roof (structure top face)", ROOF_STRUCT_TOP, None)]
            ]}]}],
    },
    "elements": [e for e, _ in elements],
    "slabs": slabs,
    "objects": [],
    "arrays": [],
    "junctions": junctions,
    "grids": ["grid-structural", "grid-secondary"],
    "details": ["detail-nmb-ew-corner-butt"] + detail_ids,
    "openings": openings,
})
w("manifest.json", {
    "format": "oebf", "format_version": "0.1.0",
    "project_name": "NMB Two-Storey Example",
    "description": "Two-storey, 9 m x 6 m building on a 3 m x 6 m grid (four lines at 3 m, two at 6 m), "
                   "using New Model Building (Waugh Thistleton, 2023) wall, floor and roof build-ups, with its details placed on junctions.",
    "created": "2026-10-19", "author": "OEBF Example", "units": "metres",
    "coordinate_system": "right_hand_z_up",
    "files": {"model": "model.json", "materials": "materials/library.json", "schema": "schema/oebf-schema.json"},
})
shutil.copytree(SRC / "schema", OUT / "schema", dirs_exist_ok=True)
shutil.copy(SRC / "OEBF-GUIDE.md", OUT / "OEBF-GUIDE.md")
print("written", OUT)
