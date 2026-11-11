import { describe, test, expect } from 'vitest';
import { checkFields, idValidator } from './dialog.js';

describe('checkFields', () => {
  const fields = [
    { name: 'name', label: 'Name', required: true },
    { name: 'z', label: 'Floor level', type: 'number' },
  ];

  test('valid values give no errors', () => {
    expect(checkFields(fields, { name: 'First floor', z: '3000' })).toEqual({});
  });

  test('a blank required field is refused, whitespace counts as blank', () => {
    expect(checkFields(fields, { name: '   ', z: '0' })).toEqual({ name: 'Name is needed.' });
  });

  test('a number field refuses text but allows blank when not required', () => {
    expect(checkFields(fields, { name: 'a', z: '3m' })).toEqual({ z: 'Floor level must be a number.' });
    expect(checkFields(fields, { name: 'a', z: '' })).toEqual({});
    expect(checkFields(fields, { name: 'a', z: '-1.5e3' })).toEqual({});
  });

  test('a custom validator sees the value and every other value', () => {
    const f = [{ name: 'a', label: 'A' }, { name: 'b', label: 'B', validate: (v, all) => (v === all.a ? 'B must differ from A.' : null) }];
    expect(checkFields(f, { a: 'x', b: 'x' })).toEqual({ b: 'B must differ from A.' });
    expect(checkFields(f, { a: 'x', b: 'y' })).toEqual({});
  });

  test('the built-in checks run before the custom one', () => {
    const f = [{ name: 'a', label: 'A', required: true, validate: () => 'never reached' }];
    expect(checkFields(f, { a: '' })).toEqual({ a: 'A is needed.' });
  });

  test('missing values are treated as blank', () => {
    expect(checkFields(fields, {})).toEqual({ name: 'Name is needed.' });
  });
});

describe('idValidator', () => {
  const taken = new Set(['profile-a']);
  const check = idValidator((id) => taken.has(id));

  test('accepts a lowercase hyphenated id', () => {
    expect(check('profile-brick-200')).toBeNull();
  });

  test('refuses capitals, spaces, underscores and a leading hyphen', () => {
    for (const bad of ['Profile', 'a b', 'a_b', '-a', '']) expect(check(bad)).toMatch(/lowercase/);
  });

  test('refuses an id that is already used', () => {
    expect(check('profile-a')).toMatch(/already used/);
  });

  test('trims before checking', () => {
    expect(check('  profile-b ')).toBeNull();
  });
});
