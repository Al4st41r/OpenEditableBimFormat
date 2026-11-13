import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// #193: in memory (the demo, or a browser without the File System Access API) Save downloads <name>.oebfz,
// a Zstd-compressed tar, and that file opens again.
test('Save on the demo downloads a .oebfz that opens again', async ({ page }) => {
  // the headless build may offer the pickers; take them away so that the plain download path is the one tested
  await page.addInitScript(() => { delete window.showSaveFilePicker; delete window.showDirectoryPicker; });
  await page.goto('editor.html?demo=1');
  await expect(page.locator('#save-btn')).toBeEnabled({ timeout: 30000 });
  await expect(page.locator('#status-mode')).toContainText('.oebfz');

  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#save-btn')]);
  expect(download.suggestedFilename()).toMatch(/\.oebfz$/);
  expect(download.suggestedFilename()).not.toMatch(/zip/i);
  await expect(page.locator('#status-bar')).toContainText(/Downloaded .*\.oebfz/);

  const path = await download.path();
  const bytes = await readFile(path);
  expect([...bytes.subarray(0, 4)]).toEqual([0x28, 0xb5, 0x2f, 0xfd]);   // a Zstd frame, not a zip ("PK")

  // open it again with Open .oebfz or .zip
  await page.setInputFiles('input[type=file][accept=".oebfz,.zip"]', path);
  await expect(page.locator('#status-bar')).toContainText(/Opened/, { timeout: 30000 });
  await expect(page.locator('#scene-tree-filename')).not.toHaveText('');
});
