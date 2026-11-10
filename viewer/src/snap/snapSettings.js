/**
 * snapSettings.js — the user's snap choices for the 3D editor (issue #82): which snap kinds are on, the grid spacing
 * (the ruler step) and the angle step. Pure apart from load/save, which take a Storage so they can be tested.
 */

import { SNAP_KINDS } from './snapEngine.js';

/** Every kind but the grid step, which is on whenever a spacing is set. */
export const TOGGLE_KINDS = SNAP_KINDS.filter((k) => k !== 'step');
export const KIND_LABELS = {
  endpoint: 'Endpoints', intersection: 'Intersections', midpoint: 'Midpoints', perpendicular: 'Perpendicular',
  parallel: 'Parallel', angle: 'Angle', 'grid-axis': 'Grid axes', alignment: 'Alignment with other points', 'on-line': 'Along a line',
};
export const ANGLE_STEPS = [0, 15, 30, 45, 90];
const KEY = 'oebf-snap-settings';

export function defaultSettings() {
  return { kinds: [...TOGGLE_KINDS], step_m: 0, angleStep: 45 };
}

/** Anything stored is checked: unknown kinds drop out, a bad spacing or angle falls back to the default. */
export function normaliseSettings(raw) {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  const kinds = Array.isArray(raw.kinds) ? TOGGLE_KINDS.filter((k) => raw.kinds.includes(k)) : d.kinds;
  const step_m = Number.isFinite(raw.step_m) && raw.step_m >= 0 ? raw.step_m : d.step_m;
  const angleStep = ANGLE_STEPS.includes(raw.angleStep) ? raw.angleStep : d.angleStep;
  return { kinds, step_m, angleStep };
}

export function loadSettings(storage) {
  try { return normaliseSettings(JSON.parse(storage.getItem(KEY))); } catch { return defaultSettings(); }
}
export function saveSettings(storage, settings) {
  try { storage.setItem(KEY, JSON.stringify(settings)); } catch { /* optional */ }
}

/** The kinds handed to the engine: the chosen ones, plus the grid step when a spacing is set. */
export function enabledKinds(settings) {
  return settings.step_m > 0 ? [...settings.kinds, 'step'] : [...settings.kinds];
}
