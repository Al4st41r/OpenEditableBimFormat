import { test, expect } from 'vitest';
import { withTag, tagsToSave } from './layerTags.js';

test('withTag sets a tag and does not change the original', () => {
  const a = { package: 'cladding' };
  const b = withTag(a, 'fire_role', 'firestop');
  expect(b).toEqual({ package: 'cladding', fire_role: 'firestop' });
  expect(a).toEqual({ package: 'cladding' });
});

test('withTag removes a tag for an empty value, an empty list or NaN', () => {
  const t = { package: 'cladding', barrier: ['air'], sequence: 2 };
  expect(withTag(t, 'package', '')).not.toHaveProperty('package');
  expect(withTag(t, 'barrier', [])).not.toHaveProperty('barrier');
  expect(withTag(t, 'sequence', NaN)).not.toHaveProperty('sequence');
  expect(withTag(undefined, 'package', 'mep')).toEqual({ package: 'mep' });
});

test('tagsToSave gives undefined for no tags', () => {
  expect(tagsToSave({})).toBeUndefined();
  expect(tagsToSave(undefined)).toBeUndefined();
  expect(tagsToSave({ sequence: 1 })).toEqual({ sequence: 1 });
});
