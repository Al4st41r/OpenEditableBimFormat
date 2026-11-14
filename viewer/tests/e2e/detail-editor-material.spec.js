import { test, expect } from '@playwright/test';
import { autoAnswerDialogs, dialogLog } from './dialogAnswers.js';

// New material from the detail editor's pickers (#194). Playwright's own waits are used throughout: each step waits for
// the state it expects (#177).
test('detail editor: New material from the toolbar and from a region picker, saved to the library and the detail (#194)', async ({ page }) => {
  const answer = await autoAnswerDialogs(page);
  await page.goto('detail-editor.html?demo=1');
  await page.waitForFunction(() => window.__detailEditor?.state());
  const library = () => page.evaluate(() => JSON.parse(window.__detailEditor.adapter()._map.get('materials/library.json')));
  const before = await library();

  // Every picker ends with New material…; cancelling puts the picker back and adds nothing.
  await expect(page.locator('#material-select option').last()).toHaveText('Import from library…');
  await expect(page.locator('#material-select option').nth(-2)).toHaveText('New material…');
  const was = await page.$eval('#material-select', (s) => s.value);
  await answer(false);
  await page.selectOption('#material-select', { label: 'New material…' });
  await expect.poll(() => dialogLog(page).then((l) => l.length)).toBe(1);
  await expect(page.locator('#material-select')).toHaveValue(was);
  expect((await library()).materials).toHaveLength(before.materials.length);

  // A taken id or a bad colour is refused: the problem is shown and the button is disabled.
  await page.selectOption('#material-select', { label: 'New material…' });
  const dlg = page.locator('dialog.oebf-dialog[data-kind=form]');
  await dlg.locator('[name=name]').fill('Oak flooring');
  await expect(dlg.locator('[name=id]')).toHaveValue('mat-oak-flooring');
  await dlg.locator('[name=id]').fill(before.materials[0].id);
  await expect(dlg.getByRole('button', { name: 'Add material' })).toBeDisabled();
  await expect(dlg).toContainText('already used');
  await dlg.locator('[name=colour]').fill('red');
  await expect(dlg).toContainText('hex colour');

  // The colour has a native swatch beside the hex text, kept in step both ways; IFC name and specification are fields (#197).
  const swatch = dlg.locator('input[type=color]');
  await expect(swatch).toBeVisible();
  await dlg.locator('[name=colour]').fill('#336699');
  await expect(swatch).toHaveValue('#336699');
  await swatch.fill('#aa5500');
  await expect(dlg.locator('[name=colour]')).toHaveValue('#AA5500');
  await expect(dlg.getByLabel('IFC material name (optional)')).toBeVisible();
  await expect(dlg.locator('textarea[name=properties]')).toBeVisible();
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  await expect(dlg).toHaveCount(0);
  await expect(page.locator('#material-select')).toHaveValue(was);

  // From the toolbar: the id follows the name, and the new material is selected.
  await answer({ name: 'Oak flooring', colour: '#c8a96e', category: 'timber', ifcMaterialName: 'Oak', properties: 'fire: D-s2, d0\ndensity: 700 kg/m3' });
  await page.selectOption('#material-select', { label: 'New material…' });
  await expect(page.locator('#material-select')).toHaveValue('mat-oak-flooring');
  await expect(page.locator('#material-select option:checked')).toHaveText('Oak flooring');
  await expect(page.locator('#status')).toContainText('Material added: Oak flooring');
  const lib = await library();
  expect(lib.materials.slice(0, before.materials.length)).toEqual(before.materials);
  expect(lib.materials.at(-1)).toEqual({ id: 'mat-oak-flooring', type: 'Material', name: 'Oak flooring', category: 'timber', colour_hex: '#C8A96E', ifc_material_name: 'Oak', properties: { fire: 'D-s2, d0', density: '700 kg/m3' }, interactions: {} });
  await expect(page.locator('#dirty')).toBeHidden();   // the library is written at once; the detail is untouched

  // From the region panel: the new material is assigned to the selected region, as one undoable step.
  await page.locator('#left-panel .item', { has: page.locator('.swatch') }).first().click();
  const regionMat = page.locator('#right-panel .row', { has: page.locator('label', { hasText: /^Material$/ }) }).locator('select');
  await expect(regionMat).toBeVisible();
  await expect(regionMat.locator('option').nth(-2)).toHaveText('New material…');
  await answer({ name: 'Cork', colour: '#b08850' });
  await regionMat.selectOption({ label: 'New material…' });
  await expect(page.locator('#status')).toContainText('Material added: Cork');
  await expect(regionMat).toHaveValue('mat-cork');
  const index = await page.evaluate(() => window.__detailEditor.state().selection.index);
  const regionMaterial = () => page.evaluate((i) => window.__detailEditor.state().doc.geometry.regions[i].material_id, index);
  expect(await regionMaterial()).toBe('mat-cork');
  await expect(page.locator('#dirty')).toBeVisible();
  await expect(page.locator('#material-select option[value=mat-cork]')).toHaveCount(1);

  // Undo takes the assignment back in one step; the material stays in the library.
  await page.click('#undo-btn');
  await expect.poll(regionMaterial).not.toBe('mat-cork');
  await expect(page.locator('#material-select option[value=mat-cork]')).toHaveCount(1);
  await page.click('#redo-btn');
  await expect.poll(regionMaterial).toBe('mat-cork');

  // Save, then read the library and the detail back from the bundle.
  await page.click('#save-btn');
  await expect(page.locator('#dirty')).toBeHidden();
  const back = await page.evaluate(() => {
    const map = window.__detailEditor.adapter()._map;
    const id = window.__detailEditor.state().doc.id;
    return { lib: JSON.parse(map.get('materials/library.json')), detail: JSON.parse(map.get(`details/${id}.json`)) };
  });
  expect(back.lib.materials.map((m) => m.id)).toEqual([...before.materials.map((m) => m.id), 'mat-oak-flooring', 'mat-cork']);
  expect(back.lib.materials.find((m) => m.id === 'mat-cork')).toMatchObject({ name: 'Cork', category: 'custom', colour_hex: '#B08850' });
  expect(back.detail.geometry.regions[index].material_id).toBe('mat-cork');
});

// Import from the default library (#197): the panel is the 3D editor's (shared code), the material lands in the library
// like a new one, every picker offers it, and it is selected in the picker the import was opened from.
test('detail editor: Import from library from the toolbar and a region picker (#197)', async ({ page }) => {
  await page.goto('detail-editor.html?demo=1');
  await page.waitForFunction(() => window.__detailEditor?.state());
  const library = () => page.evaluate(() => JSON.parse(window.__detailEditor.adapter()._map.get('materials/library.json')));
  const before = await library();
  const modal = page.locator('#lib-modal');
  const was = await page.$eval('#material-select', (s) => s.value);

  // Esc closes the panel without importing, and the picker goes back.
  await page.selectOption('#material-select', { label: 'Import from library…' });
  await expect(modal).toBeVisible();
  await expect(modal.getByLabel('Search the library')).toBeVisible();   // loaded
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  await expect(page.locator('#material-select')).toHaveValue(was);
  expect((await library()).materials).toHaveLength(before.materials.length);

  // From the toolbar: filter, Use, and the panel closes with the material selected.
  await page.selectOption('#material-select', { label: 'Import from library…' });
  await modal.getByLabel('Search the library').fill('General Purpose');
  const row = modal.locator('div', { hasText: 'Clay Brick (General Purpose)' }).filter({ has: page.getByRole('button', { name: 'Use' }) }).last();
  await row.getByRole('button', { name: 'Use' }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.locator('#material-select')).toHaveValue('mat-clay-brick-general');
  await expect(page.locator('#status')).toContainText('Material imported: Clay Brick (General Purpose)');
  const lib = await library();
  expect(lib.materials.slice(0, before.materials.length)).toEqual(before.materials);
  expect(lib.materials.at(-1)).toMatchObject({ id: 'mat-clay-brick-general', type: 'Material', category: 'masonry', colour_hex: '#C17A5C' });
  expect(lib.materials.at(-1).properties).toBeTruthy();   // library-only fields sit under properties

  // It is now in the project: the panel says so, and has no Use button for it.
  await page.selectOption('#material-select', { label: 'Import from library…' });
  await modal.getByLabel('Search the library').fill('General Purpose');
  await expect(modal).toContainText('In project');
  await expect(modal.getByRole('button', { name: 'Use' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);

  // From a region's picker: assigned to the region, as an undoable edit.
  await page.locator('#left-panel .item', { has: page.locator('.swatch') }).first().click();
  const regionMat = page.locator('#right-panel .row', { has: page.locator('label', { hasText: /^Material$/ }) }).locator('select');
  await expect(regionMat.locator('option').last()).toHaveText('Import from library…');
  await regionMat.selectOption({ label: 'Import from library…' });
  await modal.getByLabel('Search the library').fill('Mineral');
  await modal.getByRole('button', { name: 'Use' }).first().click();
  await expect(modal).toHaveCount(0);
  const index = await page.evaluate(() => window.__detailEditor.state().selection.index);
  const regionMaterial = () => page.evaluate((i) => window.__detailEditor.state().doc.geometry.regions[i].material_id, index);
  await expect.poll(regionMaterial).toMatch(/^mat-/);
  const imported = await regionMaterial();
  expect(imported).not.toBe('mat-clay-brick-general');
  await expect(regionMat).toHaveValue(imported);
  await expect(page.locator('#material-select option', { hasText: /Mineral/ }).first()).toHaveCount(1);
  await page.click('#undo-btn');
  await expect.poll(regionMaterial).not.toBe(imported);
  expect((await library()).materials.map((m) => m.id)).toContain(imported);   // the library keeps it
});
