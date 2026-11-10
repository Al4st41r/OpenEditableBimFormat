import { describe, it, expect } from 'vitest';
import { countRefs, renameRefs, findUses, matchesSearch } from './profileRefs.js';

const element = { id: 'e1', profile_id: 'p-a' };
const detail = { members: [{ profile_id: 'p-a' }, { profile_id: 'p-b' }, { nested: { profile_id: 'p-a' } }] };

describe('profileRefs', () => {
  it('counts every use, however deep', () => {
    expect(countRefs(element, 'p-a')).toBe(1);
    expect(countRefs(detail, 'p-a')).toBe(2);
    expect(countRefs(detail, 'p-z')).toBe(0);
  });
  it('renames every use and leaves the original alone', () => {
    const out = renameRefs(detail, 'p-a', 'p-c');
    expect(countRefs(out, 'p-c')).toBe(2);
    expect(countRefs(out, 'p-b')).toBe(1);
    expect(countRefs(detail, 'p-a')).toBe(2);
  });
  it('lists the files that use a profile', () => {
    const uses = findUses({ 'elements/e1.json': element, 'details/d.json': detail, 'elements/e2.json': { profile_id: 'p-b' } }, 'p-a');
    expect(uses).toEqual([{ path: 'elements/e1.json', count: 1 }, { path: 'details/d.json', count: 2 }]);
  });
  it('searches by any part of the id, ignoring case', () => {
    expect(matchesSearch('profile-cavity-250', 'CAV')).toBe(true);
    expect(matchesSearch('profile-cavity-250', 'brick')).toBe(false);
    expect(matchesSearch('profile-cavity-250', '  ')).toBe(true);
  });
});
