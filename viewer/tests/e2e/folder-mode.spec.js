/**
 * Folder (File System Access) mode, driven end to end. The browser's folder picker is a native dialog that
 * automation cannot click, so `showDirectoryPicker` is replaced with one that returns a directory in the origin
 * private file system. That is a real FileSystemDirectoryHandle with the same API, so the editor's FsaAdapter,
 * its reads, its writes (JSON and raw SVG) and its Save run unchanged.
 *
 * The edited folder is copied out, and checked with `oebf validate` (needs uv; skipped when it is missing).
 */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SOURCE = path.join(ROOT, 'example/terraced-house.oebf');

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(full, base) : [{ path: path.relative(base, full), text: fs.readFileSync(full, 'utf8') }];
  });
}

function hasUv() {
  try { execFileSync('uv', ['--version'], { stdio: 'pipe' }); return true; } catch { return false; }
}

test('a bundle opened from a folder is edited, saved in place and still validates', async ({ page }) => {
  test.setTimeout(120_000);
  const answers = [];
  page.on('dialog', async (d) => {
    if (d.type() === 'prompt') await d.accept(answers.length ? answers.shift() : d.defaultValue());
    else await d.accept();
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('bundle');
  });
  await page.goto('editor.html');
  await page.waitForFunction(() => window.__editor);

  // seed the origin-private folder with the example bundle
  await page.evaluate(async (files) => {
    const root = await navigator.storage.getDirectory();
    try { await root.removeEntry('bundle', { recursive: true }); } catch { /* none yet */ }
    const base = await root.getDirectoryHandle('bundle', { create: true });
    for (const f of files) {
      let dir = base;
      const parts = f.path.split('/');
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
      const w = await (await dir.getFileHandle(parts.at(-1), { create: true })).createWritable();
      await w.write(f.text);
      await w.close();
    }
  }, listFiles(SOURCE));

  // open it through the editor's own "Open .oebf folder" menu item
  await page.locator('#welcome-overlay').evaluate((el) => el.classList.add('hidden'));
  await page.locator('#open-btn').click();
  await page.getByText('Open .oebf folder (Chrome/Edge)').click();
  await page.waitForFunction(() => window.__editor.adapter() && !document.getElementById('save-btn').disabled, null, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__editor.adapter().constructor.name)).toBe('FsaAdapter');
  expect(await page.evaluate(() => window.__editor.status())).not.toMatch(/error/i);

  // edits that write through the folder: a storey, a material, a grid axis
  answers.push('First floor', '3000');
  await page.locator('#add-storey-btn').click();
  await page.waitForTimeout(300);
  await page.locator('#add-material-btn').click();
  await page.locator('#material-name').fill('Folder test material');
  await page.locator('#material-properties').fill('nmb_item: 999');
  await page.locator('#material-ok').click();
  answers.push('y', '4500', 'Z');
  await page.locator('#add-grid-btn').click();
  await page.waitForTimeout(500);
  await page.locator('#save-btn').click();
  await page.waitForTimeout(1500);

  // read the folder back
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'folder-mode-'));
  const written = await page.evaluate(async () => {
    const walk = async (dir, prefix = '') => {
      const out = [];
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === 'directory') out.push(...await walk(handle, `${prefix}${name}/`));
        else out.push({ path: `${prefix}${name}`, text: await (await handle.getFile()).text() });
      }
      return out;
    };
    return walk(await (await navigator.storage.getDirectory()).getDirectoryHandle('bundle'));
  });
  for (const f of written) {
    fs.mkdirSync(path.dirname(path.join(out, f.path)), { recursive: true });
    fs.writeFileSync(path.join(out, f.path), f.text);
  }
  const rel = (p) => JSON.parse(fs.readFileSync(path.join(out, p), 'utf8'));

  const lib = rel('materials/library.json');
  expect(lib.materials.find((m) => m.name === 'Folder test material')).toMatchObject({ properties: { nmb_item: '999' } });
  const gridFile = written.map((f) => f.path).find((p) => p.startsWith('grids/'));
  expect(rel(gridFile).axes.map((a) => a.id)).toContain('Z');
  expect(JSON.stringify(rel('model.json'))).toContain('storey-first-floor');
  expect(errors).toEqual([]);

  test.skip(!hasUv(), 'uv is not installed, so the saved folder was not validated');
  let result = '';
  try {
    result = execFileSync('uv', ['run', '--project', path.join(ROOT, 'ifc-tools'), 'oebf', 'validate', out], { encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    result = `${err.stdout ?? ''}${err.stderr ?? ''}`;
  }
  expect(result).toMatch(/No problems found/);
});
