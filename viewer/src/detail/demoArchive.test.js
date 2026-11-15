/**
 * The viewer's demo button loads public/terraced-house.oebfz, a packed copy of
 * the example bundle. It must stay in step with example/terraced-house.oebf or
 * the demo silently shows an older model. Re-pack both demo archives with:
 *   cd ifc-tools && uv run oebf pack ../example/terraced-house.oebf ../viewer/public/terraced-house.oebfz
 *   cd ifc-tools && uv run oebf pack ../example/nmb-two-storey.oebf ../viewer/public/nmb-two-storey.oebfz
 * The last describe block compares every file of each archive with its source bundle, so any drift fails here (#209).
 */
import { describe, test, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBundleZstd, readArchiveFiles } from '../loader/loadBundleZstd.js';
import { assertValidGeometry } from './fixtures.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const archive = () => new File([fs.readFileSync(path.join(ROOT, 'viewer/public/terraced-house.oebfz'))], 'terraced-house.oebfz');

describe('demo archive (public/terraced-house.oebfz)', () => {
  test('loads without warnings and includes the junction details', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await loadBundleZstd(archive());
    expect(r.details.map((d) => d.id)).toEqual(['detail-corner-cavity-butt', 'detail-wall-cavity-section']);
    const placed = r.junctions.filter((j) => j.detailGeometry);
    expect(placed).toHaveLength(4);
    for (const j of placed) expect(assertValidGeometry(j.detailGeometry), j.id).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test('matches the example bundle: same junction and detail ids and parameter overrides', async () => {
    const r = await loadBundleZstd(archive());
    const model = JSON.parse(fs.readFileSync(path.join(ROOT, 'example/terraced-house.oebf/model.json'), 'utf8'));
    expect(r.junctions.map((j) => j.id).sort()).toEqual([...model.junctions].sort());
    const se = r.junctions.find((j) => j.id === 'junction-se-corner');
    expect(se.detail_overrides).toEqual({ cavity_closer_width_m: 0.075 });
  });

  test('the archived detail is identical to the example detail', async () => {
    const r = await loadBundleZstd(archive());
    const example = JSON.parse(fs.readFileSync(path.join(ROOT, 'example/terraced-house.oebf/details/detail-corner-cavity-butt.json'), 'utf8'));
    expect(r.details[0]).toEqual(example);
  });
});

/** Every file under a folder, as a Map of relative path -> text. No file is exempt: the archive is a plain pack of the folder. */
function readFolder(dir, rel = '', out = new Map()) {
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) readFolder(dir, p, out);
    else out.set(p, fs.readFileSync(path.join(dir, p), 'utf8'));
  }
  return out;
}

describe.each(['terraced-house', 'nmb-two-storey'])('demo archive %s against its source bundle', (name) => {
  const files = readArchiveFiles(new Uint8Array(fs.readFileSync(path.join(ROOT, `viewer/public/${name}.oebfz`))));
  const source = readFolder(path.join(ROOT, `example/${name}.oebf`));

  test('holds exactly the files of the source bundle', () => {
    expect([...files.keys()].sort()).toEqual([...source.keys()].sort());
  });

  test('every file (guide, details, profiles, materials, junctions, elements, paths, schemas) is identical', () => {
    const drifted = [...source].filter(([p, text]) => files.get(p) !== text).map(([p]) => p);
    expect(drifted, `re-pack public/${name}.oebfz from example/${name}.oebf`).toEqual([]);
  });

  test('the guide carries the layer_ends note', () => {
    expect(files.get('OEBF-GUIDE.md')).toContain('layer_ends');
  });
});
