import { describe, test, expect } from 'vitest';
import { materialIdFor, findSimilar, normaliseColour, buildMaterial } from './materialForm.js';

const lib = [
  { id: 'mat-brick-common', name: 'Common Brick', colour_hex: '#C4693A' },
  { id: 'mat-pir-board', name: 'PIR Board Insulation', colour_hex: '#E8D8A0' },
];

describe('materialIdFor', () => {
  test('slugs the name', () => expect(materialIdFor('Common Brick', [])).toBe('mat-common-brick'));
  test('strips punctuation and edges', () => expect(materialIdFor('  Oak (rough)! ', [])).toBe('mat-oak-rough'));
  test('adds a number when the id is taken, never reusing one', () => {
    expect(materialIdFor('Brick Common', lib)).toBe('mat-brick-common-2');
    expect(materialIdFor('Brick Common', [...lib, { id: 'mat-brick-common-2' }])).toBe('mat-brick-common-3');
  });
  test('a name with no letters or digits gets a fallback', () => expect(materialIdFor('###', [])).toBe('mat-material'));
});

describe('findSimilar', () => {
  test('matches the same name ignoring case and spacing', () => {
    expect(findSimilar(lib, '  common  brick ').map((m) => m.id)).toEqual(['mat-brick-common']);
  });
  test('matches a name that contains or is contained in an existing one', () => {
    expect(findSimilar(lib, 'brick').map((m) => m.id)).toEqual(['mat-brick-common']);
    expect(findSimilar(lib, 'PIR Board Insulation 100').map((m) => m.id)).toEqual(['mat-pir-board']);
  });
  test('matches by id too', () => expect(findSimilar(lib, 'mat-pir-board')).toHaveLength(1));
  test('nothing for an empty or unrelated name', () => {
    expect(findSimilar(lib, '')).toEqual([]);
    expect(findSimilar(lib, 'Glass')).toEqual([]);
  });
});

describe('normaliseColour', () => {
  test('accepts #rgb and #rrggbb, any case, and expands the short form', () => {
    expect(normaliseColour('#c4693a')).toBe('#C4693A');
    expect(normaliseColour('#fa0')).toBe('#FFAA00');
  });
  test('accepts a missing hash', () => expect(normaliseColour('888888')).toBe('#888888'));
  test('falls back to grey for anything else', () => {
    expect(normaliseColour('red')).toBe('#888888');
    expect(normaliseColour('')).toBe('#888888');
    expect(normaliseColour(undefined)).toBe('#888888');
  });
});

describe('buildMaterial', () => {
  test('builds a schema-shaped material', () => {
    expect(buildMaterial('Glass', '#aaccee', [])).toEqual({
      id: 'mat-glass', type: 'Material', name: 'Glass', category: 'custom',
      colour_hex: '#AACCEE', interactions: {},
    });
  });
  test('refuses an empty name', () => expect(() => buildMaterial('   ', '#fff', [])).toThrow(/name/i));
});
