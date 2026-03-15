#!/usr/bin/env node
/**
 * build-library.mjs — Generate viewer/public/library/materials/library.json
 * from docs/plans/materials-database.csv.
 *
 * Run: node scripts/build-library.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const root  = resolve(__dir, '..');
const mainRoot = resolve(root, '..', '..');

const csvPath = resolve(mainRoot, 'docs/plans/materials-database.csv');
const outDir  = resolve(root, 'viewer/public/library/materials');
const outPath = resolve(outDir, 'library.json');

const csv = readFileSync(csvPath, 'utf-8');
const lines = csv.trim().split('\n');
const headers = lines[0].split(',').map(h => h.trim());

function col(row, name) {
  const i = headers.indexOf(name);
  return i >= 0 ? row[i].trim() : '';
}

const materials = lines.slice(1).map(line => {
  // Handle potential commas in quoted fields
  const row = line.match(/(".*?"|[^,]+|(?<=,)(?=,)|^(?=,)|(?<=,)$)/g)
    ?.map(v => v.replace(/^"|"$/g, '').trim()) ?? line.split(',');
  return {
    id:                       col(row, 'id'),
    name:                     col(row, 'name'),
    category:                 col(row, 'category_id'),
    category_name:            col(row, 'category_name'),
    colour_hex:               col(row, 'colour_hex'),
    carbon_kgCO2e_per_kg:     parseFloat(col(row, 'carbon_kgCO2e_per_kg')) || 0,
    density_kg_per_m3:        parseFloat(col(row, 'density_kg_per_m3')) || 0,
    thermal_conductivity_W_mK: parseFloat(col(row, 'thermal_conductivity_W_mK')) || 0,
    source:                   col(row, 'source'),
    notes:                    col(row, 'notes'),
  };
}).filter(m => m.id);

mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, JSON.stringify({ version: '1.0', materials }, null, 2));
console.log(`Written ${materials.length} materials to ${outPath}`);
