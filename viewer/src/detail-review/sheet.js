/**
 * sheet.js
 *
 * Puts a 2D detail drawing (detailSvg.js) on a sheet of paper with a border and a title block, for SVG export and
 * for printing to PDF. All sizes are millimetres on the sheet. The drawing keeps its own scale: 1 unit of its
 * viewBox is 1 mm on paper, so a printed 100 mm scale bar measures 100 mm at the stated scale.
 */

export const PAPERS = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594] };   // landscape, width by height
export const PAPER_NAMES = Object.keys(PAPERS);

const BORDER = 8;       // margin outside the frame
const FRAME_PAD = 6;    // space inside the frame around the drawing
const TITLE_H = 24;     // title block height

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (n) => String(Math.round(n * 1000) / 1000);

/** Space left for the drawing on a paper size, in mm. */
export function drawingArea(paper) {
  const [w, h] = PAPERS[paper];
  return { width: w - 2 * (BORDER + FRAME_PAD), height: h - 2 * (BORDER + FRAME_PAD) - TITLE_H };
}

/** The smallest listed paper the drawing fits on, or null when it fits none. */
export function smallestPaper(width, height) {
  return PAPER_NAMES.find((p) => { const a = drawingArea(p); return width <= a.width && height <= a.height; }) ?? null;
}

/** Break text into lines of about `max` characters at spaces, at most `lines` lines (the last is cut with an ellipsis). */
export function wrapText(text, max, lines) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const out = [];
  let line = '';
  for (const w of words) {
    if (line && (line + ' ' + w).length > max) { out.push(line); line = w; } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  if (out.length > lines) { out.length = lines; out[lines - 1] = `${out[lines - 1].slice(0, Math.max(0, max - 1))}…`; }
  return out;
}

/**
 * @param {{ svg: string, width: number, height: number, scale: number }} drawing - buildDetailSvg() result
 * @param {{ paper?: string, title: string, description?: string, project?: string, date?: string, note?: string }} meta
 *   paper: 'A4' | 'A3' | 'A2' | 'A1', or omitted for the smallest that fits
 * @returns {{ svg: string, paper: string, width: number, height: number }} the sheet; width and height in mm
 * @throws {Error} when there is no drawing, or the drawing does not fit the paper asked for
 */
export function buildSheet(drawing, meta) {
  if (!drawing?.svg) throw new Error('There is no drawing to export.');
  const paper = meta.paper ?? smallestPaper(drawing.width, drawing.height);
  if (!paper) throw new Error(`The drawing (${Math.round(drawing.width)} x ${Math.round(drawing.height)} mm) does not fit on A1. Choose a smaller scale.`);
  if (!PAPERS[paper]) throw new Error(`Unknown paper size "${paper}".`);
  const area = drawingArea(paper);
  if (drawing.width > area.width || drawing.height > area.height) {
    throw new Error(`The drawing (${Math.round(drawing.width)} x ${Math.round(drawing.height)} mm) does not fit on ${paper}. Choose a larger paper or a smaller scale.`);
  }
  const [W, H] = PAPERS[paper];
  const fx = BORDER, fy = BORDER, fw = W - 2 * BORDER, fh = H - 2 * BORDER;
  const areaTop = fy + FRAME_PAD;
  const dx = fx + FRAME_PAD + (area.width - drawing.width) / 2;
  const dy = areaTop + (area.height - drawing.height) / 2;
  const ty = fy + fh - TITLE_H;
  const font = 'font-family="Barlow, Arial, sans-serif"';

  // the drawing's own <svg> element nests as it is; its viewBox maps 1 unit to 1 mm
  const nested = drawing.svg.replace('<svg xmlns="http://www.w3.org/2000/svg"', `<svg x="${num(dx)}" y="${num(dy)}" width="${num(drawing.width)}" height="${num(drawing.height)}"`);
  const colX = [fx + 4, fx + fw * 0.42, fx + fw * 0.72, fx + fw * 0.86];
  const desc = wrapText(meta.description, Math.floor((fw * 0.42 - 8) / 1.25), 3);
  const cell = (x, label, value, size = 4) =>
    `<text x="${num(x)}" y="${num(ty + 5)}" font-size="2.2" fill="#666" ${font}>${esc(label)}</text>` +
    `<text x="${num(x)}" y="${num(ty + 5 + size + 2)}" font-size="${size}" fill="#000" ${font}>${esc(value)}</text>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" data-paper="${paper}">` +
    `<rect width="${W}" height="${H}" fill="#fff"/>` +
    `<rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" fill="none" stroke="#000" stroke-width="0.5"/>` +
    nested +
    `<line x1="${fx}" y1="${ty}" x2="${fx + fw}" y2="${ty}" stroke="#000" stroke-width="0.35"/>` +
    [colX[1], colX[2], colX[3]].map((x) => `<line x1="${num(x - 3)}" y1="${ty}" x2="${num(x - 3)}" y2="${fy + fh}" stroke="#000" stroke-width="0.18"/>`).join('') +
    cell(colX[0], 'DETAIL', meta.title, 4.2) +
    desc.map((l, i) => `<text x="${num(colX[0])}" y="${num(ty + 14 + i * 3.1)}" font-size="2.3" fill="#333" ${font}>${esc(l)}</text>`).join('') +
    cell(colX[1], 'PROJECT', meta.project || '-', 3.4) +
    (meta.note ? `<text x="${num(colX[1])}" y="${num(ty + 17)}" font-size="2.4" fill="#333" ${font}>${esc(meta.note)}</text>` : '') +
    cell(colX[2], 'SCALE', `1:${num(drawing.scale)} at ${paper}`, 4.2) +
    cell(colX[3], 'DATE', meta.date || '', 3.4) +
    `<text x="${fx + fw - 2}" y="${fy + fh - 2}" text-anchor="end" font-size="1.8" fill="#888" ${font}>Open Editable BIM Format</text>` +
    `</svg>`;
  return { svg, paper, width: W, height: H };
}

/**
 * A page that prints the sheet at its real size, for "Save as PDF" in the browser's print dialog.
 * @returns {string} HTML text
 */
export function printHtml(sheet, title) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title>` +
    `<style>@page{size:${sheet.width}mm ${sheet.height}mm;margin:0}html,body{margin:0;padding:0;background:#fff}` +
    `svg{display:block;width:${sheet.width}mm;height:${sheet.height}mm}</style></head><body>${sheet.svg}</body></html>`;
}

/** A file name for the export: the detail id, the scale and the extension. */
export const sheetFileName = (detailId, scale, ext) => `${String(detailId).replace(/[^a-z0-9-]+/gi, '-')}-1to${num(scale)}.${ext}`;
