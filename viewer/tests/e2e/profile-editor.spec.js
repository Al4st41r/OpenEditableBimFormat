import { test, expect } from '@playwright/test';

test.describe('Profile Editor', () => {
  test('page loads with correct initial state', async ({ page }) => {
    await page.goto('profile-editor.html');

    // Key UI elements present
    await expect(page.locator('#profile-svg')).toBeVisible();
    await expect(page.locator('#open-btn')).toBeVisible();
    await expect(page.locator('#save-btn')).toBeDisabled();
    await expect(page.locator('#profile-select')).toBeDisabled();
    await expect(page.locator('#project-name')).toHaveText('No bundle open');
  });

  test('buildJson produces correct profile structure', async ({ page }) => {
    await page.goto('profile-editor.html');

    const result = await page.evaluate(async () => {
      const { buildJson } = await import('/oebf/src/profile-editor/profileSerializer.js');
      return buildJson({
        layers: [
          { name: 'Brick', material_id: 'mat-brick', thickness: 0.102, function: 'finish' },
          { name: 'Block', material_id: 'mat-block', thickness: 0.100, function: 'structure' },
        ],
        originX: 0.101,
        id: 'profile-test',
        description: 'Test profile',
      });
    });

    expect(result.$schema).toBe('oebf://schema/0.1/profile');
    expect(result.id).toBe('profile-test');
    expect(result.assembly).toHaveLength(2);
    expect(result.width).toBeCloseTo(0.202, 4);
    expect(result.origin.x).toBeCloseTo(0.101, 4);
    expect(result.assembly[0].layer).toBe(1);
    expect(result.assembly[1].layer).toBe(2);
  });

  test('buildSvg produces SVG with correct rect count and origin marker', async ({ page }) => {
    await page.goto('profile-editor.html');

    const svg = await page.evaluate(async () => {
      const { buildSvg } = await import('/oebf/src/profile-editor/profileSerializer.js');
      return buildSvg({
        layers: [
          { name: 'Brick', material_id: 'mat-brick', thickness: 0.102, function: 'finish' },
          { name: 'Block', material_id: 'mat-block', thickness: 0.100, function: 'structure' },
        ],
        originX: 0.101,
        matMap: {
          'mat-brick': { colour_hex: '#C4693A' },
          'mat-block': { colour_hex: '#AAAAAA' },
        },
      });
    });

    const rects = svg.match(/<rect /g) ?? [];
    expect(rects).toHaveLength(2);
    expect(svg).toContain('cx="0.101"');
    expect(svg).toContain('viewBox="0 0 0.202 2.700"');
    expect(svg).toContain('fill="#C4693A"');
  });
});

test('a stacked slab profile opens in the profile editor, draws as bands and saves unchanged', async ({ page }) => {
  await page.goto('launch.html');
  const popupPromise = page.waitForEvent('popup');
  const profile = {
    $schema: 'oebf://schema/0.1/profile', id: 'profile-test-slab', type: 'Profile', svg_file: 'profiles/profile-test-slab.svg',
    width: 1, height: 0.2, origin: { x: 0.5, y: 0 }, alignment: 'top-face', profile_type: 'slab',
    assembly: [
      { layer: 1, name: 'Finish', material_id: 'mat-a', thickness: 0.02, function: 'finish' },
      { layer: 2, name: 'Deck', material_id: 'mat-b', thickness: 0.18, function: 'structure' },
    ],
  };
  await page.evaluate(() => { window.__saved = null; window.addEventListener('message', (e) => { if (e.data?.type === 'profile-saved') window.__saved = e.data; }); });
  await page.evaluate(() => { window.open('profile-editor.html'); });
  const popup = await popupPromise;
  await popup.waitForLoadState();
  await page.waitForTimeout(500);
  // the editor listens on its own window, so deliver the opener's message there
  await popup.evaluate((p) => {
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      data: { type: 'memory-bundle', profiles: { [p.id]: p }, matMap: { 'mat-a': { colour_hex: '#111111' }, 'mat-b': { colour_hex: '#222222' } }, activeProfileId: p.id, projectName: 'x' },
    }));
  }, profile);
  await expect(popup.locator('#profile-alignment-select')).toHaveValue('top-face');
  await expect(popup.locator('#profile-alignment-select')).toBeEnabled();
  expect(await popup.locator('#profile-svg').getAttribute('viewBox')).toBe('0 0 1 0.2');
  expect(await popup.locator('#profile-svg rect').count()).toBe(2);
  await popup.locator('#save-btn').click();
  await expect.poll(() => page.evaluate(() => window.__saved?.json?.alignment)).toBe('top-face');
  const saved = await page.evaluate(() => window.__saved);
  expect(saved.json).toMatchObject({ width: 1, height: 0.2, origin: { x: 0.5, y: 0 }, profile_type: 'slab' });
  expect(saved.svg).toContain('viewBox="0 0 1 0.2"');
});
