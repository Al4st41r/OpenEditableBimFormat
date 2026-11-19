import { test, expect } from '@playwright/test';
import { autoAnswerDialogs } from './dialogAnswers.js';

// A detail with no building (#216): the detail editor starts a bundle in memory with the library's profiles, and its
// 3D button hands that bundle, with the unsaved detail, to the review page.
test('detail editor: a detail with no building, shown in 3D from a bundle in memory (#216)', async ({ page, context }) => {
  await autoAnswerDialogs(page);   // the name dialog opens on load and is accepted with its default
  await page.goto('detail-editor.html?blank');
  const dlg = page.locator('#new-dialog');
  await expect(dlg).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#project-name')).toHaveText('Detail sketch');
  await dlg.locator('input[type=text]').first().fill('Wall to slab');
  const [, , , m2Kind, m2Profile] = await dlg.locator('select').all();
  await m2Kind.selectOption('slab');
  await m2Profile.selectOption('concrete-slab');
  await dlg.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('#detail-select')).toHaveValue('detail-wall-to-slab');

  // one region, drawn with the Rect tool (a detail with no regions has nothing to cut in 2D)
  await page.click('#tool-rect');
  await page.evaluate(() => {
    const E = window.__detailEditor, svg = document.getElementById('canvas');
    const px = (x, y) => { const v = E.view(), s = E.size(), r = svg.getBoundingClientRect(); return { clientX: r.left + s.width / 2 + (x - v.cx) * v.scale, clientY: r.top + s.height / 2 - (y - v.cy) * v.scale }; };
    const ptr = (type, x, y) => svg.dispatchEvent(new PointerEvent(type, { ...px(x, y), button: 0, pointerId: 1, bubbles: true }));
    ptr('pointerdown', -0.1, -0.1); ptr('pointermove', 0.1, 0.1); ptr('pointerup', 0.1, 0.1);
  });
  await expect.poll(() => page.evaluate(() => window.__detailEditor.state().doc.geometry?.regions?.length ?? 0)).toBe(1);

  // unsaved, then 3D: the review page opens on this bundle and shows the draft
  const [review] = await Promise.all([context.waitForEvent('page'), page.click('#view3d-btn')]);
  await review.waitForLoadState();
  await expect(review.locator('#project-name')).toHaveText('Detail sketch', { timeout: 30_000 });
  await expect(review.locator('#list')).toContainText('wall-to-slab');
  await review.waitForSelector('#drawing svg polygon', { timeout: 30_000 });
  await expect(review.locator('#status')).not.toContainText(/Could not|No unsaved/);
});
