import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUNDLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../example/terraced-house.oebf');
export const readExample = (rel) => JSON.parse(fs.readFileSync(path.join(BUNDLE, rel), 'utf8'));
export const exampleDetail = () => readExample('details/detail-corner-cavity-butt.json');
export const exampleCtx = () => ({
  profileIds: fs.readdirSync(path.join(BUNDLE, 'profiles')).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', '')),
  materialIds: readExample('materials/library.json').materials.map((m) => m.id),
});

/** Freeze an object graph so any mutation throws (ES modules are strict). */
export function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o).forEach(deepFreeze);
  }
  return o;
}

/** Read-only adapter over the example bundle on disk, with the same shape as the editor's adapters. */
export function makeFsAdapter(dir = BUNDLE) {
  return {
    type: 'fsa-test',
    name: 'terraced-house',
    readJson: async (rel) => {
      const p = path.join(dir, rel);
      if (!fs.existsSync(p)) throw new Error(`Missing file in bundle: ${rel}`);
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    },
    listDir: async (rel) => {
      const p = path.join(dir, rel);
      return fs.existsSync(p) ? fs.readdirSync(p) : [];
    },
  };
}

/** A writable in-memory copy of the example bundle (the editor's MemoryAdapter). */
export async function makeMemoryAdapter() {
  const { MemoryAdapter } = await import('../editor/storageAdapter.js');
  const map = new Map();
  const walk = (d, prefix) => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      if (fs.statSync(p).isDirectory()) walk(p, `${prefix}${name}/`);
      else if (name.endsWith('.json')) map.set(`${prefix}${name}`, fs.readFileSync(p, 'utf8'));
    }
  };
  walk(BUNDLE, '');
  return new MemoryAdapter(map, 'terraced-house');
}
