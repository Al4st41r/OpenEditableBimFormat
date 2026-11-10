import { describe, it, expect } from 'vitest';
import { counterpartId, findCounterpart, counterpartDraft, otherPlane } from './counterpart.js';

const members = [{ role: 'wall', kind: 'wall', profile_id: 'p-wall', placement: {} }, { role: 'floor', kind: 'slab', profile_id: 'p-floor', placement: {} }];
const plan = { id: 'detail-edge-plan', description: 'Plan detail: edge', plane: 'plan', condition: { rule: 'butt' }, members, tags: ['nmb'], datum: { kind: 'storey', reference: 'elevation' } };
const section = { ...plan, id: 'detail-edge-section', plane: 'section' };

describe('counterpart', () => {
  it('swaps the view in the name', () => {
    expect(otherPlane('plan')).toBe('section');
    expect(counterpartId(plan)).toBe('detail-edge-section');
    expect(counterpartId(section)).toBe('detail-edge-plan');
    expect(counterpartId({ id: 'detail-x', plane: 'section' })).toBe('detail-x-plan');
  });
  it('finds the paired detail by name', () => {
    expect(findCounterpart(plan, [plan, section])).toBe(section);
    expect(findCounterpart(plan, [plan])).toBeNull();
  });
  it('finds it by members and condition when the name does not say', () => {
    const odd = { ...section, id: 'detail-something-else' };
    expect(findCounterpart(plan, [plan, odd])).toBe(odd);
  });
  it('does not guess between two candidates', () => {
    const a = { ...section, id: 'detail-a' }, b = { ...section, id: 'detail-b' };
    expect(findCounterpart(plan, [plan, a, b])).toBeNull();
  });
  it('drafts an empty detail in the other view with the same members and condition', () => {
    const d = counterpartDraft(plan, ['detail-edge-plan']);
    expect(d).toMatchObject({ id: 'detail-edge-section', plane: 'section', view_direction: 'across_path', condition: { rule: 'butt' }, tags: ['nmb'] });
    expect(d.members.map((m) => [m.role, m.profile_id])).toEqual([['wall', 'p-wall'], ['floor', 'p-floor']]);
    expect(d.geometry ?? []).toEqual([]);
  });
  it('refuses to draft over an existing id', () => {
    expect(() => counterpartDraft(plan, ['detail-edge-section'])).toThrow(/already exists/);
  });
});
