/**
 * profileGuidelines.js — Session-only guide lines for the profile editor.
 * State is module-level. Not persisted.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
let _guides = [];
let _counter = 0;

export function addGuide(axis, value) {
  const id = `guide-${++_counter}`;
  _guides.push({ id, axis, value });
  return id;
}

export function removeGuide(id) {
  _guides = _guides.filter(g => g.id !== id);
}

export function getGuides() { return [..._guides]; }

export function clearGuides() { _guides = []; }

export function renderGuidelines(svgEl, guides) {
  [...svgEl.querySelectorAll('[data-guide-id]')].forEach(el => el.remove());
  const vb = svgEl.viewBox.baseVal;
  const width  = vb.width  || 0.3;
  const height = vb.height || 2.7;

  for (const g of guides) {
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('data-guide-id', g.id);
    line.setAttribute('stroke', '#4488ff');
    line.setAttribute('stroke-width', '0.002');
    line.setAttribute('stroke-dasharray', '0.015 0.01');
    line.style.cursor = g.axis === 'h' ? 'ns-resize' : 'ew-resize';
    if (g.axis === 'h') {
      const y = String(Math.round(g.value * 1e6) / 1e6);
      line.setAttribute('x1', '0'); line.setAttribute('y1', y);
      line.setAttribute('x2', String(width)); line.setAttribute('y2', y);
    } else {
      const x = String(Math.round(g.value * 1e6) / 1e6);
      line.setAttribute('x1', x); line.setAttribute('y1', '0');
      line.setAttribute('x2', x); line.setAttribute('y2', String(height));
    }
    svgEl.appendChild(line);
  }
}

export function setupGuideDrag(svgEl, onUpdate, onRemove) {
  let draggingId = null;
  let draggingAxis = null;

  svgEl.addEventListener('mousedown', e => {
    const id = e.target.dataset.guideId;
    if (!id) return;
    const guide = _guides.find(g => g.id === id);
    if (!guide) return;
    draggingId = id; draggingAxis = guide.axis;
    e.preventDefault();
  });

  window.addEventListener('mousemove', e => {
    if (!draggingId) return;
    const ctm = svgEl.getScreenCTM();
    if (!ctm) return;
    const pt = svgEl.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const svgPt = pt.matrixTransform(ctm.inverse());
    const vb = svgEl.viewBox.baseVal;
    let newValue, offEdge;
    if (draggingAxis === 'h') {
      newValue = Math.round(svgPt.y * 1e4) / 1e4;
      offEdge  = svgPt.y < 0 || svgPt.y > vb.height;
    } else {
      newValue = Math.round(svgPt.x * 1e4) / 1e4;
      offEdge  = svgPt.x < 0 || svgPt.x > vb.width;
    }
    if (offEdge) {
      const id = draggingId; draggingId = null;
      removeGuide(id); onRemove(id);
    } else {
      const g = _guides.find(g => g.id === draggingId);
      if (g) g.value = newValue;
      onUpdate(draggingId, newValue);
    }
  });

  window.addEventListener('mouseup', () => { draggingId = null; });
}
