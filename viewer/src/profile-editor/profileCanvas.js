/**
 * profileCanvas.js
 *
 * Manages the live SVG canvas in the profile editor.
 * Renders layer bands and a draggable origin marker.
 *
 * Fires CustomEvents on the svgEl:
 *   'layer-selected'  — detail: { index: number }
 *   'origin-moved'    — detail: { originX: number }
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const WALL_HEIGHT = 2.7; // metres — fixed for v0.1

/**
 * Initialise the canvas on an <svg> element.
 *
 * @param {SVGElement} svgEl
 */
export function initCanvas(svgEl) {
  svgEl.setAttribute('xmlns', SVG_NS);
  svgEl.style.width  = '100%';
  svgEl.style.height = '100%';
  _setupOriginDrag(svgEl);
}

/**
 * Render layers and origin marker into svgEl.
 *
 * @param {SVGElement} svgEl
 * @param {Array<{ name, material_id, thickness, function }>} layers
 * @param {number} originX  — metres from left face
 * @param {object} matMap   — id → { colour_hex }
 * @param {number|null} selectedIndex
 */
export function renderCanvas(svgEl, layers, originX, matMap, selectedIndex = null) {
  // Clear previous content
  while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);

  const totalWidth = layers.reduce((s, l) => s + l.thickness, 0) || 0.1;
  svgEl.setAttribute('viewBox', `0 0 ${totalWidth} ${WALL_HEIGHT}`);

  let cursor = 0;
  layers.forEach((layer, i) => {
    const colour = matMap[layer.material_id]?.colour_hex ?? '#888888';
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x',      String(Math.round(cursor * 1e6) / 1e6));
    rect.setAttribute('y',      '0');
    rect.setAttribute('width',  String(Math.round(layer.thickness * 1e6) / 1e6));
    rect.setAttribute('height', String(WALL_HEIGHT));
    rect.setAttribute('fill',   colour);
    rect.setAttribute('stroke', i === selectedIndex ? '#0080ff' : '#888');
    rect.setAttribute('stroke-width', '0.002');
    rect.style.cursor = 'pointer';
    rect.addEventListener('click', () => {
      svgEl.dispatchEvent(new CustomEvent('layer-selected', { detail: { index: i } }));
    });
    svgEl.appendChild(rect);
    cursor += layer.thickness;
    cursor = Math.round(cursor * 1e6) / 1e6; // prevent float drift
  });

  // Origin marker
  const clampedX = Math.max(0, Math.min(originX, totalWidth));
  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', String(clampedX));
  line.setAttribute('y1', '-0.020');
  line.setAttribute('x2', String(clampedX));
  line.setAttribute('y2', String(WALL_HEIGHT + 0.020));
  line.setAttribute('stroke', 'red');
  line.setAttribute('stroke-width', '0.002');
  svgEl.appendChild(line);

  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('cx',   String(clampedX));
  circle.setAttribute('cy',   '0');
  circle.setAttribute('r',    '0.005');
  circle.setAttribute('fill', 'red');
  circle.setAttribute('data-origin-marker', 'true');
  circle.style.cursor = 'ew-resize';
  svgEl.appendChild(circle);
}

/** Wire up drag behaviour for the origin marker circle. */
function _setupOriginDrag(svgEl) {
  let dragging = false;

  svgEl.addEventListener('mousedown', e => {
    if (e.target.dataset.originMarker === 'true') dragging = true;
  });

  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const pt = svgEl.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgPt = pt.matrixTransform(svgEl.getScreenCTM().inverse());
    const vb = svgEl.viewBox.baseVal;
    const newX = Math.max(0, Math.min(svgPt.x, vb.width));
    svgEl.dispatchEvent(new CustomEvent('origin-moved', {
      detail: { originX: Math.round(newX * 1e4) / 1e4 },
    }));
  });

  window.addEventListener('mouseup', () => { dragging = false; });
}
