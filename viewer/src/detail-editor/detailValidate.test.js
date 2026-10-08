import { describe, test, expect } from 'vitest';
import { validateDetail } from './detailValidate.js';
import { makeDetail, rect } from '../detail/fixtures.js';
import { exampleDetail, exampleCtx } from './testUtils.js';

const CTX = { profileIds: ['p1'], materialIds: ['mat-a', 'mat-b'] };
const check = (d, ctx = CTX) => validateDetail(d, ctx);
const codes = (d, ctx) => check(d, ctx).map((m) => m.code);
const only = (d, code, ctx) => check(d, ctx).filter((m) => m.code === code);

describe('valid documents', () => {
  test('the fixture detail has no messages', () => {
    expect(check(makeDetail())).toEqual([]);
  });

  test('the example detail validates against the example bundle', () => {
    expect(validateDetail(exampleDetail(), exampleCtx())).toEqual([]);
  });

  test('bundle context is optional: profile and material checks are skipped without it', () => {
    const d = makeDetail();
    d.members[0].profile_id = 'anything';
    expect(validateDetail(d, undefined)).toEqual([]);
  });

  test('messages carry path, code and message', () => {
    const d = makeDetail(); d.members = d.members.slice(0, 1);
    const [m] = check(d);
    expect(Object.keys(m).sort()).toEqual(['code', 'message', 'path']);
    expect(typeof m.message).toBe('string');
  });
});

describe('integrity rules', () => {
  test('duplicate role', () => {
    const d = makeDetail(); d.members[1].role = 'a';
    expect(only(d, 'role-duplicate')[0].path).toBe('members[1].role');
  });

  test('fewer than two members', () => {
    const d = makeDetail(); d.members = d.members.slice(0, 1);
    expect(codes(d)).toContain('members-min');
  });

  test('undeclared parameter in a coordinate', () => {
    const d = makeDetail();
    d.geometry.regions[0].vertices[1].x = { param: 'nope' };
    const m = only(d, 'param-undeclared')[0];
    expect(m.path).toBe('geometry.regions[0].vertices[1].x');
    expect(m.message).toMatch(/nope/);
  });

  test('parameter default outside its range, and min above max', () => {
    const d = makeDetail(); d.parameters.w.default = 0.9;
    expect(only(d, 'param-default-range')[0].path).toBe('parameters.w');
    const e = makeDetail(); e.parameters.w.min = 0.5; e.parameters.w.max = 0.1; e.parameters.w.default = 0.3;
    expect(codes(e)).toContain('param-min-max');
  });

  test('region with fewer than three vertices', () => {
    const d = makeDetail(); d.geometry.regions[0].vertices = d.geometry.regions[0].vertices.slice(0, 2);
    expect(only(d, 'region-vertices')[0].path).toBe('geometry.regions[0].vertices');
  });

  test('self-intersecting region and zero-area region', () => {
    const d = makeDetail();
    d.geometry.regions[0].vertices = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
    expect(only(d, 'region-self-intersect')[0].path).toBe('geometry.regions[0]');
    const z = makeDetail();
    z.geometry.regions[0].vertices = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }];
    expect(codes(z)).toContain('region-zero-area');
  });

  test('a bound region is checked at the parameter defaults', () => {
    const d = makeDetail();
    d.parameters.w = { default: 0, min: 0, max: 1 };
    d.geometry.regions[0].vertices = [{ x: 0, y: 0 }, { x: { param: 'w' }, y: 0 }, { x: 0, y: 1 }];
    expect(codes(d)).toContain('region-zero-area'); // collapses at w = 0
  });

  test('extrusion must be above zero', () => {
    const d = makeDetail(); d.geometry.extrusion_m = 0;
    expect(only(d, 'extrusion')[0].path).toBe('geometry.extrusion_m');
    const e = makeDetail(); delete e.geometry.extrusion_m;
    expect(codes(e)).toContain('extrusion');
  });

  test('condition must match the members', () => {
    const d = makeDetail(); d.condition = { member_count: 3 };
    expect(only(d, 'condition-count')[0].path).toBe('condition.member_count');
    const e = makeDetail(); e.condition = { member_kinds: ['wall', 'slab'] };
    expect(only(e, 'condition-kinds')[0].path).toBe('condition.member_kinds');
  });

  test('condition kinds compare as a multiset, ignoring order', () => {
    const d = makeDetail(); d.members[1].kind = 'slab';
    d.condition = { member_count: 2, member_kinds: ['slab', 'wall'] };
    expect(check(d)).toEqual([]);
  });

  test('member profile and region material must exist in the bundle', () => {
    const d = makeDetail(); d.members[0].profile_id = 'ghost';
    expect(only(d, 'profile-missing')[0].message).toMatch(/ghost/);
    const e = makeDetail(); e.geometry.regions[0].material_id = 'mat-ghost';
    expect(only(e, 'material-missing')[0].path).toBe('geometry.regions[0].material_id');
  });

  test('grid_elevation datum only supports the elevation reference', () => {
    const d = makeDetail(); d.datum = { kind: 'grid_elevation', reference: 'bottom' };
    expect(codes(d)).toContain('datum-combination');
    const e = makeDetail(); e.datum = { kind: 'grid_elevation', reference: 'elevation' };
    expect(codes(e)).not.toContain('datum-combination');
  });

  test('one message per problem: several faults are all reported', () => {
    const d = makeDetail(); d.members[1].role = 'a'; d.geometry.extrusion_m = -1; d.description = '';
    expect(new Set(codes(d))).toEqual(new Set(['role-duplicate', 'extrusion', 'description']));
  });
});

describe('member extent', () => {
  test('forward, backward and centred are accepted', () => {
    for (const extent of ['forward', 'backward', 'centred']) {
      const d = makeDetail(); d.members[0].extent = extent;
      expect(check(d)).toEqual([]);
    }
  });
  test('an unknown extent is reported at its path', () => {
    const d = makeDetail(); d.members[1].extent = 'sideways';
    expect(only(d, 'enum').map((m) => m.path)).toEqual(['members[1].extent']);
  });
});

describe('structure (mirrors the JSON Schema)', () => {
  const mutate = (fn) => { const d = makeDetail(); fn(d); return d; };

  const invalid = {
    'missing $schema':    (d) => { delete d.$schema; },
    'wrong type':         (d) => { d.type = 'Junction'; },
    'missing id':         (d) => { delete d.id; },
    'bad id (capitals)':  (d) => { d.id = 'Detail Corner'; },
    'bad id (underscore)': (d) => { d.id = 'detail_corner'; },
    'empty id':           (d) => { d.id = ''; },
    'missing description': (d) => { delete d.description; },
    'empty description':  (d) => { d.description = ''; },
    'missing members':    (d) => { delete d.members; },
    'single member':      (d) => { d.members = d.members.slice(0, 1); },
    'missing datum':      (d) => { delete d.datum; },
    'bad datum kind':     (d) => { d.datum.kind = 'planet'; },
    'bad datum reference': (d) => { d.datum.reference = 'middle'; },
    'bad plane':          (d) => { d.plane = 'elevation'; },
    'bad member kind':    (d) => { d.members[0].kind = 'spaceship'; },
    'bad member role':    (d) => { d.members[0].role = 'Bad Role'; },
    'bad member extent':  (d) => { d.members[0].extent = 'left'; },
    'extent not a string': (d) => { d.members[0].extent = 1; },
    'missing profile_id': (d) => { delete d.members[0].profile_id; },
    'missing placement':  (d) => { delete d.members[0].placement; },
    'string placement':   (d) => { d.members[0].placement.offset_x_m = '125mm'; },
    'parameter without default': (d) => { delete d.parameters.w.default; },
    'extrusion missing':  (d) => { delete d.geometry.extrusion_m; },
    'extrusion zero':     (d) => { d.geometry.extrusion_m = 0; },
    'coordinate as string': (d) => { d.geometry.regions[0].vertices[0].x = '0.1'; },
    'coordinate expr without param': (d) => { d.geometry.regions[0].vertices[0].x = { scale: 1 }; },
    'coordinate expr empty param': (d) => { d.geometry.regions[0].vertices[0].x = { param: '' }; },
    'coordinate expr bad scale': (d) => { d.geometry.regions[0].vertices[0].x = { param: 'w', scale: 'big' }; },
    'coordinate expr extra key': (d) => { d.geometry.regions[0].vertices[0].x = { param: 'w', surprise: 1 }; },
    'region without material': (d) => { delete d.geometry.regions[0].material_id; },
    'condition bad rule': (d) => { d.condition = { rule: 'weld' }; },
    'condition bad count': (d) => { d.condition = { member_count: 1 }; },
    'condition bad kind': (d) => { d.condition = { member_kinds: ['spaceship'] }; },
    'tags not strings':   (d) => { d.tags = [1]; },
  };
  for (const [name, fn] of Object.entries(invalid)) {
    test(`reports: ${name}`, () => {
      expect(check(mutate(fn)).length, name).toBeGreaterThan(0);
    });
  }

  const unknown = {
    'top level':   (d) => { d.surprise = 1; },
    'member':      (d) => { d.members[0].surprise = 1; },
    'placement':   (d) => { d.members[0].placement.surprise = 1; },
    'datum':       (d) => { d.datum.surprise = 1; },
    'geometry':    (d) => { d.geometry.surprise = 1; },
    'region':      (d) => { d.geometry.regions[0].surprise = 1; },
    'vertex':      (d) => { d.geometry.regions[0].vertices[0].surprise = 1; },
    'parameter':   (d) => { d.parameters.w.surprise = 1; },
    'condition':   (d) => { d.condition = { surprise: 1 }; },
  };
  for (const [name, fn] of Object.entries(unknown)) {
    test(`reports an unknown field at ${name}`, () => {
      expect(codes(mutate(fn))).toContain('unknown-field');
    });
  }

  test('does not throw on a badly shaped document, it reports', () => {
    for (const bad of [null, undefined, 42, 'x', [], {}]) {
      expect(() => validateDetail(bad, CTX)).not.toThrow();
      expect(validateDetail(bad, CTX).length).toBeGreaterThan(0);
    }
    const d = makeDetail(); d.members = 'nope'; d.geometry = { regions: 'nope', extrusion_m: 1 };
    expect(() => check(d)).not.toThrow();
  });

  test('region vertices: rect fixture is fine', () => {
    const d = makeDetail(); d.geometry.regions[0].vertices = rect(0, 0, 1, 1);
    expect(check(d)).toEqual([]);
  });
});
