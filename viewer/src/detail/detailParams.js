/**
 * detailParams.js
 *
 * Resolve a Detail's declared parameters against a junction's detail_overrides.
 * Values are clamped to [min, max]; problems are reported as warnings rather
 * than thrown, so a bad override degrades gracefully in the viewer.
 */

/**
 * @param {object} detail - parsed Detail entity
 * @param {Object<string, number>} [overrides]
 * @returns {{ values: Object<string, number>, warnings: string[] }}
 */
export function applyOverrides(detail, overrides = {}) {
  const params = detail?.parameters ?? {};
  const values = {};
  const warnings = [];

  for (const [name, def] of Object.entries(params)) {
    values[name] = def.default;
  }

  for (const [name, raw] of Object.entries(overrides ?? {})) {
    const def = params[name];
    if (!def) {
      warnings.push(`Override "${name}" is not a parameter of detail "${detail?.id}"; ignored`);
      continue;
    }
    if (typeof raw !== 'number' || Number.isNaN(raw)) {
      warnings.push(`Override "${name}" is not a number; using default ${def.default}`);
      continue;
    }
    let v = raw;
    if (def.min !== undefined && v < def.min) v = def.min;
    if (def.max !== undefined && v > def.max) v = def.max;
    if (v !== raw) warnings.push(`Override "${name}" = ${raw} is outside ${def.min ?? '-inf'}..${def.max ?? 'inf'}; clamped to ${v}`);
    values[name] = v;
  }

  return { values, warnings };
}
