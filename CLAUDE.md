# OEBF Project — Claude Instructions

## Build & Version

- **Build command:** `cd viewer && npm run build`
- **Patch version auto-increment:** A `prebuild` npm script runs `npm version patch --no-git-tag-version` before every production build. This bumps the third number in `viewer/package.json` (e.g. `0.2.1` → `0.2.2`) automatically — no manual version editing required.
- **Version display:** The version is injected at build time via Vite's `define` (`__APP_VERSION__`) and shown in the scene tree footer of the editor.
- **Do not** manually edit the `version` field in `viewer/package.json` unless changing the major or minor number intentionally.

## Tests

- Run from `viewer/`: `npm test`
- 399 JS tests (Vitest, 34 files) + 21 Python tests (pytest in `ifc-tools/`)
- All tests must pass before committing

## Deployment

- Deployed at `architools.drawingtable.net/oebf/`
- Built output goes to `viewer/dist/`
