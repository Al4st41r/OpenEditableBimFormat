# Decision: Material Library Approach — Project-Level Only for v0.1, Optional Standard Library for v0.2

**Date:** 2026-03-02
**Status:** Accepted
**Resolves:** Design doc open question #11 — [GitHub issue #12](https://github.com/Al4st41r/OpenEditableBimFormat/issues/12)

---

## Context

Every OEBF project defines its materials in `materials/library.json`. Common materials (concrete, brick, timber) must currently be re-defined or copy-pasted between projects. Three approaches were considered:

- **Option A — Project-level only:** Each project is self-contained. Simple, no external dependencies, but common materials must be re-authored for every project.
- **Option B — Shared standard library:** A built-in `standard-materials.json` ships with the OEBF tools. Projects reference materials by well-known IDs (e.g., `oebf-std:mat-concrete-c30`). Projects can override standard properties locally. Requires managing library versioning.
- **Option C — External library references:** Projects reference external material libraries by URL or file path. Supports organisation-wide libraries. Most flexible but most complex to resolve and least compatible with the self-contained, LLM-editable bundle goal.

---

## Decision

### v0.1 — Project-level only (Option A)

All materials are defined in `materials/library.json` within the project bundle. No external references. No standard library.

This preserves the core OEBF principle that a bundle is fully self-contained: an LLM or tool can read and edit the model without resolving external dependencies. It also avoids introducing versioning complexity before the format itself is stable.

### v0.2 — Optional standard library (Option B, opt-in)

A curated `oebf-standard-materials.json` will ship alongside the `oebf` CLI. Projects that wish to use it opt in by adding a `material_library` field to `manifest.json`:

```json
{
  "material_library": "oebf-standard-v1"
}
```

When this field is present, the CLI and viewer resolve `oebf-std:` prefixed material IDs against the bundled standard library. Projects may override any standard material by re-declaring it in their local `materials/library.json` — local declarations always take precedence.

The standard library will cover the most common construction materials: concrete grades, brick types, timber species, plaster, insulation, glazing, and steel. The initial set is guided by the materials already used in the example bundle (`terraced-house.oebf`).

Option C (external URL/path references) is deferred indefinitely. It conflicts with the self-contained bundle goal and would require a resolver mechanism that adds complexity for all users, not just those with organisation-wide libraries. If organisation-wide libraries are needed, the recommended approach in v0.2 is for organisations to maintain their own fork of `oebf-standard-materials.json` distributed alongside their internal `oebf` CLI build.

---

## Acceptance Criteria

### v0.1

1. `materials/library.json` is the sole source of material data for a project bundle.
2. All material IDs referenced in profiles (`assembly[].material_id`) resolve within `materials/library.json`.
3. The JSON Schema (`materials.schema.json`) validates the library file and rejects any `oebf-std:` prefixed IDs (not valid in v0.1 — reserved for v0.2).
4. The example bundle (`terraced-house.oebf`) defines all required materials locally and validates against the schema.

### v0.2

1. The `oebf` CLI ships with `oebf-standard-materials.json` covering at minimum: 5 concrete grades, 4 brick types, 3 timber species, PIR and mineral wool insulation, gypsum plaster, float glass, structural steel (S275, S355), and general mortar.
2. Projects declare opt-in via `"material_library": "oebf-standard-v1"` in `manifest.json`.
3. The schema for v0.2 permits `oebf-std:` prefixed material IDs when `material_library` is declared.
4. Local declarations in `materials/library.json` override standard library entries with the same ID.
5. The CLI reports a warning (not an error) if a project references an `oebf-std:` ID without declaring `material_library` in the manifest.

---

## Rationale

### Why project-level only for v0.1

The format is not yet stable. Shipping a standard material library before the schema and tooling are settled would create pressure to maintain backwards compatibility on the library before the format itself has been validated against real use. It is easier to add a standard library in v0.2 than to remove or version-break it after projects have adopted it.

The self-contained bundle principle is also a first-class design goal. A bundle should be editable by an LLM or a user with no tools installed other than a text editor — no network access, no external resolver. Project-level materials satisfy this fully. Standard library resolution, when added, will be an optional convenience layer, not a required dependency.

### Why Option B before Option C

Option C (external URL/path references) is the most general solution but requires a resolver — a component that fetches, caches, and validates external content at edit and render time. This adds complexity for every user, not just those with multi-project organisations. Option B achieves 80% of the consistency benefit (common materials available without re-authoring) with none of the resolver complexity, because the standard library is bundled with the CLI, not fetched at runtime.

### Why `oebf-std:` as the namespace prefix

The `oebf-std:` prefix is unambiguous and cannot conflict with project-defined IDs (which use plain slugs such as `mat-brick-common`). It signals to both humans and LLMs that the material is not defined locally. The prefix is reserved in the v0.1 schema so that documents written now will not inadvertently use IDs that will collide with the v0.2 standard library.

---

## Impact on Existing Files

### `spec/schema/materials.schema.json`

Add a pattern constraint to material `id` fields to disallow the `oebf-std:` prefix (reserved for v0.2):

```json
"id": {
  "type": "string",
  "pattern": "^(?!oebf-std:)mat-[a-z0-9-]+$",
  "description": "Unique slug ID for this material. Must start with 'mat-'. The 'oebf-std:' prefix is reserved for the v0.2 standard library."
}
```

### `spec/schema/manifest.schema.json`

Add `material_library` as an optional field (permitted but not required in v0.1; value must be a string):

```json
"material_library": {
  "type": "string",
  "description": "Optional. Reference to a named standard material library distributed with the oebf tools. Reserved for v0.2. Leave absent in v0.1 projects."
}
```

These schema changes are backwards-compatible: existing v0.1 projects omit `material_library` and use plain `mat-` IDs, which continue to validate without modification.

---

*End of decision document.*
