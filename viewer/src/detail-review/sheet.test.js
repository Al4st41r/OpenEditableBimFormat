import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildSheet, smallestPaper, drawingArea, wrapText, printHtml, sheetFileName, PAPERS } from './sheet.js';
import { buildAxoModel } from '../detail-axo/detailAxo.js';
import { buildDetailSvg } from './detailSvg.js';

const root = new URL('../../../example/nmb-two-storey.oebf/', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
function drawing(scale = 5) {
  const detail = read('details/detail-nmb-ew-slab-edge-section.json');
  const materials = new Map(read('materials/library.json').materials.map((m) => [m.id, m]));
  const profiles = new Map(detail.members.map((m) => [m.profile_id, read(`profiles/${m.profile_id}.json`)]));
  return buildDetailSvg(buildAxoModel(detail, { profiles }), { materials, profiles, scale });
}
const meta = { title: 'detail-x', description: 'A description of the detail', project: 'NMB', date: '2026-11-09' };

describe('paper', () => {
  it('has landscape sizes, each bigger than the last', () => {
    const areas = Object.keys(PAPERS).map((p) => drawingArea(p));
    areas.forEach((a, i) => { if (i) expect(a.width).toBeGreaterThan(areas[i - 1].width); });
  });
  it('picks the smallest paper that fits, or null', () => {
    expect(smallestPaper(100, 100)).toBe('A4');
    expect(smallestPaper(300, 200)).toBe('A3');
    expect(smallestPaper(5000, 5000)).toBeNull();
  });
});

describe('wrapText', () => {
  it('wraps at spaces and cuts with an ellipsis past the line limit', () => {
    expect(wrapText('aaa bbb ccc', 7, 5)).toEqual(['aaa bbb', 'ccc']);
    const cut = wrapText('one two three four five six', 8, 2);
    expect(cut).toHaveLength(2);
    expect(cut[1].endsWith('…')).toBe(true);
    expect(wrapText(undefined, 10, 2)).toEqual([]);
  });
});

describe('buildSheet', () => {
  it('makes a sheet at paper size with the drawing nested at 1 unit = 1 mm and the title block text', () => {
    const d = drawing();
    const s = buildSheet(d, meta);
    expect(s.svg).toContain(`width="${s.width}mm" height="${s.height}mm"`);
    expect(s.svg).toContain(`width="${Math.round(d.width * 1000) / 1000}" height="${Math.round(d.height * 1000) / 1000}"`);
    expect(s.svg).toContain('detail-x');
    expect(s.svg).toContain('1:5 at ' + s.paper);
    expect(s.svg.match(/<svg /g)).toHaveLength(2);   // sheet plus the nested drawing
  });
  it('centres the drawing inside the frame', () => {
    const d = drawing();
    const s = buildSheet(d, { ...meta, paper: 'A2' });
    const x = Number(/<svg x="([\d.]+)"/.exec(s.svg)[1]);
    const a = drawingArea('A2');
    expect(x).toBeCloseTo(8 + 6 + (a.width - d.width) / 2, 2);
  });
  it('escapes text', () => {
    const s = buildSheet(drawing(), { ...meta, title: 'a<b>&"c', description: '<script>' });
    expect(s.svg).not.toContain('<script>');
    expect(s.svg).toContain('a&lt;b&gt;&amp;&quot;c');
  });
  it('refuses an empty drawing, an unknown paper and a drawing too big for the paper', () => {
    expect(() => buildSheet({ svg: '' }, meta)).toThrow(/no drawing/);
    expect(() => buildSheet(drawing(), { ...meta, paper: 'B5' })).toThrow(/Unknown paper/);
    expect(() => buildSheet({ ...drawing(), width: 400, height: 100 }, { ...meta, paper: 'A4' })).toThrow(/does not fit on A4/);
    expect(() => buildSheet({ ...drawing(), width: 9000, height: 100 }, meta)).toThrow(/does not fit on A1/);
  });
});

describe('print page and file name', () => {
  it('sets the page size to the sheet', () => {
    const html = printHtml({ svg: '<svg/>', width: 297, height: 210 }, 'T <1>');
    expect(html).toContain('@page{size:297mm 210mm;margin:0}');
    expect(html).toContain('T &lt;1&gt;');
  });
  it('names the file from the id and scale', () => {
    expect(sheetFileName('detail-nmb ew/slab', 5, 'svg')).toBe('detail-nmb-ew-slab-1to5.svg');
  });
});

describe('overlay key and embedded font', () => {
  const legend = { title: 'Fire strategy', rows: [{ colour: '#cc0000', label: 'Firestop', count: 2 }, { colour: null, label: 'No data', count: 1 }], noData: 1 };

  it('draws the key with a swatch per row, counts above one, and the no-data note', () => {
    const s = buildSheet(drawing(), { ...meta, legend });
    expect(s.svg).toContain('KEY');
    expect(s.svg).toContain('Fire strategy');
    expect(s.svg).toContain('Firestop (2)');
    expect(s.svg).toContain('stroke-dasharray="0.8 0.6"');
    expect(s.svg).toContain('1 solid(s) have no data');
  });
  it('reserves room for the key, so the drawing is narrower than the no-key area', () => {
    expect(drawingArea('A3', { legend: true }).width).toBeLessThan(drawingArea('A3').width);
    const tight = { ...drawing(), width: drawingArea('A3').width - 1, height: 100 };
    expect(buildSheet(tight, meta).paper).toBe('A3');
    expect(buildSheet(tight, { ...meta, legend }).paper).toBe('A2');
  });
  it('summarises rows past the limit, and escapes labels', () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ colour: '#123456', label: i === 0 ? '<b>' : `row ${i}` }));
    const s = buildSheet(drawing(), { ...meta, legend: { title: 't', rows } });
    expect(s.svg).toContain('and 7 more');
    expect(s.svg).toContain('&lt;b&gt;');
    expect(s.svg).not.toContain('<b>');
  });
  it('embeds font rules, and omits the style block without them', () => {
    expect(buildSheet(drawing(), { ...meta, fontCss: "@font-face{font-family:'Barlow'}" }).svg).toContain("<defs><style>@font-face{font-family:'Barlow'}</style></defs>");
    expect(buildSheet(drawing(), meta).svg).not.toContain('@font-face');
  });
});
