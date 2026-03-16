# OEBF Project — Claude Instructions

## Build & Version

- **Build command:** `cd viewer && npm run build`
- **Patch version auto-increment:** A `prebuild` npm script runs `npm version patch --no-git-tag-version` before every production build. This bumps the third number in `viewer/package.json` (e.g. `0.2.1` → `0.2.2`) automatically — no manual version editing required.
- **Version display:** The version is injected at build time via Vite's `define` (`__APP_VERSION__`) and shown in the scene tree footer of the editor.
- **Do not** manually edit the `version` field in `viewer/package.json` unless changing the major or minor number intentionally.

## Tests

- Run from `viewer/`: `npm test`
- All tests must pass before committing. Update the test count in `docs/project-status.md` after any test changes.

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

### Current phase (Phase 8 — editor polish)

Open issues for the current phase, in rough priority order:

| # | Title |
|---|---|
| #69 | Bug: 3D rendering quality — lighting, z-fighting, gradient artefacts |
| #71 | Feature: Materials section in editor scene tree |
| #72 | Feature: Profile editor — FFL line spans full canvas width |
| #73 | Feature: Profile editor — resizable buildup pane |
| #74 | Feature: Profile editor — outlines on drawn shapes |
| #75 | Feature: Profile editor — ruler and dimension input while drawing |
| #76 | Feature: Profile editor — material picker (library + project + create new) |
| #77 | Feature: Profile editor — region layer extrusion depth and repeat |

Issues #70 (version number) and #66 (profile editor features) are complete — close them after confirming.

### Backlog / future phases

| # | Title |
|---|---|
| #67 | Research and plan AI integration |
| #58 | V0.3: IFC importer/exporter in editor UI |
| #18 | CSG fallback for spline-path junctions |
| #10 | Tauri v2 desktop wrapper |
| #45 | Project/marketing website |
| #44 | Surface IFC tools on homepage |

### Review checklist

At the end of every significant piece of work, run through this:

- [ ] All tests pass (`cd viewer && npm test`)
- [ ] `docs/project-status.md` is up to date (date, test count, phase status)
- [ ] Completed issues are closed on GitHub
- [ ] Any new bugs or follow-on features discovered have been filed as issues
- [ ] The issue table in this file is updated if the phase has changed
