import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STARTERS, starterFor, DEFAULT_STARTER } from './starters.js';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');

describe('starters', () => {
  it('every starter has a packed archive in public/', () => {
    for (const s of STARTERS) expect(fs.existsSync(path.join(PUBLIC, s.file)), s.file).toBe(true);
  });
  it('ids are unique and the default exists', () => {
    expect(new Set(STARTERS.map((s) => s.id)).size).toBe(STARTERS.length);
    expect(STARTERS.some((s) => s.id === DEFAULT_STARTER)).toBe(true);
  });
  it('an unknown or missing id gives the default', () => {
    expect(starterFor('nope').id).toBe(DEFAULT_STARTER);
    expect(starterFor(null).id).toBe(DEFAULT_STARTER);
    expect(starterFor('nmb-two-storey').id).toBe('nmb-two-storey');
  });
});
