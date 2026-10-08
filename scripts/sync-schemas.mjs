#!/usr/bin/env node
/**
 * sync-schemas.mjs — Copy spec/schema/*.schema.json into the example bundle's
 * schema/ folder and regenerate the entityTypes list in oebf-schema.json.
 * spec/schema is the single source of truth (see issue #99).
 *
 * Run:   node scripts/sync-schemas.mjs
 * Check: node scripts/sync-schemas.mjs --check   (exits 1 if out of sync; no writes)
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root   = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = resolve(root, 'spec/schema');
const dstDir = resolve(root, 'example/terraced-house.oebf/schema');
const check  = process.argv.includes('--check');

const files = readdirSync(srcDir).filter(f => f.endsWith('.schema.json')).sort();
const stale = [];

function sync(path, content) {
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (current === content) return;
  stale.push(path.replace(root + '/', ''));
  if (!check) writeFileSync(path, content);
}

if (!check) mkdirSync(dstDir, { recursive: true });

for (const f of files) sync(resolve(dstDir, f), readFileSync(resolve(srcDir, f), 'utf8'));

const indexPath = resolve(dstDir, 'oebf-schema.json');
const index = JSON.parse(readFileSync(indexPath, 'utf8'));
index.definitions.entityTypes = files.map(f => f.replace('.schema.json', ''));
sync(indexPath, JSON.stringify(index, null, 2) + '\n');

if (stale.length === 0) {
  console.log('Schemas in sync.');
} else if (check) {
  console.error('Out of sync (run: node scripts/sync-schemas.mjs):\n  ' + stale.join('\n  '));
  process.exit(1);
} else {
  console.log('Updated:\n  ' + stale.join('\n  '));
}
