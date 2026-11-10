import { test, expect } from 'vitest';
import { defaultSettings, normaliseSettings, enabledKinds, loadSettings, saveSettings, ANGLE_STEPS } from './snapSettings.js';

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test('the defaults turn every kind on, with no grid spacing and a 45 degree angle', () => {
  const d = defaultSettings();
  expect(d.step_m).toBe(0);
  expect(d.angleStep).toBe(45);
  expect(enabledKinds(d)).not.toContain('step');
  expect(d.kinds).toContain('endpoint');
});

test('a grid spacing adds the step kind', () => {
  expect(enabledKinds({ ...defaultSettings(), step_m: 0.1 })).toContain('step');
});

test('stored settings are checked: unknown kinds, a negative spacing and an odd angle fall back', () => {
  const s = normaliseSettings({ kinds: ['endpoint', 'bogus'], step_m: -1, angleStep: 17 });
  expect(s.kinds).toEqual(['endpoint']);
  expect(s.step_m).toBe(0);
  expect(s.angleStep).toBe(45);
  expect(ANGLE_STEPS).toContain(s.angleStep);
});

test('settings survive a save and a load, and a corrupt entry gives the defaults', () => {
  const st = memory();
  saveSettings(st, { kinds: ['midpoint'], step_m: 0.25, angleStep: 90 });
  expect(loadSettings(st)).toEqual({ kinds: ['midpoint'], step_m: 0.25, angleStep: 90 });
  st.setItem('oebf-snap-settings', '{not json');
  expect(loadSettings(st)).toEqual(defaultSettings());
});
