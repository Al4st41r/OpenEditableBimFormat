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
