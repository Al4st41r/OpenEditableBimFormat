# Branch Concept Lite Review and Proposal

**Date:** 2026-11-06
**Status:** Proposal. No code changed.
**Related:** `docs/plans/2026-11-06-lineweights.md`, issue #81

---

## 1. Method and limits

The review of https://concept.branch3d.com/ used the HTTP headers, the HTML and the minified JS and CSS bundles. A screenshot of the welcome dialogue was taken. The 3D model view could not be captured: headless Chromium with software WebGL crashed on this machine while the model was generated, in two attempts. Findings about the 3D view are therefore from the bundle only. No source map is published.

## 2. Findings

| Area | Finding |
|---|---|
| UI | React 18, Vite, Tailwind, Radix primitives, Inter font |
| 3D | three.js r171 through `@react-three/fiber`; WebGL only; `Line2`/`LineMaterial`, `EffectComposer`, SSAO |
| State | zustand |
| Analysis | Plain JavaScript; no WebAssembly solver or workers found. Timber panel tables hold thickness, plies, stiffness and strength |
| Services | Cloudflare hosting, Sentry, Amplitude (opt-in cookies), a Cloudflare Worker link shortener. No account and no backend database |
| Onboarding | A three-step dialogue: building type, structural system, material, then "Generate my model" |
| Export | No IFC or DXF found |

## 3. Comparison with OEBF

| Topic | Branch Concept Lite | OEBF today |
|---|---|---|
| Lines in 3D | `Line2` fat lines (constant width) | `LineDashedMaterial` for grid axes and guides (`gridOverlayManager.js`, `guideManager.js`); width is fixed at 1 px by WebGL |
| Starting a model | Preset wizard, then edit | Blank bundle |
| Quantities and carbon | Live, from the model | None |
| Material data | Structural tables in the app | `properties` is an untyped object in `materials.schema.json` |
| Persistence | Local, no account | Bundle on disk |

## 4. Proposal

Three independent items, in priority order.

### 4.1 Fat lines for guides and grid axes

Replace `LineDashedMaterial` with `Line2` and `LineMaterial` (three.js examples) in the grid and guide managers. `LineMaterial` takes a width in pixels and supports dashes, so the pink and blue dashed styles are kept and become visible at any zoom.

- Scope: two managers plus a small shared helper, `viewer/src/editor/fatLine.js`.
- Risk: `LineMaterial` needs the renderer resolution on resize, and its raycasting differs from `THREE.Line`. Check the snap and pick code.
- Tests: Vitest for the helper; check existing guide and grid tests.
- Link to the lineweight plan: the same helper can later take a weight from the `pen_mm` series.

### 4.2 Quantities and carbon (new issue)

Add a read-only quantities panel: volume, area and mass per material, summed from profiles, paths and arrays. A carbon figure needs a factor per material. Propose optional `properties.density_kg_m3` and `properties.embodied_carbon_kgco2e_m3` on materials, documented in the guide, before any UI.

- Open question: which factor source and which life-cycle stages. Branch cites the IStructE SCORS scheme; OEBF should state its own basis rather than copy theirs.
- Depends on: #61 (material library browser) for the data source.

### 4.3 Starter models (new issue)

Offer a small set of preset bundles (for example a terraced house, a framed pavilion) from the editor home page, in place of a blank start. The example bundle already exists and can seed the first one. This is low effort and no schema change.

### Not recommended

- Moving the editor to React or `@react-three/fiber`. The editor is tool-driven and imperative; the migration cost is high and nothing found depends on it.
- Adding an analytics service. Branch uses Sentry and Amplitude behind a consent dialogue; OEBF has no need.

## 5. Next steps

1. Agree 4.1 and file an issue; implement behind the existing tests.
2. File issues for 4.2 and 4.3.
3. Retry the model-view inspection on a machine with a GPU if the line rendering needs closer comparison.
