import { describe, test, expect } from 'vitest';
import { buildMemberShapes, placePoint, isStackedSlab } from './memberShapes.js';
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

describe('stacked slab profiles', () => {
  const slab = {
    id: 'profile-fl', profile_type: 'slab', alignment: 'top-face', width: 1.0, origin: { x: 0.5, y: 0 },
    assembly: [
      { layer: 1, name: 'finish', material_id: 'mat-a', thickness: 0.02, function: 'finish' },
      { layer: 2, name: 'clt', material_id: 'mat-b', thickness: 0.14, function: 'structure' },
    ],
  };
  const member = { role: 'floor', kind: 'slab', profile_id: 'profile-fl', placement: { offset_x_m: 0, offset_y_m: 0, rotation_deg: 0 } };
  const ys = (shape) => shape.points.map((p) => p.y);
  const xs = (shape) => shape.points.map((p) => p.x);

  test('only top-face and bottom-face slab profiles are stacked', () => {
    expect(isStackedSlab(slab)).toBe(true);
    expect(isStackedSlab({ ...slab, alignment: 'bottom-face' })).toBe(true);
    expect(isStackedSlab({ ...slab, alignment: 'center' })).toBe(false);      // the profile editor's own slab profiles
    expect(isStackedSlab({ ...slab, profile_type: 'wall' })).toBe(false);
    expect(isStackedSlab(undefined)).toBe(false);
  });

  test('section: layers hang down from the top face, across the width', () => {
    const { shapes, warnings } = buildMemberShapes(member, slab, { plane: 'section' });
    expect(warnings).toEqual([]);
    expect(shapes.map((s) => s.materialId)).toEqual(['mat-a', 'mat-b']);
    expect(Math.min(...ys(shapes[0]))).toBeCloseTo(-0.02, 9);
    expect(Math.max(...ys(shapes[0]))).toBe(0);
    expect(Math.min(...ys(shapes[1]))).toBeCloseTo(-0.16, 9);
    expect(Math.max(...ys(shapes[1]))).toBeCloseTo(-0.02, 9);
    expect(Math.min(...xs(shapes[0]))).toBeCloseTo(-0.5, 9);
    expect(Math.max(...xs(shapes[0]))).toBeCloseTo(0.5, 9);
  });

  test('bottom-face stacks upwards', () => {
    const { shapes } = buildMemberShapes(member, { ...slab, alignment: 'bottom-face' }, { plane: 'section' });
    expect(Math.min(...ys(shapes[0]))).toBe(0);
    expect(Math.max(...ys(shapes[1]))).toBeCloseTo(0.16, 9);
  });

  test('the placement moves and rotates the stack', () => {
    const moved = { ...member, placement: { offset_x_m: 2, offset_y_m: 1, rotation_deg: 0 } };
    const { shapes } = buildMemberShapes(moved, slab, { plane: 'section' });
    expect(Math.max(...ys(shapes[0]))).toBe(1);
    expect(Math.min(...xs(shapes[0]))).toBeCloseTo(1.5, 9);
  });

  test('plan: one footprint, in the top layer\'s material', () => {
    const { shapes } = buildMemberShapes(member, slab, { plane: 'plan', length: 0.6 });
    expect(shapes).toHaveLength(1);
    expect(shapes[0].materialId).toBe('mat-a');
    expect(Math.max(...xs(shapes[0])) - Math.min(...xs(shapes[0]))).toBeCloseTo(0.6, 9);
    expect(Math.max(...ys(shapes[0])) - Math.min(...ys(shapes[0]))).toBeCloseTo(1.0, 9);
  });

  test('a wall-style profile is unchanged', () => {
    const wall = { id: 'w', width: 0.2, origin: { x: 0.1, y: 0 }, assembly: [{ layer: 1, material_id: 'm', thickness: 0.2, function: 'structure' }] };
    const { shapes } = buildMemberShapes(member, wall, { plane: 'section', heightM: 2 });
    expect(Math.max(...ys(shapes[0]))).toBe(2);
  });
});

import { describeLayers, startFromPoint, profileOriginX } from './memberShapes.js';

describe('layer starts', () => {
  const profile = {
    id: 'p', width: 0.3, origin: { x: 0.15, y: 0 }, height_limit_m: 2,
    assembly: [
      { layer: 1, name: 'brick', material_id: 'a', thickness: 0.1, function: 'finish' },
      { layer: 2, name: 'cavity', material_id: 'b', thickness: 0.05, function: 'insulation' },
      { layer: 3, name: 'block', material_id: 'c', thickness: 0.1, function: 'structure' },
    ],
  };
  const member = (extra = {}) => ({ role: 'w', kind: 'wall', profile_id: 'p', placement: { offset_x_m: 0, offset_y_m: 0, rotation_deg: 0 }, ...extra });

  test('layers start where the ones before end, unless the member overrides one', () => {
    const close = (got, want) => got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 9));
    close(describeLayers(member(), profile).map((l) => l.start), [0, 0.1, 0.15]);
    const moved = describeLayers(member({ layer_starts: [{ layer: 2, start_m: 0.2 }] }), profile);
    close(moved.map((l) => l.start), [0, 0.2, 0.15]);            // only that layer moves; the next still follows the natural stack
    expect(moved[1]).toMatchObject({ natural: 0.1, override: 0.2 });
    expect(describeLayers(member(), {})).toEqual([]);
  });

  test('a moved band is drawn from its new start', () => {
    const base = buildMemberShapes(member(), profile, { plane: 'section' }).shapes;
    const moved = buildMemberShapes(member({ layer_starts: [{ layer: 2, start_m: 0.2 }] }), profile, { plane: 'section' }).shapes;
    const xs = (s) => s.points.map((p) => p.x);
    expect(Math.min(...xs(base[1]))).toBeCloseTo(-0.05);                  // 0.1 - origin 0.15
    expect(Math.min(...xs(moved[1]))).toBeCloseTo(0.05);                  // 0.2 - 0.15
    expect(Math.max(...xs(moved[1])) - Math.min(...xs(moved[1]))).toBeCloseTo(0.05);   // thickness kept
    expect(moved[1].key).toBe(2);
    expect(moved[1].startPoint.x).toBeCloseTo(0.05);
  });

  test('a moved region layer shifts as a whole so its left edge is at the start', () => {
    const p = { ...profile, assembly: [...profile.assembly, { layer: 4, name: 'tie', material_id: 'd', function: 'structure', type: 'region', vertices: [{ x: 0.1, y: 0 }, { x: 0.2, y: 0 }, { x: 0.2, y: 0.5 }, { x: 0.1, y: 0.5 }] }] };
    const shape = (m) => buildMemberShapes(m, p, { plane: 'section' }).shapes.find((s) => s.key === 4);
    expect(Math.min(...shape(member()).points.map((q) => q.x))).toBeCloseTo(-0.05);
    expect(Math.min(...shape(member({ layer_starts: [{ layer: 4, start_m: 0.25 }] })).points.map((q) => q.x))).toBeCloseTo(0.1);
  });

  test('startFromPoint inverts the start handle, in a section and in a plan, with rotation', () => {
    const frame = (plane, rotation_deg) => ({ placement: { offset_x_m: 1, offset_y_m: 2, rotation_deg }, originX: 0.15, plane });
    for (const [plane, rot] of [['section', 0], ['section', 30], ['plan', 0], ['plan', 90]]) {
      const m = member({ placement: { offset_x_m: 1, offset_y_m: 2, rotation_deg: rot }, layer_starts: [{ layer: 2, start_m: 0.2 }] });
      const sh = buildMemberShapes(m, profile, { plane }).shapes.find((s) => s.key === 2);
      expect(startFromPoint(frame(plane, rot), sh.startPoint)).toBeCloseTo(0.2, 6);
    }
    expect(profileOriginX(profile)).toBe(0.15);
    expect(profileOriginX({ width: 0.4 })).toBe(0.2);
  });
});

import { unitSpans } from './memberShapes.js';

describe('layers drawn as units', () => {
  const profile = {
    id: 'p', width: 0.3, origin: { x: 0.15, y: 0 }, height_limit_m: 2,
    assembly: [
      { layer: 1, name: 'brick', material_id: 'brick', thickness: 0.1, function: 'finish' },
      { layer: 2, name: 'cavity', material_id: 'air', thickness: 0.1, function: 'insulation' },
    ],
  };
  const member = (units, extra = {}) => ({ role: 'w', kind: 'wall', profile_id: 'p', placement: { offset_x_m: 0, offset_y_m: 0, rotation_deg: 0 }, layer_units: units, ...extra });
  const brick = { layer: 1, depth_m: 0.2, repeat_m: 0.21 };
  const unitsOf = (shapes) => shapes.filter((s) => s.unit !== undefined);
  const spanX = (s) => [Math.min(...s.points.map((p) => p.x)), Math.max(...s.points.map((p) => p.x))];
  const spanY = (s) => [Math.min(...s.points.map((p) => p.y)), Math.max(...s.points.map((p) => p.y))];

  test('unitSpans fills the run, or places exactly the count from the start offset', () => {
    expect(unitSpans({ depth_m: 0.2, repeat_m: 0.21 }, [0, 1]).spans).toHaveLength(4);        // 0, .21, .42, .63 (+.2 = .83); a fifth would end at 1.04
    expect(unitSpans({ depth_m: 0.2, repeat_m: 0.2 }, [0, 1]).spans).toHaveLength(5);         // joints of zero fit exactly
    expect(unitSpans({ depth_m: 0.2, repeat_m: 0.21, count: 2, start_m: 0.5 }, [0, 1]).spans).toEqual([[0.5, 0.7], [0.71, 0.91]].map(([a, b]) => [expect.closeTo(a, 9), expect.closeTo(b, 9)]));
    expect(unitSpans({ depth_m: 2, repeat_m: 2 }, [0, 1]).spans).toEqual([]);                  // a unit longer than the run does not fit
    const big = unitSpans({ depth_m: 0.001, repeat_m: 0.001 }, [0, 100]);
    expect(big.spans).toHaveLength(400); expect(big.truncated).toBe(true);
  });

  test('in plan the units run along the wall and are as thick as the layer; the other layers stay strips', () => {
    const r = buildMemberShapes(member([brick]), profile, { plane: 'plan', length: 1, extent: 'forward' });
    const units = unitsOf(r.shapes);
    expect(units).toHaveLength(4);
    expect(spanX(units[0])[0]).toBeCloseTo(0); expect(spanX(units[0])[1]).toBeCloseTo(0.2);
    expect(spanX(units[1])[0]).toBeCloseTo(0.21);                                              // 10 mm joint
    const across = spanY(units[0]);
    expect(across[1] - across[0]).toBeCloseTo(0.1);                                            // the layer thickness
    expect(r.shapes.filter((s) => s.layer === 1)).toHaveLength(1);                             // the cavity layer is one strip
    expect(units.every((s) => s.materialId === 'brick' && s.key === 1)).toBe(true);
  });

  test('in section the units stack up the wall', () => {
    const r = buildMemberShapes(member([{ layer: 1, depth_m: 0.065, repeat_m: 0.075 }]), profile, { plane: 'section', heightM: 1 });
    const units = unitsOf(r.shapes);
    expect(units).toHaveLength(13);                                                            // courses to 1 m
    expect(spanY(units[1])[0]).toBeCloseTo(0.075);
    expect(spanY(units[0])[1] - spanY(units[0])[0]).toBeCloseTo(0.065);
    expect(spanX(units[0])[1] - spanX(units[0])[0]).toBeCloseTo(0.1);
  });

  test('a joint material keeps the strip underneath as the bed, and units can change material', () => {
    const r = buildMemberShapes(member([{ ...brick, material_id: 'engineering-brick', joint_material_id: 'mortar' }]), profile, { plane: 'plan', length: 1, extent: 'forward' });
    const bed = r.shapes.find((s) => s.bed);
    expect(bed.materialId).toBe('mortar');
    expect(r.shapes.indexOf(bed)).toBeLessThan(r.shapes.indexOf(unitsOf(r.shapes)[0]));         // drawn first, so the units sit on it
    expect(unitsOf(r.shapes)[0].materialId).toBe('engineering-brick');
  });

  test('units follow the member placement and rotation, and the start handle stays on the first shape only', () => {
    const rotated = member([brick], { placement: { offset_x_m: 1, offset_y_m: 2, rotation_deg: 90 } });
    const r = buildMemberShapes(rotated, profile, { plane: 'plan', length: 1, extent: 'forward' });
    const units = unitsOf(r.shapes);
    expect(spanY(units[0])[0]).toBeCloseTo(2); expect(spanY(units[1])[0]).toBeCloseTo(2.21);   // along y after a quarter turn
    expect(r.shapes.filter((s) => s.layer === 0 && s.startPoint)).toHaveLength(1);
  });

  test('more than the cap shows the cap with a warning', () => {
    const r = buildMemberShapes(member([{ layer: 1, depth_m: 0.001, repeat_m: 0.001, count: 1000 }]), profile, { plane: 'plan', length: 1 });
    expect(unitsOf(r.shapes)).toHaveLength(400);
    expect(r.warnings.join(' ')).toMatch(/more than 400/);
  });
});

describe('units start at the origin end of the run', () => {
  const profile = { id: 'p', width: 0.1, origin: { x: 0, y: 0 }, assembly: [{ layer: 1, name: 'b', material_id: 'brick', thickness: 0.1, function: 'finish' }] };
  const m = (extent) => ({ role: 'w', kind: 'wall', profile_id: 'p', extent, placement: { offset_x_m: 0, offset_y_m: 0, rotation_deg: 0 }, layer_units: [{ layer: 1, depth_m: 0.2, repeat_m: 0.21 }] });
  const xs = (r) => r.shapes.filter((s) => s.unit !== undefined).map((s) => [Math.min(...s.points.map((p) => p.x)), Math.max(...s.points.map((p) => p.x))]);

  test('a backward member arriving at its origin ends with a whole unit there, and runs away from it', () => {
    const r = xs(buildMemberShapes(m('backward'), profile, { plane: 'plan', length: 0.6 }));
    expect(r[0][1]).toBeCloseTo(0);                    // the first unit touches the origin
    expect(r[0][0]).toBeCloseTo(-0.2);
    expect(r[1][1]).toBeCloseTo(-0.21);
  });
  test('a forward member starts at its origin; a centred one at its left end', () => {
    expect(xs(buildMemberShapes(m('forward'), profile, { plane: 'plan', length: 0.6 }))[0][0]).toBeCloseTo(0);
    expect(xs(buildMemberShapes(m('centred'), profile, { plane: 'plan', length: 0.6 }))[0][0]).toBeCloseTo(-0.3);
  });
});

import { runningBondSpans } from './memberShapes.js';

describe('bond and courses', () => {
  const brick = { depth_m: 0.2, repeat_m: 0.21, height_m: 0.06, course_m: 0.07 };
  const profile = { id: 'p', width: 0.1, origin: { x: 0, y: 0 }, assembly: [{ layer: 1, name: 'b', material_id: 'brick', thickness: 0.1, function: 'finish' }] };
  const wall = (unit) => ({ role: 'w', kind: 'wall', profile_id: 'p', extent: 'forward', placement: { offset_x_m: 0, offset_y_m: 0, rotation_deg: 0 }, layer_units: [{ layer: 1, ...unit }] });
  const units = (r) => r.shapes.filter((s) => s.unit !== undefined);

  test('an odd course starts with a half unit and then whole units offset by half a pitch', () => {
    const s = runningBondSpans({ depth_m: 0.215, repeat_m: 0.225 }, [0, 1]);
    expect(s[0][0]).toBeCloseTo(0); expect(s[0][1]).toBeCloseTo(0.1025);      // the bat: (215 - 10) / 2
    expect(s[1][0]).toBeCloseTo(0.1125); expect(s[1][1]).toBeCloseTo(0.3275);  // then whole bricks at the half pitch
    expect(s.at(-1)[1]).toBeLessThanOrEqual(1 + 1e-9);                         // none run past the end
  });

  test('without the courses option the plan shows one row, as before', () => {
    const r = buildMemberShapes(wall(brick), profile, { plane: 'plan', length: 1 });
    expect(units(r).every((s) => s.w0 === undefined)).toBe(true);
    expect(units(r)).toHaveLength(4);
  });

  test('with courses each course is a row at its own height, and a running bond offsets every second one', () => {
    const r = buildMemberShapes(wall({ ...brick, bond: 'running' }), profile, { plane: 'plan', length: 1, courses: true, wallTop: 0.3 });
    const byCourse = (c) => units(r).filter((s) => s.course === c);
    expect(new Set(units(r).map((s) => s.course))).toEqual(new Set([0, 1, 2, 3]));            // 0.3 m / 0.07 = 4 courses
    expect(byCourse(0)[0].w0).toBeCloseTo(0); expect(byCourse(0)[0].w1).toBeCloseTo(0.06);
    expect(byCourse(2)[0].w0).toBeCloseTo(0.14);
    const startX = (s) => Math.min(...s.points.map((p) => p.x));
    expect(startX(byCourse(0)[1])).toBeCloseTo(0.21);                                         // stretcher course: whole bricks
    expect(startX(byCourse(1)[1])).toBeGreaterThan(0.1);                                      // odd course: shifted
    expect(startX(byCourse(1)[1])).not.toBeCloseTo(0.21);
    expect(byCourse(1).length).toBeGreaterThanOrEqual(byCourse(0).length);                    // the bat adds one
  });

  test('a stack bond puts every course over the one below', () => {
    const r = buildMemberShapes(wall({ ...brick, bond: 'stack' }), profile, { plane: 'plan', length: 1, courses: true, wallTop: 0.15 });
    const xs = (c) => units(r).filter((s) => s.course === c).map((s) => Math.min(...s.points.map((p) => p.x)).toFixed(4));
    expect(xs(1)).toEqual(xs(0));
  });

  test('the last course does not rise above the wall', () => {
    const r = buildMemberShapes(wall(brick), profile, { plane: 'plan', length: 0.3, courses: true, wallTop: 0.2 });
    expect(Math.max(...units(r).map((s) => s.w1))).toBeLessThanOrEqual(0.2 + 1e-9);
  });

  test('courses are mirrored for a member that arrives at its origin (backward) and are ignored in section', () => {
    const back = buildMemberShapes({ ...wall({ ...brick, bond: 'running' }), extent: 'backward' }, profile, { plane: 'plan', length: 1, courses: true, wallTop: 0.15 });
    expect(Math.max(...units(back).filter((s) => s.course === 0).map((s) => Math.max(...s.points.map((p) => p.x))))).toBeCloseTo(0);
    const section = buildMemberShapes(wall(brick), profile, { plane: 'section', heightM: 1, courses: true, wallTop: 1 });
    expect(units(section).every((s) => s.course === undefined)).toBe(true);
  });

  test('a huge wall is capped with a warning', () => {
    const r = buildMemberShapes(wall({ depth_m: 0.01, repeat_m: 0.011, height_m: 0.01, course_m: 0.011 }), profile, { plane: 'plan', length: 3, courses: true, wallTop: 3 });
    expect(units(r).length).toBeLessThanOrEqual(1500);
    expect(r.warnings.join(' ')).toMatch(/more than 1500/);
  });
});

import { effectiveOriginX } from './memberShapes.js';

describe('insertion point on a layer', () => {
  const profile = {
    id: 'p', width: 0.3, origin: { x: 0.15, y: 0 }, height_limit_m: 2,
    assembly: [
      { layer: 1, name: 'brick', material_id: 'a', thickness: 0.1, function: 'finish' },
      { layer: 2, name: 'cavity', material_id: 'b', thickness: 0.05, function: 'insulation' },
      { layer: 3, name: 'block', material_id: 'c', thickness: 0.15, function: 'structure' },
    ],
  };
  const member = (insertion, extra = {}) => ({ role: 'w', kind: 'wall', profile_id: 'p', insertion, placement: { offset_x_m: 0, offset_y_m: 0, rotation_deg: 0 }, ...extra });

  test('without an insertion the profile origin is used', () => {
    expect(effectiveOriginX(member(undefined), profile)).toBe(0.15);
  });
  test('left face, centre and right face of a layer', () => {
    expect(effectiveOriginX(member({ layer: 3, at: 'left-face' }), profile)).toBeCloseTo(0.15);    // block starts at 0.15
    expect(effectiveOriginX(member({ layer: 3, at: 'centre' }), profile)).toBeCloseTo(0.225);
    expect(effectiveOriginX(member({ layer: 3, at: 'right-face' }), profile)).toBeCloseTo(0.3);
    expect(effectiveOriginX(member({ layer: 1, at: 'left-face' }), profile)).toBe(0);
  });
  test('follows a layer start override, and an unknown layer falls back to the profile origin', () => {
    expect(effectiveOriginX(member({ layer: 3, at: 'left-face' }, { layer_starts: [{ layer: 3, start_m: 0.2 }] }), profile)).toBeCloseTo(0.2);
    expect(effectiveOriginX(member({ layer: 9, at: 'centre' }), profile)).toBe(0.15);
  });
  test('the member is drawn with that point at its origin: the chosen face is at x = 0 in a section', () => {
    const xsOf = (m, key) => buildMemberShapes(m, profile, { plane: 'section' }).shapes.find((s) => s.key === key).points.map((p) => p.x);
    expect(Math.min(...xsOf(member({ layer: 3, at: 'left-face' }), 3))).toBeCloseTo(0);          // block's left face on the origin
    expect(Math.min(...xsOf(member({ layer: 1, at: 'left-face' }), 1))).toBeCloseTo(0);          // the external face of the brick
    expect(Math.max(...xsOf(member({ layer: 3, at: 'right-face' }), 3))).toBeCloseTo(0);
    expect(Math.min(...xsOf(member(undefined), 1))).toBeCloseTo(-0.15);                           // default: the middle of the profile
  });
  test('in plan the chosen face sits on the member axis, whichever way the member turns', () => {
    const m = member({ layer: 3, at: 'left-face' }, { placement: { offset_x_m: 1, offset_y_m: 2, rotation_deg: 90 } });
    const sh = buildMemberShapes(m, profile, { plane: 'plan', length: 1 }).shapes.find((s) => s.key === 3);
    // rotated a quarter turn the across axis is x: the block's near face is on x = 1 (the offset)
    expect(Math.max(...sh.points.map((p) => p.x))).toBeCloseTo(1 + 0.15, 6);
    expect(Math.min(...sh.points.map((p) => p.x))).toBeCloseTo(1, 6);
  });
});

describe('layers starting and finishing at different points', () => {
  const profile = {
    id: 'p', width: 0.3, origin: { x: 0.15, y: 0 }, height_limit_m: 2,
    assembly: [
      { layer: 1, name: 'brick', material_id: 'a', thickness: 0.1, function: 'finish' },
      { layer: 2, name: 'block', material_id: 'c', thickness: 0.2, function: 'structure' },
    ],
  };
  const member = (ends, extent, extra = {}) => ({ role: 'w', kind: 'wall', profile_id: 'p', extent, layer_ends: ends, placement: { offset_x_m: 0, offset_y_m: 0, rotation_deg: 0 }, ...extra });
  const runOf = (r, key) => { const s = r.shapes.find((x) => x.key === key); const xs = s.points.map((p) => p.x); return [Math.min(...xs), Math.max(...xs)]; };

  test('a backward wall: the origin end is its right end, the far end its left', () => {
    const r = buildMemberShapes(member([{ layer: 1, near_m: 0.1, far_m: -0.05 }], 'backward'), profile, { plane: 'plan', length: 1 });
    expect(runOf(r, 1)[1]).toBeCloseTo(0.1);               // brick runs 100 mm past the origin
    expect(runOf(r, 1)[0]).toBeCloseTo(-0.95);             // and stops 50 mm short at the far end
    expect(runOf(r, 2)).toEqual([expect.closeTo(-1, 9), expect.closeTo(0, 9)]);   // the block is untouched
  });
  test('a forward wall: the origin end is its left end', () => {
    const r = buildMemberShapes(member([{ layer: 2, near_m: -0.2, far_m: 0.3 }], 'forward'), profile, { plane: 'plan', length: 1 });
    expect(runOf(r, 2)[0]).toBeCloseTo(0.2);
    expect(runOf(r, 2)[1]).toBeCloseTo(1.3);
  });
  test('in a section the origin end is the bottom and the far end the top', () => {
    const r = buildMemberShapes(member([{ layer: 1, near_m: 0.1, far_m: -0.2 }]), profile, { plane: 'section', heightM: 2 });
    const ys = r.shapes.find((s) => s.key === 1).points.map((p) => p.y);
    expect(Math.min(...ys)).toBeCloseTo(-0.1); expect(Math.max(...ys)).toBeCloseTo(1.8);
  });
  test('a layer shortened away to nothing is left out; the others stay', () => {
    const r = buildMemberShapes(member([{ layer: 1, near_m: -0.6, far_m: -0.6 }], 'forward'), profile, { plane: 'plan', length: 1 });
    expect(r.shapes.map((s) => s.key)).toEqual([2]);
  });
  test('units fill the layer\'s own run, so a staggered brick leaf gets more bricks', () => {
    const units = [{ layer: 1, depth_m: 0.2, repeat_m: 0.21 }];
    const count = (ends) => buildMemberShapes(member(ends, 'forward', { layer_units: units }), profile, { plane: 'plan', length: 1 }).shapes.filter((s) => s.unit !== undefined).length;
    expect(count(undefined)).toBe(4);
    expect(count([{ layer: 1, far_m: 0.5 }])).toBe(7);
  });
  test('each layer gets a handle at both ends, at the ends the layer really has', () => {
    const r = buildMemberShapes(member([{ layer: 1, near_m: 0.1 }], 'backward'), profile, { plane: 'plan', length: 1 });
    const hs = r.shapes.find((s) => s.key === 1).endHandles;
    expect(hs.map((h) => h.which)).toEqual(['near', 'far']);
    expect(hs[0].point.x).toBeCloseTo(0.1); expect(hs[1].point.x).toBeCloseTo(-1);
    expect(hs[0].run).toMatchObject({ sign: -1, base: 0 });
    expect(hs[1].run.base).toBe(1);
  });
});
