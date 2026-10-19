"""NMB wall/floor/roof types, extra products and details for gen_nmb.py.

Source: New Model Building Details v1.0 (Waugh Thistleton Architects, 2023).
Detail regions are traced from the drawings at about +/-10 mm. They show the products the swept
profiles do not (cavity barriers, firestops, sealers, brackets, columns, membranes), not every line.

Coordinates, metres. Wall-local x runs across the wall (exterior negative, interior positive, as in the
profile). Section details use detail x = wall-local x, y up from the datum. Plan details use detail
u = along the wall and v = -x, so the exterior is +v.
"""

# ---- extra materials ------------------------------------------------------
def _m(id_, name, cat, colour, item=None, **props):
    p = dict(props)
    if item:
        p["nmb_item"] = item
    return {"id": id_, "type": "Material", "name": name, "category": cat, "colour_hex": colour,
            "ifc_material_name": name, "properties": p, "interactions": {}}


EXTRA_MATS = [
    _m("mat-nmb-steel-bracket", "Steel bracket", "steel", "#7F8791", "304",
       fixing="Screw fixed to timber elements", fire="Fire resistance provided through encapsulation"),
    _m("mat-nmb-gap-sealer", "Fire resistant gap sealer", "sealant", "#D9363E", "312",
       fire="60 minutes", reaction="Euroclass A2-s3, d2 or better",
       location="Head and base junctions to wall lining boards"),
    _m("mat-nmb-cavity-closer", "Cavity closer", "board", "#B9B5AC", "313",
       fire="30 minutes integrity, 15 minutes insulation", min_thickness_mm=12,
       description="Calcium silicate, cement-based or gypsum-based board"),
    _m("mat-nmb-firestop-wrap", "Intumescent firestop wrap", "firestop", "#E06A6A", "314", fire="60 minutes"),
    _m("mat-nmb-firestop-collar", "Intumescent firestop collar", "firestop", "#C8323C", "315", fire="60 minutes"),
    _m("mat-nmb-fire-rated-duct", "Fire rated duct", "services", "#D9363E", "316", fire="60 minutes"),
    _m("mat-nmb-shaft-lining-system", "Shaft lining system", "steel", "#B8BCC4", "319",
       description="Wall framing system providing non-loadbearing partition to service riser"),
    _m("mat-nmb-shaft-lining-board", "Shaft lining board", "plasterboard", "#DCDCD6", "320",
       fire="60 minutes", reaction="Euroclass A1 in accordance with BS EN 13501-1", min_layers=2),
    _m("mat-nmb-full-fill-insulation", "Full fill insulation", "insulation", "#F2A9BE", "325",
       description="Full fill stone mineral wool slab insulation for steel frames",
       reaction="Euroclass A2-s1, d2 or better"),
    _m("mat-nmb-balcony-connection", "Balcony connection", "steel", "#6E7580", "326",
       description="Bespoke steel balcony connection, fully encapsulated with K2-60 protection"),
    _m("mat-nmb-closed-cell-insulation", "Closed cell perimeter insulation", "insulation", "#BFC3BA", "327",
       location="Junction of GF slab and external facade, below DPC"),
    _m("mat-nmb-linear-firestop", "Linear firestop", "firestop", "#E0364A", "341",
       fire="60 minutes", dimension="150 mm, up to 3 layers for minimum 5% compression"),
    _m("mat-nmb-cavity-barrier-horizontal", "Horizontal cavity barrier", "firestop", "#E8485A", "342",
       fire="60 minutes", description="Open state stone mineral wool intumescent cavity barrier"),
    _m("mat-nmb-cavity-barrier-vertical", "Vertical cavity barrier", "firestop", "#F0586A", "343",
       fire="60 minutes", description="Stone mineral wool vertical cavity barrier"),
    _m("mat-nmb-cavity-barrier-window", "Cavity barrier to windows", "firestop", "#F28A98", "344",
       fire="30 minutes integrity, 15 minutes insulation"),
    _m("mat-nmb-ablative-batt", "Ablative coated batt", "insulation", "#F2C4CC", "345",
       description="Mineral wool insulation, pre-coated on both sides with ablative coating"),
    _m("mat-nmb-fire-board", "Fire board", "board", "#F2B5C4", "346",
       fire="60 minutes", description="Calcium silicate or cement-based board suitable for external use"),
    _m("mat-nmb-roof-structure", "Lightweight timber roof structure", "timber", "#D8B67A", "362",
       description="Timber decking board with timber joists"),
    _m("mat-nmb-roof-sheeting", "Non-combustible roof sheeting", "board", "#B0B3AA", "364",
       description="Non-combustible cement bonded particle board, horizontal application"),
    _m("mat-nmb-waterproofing", "Robust waterproofing layer", "membrane", "#3FA3B8", None,
       note="Installed to a minimum of 1.2 m AFFL in wet areas"),
    _m("mat-nmb-tanking-membrane", "Self adhesive waterproofing membrane", "membrane", "#52B6C9"),
    _m("mat-nmb-bathroom-finish", "Bathroom wall finish (tiles)", "finish", "#C9D6DC"),
    _m("mat-nmb-service-void", "Servicing void", "cavity", "#F4F4F0", None, note="200 mm void for SVP"),
    _m("mat-nmb-dpc", "DPC membrane", "membrane", "#3C3C3C", None,
       note="Extends a minimum of 100 mm beyond the timber thickness"),
    _m("mat-nmb-dpm", "DPM waterproofing membrane", "membrane", "#2E8FD6", None),
    _m("mat-nmb-acoustic-strip", "Acoustic flanking strip", "acoustic", "#1F1F1F"),
    _m("mat-nmb-upstand-masonry", "Masonry upstand", "masonry", "#C9C6BD", None,
       note="Minimum 150 mm above external ground level"),
    _m("mat-nmb-cavity-tray", "Non-combustible cavity tray", "membrane", "#4DB8C8"),
    _m("mat-nmb-epdm", "EPDM seal", "membrane", "#2B2B2B"),
    _m("mat-nmb-window-frame", "Window frame and glazing", "glazing", "#B7D3E0"),
    _m("mat-nmb-roof-green", "Green roof substrate and vegetation", "roofing", "#7FA85A"),
    _m("mat-nmb-roof-gravel", "Gravel upstand guard", "roofing", "#C9C9C0"),
    _m("mat-nmb-coping", "Parapet coping", "metal", "#A8A8A8"),
    _m("mat-nmb-balcony-frame", "Non-combustible balcony support frame", "steel", "#9096A0"),
    _m("mat-nmb-thermal-break", "Balcony thermal break", "insulation", "#52B6C9"),
    _m("mat-nmb-pipe", "Pipe or non-fire rated duct", "services", "#EDEDED",
       note="PVCu to BS 4514:2001 or BS 5255:1989; maximum opening 160 mm"),
    _m("mat-nmb-end-grain-sealer", "End grain sealer", "sealant", "#2F7DC8", None,
       note="Coloured sealer to all cut openings; continue 50 mm along the adjacent face"),
    _m("mat-nmb-balcony-deck", "Non-combustible balcony deck", "steel", "#8A8F98", "326",
       note="Thermally broken from the structure; cavity barriers coordinated with the compartmentation"),
    _m("mat-nmb-sub-base", "Sub-base and blinding", "ground", "#B8B2A4"),
]

# ---- additional profiles (layers listed exterior/top first) -----------------
W_ = "mat-nmb-wall-lining-board"
SK = ("Skim and paint", "mat-nmb-skim", 0.003, "finish")
LB15 = ("Wall lining board (311)", W_, 0.015, "finish")
LB13 = ("Wall lining board", W_, 0.013, "finish")
LS50 = ("Wall lining system (318) with insulation (317)", "mat-nmb-wall-lining-system", 0.050, "insulation")
LS70 = ("Wall lining system with insulation between studs", "mat-nmb-wall-lining-system", 0.070, "insulation")
CLT = ("CLT wall panel (301)", "mat-nmb-clt", 0.180, "structure")
WP = ("Robust waterproofing layer", "mat-nmb-waterproofing", 0.002, "membrane")
SB15 = ("Shaft lining board (320/311)", "mat-nmb-shaft-lining-board", 0.015, "finish")
SS50 = ("Shaft lining system (319)", "mat-nmb-shaft-lining-system", 0.050, "service")

WALL_TYPES = {
    "profile-nmb-iw-02-a": ("NMB-IW-02-A internal CLT wall, apartment/apartment: K2 60 + REI 60, lined direct (no lining system)",
                            [SK, LB15, LB15, CLT, LB15, LB15, SK], 2.777),
    "profile-nmb-iw-03-a": ("NMB-IW-03-A internal CLT wall with robust waterproofing to 1.2 m AFFL",
                            [SK, LB15, LB15, LS50, WP, CLT, WP, LS50, LB15, LB15, SK], 2.777),
    "profile-nmb-iw-04-a": ("NMB-IW-04-A internal CLT wall with 200 mm SVP servicing void on one side",
                            [SK, LB15, LB15, LS50, WP, CLT, WP,
                             ("Servicing void for SVP", "mat-nmb-service-void", 0.200, "service"),
                             LS50, LB15, LB15, SK], 2.777),
    "profile-nmb-iw-05-a": ("NMB-IW-05-A service riser wall: CLT with shaft lining both sides, K2 60 + REI 60",
                            [SB15, SB15, SS50, CLT, SS50, SB15, SB15], 2.777),
    "profile-nmb-ip-01-a": ("NMB-IP-01-A non-loadbearing partition, apartment/apartment: 30 minutes REI",
                            [SK, LB13, LS70, LB13, SK], 2.7),
    "profile-nmb-ip-02-a": ("NMB-IP-02-A bathroom partition: 30 minutes REI, tanked and tiled one side",
                            [SK, LB13, LS70, LB13,
                             ("Robust self adhesive waterproofing membrane", "mat-nmb-tanking-membrane", 0.003, "membrane"),
                             ("Bathroom wall finish, e.g. tiles", "mat-nmb-bathroom-finish", 0.011, "finish")], 2.7),
    "profile-nmb-ip-03-a": ("NMB-IP-03-A service riser partition: 60 minutes REI",
                            [SB15, SB15, ("Shaft lining system (319)", "mat-nmb-shaft-lining-system", 0.070, "service"),
                             SB15, SB15], 2.7),
    "profile-nmb-ip-04-a": ("NMB-IP-04-A storage partition: no rating",
                            [SK, LB13, LS70, LB13, SK], 2.7),
    "profile-nmb-glulam-column": ("NMB glulam column (303), 300 mm square, encapsulated with two layers of 311 each face",
                                  [LB15, LB15, ("Glulam column (303)", "mat-nmb-glulam", 0.300, "structure"), LB15, LB15], 2.777),
}

SLAB_TYPES = {
    "profile-nmb-fl-01": ("NMB-FL-01 party floor: 60 minutes REI, optional services zone and suspended ceiling not drawn",
                          [("Internal floor finish allowance", "mat-nmb-floor-finish", 0.020, "finish"),
                           ("Screedboard", "mat-nmb-screedboard", 0.020, "finish"),
                           ("Rigid insulation with underfloor heating", "mat-nmb-ufh-insulation", 0.035, "insulation"),
                           ("Acoustic matting", "mat-nmb-acoustic-matting", 0.008, "membrane"),
                           ("CLT floor panel (302)", "mat-nmb-clt", 0.140, "structure"),
                           LB15, LB15, SK]),
    "profile-nmb-fl-02": ("NMB-FL-02 ground floor slab: no fire rating",
                          [("Internal floor finish allowance", "mat-nmb-floor-finish", 0.025, "finish"),
                           ("Screed (bonded)", "mat-nmb-screed", 0.095, "finish"),
                           ("Reinforced concrete (in-situ), to SE design", "mat-nmb-concrete", 0.250, "structure"),
                           ("Waterproof membrane", "mat-nmb-waterproofing", 0.003, "membrane"),
                           ("Rigid closed cell insulation", "mat-nmb-ground-insulation", 0.205, "insulation")]),
    "profile-nmb-rf-01": ("NMB-RF-01 flat roof, fall 1:40 to 1:5.5: lightweight timber structure, BROOF(t4)",
                          [("BROOF (t4) roof build up (361)", "mat-nmb-roof-buildup", 0.350, "finish"),
                           ("Lightweight roof structure (362)", "mat-nmb-roof-structure", 0.208, "structure"),
                           LB15, LB15, SK]),
    "profile-nmb-rf-02": ("NMB-RF-02 pitched roof, fall 1:5.5 to 10 degrees: CLT roof panel, BROOF(t4)",
                          [("BROOF (t4) roof build up (361)", "mat-nmb-roof-buildup", 0.350, "finish"),
                           ("CLT roof panel (363)", "mat-nmb-clt", 0.208, "structure"),
                           LB15, LB15, SK]),
}


def slab_svg(layers, colours):
    total = sum(t for _, _, t, _ in layers)
    y, rects = 0.0, []
    for name, mid, t, _ in layers:
        rects.append(f'  <!-- {name}: {y*1000:.0f}-{(y+t)*1000:.0f} mm from the top face -->\n'
                     f'  <rect x="0" y="{y:.3f}" width="1.000" height="{t:.3f}" fill="{colours[mid]}" '
                     f'stroke="#888" stroke-width="0.002"/>')
        y += t
    return (f'<?xml version="1.0" encoding="UTF-8"?>\n'
            f'<svg xmlns="http://www.w3.org/2000/svg"\n     viewBox="0 0 1.000 {total:.3f}"\n'
            f'     width="1000mm" height="{total*1000:.0f}mm">\n' + "\n".join(rects) + '\n</svg>\n')


# ---- region helpers ---------------------------------------------------------
def rect(mat, x0, x1, y0, y1):
    return {"material_id": mat, "vertices": [
        {"x": round(x0, 4), "y": round(y0, 4)}, {"x": round(x1, 4), "y": round(y0, 4)},
        {"x": round(x1, 4), "y": round(y1, 4)}, {"x": round(x0, 4), "y": round(y1, 4)}]}


def poly(mat, pts):
    return {"material_id": mat, "vertices": [{"x": round(x, 4), "y": round(y, 4)} for x, y in pts]}


def prect(mat, u0, u1, x0, x1):
    """Plan rectangle from an along-wall range and a wall-local x range (v = -x)."""
    return rect(mat, u0, u1, -x1, -x0)


FIN, SCB, UFH, ACO, CLTM, LIN = ("mat-nmb-floor-finish", "mat-nmb-screedboard", "mat-nmb-ufh-insulation",
                                 "mat-nmb-acoustic-matting", "mat-nmb-clt", "mat-nmb-wall-lining-board")
SCR, RC, MEM, INS = "mat-nmb-screed", "mat-nmb-concrete", "mat-nmb-waterproofing", "mat-nmb-ground-insulation"
GAP, FS, CBH, CBV, CBW = ("mat-nmb-gap-sealer", "mat-nmb-linear-firestop", "mat-nmb-cavity-barrier-horizontal",
                          "mat-nmb-cavity-barrier-vertical", "mat-nmb-cavity-barrier-window")
FFI, STB, FBD, COL = "mat-nmb-full-fill-insulation", "mat-nmb-steel-bracket", "mat-nmb-fire-board", "mat-nmb-glulam"


def fl01(xa, xb, y=0.0, mirror=False):
    """FL-01 floor build-up between wall-local x = xa and xb, top face at y."""
    s = -1 if mirror else 1
    out, top = [], y
    for mat, t in [(FIN, .020), (SCB, .020), (UFH, .035), (ACO, .008), (CLTM, .140), (LIN, .030)]:
        out.append(rect(mat, min(s * xa, s * xb), max(s * xa, s * xb), top - t, top))
        top -= t
    return out


def fl02(xa, xb, y=0.0, mirror=False):
    s = -1 if mirror else 1
    out, top = [], y
    for mat, t in [(FIN, .025), (SCR, .095), (RC, .250), (MEM, .003), (INS, .205)]:
        out.append(rect(mat, min(s * xa, s * xb), max(s * xa, s * xb), top - t, top))
        top -= t
    return out


def build_types(write, svg_write, colours, schema, profile_fn):
    for pid, (desc, layers, height) in WALL_TYPES.items():
        profile_fn(pid, desc, layers, height)
    for pid, (desc, layers) in SLAB_TYPES.items():
        total = round(sum(t for _, _, t, _ in layers), 6)
        write(f"profiles/{pid}.json", {
            "$schema": schema("profile"), "id": pid, "type": "Profile", "description": desc,
            "svg_file": f"profiles/{pid}.svg", "width": 1.0, "height": total,
            "origin": {"x": 0.5, "y": 0.0}, "alignment": "top-face", "profile_type": "slab",
            "assembly": [{"layer": i + 1, "name": n, "material_id": m, "thickness": t, "function": f}
                         for i, (n, m, t, f) in enumerate(layers)],
        })
        svg_write(f"profiles/{pid}.svg", slab_svg(layers, colours))


# ---- details ------------------------------------------------------------------
def member(role, kind, profile_id, x=0.0, y=0.0, rot=0, extent=None):
    m = {"role": role, "kind": kind, "profile_id": profile_id,
         "placement": {"offset_x_m": x, "offset_y_m": y, "rotation_deg": rot}}
    if extent:
        m["extent"] = extent
    return m


EW = "profile-nmb-ew-01-gf"
IW1, IW2, IW5 = "profile-nmb-iw-01-a", "profile-nmb-iw-02-a", "profile-nmb-iw-05-a"
COLP, FL1, FL2, RF1 = "profile-nmb-glulam-column", "profile-nmb-fl-01", "profile-nmb-fl-02", "profile-nmb-rf-01"

# roof: roof structure top face at y = 0 on a grid elevation datum
ROOF_BU, ROOF_ST = .350, .208

DETAILS = []


def detail(id_, title, pages, plane, members, regions, extrusion, datum=None, notes="", tags=()):
    datum = datum or {"kind": "storey", "reference": "elevation"}
    DETAILS.append({
        "$schema": None, "id": id_, "type": "Detail",
        "description": f"{title}. NMB Details v1.0 (2023), {pages}. {notes}".strip(),
        "members": members, "datum": datum, "plane": plane,
        "view_direction": "along_path" if plane == "plan" else "across_path",
        "geometry": {"extrusion_m": extrusion, "regions": regions},
        "tags": ["nmb"] + list(tags),
    })


# --- external wall ---------------------------------------------------------------------------
detail("detail-nmb-ew-slab-edge-section", "External wall NMB-EW-01 at a party floor edge, section",
       "pp. 28-29", "section",
       [member("through-wall", "wall", EW), member("floor", "slab", FL1, x=.293)],
       fl01(.293, .91) + [
           rect("mat-nmb-acoustic-strip", .283, .293, -.083, 0.0),
           rect(FS, .251, .283, -.207, -.070),
           rect(CBH, -.231, .094, -.170, -.084),
           rect(FFI, .107, .243, -.482, .070),
           rect(STB, .293, .457, -.083, -.077),
           rect(GAP, .268, .291, -.253, -.223)],
       1.0, notes="Datum is the finished floor level. Cavity barrier aligns with the floor compartment; linear firestop seals the "
                  "gap between the light steel frame and the CLT edge; full fill insulation (325) to the ceiling soffit.",
       tags=["slab-edge", "external-wall"])

detail("detail-nmb-ew-slab-edge-plan", "External wall NMB-EW-01 at an internal CLT wall, plan at the floor edge",
       "pp. 30-31", "plan",
       [member("through-wall", "wall", EW), member("internal-wall", "wall", IW1, y=-.291, rot=90, extent="backward")],
       [prect(CBV, -.046, .042, -.250, .094),
        prect(FFI, -.331, .349, .107, .246),
        prect(FS, -.042, .042, .258, .291),
        prect(GAP, -.113, -.098, .291, .306), prect(GAP, .098, .113, .291, .306)],
       0.3, notes="Vertical cavity barrier aligned with the internal compartmentation, full fill insulation between studs over the party wall.",
       tags=["slab-edge", "external-wall"])

COL_OFF = (.288, .584, .614)   # fire board face, column face, encapsulation face (wall-local x)
detail("detail-nmb-ew-column-section", "External wall NMB-EW-01 at a glulam column and party floor, section",
       "pp. 32-33", "section",
       [member("through-wall", "wall", EW), member("column", "column", COLP, x=.436), member("floor", "slab", FL1, x=.614)],
       [rect(COL, .288, .584, -.70, .50), rect(LIN, .584, .614, -.70, .50), rect(FBD, .258, .288, -.70, .50),
        rect(CBH, -.231, .094, -.170, -.084), rect(FFI, .107, .245, -.482, .070)] + fl01(.614, 1.05) + [
           rect("mat-nmb-acoustic-strip", .614, .624, -.083, 0.0)],
       1.0, notes="The column sits inside the light steel frame, encapsulated outside with fire board (346) and inside with "
                  "two layers of wall lining board (311). End-grain sealer to all column and slab edges (not drawn).",
       tags=["column", "external-wall"])

detail("detail-nmb-ew-column-plan", "External corner of NMB-EW-01 with a glulam column in the inside corner, plan",
       "pp. 34-35", "plan",
       [member("through-wall", "wall", EW), member("return-wall", "wall", EW, rot=-90, extent="forward"),
        member("column", "column", COLP, x=-.436, y=-.436)],
       [prect(COL, -.581, -.291, .291, .581),
        prect(LIN, -.611, -.581, .291, .611),           # lining on the free face (east)
        prect(LIN, -.611, -.291, .581, .611),           # lining on the free face (south)
        prect(FBD, -.581, -.291, .258, .291),
        prect(FFI, -.581, -.291, .107, .245)],
       3.0, notes="Exterior wall lining and external encapsulation define the line of the external wall; vapour barrier lapped and "
                  "taped to the internal face of the column.",
       tags=["column", "corner", "external-wall"])

detail("detail-nmb-ew-internal-corner-plan", "NMB-EW-01 internal corner with a glulam column, plan",
       "pp. 36-37", "plan",
       [member("through-wall", "wall", EW), member("return-wall", "wall", EW, rot=90, extent="forward"),
        member("column", "column", COLP, x=.436, y=-.436)],
       [prect(COL, .291, .581, .291, .581),
        prect(LIN, .581, .611, .291, .611), prect(LIN, .291, .581, .581, .611),
        prect(GAP, .286, .298, .289, .301), prect(GAP, .289, .301, .286, .298)],
       3.0, notes="Fire resistant gap sealer (312) at the plasterboard junctions; encapsulation to the column fitted before the internal lining.",
       tags=["column", "corner", "external-wall"])

detail("detail-nmb-ew-window-section", "Typical window in NMB-EW-01: sill above, head below a party floor, section",
       "pp. 38-39", "section",
       [member("through-wall", "wall", EW), member("floor", "slab", FL1, x=.293)],
       fl01(.293, .91) + [
           rect("mat-nmb-acoustic-strip", .283, .293, -.083, 0.0),
           rect(FS, .251, .283, -.207, -.070),
           rect(CBH, -.231, .094, -.170, -.084),
           rect(FFI, .107, .243, -.482, .070),
           rect(CBW, -.191, .104, .769, .843),          # cavity barrier under the upper window sill
           rect("mat-nmb-cavity-closer", .104, .281, .769, .843),
           rect(CBW, -.191, .104, -.405, -.325),        # cavity barrier over the lower window head
           rect(GAP, .268, .291, -.253, -.223),
           rect("mat-nmb-epdm", -.291, -.271, .843, .853)],
       1.0, notes="Datum is the finished floor level. Window cavity barriers (344) to the sill and head, coordinated with the "
                  "horizontal compartment cavity barrier (342). Membrane seal between frame and outer face before barrier installation.",
       tags=["window", "external-wall"])

detail("detail-nmb-ew-window-full-height-section", "Full height window in NMB-EW-01 at a party floor, section",
       "pp. 40-41", "section",
       [member("through-wall", "wall", EW), member("floor", "slab", FL1, x=.293)],
       fl01(.293, .91) + [
           rect(FS, .251, .283, -.207, -.070),
           rect(CBW, -.215, .086, -.094, -.014),
           rect(CBH, -.215, .086, -.185, -.104),
           rect(CBW, -.215, .086, -.447, -.367),
           rect(FFI, .107, .243, -.482, .070),
           rect("mat-nmb-cavity-closer", .086, .281, -.094, -.014),
           rect(GAP, .268, .291, -.253, -.223)],
       1.0, notes="The window cavity barrier is coordinated with the horizontal compartmentation cavity barrier and the cladding fixing system.",
       tags=["window", "external-wall"])

detail("detail-nmb-ew-window-plan", "Typical window jambs in NMB-EW-01 either side of an internal wall, plan",
       "pp. 42-43", "plan",
       [member("through-wall", "wall", EW), member("internal-wall", "wall", IW1, y=-.291, rot=90, extent="backward")],
       [prect(CBW, -.594, -.506, -.269, .062), prect(CBW, .510, .598, -.269, .062),
        prect(CBV, -.046, .042, -.269, .094),
        prect(FFI, -.331, .349, .107, .246),
        prect(FS, -.042, .042, .258, .291),
        prect("mat-nmb-epdm", -.510, -.506, -.291, -.200), prect("mat-nmb-epdm", .510, .514, -.291, -.200)],
       1.2, notes="60 minute rated cavity barriers to all window jambs; vertical cavity barrier aligned with the internal compartmentation.",
       tags=["window", "external-wall"])

# --- ground slab ---------------------------------------------------------------------------------
def ground_wall(core_w, lining_t, id_, title, pages, prof, notes):
    h = core_w / 2
    regs = [rect(COL if "column" in id_ else CLTM, -h, h, .030, 1.0),
            rect("mat-nmb-dpc", -(h + .10), h + .10, .020, .030),
            rect("mat-nmb-upstand-masonry", -h - .01, h + .01, -.120, .020)]
    for s in (-1, 1):
        a, b = sorted((s * h, s * (h + lining_t)))
        regs.append(rect(LIN, a, b, -.120, 1.0))
        a, b = sorted((s * (h + lining_t + .004), s * (h + lining_t + .014)))
        regs.append(rect("mat-nmb-acoustic-strip", a, b, -.120, .034))
        a, b = sorted((s * h, s * (h + .006)))
        regs.append(rect(STB, a, b, -.110, .084))
        a, b = sorted((s * h, s * (h + .14)))
        regs.append(rect(STB, a, b, -.116, -.110))
        regs += fl02(h + lining_t + .014, .60, mirror=(s < 0))
    detail(id_, title, pages, "section",
           [member("wall", "wall" if "column" not in id_ else "column", prof), member("slab", "slab", FL2)],
           regs, 1.0, notes=notes, tags=["ground-slab"])


ground_wall(.300, .066, "detail-nmb-gs-glulam-column-section", "Glulam column on the ground floor slab, section",
            "pp. 64-65", COLP,
            "Datum is the internal finished floor level. Timber base at or above FFL on a masonry upstand; DPC protrudes 100 mm beyond "
            "the timber; end-grain sealer to the column base; acoustic flanking strip and L-shaped slab connection brackets (324).")
ground_wall(.180, .066, "detail-nmb-gs-clt-wall-section", "Internal CLT wall on the ground floor slab, section",
            "pp. 66-67", IW1,
            "As the column junction, with a 180 mm CLT wall. CLT thickness varies with design.")

detail("detail-nmb-gs-external-wall-section", "NMB-EW-01 on the ground floor slab perimeter upstand, section",
       "pp. 68-69", "section",
       [member("through-wall", "wall", EW), member("slab", "slab", FL2, x=.30)],
       fl02(.30, .95) + [
           rect("mat-nmb-upstand-masonry", -.294, -.196, -.144, .144),
           rect("mat-nmb-closed-cell-insulation", -.196, .114, -.136, .144),
           rect("mat-nmb-dpm", .114, .118, -.136, .150),
           rect("mat-nmb-dpm", -.302, -.298, -.378, -.144),
           rect("mat-nmb-dpm", -.302, .95, -.378, -.373),
           rect(CBH, -.230, .100, .610, .674),
           poly("mat-nmb-cavity-tray", [(-.294, .144), (-.030, .144), (-.030, .150), (-.294, .150)]),
           poly("mat-nmb-cavity-tray", [(-.030, .144), (.110, .274), (.114, .274), (.110, .268), (-.026, .144)]),
           rect(FFI, .107, .257, .150, .270),
           rect(RC, -.294, .30, -.370, -.120), rect(RC, .114, .291, -.120, .144),
           rect(INS, -.294, .30, -.578, -.373)],
       1.0, notes="Datum is the finished floor level at external ground level. Upstand minimum 150 mm above ground; the facade is a "
                  "continuous non-load-bearing light steel frame supported from the slab above and seated on the upstand. "
                  "The DPM connects to the DPC at the top of the upstand. In the example the ground floor wall starts at the top of the upstand.",
       tags=["ground-slab", "external-wall"])

# --- internal structure ------------------------------------------------------------------------------
detail("detail-nmb-core-floor-plan", "Core wall NMB-IW-02-A junction with a CLT floor, plan at the floor",
       "pp. 56-57", "plan",
       [member("core-wall", "wall", IW2), member("floor", "slab", FL1, y=-.5)],
       [prect(GAP, -.131, -.121, -.253, -.238), prect(GAP, .121, .131, -.253, -.238),
        prect(STB, -.40, -.13, .0, .006), prect(STB, .13, .40, .0, .006),
        prect(STB, -.40, .40, .56, .566),
        prect("mat-nmb-acoustic-strip", -.131, -.121, -.253, -.200)],
       0.25, notes="Steel brackets (304) under the floor finish are over-boarded with K2-60 encapsulation; sockets recessed with REI 60 "
                   "back boxes. Fire resistant gap sealer at the plasterboard junctions. Plan region positions are indicative.",
       tags=["core", "floor"])

detail("detail-nmb-core-floor-section", "Core wall NMB-IW-01-A through a CLT floor, section",
       "pp. 58-59", "section",
       [member("core-wall", "wall", IW1), member("floor", "slab", FL1, x=.173)],
       fl01(.173, .90) + fl01(.173, .90, mirror=True) + [
           rect(STB, .090, .096, -.216, -.080), rect(STB, -.096, -.090, -.216, -.080),
           rect(STB, .096, .20, -.223, -.217), rect(STB, -.20, -.096, -.223, -.217),
           rect(GAP, .150, .173, -.080, -.055), rect(GAP, -.173, -.150, -.080, -.055),
           rect(GAP, .150, .173, -.280, -.253), rect(GAP, -.173, -.150, -.280, -.253),
           rect("mat-nmb-acoustic-strip", .173, .183, -.083, 0.0), rect("mat-nmb-acoustic-strip", -.183, -.173, -.083, 0.0)],
       1.0, notes="Floor soffit encapsulated with gypsum board to K2-60. Steel bracket (304) either fixed to the face of the CLT floor panel "
                  "and over-boarded, or routed into the panel and boarded. Acoustic flanking strip under the walls.",
       tags=["core", "floor"])

# --- roof ------------------------------------------------------------------------------------------------
RD = {"kind": "storey", "reference": "elevation"}


def roof_kit(xa, xb, mirror=False):
    s = -1 if mirror else 1
    a, b = sorted((s * xa, s * xb))
    return [rect("mat-nmb-roof-buildup", a, b, 0.0, ROOF_BU),
            rect("mat-nmb-vapour-barrier", a, b, -.004, 0.0),
            rect("mat-nmb-roof-structure", a, b, -ROOF_ST - .004, -.004),
            rect(LIN, a, b, -ROOF_ST - .034, -ROOF_ST - .004)]


detail("detail-nmb-roof-core-section", "Roof junction with a core wall rising through the roof, section",
       "pp. 74-75", "section",
       [member("core-wall", "wall", IW1), member("facade", "wall", EW, x=-.55), member("roof", "roof", RF1, x=.55)],
       roof_kit(-.12, -1.0) + [
           rect("mat-nmb-end-grain-sealer", -.123, -.113, -.35, 0.0),
           rect(CBH, -.40, -.20, .45, .52),
           rect("mat-nmb-cavity-tray", -.12, -.116, 0.0, .15),
           poly("mat-nmb-cavity-tray", [(-.20, .15), (-.12, .15), (-.12, .156), (-.20, .156)]),
           rect(GAP, -.153, -.138, -.268, -.238),
           rect("mat-nmb-roof-green", -.9, -.5, .35, .50), rect("mat-nmb-roof-gravel", -.5, -.2, .35, .45)],
       1.0, datum=RD,
       notes="Datum is the roof structure top face. Core walls continue above the roof as a parapet clad in the external wall system. "
             "Waterproofing is turned up 150 mm minimum behind the cladding; green roof and gravel upstand guard at the edge.",
       tags=["roof", "core"])

detail("detail-nmb-roof-parapet-section", "Parapet junction, NMB-EW-01 rising above a flat roof, section",
       "pp. 76-77", "section",
       [member("parapet-wall", "wall", EW), member("roof", "roof", RF1, x=.80)],
       roof_kit(.291, 1.2) + [
           rect("mat-nmb-coping", -.35, .30, .98, 1.01),
           rect("mat-nmb-dpc", -.30, .30, .975, .98),
           rect(CBH, -.231, -.090, .88, .96),
           rect("mat-nmb-cavity-tray", .291, .296, 0.0, .30),
           rect("mat-nmb-roof-green", .90, 1.2, .35, .50), rect("mat-nmb-roof-gravel", .40, .90, .35, .45),
           rect(GAP, .268, .291, -.253, -.223)],
       1.0, datum=RD,
       notes="Parapets must not be built from CLT or other timber components. Horizontal cavity barrier at the head, DPC under the coping, "
             "waterproofing turned up at least 300 mm.",
       tags=["roof", "parapet"])

detail("detail-nmb-roof-external-wall-section", "Roof or terrace meeting an external wall NMB-EW-01, section",
       "pp. 78-79", "section",
       [member("external-wall", "wall", EW), member("roof", "roof", RF1, x=-.80)],
       roof_kit(-.291, -1.2) + [
           rect(CBH, -.231, .094, .40, .48),
           poly("mat-nmb-cavity-tray", [(-.296, .0), (-.291, 0.0), (-.291, .35), (-.296, .35)]),
           rect("mat-nmb-roof-green", -1.2, -.60, .35, .50), rect("mat-nmb-roof-gravel", -.60, -.35, .35, .45),
           rect(FFI, .107, .245, -.35, .20),
           rect("mat-nmb-acoustic-strip", .291, .301, -.103, -.020)] + fl01(.301, .90, y=-.020),
       1.0, datum=RD,
       notes="Datum is the roof structure top face. Waterproofing returns up the wall behind a cavity tray to 150 mm minimum above the roof finish.",
       tags=["roof", "external-wall"])

detail("detail-nmb-roof-party-wall-section", "Roof junction with a party wall, section",
       "pp. 80-81", "section",
       [member("party-wall", "wall", IW1), member("roof", "roof", RF1, x=.80)],
       roof_kit(.173, 1.2) + roof_kit(-.173, -1.2) + [
           rect("mat-nmb-roof-sheeting", .173, .173 + 1.5, -.004, .014),
           rect("mat-nmb-roof-sheeting", -.173 - 1.5, -.173, -.004, .014),
           rect("mat-nmb-end-grain-sealer", -.090, .090, -.012, -.004)],
       1.0, datum=RD,
       notes="Where the building height exceeds 15 m, roof decking within 1.5 m of a separating wall is non-combustible (364). "
             "Not required for MultiMax-scale buildings under 11 m; included for completeness of the NMB details.",
       tags=["roof", "party-wall"])

# --- balcony -------------------------------------------------------------------------------------------------
detail("detail-nmb-balcony-connection-plan", "Typical balcony connection through NMB-EW-01, plan",
       "pp. 86-87", "plan",
       [member("through-wall", "wall", EW), member("floor", "slab", FL1, y=-.8)],
       [prect("mat-nmb-balcony-connection", u0, u0 + .09, .190, .300) for u0 in (-.60, -.20, .20, .60)] +
       [prect(GAP, -.60, .60, .291, .297), prect(FFI, -.70, .70, .107, .246),
        prect("mat-nmb-waterproofing", -.70, .70, .094, .097)],
       0.3, notes="Encapsulated steel balcony brackets (326) at the facade slab connections (324); liquid applied waterproofing sealant to fixings; "
                  "bracketry sealed to sheathing board and breather membrane; balcony thermally broken. Positions indicative.",
       tags=["balcony"])

detail("detail-nmb-balcony-connection-section", "Typical balcony connection through NMB-EW-01 at a party floor, section",
       "pp. 88-89", "section",
       [member("through-wall", "wall", EW), member("floor", "slab", FL1, x=.293)],
       fl01(.293, .90) + [
           rect("mat-nmb-glulam", .293, .50, -.55, -.223),
           rect("mat-nmb-thermal-break", .094, .107, -.22, -.08),
           rect("mat-nmb-balcony-connection", -.60, .107, -.178, -.158),
           rect("mat-nmb-balcony-frame", -.60, -.291, -.140, -.120),
           rect(CBH, -.231, .094, -.170, -.084), rect(CBH, -.231, .094, -.445, -.360),
           rect(FS, .251, .283, -.207, -.070),
           rect(FFI, .107, .243, -.600, .070),
           rect(GAP, .268, .291, -.253, -.223),
           rect("mat-nmb-waterproofing", -.60, -.291, -.120, -.116)],
       1.0, notes="Non-combustible balcony system with a thermally broken notched fin connection; internal brackets encapsulated to K2-60; "
                  "cavity fire barriers around the primary brackets coordinated with the compartmentation barriers; penetrations to waterproofing "
                  "taped with non-combustible product.",
       tags=["balcony"])

detail("detail-nmb-balcony-door-plan", "External balcony door threshold in NMB-EW-01, plan",
       "pp. 90-91", "plan",
       [member("through-wall", "wall", EW), member("floor", "slab", FL1, y=-.8)],
       [prect(CBW, -.55, -.47, -.270, .062), prect(CBW, .47, .55, -.270, .062),
        prect("mat-nmb-window-frame", -.47, .47, -.040, .040),
        prect("mat-nmb-epdm", -.47, -.465, -.291, -.100), prect("mat-nmb-epdm", .465, .47, -.291, -.100),
        prect("mat-nmb-balcony-connection", -.30, -.20, .190, .300), prect("mat-nmb-balcony-connection", .20, .30, .190, .300)],
       0.3, notes="Cavity barriers around the door coordinated with the primary bracket barriers for a continuous line of compartmentation. "
                  "Balcony bracketry coordinated with door openings and facade connectors.",
       tags=["balcony", "door"])

detail("detail-nmb-balcony-door-section", "External balcony door threshold in NMB-EW-01, section",
       "pp. 92-93", "section",
       [member("through-wall", "wall", EW), member("floor", "slab", FL1, x=.293)],
       fl01(.293, .90) + [
           rect("mat-nmb-glulam", .293, .50, -.55, -.223),
           rect("mat-nmb-balcony-connection", -.60, .107, -.178, -.158),
           rect("mat-nmb-balcony-frame", -.60, -.291, -.140, -.120),
           rect("mat-nmb-thermal-break", .094, .107, -.22, -.08),
           rect(CBH, -.231, .094, -.170, -.084), rect(CBW, -.231, .094, -.445, -.360),
           rect(FS, .251, .283, -.207, -.070),
           rect(FFI, .107, .243, -.600, .070),
           rect("mat-nmb-epdm", -.291, -.271, .02, .04),
           rect("mat-nmb-window-frame", -.05, .05, .02, 2.12),
           rect(GAP, .268, .291, -.253, -.223)],
       1.0, notes="Balcony bracketry must not obstruct waterproofing to the door threshold. Cavity fire barriers to doors coordinated with those "
                  "to primary brackets.",
       tags=["balcony", "door"])

# --- penetrations ----------------------------------------------------------------------------------------------
detail("detail-nmb-penetration-party-wall-section", "Service penetration through a party wall below a CLT floor, section",
       "pp. 98-99", "section",
       [member("party-wall", "wall", IW1), member("floor", "slab", FL1, x=.173)],
       fl01(.173, .90) + fl01(.173, .90, mirror=True) + [
           rect("mat-nmb-pipe", -.90, .90, -.388, -.332),
           rect("mat-nmb-firestop-wrap", -.123, .123, -.352, -.332), rect("mat-nmb-firestop-wrap", -.123, .123, -.388, -.368),
           rect(GAP, -.153, -.123, -.340, -.320), rect(GAP, .123, .153, -.340, -.320),
           rect("mat-nmb-end-grain-sealer", -.090, .090, -.332, -.326),
           rect("mat-nmb-acoustic-strip", .173, .183, -.083, 0.0), rect("mat-nmb-acoustic-strip", -.183, -.173, -.083, 0.0)],
       1.0, notes="Pipe material to be identified for each penetration. Fire stopping suited to size and material of the pipe (314), achieving "
                  "60 minutes REI to the manufacturer's requirements; mineral wool in voids; end-grain sealer to openings in mass timber.",
       tags=["penetration"])

detail("detail-nmb-penetration-shaft-section", "Penetration to a shaft: CLT wall IW-05-A with a floor, and riser partition IP-03-A, section",
       "pp. 100-101", "section",
       [member("shaft-wall", "wall", IW5), member("floor", "slab", FL1, x=-.17)],
       fl01(.17, .90, mirror=True) + [
           rect("mat-nmb-shaft-lining-board", .170, .185, -.223, -.080),
           rect(GAP, -.185, -.170, -.080, -.060), rect(GAP, -.185, -.170, -.260, -.240),
           rect("mat-nmb-end-grain-sealer", .165, .170, -.223, -.083)],
       1.0, notes="Non-loadbearing shaft wall linings designed to suit compartmentation requirements (320); shaft lining board continued to "
                  "encapsulate the slab edge; soffit encapsulated to K2-60. IP-03-A riser partition shown separately as a profile.",
       tags=["penetration", "shaft"])

detail("detail-nmb-penetration-internal-slab-plan", "Service penetration through internal walls and slab, plan",
       "pp. 102-103", "plan",
       [member("wall", "wall", "profile-nmb-iw-03-a"), member("return-wall", "wall", "profile-nmb-iw-03-a", rot=90, extent="forward")],
       [prect("mat-nmb-pipe", .33, .39, -.03, .03),
        prect("mat-nmb-firestop-collar", .30, .42, -.06, .06),
        prect("mat-nmb-ablative-batt", .25, .47, .06, .12),
        prect("mat-nmb-end-grain-sealer", .24, .25, -.20, .20)],
       0.25, notes="K2-60 encapsulation boxes in services so all mass timber elements and openings are fully encapsulated; intumescent fire stop "
                   "collar (315) fixed to the manufacturer's requirements; mineral wool in voids. Positions indicative.",
       tags=["penetration"])

detail("detail-nmb-penetration-internal-slab-section", "Service penetration through internal walls and slab, section",
       "pp. 104-105", "section",
       [member("wall", "wall", IW1), member("floor", "slab", FL1, x=.173)],
       fl01(.173, .90) + [
           rect("mat-nmb-pipe", .40, .46, -.50, .10),
           rect("mat-nmb-firestop-collar", .39, .47, -.253, -.223),
           rect("mat-nmb-end-grain-sealer", .385, .39, -.223, -.083),
           rect("mat-nmb-ablative-batt", .385, .47, -.223, -.083),
           rect(GAP, .47, .49, -.253, -.223)],
       1.0, notes="Intumescent fire stop collar (315) to the slab soffit; end-grain sealer and mineral wool to the opening.",
       tags=["penetration"])

detail("detail-nmb-penetration-facade-fire-collar-section", "Service penetration through NMB-EW-01 with a proprietary fire collar, section",
       "pp. 108-109", "section",
       [member("through-wall", "wall", EW), member("penetration", "other", "profile-nmb-iw-05-a", x=0.0, rot=90)],
       [rect("mat-nmb-pipe", -.291, .291, -.125, .125),
        rect("mat-nmb-firestop-collar", .258, .291, -.150, -.125), rect("mat-nmb-firestop-collar", .258, .291, .125, .150),
        rect(FFI, .107, .257, -.275, -.125), rect(FFI, .107, .257, .125, .275),
        rect("mat-nmb-ablative-batt", .107, .257, .150, .250),
        rect(GAP, .258, .291, -.158, -.150)],
       1.0, datum={"kind": "storey", "reference": "elevation"},
       notes="Opening framed using sheathing board, full fill mineral wool to the light steel frame around the penetration (325), proprietary "
             "intumescent fire collars (315) fixed through the tabs, AVCL sealed to the penetration; maximum opening 250 mm. "
             "Datum y = 0 is the pipe centre line. A free area, air brick or termination duct is provided externally.",
       tags=["penetration", "facade"])

detail("detail-nmb-penetration-facade-cavity-closed-section", "Service penetration through NMB-EW-01 with the cavity closed locally, section",
       "pp. 108-109", "section",
       [member("through-wall", "wall", EW), member("penetration", "other", "profile-nmb-iw-05-a", x=0.0, rot=90)],
       [rect("mat-nmb-pipe", -.291, .291, -.150, .150),
        rect(CBW, -.231, .094, .150, .250), rect(CBW, -.231, .094, -.250, -.150),
        rect(FFI, .107, .257, -.275, -.150), rect(FFI, .107, .257, .150, .275),
        rect(GAP, .258, .291, -.158, -.150)],
       1.0, notes="Cavity barriers rated for 60 minutes (REI 60) around the penetration if fire rated ducts and collars are not installed (343); "
                  "maximum opening 300 mm; voids between internal lining and the penetration sealed with intumescent gap sealer (312).",
       tags=["penetration", "facade"])

detail("detail-nmb-penetration-facade-fire-duct-section", "Service penetration through NMB-EW-01 with a fire rated duct, section",
       "pp. 106-107", "section",
       [member("through-wall", "wall", EW), member("penetration", "other", "profile-nmb-iw-05-a", x=0.0, rot=90)],
       [rect("mat-nmb-fire-rated-duct", -.291, .291, -.150, .150),
        rect("mat-nmb-firestop-wrap", -.291, .258, .150, .200), rect("mat-nmb-firestop-wrap", -.291, .258, -.200, -.150),
        rect(GAP, .258, .291, -.158, -.150)],
       1.0, notes="Fire rated duct (316) constructed from, or encapsulated with, fire rated ductwork insulation; opening in the light steel frame "
                  "framed using sheathing board.",
       tags=["penetration", "facade"])

detail("detail-nmb-penetration-roof-svp-section", "Soil vent pipe through the roof, section",
       "pp. 110-111", "section",
       [member("roof", "roof", RF1), member("pipe-wall", "wall", "profile-nmb-ip-03-a")],
       [rect("mat-nmb-pipe", -.085, .085, -.60, .60),
        rect("mat-nmb-waterproofing", .085, .090, 0.0, .30), rect("mat-nmb-waterproofing", -.090, -.085, 0.0, .30),
        rect("mat-nmb-roof-buildup", .090, 1.2, 0.0, ROOF_BU), rect("mat-nmb-roof-buildup", -1.2, -.090, 0.0, ROOF_BU),
        rect("mat-nmb-roof-structure", .090, 1.2, -ROOF_ST - .004, -.004), rect("mat-nmb-roof-structure", -1.2, -.090, -ROOF_ST - .004, -.004),
        rect(FFI, .090, .20, -ROOF_ST, 0.0), rect(FFI, -.20, -.090, -ROOF_ST, 0.0),
        rect("mat-nmb-firestop-collar", .090, .13, -ROOF_ST - .034, -ROOF_ST - .004),
        rect("mat-nmb-firestop-collar", -.13, -.090, -ROOF_ST - .034, -ROOF_ST - .004),
        rect(GAP, .090, .105, -ROOF_ST - .034, -ROOF_ST - .004), rect(GAP, -.105, -.090, -ROOF_ST - .034, -ROOF_ST - .004)],
       1.0, datum=RD,
       notes="Service sealed and taped to the structural deck during construction; waterproofing lapped at least 150 mm above the roof finish with an "
             "apron flashing bonded to the pipe; full fill mineral wool and intumescent collar at the soffit; maximum internal diameter 160 mm.",
       tags=["penetration", "roof"])

detail("detail-nmb-penetration-roof-rwp-section", "Rainwater outlet through the roof, section",
       "pp. 112-113", "section",
       [member("roof", "roof", RF1), member("pipe-wall", "wall", "profile-nmb-ip-03-a")],
       [rect("mat-nmb-pipe", -.040, .040, -.60, .0),
        rect("mat-nmb-waterproofing", -.10, .10, 0.0, .004),
        rect("mat-nmb-roof-buildup", .10, 1.2, 0.0, ROOF_BU), rect("mat-nmb-roof-buildup", -1.2, -.10, 0.0, ROOF_BU),
        rect("mat-nmb-roof-structure", .10, 1.2, -ROOF_ST - .004, -.004), rect("mat-nmb-roof-structure", -1.2, -.10, -ROOF_ST - .004, -.004),
        rect(FFI, .040, .15, -ROOF_ST, 0.0), rect(FFI, -.15, -.040, -ROOF_ST, 0.0),
        rect("mat-nmb-firestop-collar", .040, .090, -ROOF_ST - .034, -ROOF_ST - .004),
        rect("mat-nmb-firestop-collar", -.090, -.040, -ROOF_ST - .034, -ROOF_ST - .004),
        rect("mat-nmb-roof-gravel", .30, .50, .35, .45), rect("mat-nmb-roof-gravel", -.50, -.30, .35, .45),
        rect(GAP, .040, .055, -ROOF_ST - .034, -ROOF_ST - .004), rect(GAP, -.055, -.040, -ROOF_ST - .034, -ROOF_ST - .004)],
       1.0, datum=RD,
       notes="Roof outlet spigot with gravel guard; vapour control layer turned back over insulation; voids within the roof construction around the "
             "service filled with mineral wool; maximum internal diameter 160 mm.",
       tags=["penetration", "roof"])


# Advisory condition: derived from the detail's own members (the validator requires them to agree).


def build_details(write, schema):
    ids = []
    for d in DETAILS:
        d = dict(d)
        d["$schema"] = schema("detail")
        kinds = [m["kind"] for m in d["members"]]
        d["condition"] = {"rule": "butt", "member_count": len(kinds), "member_kinds": kinds}
        ordered = {k: d[k] for k in ("$schema", "id", "type", "description", "condition", "members", "datum", "plane",
                                     "view_direction", "geometry", "tags")}
        write(f"details/{d['id']}.json", ordered)
        ids.append(d["id"])
    return ids
