/**
 * viewTransform.js
 *
 * Detail space (metres, y up) <-> viewport pixels (y down), with zoom and pan.
 * A view is { cx, cy, scale }: the detail-space point at the viewport centre,
 * and pixels per metre. Plain data; every function returns a new view.
 */

const MIN_SCALE = 1;
const MAX_SCALE = 1e6;
const FALLBACK_SCALE = 100;

export function fitView(viewBox, size) {
  const ok = viewBox.width > 0 && viewBox.height > 0 && size.width > 0 && size.height > 0;
  return {
    cx: viewBox.x + viewBox.width / 2,
    cy: viewBox.y + viewBox.height / 2,
    scale: ok ? Math.min(size.width / viewBox.width, size.height / viewBox.height) : FALLBACK_SCALE,
  };
}

export const toScreen = (view, size, p) => ({
  x: size.width / 2 + (p.x - view.cx) * view.scale,
  y: size.height / 2 - (p.y - view.cy) * view.scale,
});

export const toDetail = (view, size, px) => ({
  x: view.cx + (px.x - size.width / 2) / view.scale,
  y: view.cy + (size.height / 2 - px.y) / view.scale,
});

/** Zoom by `factor` keeping the detail-space point under `px` where it is. */
export function zoomAt(view, size, px, factor) {
  const p = toDetail(view, size, px);
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
  return {
    scale,
    cx: p.x - (px.x - size.width / 2) / scale,
    cy: p.y - (size.height / 2 - px.y) / scale,
  };
}

/** Move the content with the pointer by (dx, dy) pixels. */
export const panByPixels = (view, dx, dy) => ({ ...view, cx: view.cx - dx / view.scale, cy: view.cy + dy / view.scale });

export const viewBoxAttr = (size) => `0 0 ${size.width} ${size.height}`;
