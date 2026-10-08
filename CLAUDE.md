# OEBF Project — Claude Instructions

## Build & Version

- **Build command:** `cd viewer && npm run build`
- **Patch version auto-increment:** A `prebuild` npm script runs `npm version patch --no-git-tag-version` before every production build. This bumps the third number in `viewer/package.json` (e.g. `0.2.1` → `0.2.2`) automatically — no manual version editing required.
- **Version display:** The version is injected at build time via Vite's `define` (`__APP_VERSION__`) and shown in the scene tree footer of the editor.
- **Do not** manually edit the `version` field in `viewer/package.json` unless changing the major or minor number intentionally.

## Tests

- Run from `viewer/`: `npm test`; run from `ifc-tools/`: `uv run pytest`
- Scope-conformance suites: `viewer/src/scope-conformance.test.js` and `ifc-tools/tests/test_scope_conformance.py`. Known gaps are marked `test.fails` / `xfail(strict=True)`; remove the marker when the linked issue is fixed.
- All tests must pass before committing. Update the test count in `docs/project-status.md` after any test changes.

## Schemas

- `spec/schema/` is the source of truth. After editing a schema run `node scripts/sync-schemas.mjs` to update the example bundle copy; CI fails if they differ (`--check`).

## Deployment

- Deployed at `architools.drawingtable.net/oebf/`
- Built output goes to `viewer/dist/`

## GitHub Issues

- **Remote:** `git@github.com-personal:Al4st41r/OpenEditableBimFormat.git`
- **View open issues:** `gh issue list --limit 50 --state open`
- **Create an issue:** `gh issue create --title "..." --body "..."`

### Issue discipline

After completing any feature, bug fix, or review session:

1. **Close resolved issues** — if work directly addresses an open issue, close it: `gh issue close <number> --comment "Fixed in <commit>."`
2. **Open new issues** for anything discovered during the work that is not already tracked — bugs found, follow-on features, tech debt.
3. **Keep issues and the development phase in sync** — the open issue list should reflect exactly what is planned or known for the current and next phase. If an issue is complete but still open, close it. If a planned item has no issue, create one.

### Current phase (Phase 8 — editor polish and spec conformance)

Open issues, in rough priority order:

| # | Title |
|---|---|
| #91 | Bug: Changing wall profile in properties panel causes wall to disappear |
| #96 | Problems with profile manager and detail tagging |
| #95 | Feature: Add material panel should display existing library below the create form |
| #100 | Unify library profile/material format with the spec schemas |
| #97 | Feature: bezier and spline path segments |
| #98 | Feature: honour sweep_mode, caps and offsets |

Phase 8 issues #69–#77 and #70/#66 are closed.

### Backlog / future phases

| # | Title |
|---|---|
| #101 | Spec items not yet delivered (commands.json, ifc/mapping.json, migrations) |
| #83 | Object properties panel — full entity field display and inline editing |
| #82 | Snapping tools — grid, endpoint, angle, midpoint |
| #81 | Junction detail system — reusable details by level and grid (plan: docs/plans/2026-10-08-junction-detail-system.md) |
| #10 | Desktop wrapper: Tauri v2 and file watching |

### Review checklist

At the end of every significant piece of work, run through this:

- [ ] All tests pass (`cd viewer && npm test`)
- [ ] `docs/project-status.md` is up to date (date, test count, phase status)
- [ ] Completed issues are closed on GitHub
- [ ] Any new bugs or follow-on features discovered have been filed as issues
- [ ] The issue table in this file is updated if the phase has changed
