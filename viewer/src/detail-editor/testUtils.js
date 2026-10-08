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
