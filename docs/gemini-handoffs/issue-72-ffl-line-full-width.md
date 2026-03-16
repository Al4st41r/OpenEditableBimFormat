# Gemini Handoff — Issue #72: FFL line spans full canvas width

## Task summary

A one-line fix in `viewer/src/profile-editor/profileCanvas.js`. The FFL (Finished Floor Level) reference line currently ends at `totalWidth` (the sum of layer thicknesses). It should span the full SVG viewport width so it reads clearly as a horizontal datum regardless of profile width.

## Repo

`/home/pi/WebApps/OpenEditableBimFormat`

## File to modify

`viewer/src/profile-editor/profileCanvas.js`

## Exact change required

In the `renderCanvas` function, find this block (around line 105):

```js
if (ffl > 0) {
  const yFfl = Math.round((WALL_HEIGHT - ffl) * 1e6) / 1e6;
  const fflLine = document.createElementNS(SVG_NS, 'line');
  fflLine.setAttribute('x1', '0'); fflLine.setAttribute('y1', String(yFfl));
  fflLine.setAttribute('x2', String(totalWidth)); fflLine.setAttribute('y2', String(yFfl));
```

Change `String(totalWidth)` to `String(totalWidth * 100)` — wait, that's wrong. The viewBox is `0 0 totalWidth WALL_HEIGHT` in metres. The line should span the full viewBox width. But the requirement is that it spans the full **canvas window**, not just the profile width.

The SVG `viewBox` is set to `0 0 ${totalWidth} ${WALL_HEIGHT}`. To make the line extend visually beyond the profile to the canvas edges, the `x2` needs to be larger than `totalWidth`. However, since the SVG scales to fit, anything beyond the viewBox will be clipped.

The correct approach: set `overflow="visible"` on the SVG and extend the line well beyond the viewBox, OR (simpler) just use a very large `x2` value that exceeds any realistic `totalWidth`.

**Recommended fix** — use a large fixed `x2` value so the line always extends to the canvas edge regardless of profile width:

```js
fflLine.setAttribute('x2', String(totalWidth * 10)); fflLine.setAttribute('y2', String(yFfl));
```

And add `svgEl.setAttribute('overflow', 'visible');` in `initCanvas`.

Actually, the **simplest correct fix**: the SVG already has `style="width:100%;height:100%"` and the viewBox is in metres. Just extend `x2` to `totalWidth * 10` — this will render well beyond any realistic wall width and the SVG `overflow:visible` default will show it.

**Bottom line — make this change:**

```js
// Before:
fflLine.setAttribute('x2', String(totalWidth)); fflLine.setAttribute('y2', String(yFfl));

// After:
fflLine.setAttribute('x2', String(totalWidth * 10)); fflLine.setAttribute('y2', String(yFfl));
```

Also add the same change for the `hlimit` line (a few lines below), for consistency:

```js
// Before:
limitLine.setAttribute('x2', String(totalWidth)); limitLine.setAttribute('y2', String(yLimit));

// After:
limitLine.setAttribute('x2', String(totalWidth * 10)); limitLine.setAttribute('y2', String(yLimit));
```

## Context: how the SVG canvas works

- The `<svg>` element has `style="width:100%;height:100%"` set in `initCanvas`
- `viewBox` is set to `0 0 ${totalWidth} ${WALL_HEIGHT}` where `WALL_HEIGHT = 2.7` (metres) and `totalWidth` is the sum of layer thicknesses (e.g. 0.29 for a cavity wall)
- All coordinates in the SVG are in metres
- `preserveAspectRatio` is not explicitly set, so SVG defaults apply
- The FFL line and height-limit line use SVG coordinates, so `x2 = totalWidth * 10` means the line extends 10× the profile width to the right — always visually off-screen

## Test

No automated tests cover SVG rendering. Verify manually:
1. Open the profile editor at `architools.drawingtable.net/oebf/profile-editor.html`
2. Load or create a profile with an FFL set
3. The green dashed FFL line should now extend to the right edge of the canvas, not stop at the profile's right face

## Run tests (regression check)

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npm test -- --run
```

All 403 tests should pass (no unit tests cover this rendering code).

## Build

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npm run build
```

## Commit

```bash
cd /home/pi/WebApps/OpenEditableBimFormat
git add viewer/src/profile-editor/profileCanvas.js
git commit -m "fix: FFL and height-limit lines span full canvas width (#72)"
```

## GitHub issue

Close issue #72 after committing:

```bash
gh issue close 72 --comment "FFL and height-limit lines now use x2 = totalWidth * 10, extending well beyond the profile to the canvas edge."
```
