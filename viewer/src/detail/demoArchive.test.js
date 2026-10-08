/**
 * The viewer's demo button loads public/terraced-house.oebfz, a packed copy of
 * the example bundle. It must stay in step with example/terraced-house.oebf or
 * the demo silently shows an older model. Re-pack with:
 *   cd ifc-tools && uv run --with zstandard python ../tools/pack_oebfz.py \
 *     ../example/terraced-house.oebf ../viewer/public/terraced-house.oebfz
 */
import { describe, test, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBundleZstd } from '../loader/loadBundleZstd.js';
import { assertValidGeometry } from './fixtures.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const archive = () => new File([fs.readFileSync(path.join(ROOT, 'viewer/public/terraced-house.oebfz'))], 'terraced-house.oebfz');

describe('demo archive (public/terraced-house.oebfz)', () => {
  test('loads without warnings and includes the junction details', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await loadBundleZstd(archive());
    expect(r.details.map((d) => d.id)).toEqual(['detail-corner-cavity-butt']);
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
