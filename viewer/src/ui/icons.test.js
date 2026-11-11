import { test, expect } from 'vitest';
import * as lucide from 'lucide';
import { ICONS } from './icons.js';

test('every icon name resolves to a Lucide drawing', () => {
  for (const [name, node] of Object.entries(ICONS)) {
    expect(Array.isArray(node), name).toBe(true);
    expect(node.length, name).toBeGreaterThan(0);
  }
});

test('the drawings are Lucide exports (a renamed icon in an upgrade fails here)', () => {
  const exported = new Set(Object.values(lucide).filter(Array.isArray));
  for (const [name, node] of Object.entries(ICONS)) expect(exported.has(node), name).toBe(true);
});

test('icons used in the pages are all defined', async () => {
  const fs = await import('node:fs');
  const used = new Set();
  for (const f of ['editor.html', 'profile-editor.html', 'detail-editor.html', 'viewer.html', 'launch.html']) {
    for (const m of fs.readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8').matchAll(/data-icon="([^"]+)"/g)) used.add(m[1]);
  }
  for (const name of used) expect(Object.keys(ICONS), name).toContain(name);
});
