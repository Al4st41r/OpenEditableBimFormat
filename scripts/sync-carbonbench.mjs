#!/usr/bin/env node
/**
 * sync-carbonbench.mjs — Copy carbon factors from a CarbonBench material database release into the
 * materials of an OEBF bundle. A material names its row with `carbonbench_id` (and `carbonbench_version`);
 * the factors are written to `properties.carbon` so the bundle stays self-contained.
 *
 * Run:   node scripts/sync-carbonbench.mjs <bundle.oebf> [--db <path to vX.json>]
 * Check: node scripts/sync-carbonbench.mjs <bundle.oebf> --check   (exits 1 if the snapshot is stale; no writes)
 *
 * The database defaults to the newest ~/WebApps/CarbonBench/materials/database/v*.json, or $CARBONBENCH_DB.
 * Only A1-A3 factors are copied. A factor with a per-m2 unit is copied as it is; consumers cannot convert it.
 * Materials whose id is not in the database are reported and left unchanged.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { homedir } from 'os';

const args = process.argv.slice(2);
const check = args.includes('--check');
const dbFlag = args.indexOf('--db');
const bundle = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--db');
if (!bundle) { console.error('Usage: node scripts/sync-carbonbench.mjs <bundle.oebf> [--db <file>] [--check]'); process.exit(2); }

function newestDb() {
  const dir = join(homedir(), 'WebApps/CarbonBench/materials/database');
  if (!existsSync(dir)) return null;
  const num = (f) => f.replace(/^v|\.json$/g, '').split('.').map(Number);
  const files = readdirSync(dir).filter((f) => /^v\d+\.\d+\.\d+\.json$/.test(f))
    .sort((a, b) => { const [x, y] = [num(a), num(b)]; for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; });
  return files.length ? join(dir, files.at(-1)) : null;
}

const dbPath = dbFlag >= 0 ? args[dbFlag + 1] : (process.env.CARBONBENCH_DB ?? newestDb());
if (!dbPath || !existsSync(dbPath)) {
  console.log('CarbonBench database not found; nothing to sync.');
  process.exit(0); // not an error: CI and other machines do not have it
}

const db = JSON.parse(readFileSync(dbPath, 'utf8'));
const rows = new Map(db.materials.filter((m) => m.granularity === 'material').map((m) => [m.id, m]));
const libPath = resolve(bundle, 'materials/library.json');
const lib = JSON.parse(readFileSync(libPath, 'utf8'));

const snapshot = (row) => ({
  factor: row.carbon_factor ?? null,
  unit: row.carbon_unit ?? null,
  density_kg_m3: row.density_kg_m3 ?? null,
  biogenic_factor: row.biogenic_factor ?? null,
  biogenic_unit: row.biogenic_unit ?? null,
});

const stale = [];
const missing = [];
let linked = 0;
for (const m of lib.materials) {
  if (!m.carbonbench_id) continue;
  linked += 1;
  const row = rows.get(m.carbonbench_id);
  if (!row) { missing.push(`${m.id} -> ${m.carbonbench_id}`); continue; }
  const next = snapshot(row);
  const same = JSON.stringify(m.properties?.carbon) === JSON.stringify(next) && m.carbonbench_version === db.version;
  if (same) continue;
  stale.push(m.id);
  if (!check) {
    m.properties = { ...(m.properties ?? {}), carbon: next };
    m.carbonbench_version = db.version;
  }
}

if (!check && stale.length) writeFileSync(libPath, JSON.stringify(lib, null, 2) + '\n');
console.log(`${linked} linked material(s), CarbonBench ${db.version}: ${stale.length} ${check ? 'stale' : 'updated'}, ${missing.length} not found.`);
if (missing.length) console.error('Not in the database:\n  ' + missing.join('\n  '));
if (check && (stale.length || missing.length)) process.exit(1);
if (missing.length) process.exit(1);
