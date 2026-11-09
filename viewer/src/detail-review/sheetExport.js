/**
 * sheetExport.js
 *
 * Detail -> sheet, shared by the review page and the detail editor: build the 2D drawing, put it on a sheet with a
 * title block and the embedded Barlow font, and hand it to the browser as an SVG download or a print to PDF.
 */

import { buildAxoModel } from '../detail-axo/detailAxo.js';
import { buildDetailSvg } from './detailSvg.js';
import { buildSheet, printHtml, sheetFileName } from './sheet.js';

/**
 * Barlow as @font-face rules with the font files inline, so an exported sheet looks the same on any machine. Cached.
 * A missing font gives '' (the sheet still exports, in a fallback face).
 */
let fontCssPromise = null;
export function embeddedFontCss(baseUrl) {
  fontCssPromise ??= Promise.all([[400, 'Barlow-Regular'], [700, 'Barlow-Bold']].map(async ([weight, file]) => {
    const res = await fetch(`${baseUrl}fonts/${file}.woff2`);
    if (!res.ok) throw new Error(`font ${file}: ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `@font-face{font-family:'Barlow';font-weight:${weight};src:url(data:font/woff2;base64,${btoa(bin)}) format('woff2')}`;
  })).then((rules) => rules.join('')).catch(() => { fontCssPromise = null; return ''; });
  return fontCssPromise;
}

/**
 * @param {{ detail: object, profiles: Map|object, materials: Map|object, scale?: number, hairline?: boolean, paper?: string,
 *           project?: string, legend?: object|null, fills?: Map|null, fontCss?: string, model?: object }} o
 *   model: a prepared axo model for the detail (the review page already has one); built when omitted
 * @returns {{ sheet: object, name: string, scale: number }}
 */
export function buildDetailSheet(o) {
  const model = o.model ?? buildAxoModel(o.detail, { profiles: o.profiles });
  const drawing = buildDetailSvg(model, { materials: o.materials, profiles: o.profiles, scale: o.scale, hairline: o.hairline, fills: o.fills ?? undefined });
  if (!drawing.svg) throw new Error('There is nothing to draw: the detail has no solids.');
  return {
    sheet: buildSheet(drawing, {
      legend: o.legend ?? null, fontCss: o.fontCss, paper: o.paper || undefined,
      title: o.detail.id, description: o.detail.description, project: o.project ?? '',
      date: new Date().toISOString().slice(0, 10),
    }),
    name: o.detail.id, scale: drawing.scale,
  };
}

/** Save the sheet as an SVG file, or print it at real size for "Save as PDF". Browser only. @returns {string} what happened */
export function deliverSheet({ sheet, name, scale }, kind) {
  if (kind === 'svg') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([sheet.svg], { type: 'image/svg+xml' }));
    a.download = sheetFileName(name, scale, 'svg');
    a.click();
    URL.revokeObjectURL(a.href);
    return `Saved ${sheet.paper} sheet as SVG.`;
  }
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
  frame.srcdoc = printHtml(sheet, sheetFileName(name, scale, 'pdf').replace(/\.pdf$/, ''));
  frame.onload = () => { frame.contentWindow.focus(); frame.contentWindow.print(); setTimeout(() => frame.remove(), 60000); };
  document.body.appendChild(frame);
  return `Printing ${sheet.paper} sheet: choose "Save as PDF" as the printer.`;
}
