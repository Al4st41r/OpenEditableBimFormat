# NMB two-storey example generator

Builds `example/nmb-two-storey.oebf` from the New Model Building Details v1.0 (Waugh Thistleton Architects, 2023).

Run from the repository root (standard library only):

```
python3 scripts/nmb-example/gen_nmb.py .
cd ifc-tools && uv run oebf validate ../example/nmb-two-storey.oebf
```

- `gen_nmb.py` writes the model: grid, walls, upstands, columns, slabs, openings and junctions. It deletes and recreates the bundle folder.
- `nmb_details.py` holds the extra materials, the wall, floor and roof types, and the 31 details traced from the drawings.

The plan is in `docs/plans/2026-10-20-nmb-detail-coverage.md`.
