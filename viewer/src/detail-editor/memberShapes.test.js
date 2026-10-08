import { describe, test, expect } from 'vitest';
import { buildMemberShapes, placePoint } from './memberShapes.js';
import { readExample, deepFreeze } from './testUtils.js';
import { signedArea } from '../detail/regionGeometry.js';

const close = (a, b, d = 9) => expect(a).toBeCloseTo(b, d);
const PROFILE = () => ({
  id: 'p1', origin: { x: 0.125, y: 0 }, width: 0.25,
  assembly: [
    { layer: 1, name: 'a', material_id: 'm1', thickness: 0.1, function: 'finish' },
    { layer: 2, name: 'b', material_id: 'm2', thickness: 0.05, function: 'insulation' },
    { layer: 3, name: 'c', material_id: 'm3', thickness: 0.1, function: 'structure' },
  ],
});
const member = (placement = {}) => ({ role: 'r', kind: 'wall', profile_id: 'p1', placement: { offset_x_m: 0, offset_y_m: 0, rotation_deg: 0, ...placement } });
const xs = (s) => s.points.map((p) => p.x);
const ys = (s) => s.points.map((p) => p.y);
const range = (v) => [Math.min(...v), Math.max(...v)];

describe('placePoint', () => {
  test('rotates anticlockwise about the origin, then translates', () => {
    const p = placePoint({ offset_x_m: 1, offset_y_m: 2, rotation_deg: 90 }, { x: 3, y: 0 });
    close(p.x, 1); close(p.y, 5);
  });
  test('zero placement is the identity', () => {
    expect(placePoint({ offset_x_m: 0, offset_y_m: 0, rotation_deg: 0 }, { x: 0.3, y: -0.2 })).toEqual({ x: 0.3, y: -0.2 });
  });
  test('180 degrees negates', () => {
    const p = placePoint({ offset_x_m: 0, offset_y_m: 0, rotation_deg: 180 }, { x: 1, y: 2 });
    close(p.x, -1); close(p.y, -2);
  });
});

describe('section view', () => {
  const build = (m = member(), p = PROFILE(), opts = {}) => buildMemberShapes(m, p, { plane: 'section', ...opts });

  test('one shape per layer, in order, with material and function', () => {
    const { shapes } = build();
    expect(shapes.map((s) => s.materialId)).toEqual(['m1', 'm2', 'm3']);
    expect(shapes.map((s) => s.function)).toEqual(['finish', 'insulation', 'structure']);
    expect(shapes.map((s) => s.layer)).toEqual([0, 1, 2]);
  });

  test('layers are bands across the thickness with the profile origin at x = 0', () => {
    const { shapes } = build();
    const [a, b, c] = shapes.map((s) => range(xs(s)));
    close(a[0], -0.125); close(a[1], -0.025);
    close(b[0], -0.025); close(b[1], 0.025);
    close(c[0], 0.025);  close(c[1], 0.125);
  });

  test('height defaults to 2.7 m, or follows the profile height or the option', () => {
    close(range(ys(build().shapes[0]))[1], 2.7);
    close(range(ys(build(member(), { ...PROFILE(), height: 3.1 }).shapes[0]))[1], 3.1);
    close(range(ys(build(member(), PROFILE(), { heightM: 4 }).shapes[0]))[1], 4);
  });

  test('every shape is counter-clockwise', () => {
    for (const s of build(member({ rotation_deg: 37 })).shapes) expect(signedArea(s.points)).toBeGreaterThan(0);
  });

  test('placement offset and rotation are applied', () => {
    const { shapes } = build(member({ offset_x_m: 1, offset_y_m: 2, rotation_deg: 90 }));
    // layer a spans x -0.125..-0.025, y 0..2.7 -> rotate 90: (x,y)->(-y,x), then +(1,2)
    const [x0, x1] = range(xs(shapes[0])), [y0, y1] = range(ys(shapes[0]));
    close(x0, 1 - 2.7); close(x1, 1);
    close(y0, 2 - 0.125); close(y1, 2 - 0.025);
  });

  test('origin is the placement offset; bounds cover every shape', () => {
    const r = build(member({ offset_x_m: 0.4, offset_y_m: -0.1 }));
    expect(r.origin).toEqual({ x: 0.4, y: -0.1 });
    close(r.bounds.min.x, 0.4 - 0.125); close(r.bounds.max.x, 0.4 + 0.125);
    close(r.bounds.min.y, -0.1);        close(r.bounds.max.y, -0.1 + 2.7);
  });

  test('region layers use their own vertices, shifted by the profile origin', () => {
    const p = PROFILE();
    p.assembly.push({ layer: 4, name: 'r', material_id: 'm4', function: 'service', type: 'region',
      vertices: [{ x: 0.1, y: 0.5 }, { x: 0.2, y: 0.5 }, { x: 0.2, y: 1 }, { x: 0.1, y: 1 }] });
    const s = build(member(), p).shapes[3];
    close(range(xs(s))[0], 0.1 - 0.125); close(range(xs(s))[1], 0.2 - 0.125);
    close(range(ys(s))[0], 0.5);
  });

  test('zero-thickness layers are skipped', () => {
    const p = PROFILE(); p.assembly[1].thickness = 0;
    expect(build(member(), p).shapes.map((s) => s.layer)).toEqual([0, 2]);
  });

  test('the example profile gives its four layers across its 290 mm width', () => {
    const { shapes, bounds } = build(member(), readExample('profiles/profile-cavity-250.json'));
    expect(shapes).toHaveLength(4);
    close(bounds.max.x - bounds.min.x, 0.29);
    close(bounds.min.x, -0.145);
  });
});

describe('plan view', () => {
  const build = (m = member(), p = PROFILE(), opts = {}, index = 0) => buildMemberShapes(m, p, { plane: 'plan', index, ...opts });

  // In the 3D model the first layer (profile -x, eg the brick leaf) lies on the LEFT of travel,
  // so plan across-axis = -(profile x): layer a is at +y, the last layer at -y.
  test('layers are contiguous strips; the first layer is on the left of travel (+y)', () => {
    const { shapes } = build();
    const spans = shapes.map((s) => range(ys(s)));
    close(spans[0][0], 0.025);  close(spans[0][1], 0.125);
    close(spans[1][0], -0.025); close(spans[1][1], 0.025);
    close(spans[2][0], -0.125); close(spans[2][1], -0.025);
  });

  test('members are centred on their origin by default, 0.6 m long', () => {
    for (const index of [0, 1]) {
      const [x0, x1] = range(xs(build(member(), PROFILE(), {}, index).shapes[0]));
      close(x0, -0.3); close(x1, 0.3);
    }
  });

  test('member.extent: forward runs along +x from the origin, backward ends at the origin', () => {
    const fwd = range(xs(build({ ...member(), extent: 'forward' }).shapes[0]));
    close(fwd[0], 0); close(fwd[1], 0.6);
    const back = range(xs(build({ ...member(), extent: 'backward' }).shapes[0]));
    close(back[0], -0.6); close(back[1], 0);
    const mid = range(xs(build({ ...member(), extent: 'centred' }).shapes[0]));
    close(mid[0], -0.3); close(mid[1], 0.3);
  });

  test('the length option scales the run; the extent option overrides the member', () => {
    const c = range(xs(build({ ...member(), extent: 'backward' }, PROFILE(), { length: 1, extent: 'forward' }).shapes[0]));
    close(c[0], 0); close(c[1], 1);
  });

  test('rotation turns the strips: 90 degrees runs a forward member along +y', () => {
    const { shapes } = build({ ...member({ rotation_deg: 90 }), extent: 'forward' });
    const [y0, y1] = range(ys(shapes[0]));
    close(y0, 0); close(y1, 0.6);
    const [x0, x1] = range(xs(shapes[0]));
    close(x0, -0.125); close(x1, -0.025); // across +0.025..+0.125 becomes -0.125..-0.025
  });

  test('offset moves the strips', () => {
    const [x0] = range(xs(build({ ...member({ offset_x_m: 1 }), extent: 'forward' }).shapes[0]));
    close(x0, 1);
  });

  test('a region layer appears as a strip over its across-extent', () => {
    const p = PROFILE();
    p.assembly.push({ layer: 4, name: 'r', material_id: 'm4', function: 'service', type: 'region',
      vertices: [{ x: 0.1, y: 0.5 }, { x: 0.2, y: 0.9 }, { x: 0.15, y: 1 }] });
    const s = build(member(), p).shapes[3];
    close(range(ys(s))[0], -(0.2 - 0.125)); close(range(ys(s))[1], -(0.1 - 0.125));
  });

  test('every strip is counter-clockwise, also when rotated', () => {
    for (const s of build(member({ rotation_deg: 123 })).shapes) expect(signedArea(s.points)).toBeGreaterThan(0);
  });

  test('bounds cover all strips', () => {
    const { bounds } = build();
    close(bounds.min.x, -0.3); close(bounds.max.x, 0.3);
    close(bounds.min.y, -0.125); close(bounds.max.y, 0.125);
  });

  test('the example corner: the brick layer is on the exterior (+v) side of the through wall', () => {
    const profile = readExample('profiles/profile-cavity-250.json');
    const { shapes } = build({ ...member(), profile_id: 'profile-cavity-250', extent: 'forward' }, profile);
    const brick = shapes.find((s) => s.layer === 0);
    expect(Math.min(...ys(brick))).toBeGreaterThan(0);          // brick at +y
    expect(Math.max(...ys(shapes.find((s) => s.layer === 3)))).toBeLessThan(0); // plaster at -y
  });
});

describe('problems', () => {
  test('a missing profile gives no shapes and a warning naming it', () => {
    const r = buildMemberShapes(member(), undefined, { plane: 'section' });
    expect(r.shapes).toEqual([]);
    expect(r.bounds).toBeNull();
    expect(r.warnings.join(' ')).toMatch(/p1/);
    expect(r.origin).toEqual({ x: 0, y: 0 });
  });

  test('a profile without an assembly (library dialect) gives a warning, not a throw', () => {
    const r = buildMemberShapes(member(), { id: 'p1', layers: [] }, { plane: 'plan' });
    expect(r.shapes).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/assembly/);
  });

  test('an unknown plane throws', () => {
    expect(() => buildMemberShapes(member(), PROFILE(), { plane: 'elevation' })).toThrow(/plane/);
  });

  test('inputs are not mutated', () => {
    expect(() => buildMemberShapes(deepFreeze(member()), deepFreeze(PROFILE()), { plane: 'section' })).not.toThrow();
    expect(() => buildMemberShapes(deepFreeze(member()), deepFreeze(PROFILE()), { plane: 'plan' })).not.toThrow();
  });
});
