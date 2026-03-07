import { describe, test, expect } from 'vitest';
import { buildProfileShape } from './loadProfile.js';

describe('buildProfileShape — single layer', () => {
  test('single layer: returns one shape with four rectangle points', () => {
    const profileData = {
      id: 'profile-simple',
      type: 'Profile',
      svg_file: 'profiles/test.svg',
      width: 0.1,
      origin: { x: 0.05, y: 0 },
      alignment: 'center',
      assembly: [
        { layer: 1, name: 'Wall', material_id: 'mat-a', thickness: 0.1, function: 'structure' }
      ]
    };
    const shapes = buildProfileShape(profileData);
    expect(shapes).toHaveLength(1);
    expect(shapes[0].points).toHaveLength(4);
    expect(shapes[0].materialId).toBe('mat-a');
    expect(shapes[0].width).toBeCloseTo(0.1);
  });

  test('single layer: rectangle is centred on origin.x', () => {
    const profileData = {
      id: 'profile-centred',
      type: 'Profile',
      width: 0.2,
      origin: { x: 0.1, y: 0 },
      assembly: [
        { layer: 1, name: 'Wall', material_id: 'mat-a', thickness: 0.2, function: 'structure' }
      ]
    };
    const shapes = buildProfileShape(profileData);
    const pts = shapes[0].points;
    // With origin.x = 0.1 and thickness 0.2: x0 = -0.1, x1 = 0.1
    expect(pts[0].x).toBeCloseTo(-0.1);
    expect(pts[1].x).toBeCloseTo(0.1);
  });
});

describe('buildProfileShape — multi-layer', () => {
  test('multi-layer: returns one shape per assembly layer', () => {
    const profileData = {
      id: 'profile-multi',
      type: 'Profile',
      width: 0.25,
      origin: { x: 0.125, y: 0 },
      assembly: [
        { layer: 1, name: 'L1', material_id: 'mat-a', thickness: 0.102, function: 'finish'     },
        { layer: 2, name: 'L2', material_id: 'mat-b', thickness: 0.075, function: 'insulation' },
        { layer: 3, name: 'L3', material_id: 'mat-c', thickness: 0.073, function: 'structure'  }
      ]
    };
    const shapes = buildProfileShape(profileData);
    expect(shapes).toHaveLength(3);
    expect(shapes[0].width).toBeCloseTo(0.102);
    expect(shapes[1].width).toBeCloseTo(0.075);
    expect(shapes[2].width).toBeCloseTo(0.073);
  });

  test('multi-layer: materialId is set on each shape', () => {
    const profileData = {
      id: 'profile-ids',
      type: 'Profile',
      width: 0.2,
      origin: { x: 0.1, y: 0 },
      assembly: [
        { layer: 1, name: 'A', material_id: 'mat-brick', thickness: 0.1, function: 'finish'    },
        { layer: 2, name: 'B', material_id: 'mat-block', thickness: 0.1, function: 'structure' }
      ]
    };
    const shapes = buildProfileShape(profileData);
    expect(shapes[0].materialId).toBe('mat-brick');
    expect(shapes[1].materialId).toBe('mat-block');
  });

  test('multi-layer: layers are contiguous — no gaps between rectangles', () => {
    const profileData = {
      id: 'profile-contiguous',
      type: 'Profile',
      width: 0.3,
      origin: { x: 0.15, y: 0 },
      assembly: [
        { layer: 1, name: 'A', material_id: 'mat-a', thickness: 0.1, function: 'finish'    },
        { layer: 2, name: 'B', material_id: 'mat-b', thickness: 0.1, function: 'insulation'},
        { layer: 3, name: 'C', material_id: 'mat-c', thickness: 0.1, function: 'structure' }
      ]
    };
    const shapes = buildProfileShape(profileData);
    // Right edge of each layer must equal left edge of next
    for (let i = 0; i < shapes.length - 1; i++) {
      const rightEdge = shapes[i].points[1].x;    // x1 of layer i
      const leftEdge  = shapes[i + 1].points[0].x; // x0 of layer i+1
      expect(rightEdge).toBeCloseTo(leftEdge);
    }
  });
});

describe('buildProfileShape — real cavity wall profile', () => {
  test('cavity-250: 4 layers, widths match spec', () => {
    const profileData = {
      '$schema': 'oebf://schema/0.1/profile',
      id: 'profile-cavity-250',
      type: 'Profile',
      svg_file: 'profiles/profile-cavity-250.svg',
      width: 0.290,
      height: null,
      origin: { x: 0.145, y: 0.0 },
      alignment: 'center',
      assembly: [
        { layer: 1, name: 'External Brick Leaf',  material_id: 'mat-brick-common',    thickness: 0.102, function: 'finish'     },
        { layer: 2, name: 'Cavity + PIR',          material_id: 'mat-pir-insulation',  thickness: 0.075, function: 'insulation' },
        { layer: 3, name: 'Dense Aggregate Block', material_id: 'mat-dense-aggregate', thickness: 0.100, function: 'structure'  },
        { layer: 4, name: 'Gypsum Plaster Skim',   material_id: 'mat-gypsum-plaster',  thickness: 0.013, function: 'finish'     }
      ]
    };
    const shapes = buildProfileShape(profileData);
    expect(shapes).toHaveLength(4);
    expect(shapes[0].width).toBeCloseTo(0.102);
    expect(shapes[1].width).toBeCloseTo(0.075);
    expect(shapes[2].width).toBeCloseTo(0.100);
    expect(shapes[3].width).toBeCloseTo(0.013);
    // Total width of all layers = 0.290
    const totalWidth = shapes.reduce((sum, s) => sum + s.width, 0);
    expect(totalWidth).toBeCloseTo(0.290);
  });

  test('cavity-250: custom wall height is applied to all layers', () => {
    const profileData = {
      id: 'profile-cavity-250',
      type: 'Profile',
      width: 0.290,
      origin: { x: 0.145, y: 0.0 },
      assembly: [
        { layer: 1, name: 'Brick', material_id: 'mat-brick', thickness: 0.102, function: 'finish' }
      ]
    };
    const shapes = buildProfileShape(profileData, 3.0);
    const pts = shapes[0].points;
    const maxY = Math.max(...pts.map(p => p.y));
    expect(maxY).toBeCloseTo(3.0);
  });
});

describe('buildProfileShape — edge cases', () => {
  test('empty assembly: returns empty array', () => {
    const profileData = {
      id: 'profile-empty',
      type: 'Profile',
      width: 0.1,
      origin: { x: 0.05, y: 0 },
      assembly: []
    };
    const shapes = buildProfileShape(profileData);
    expect(shapes).toHaveLength(0);
  });

  test('missing origin: defaults to half width as centreline', () => {
    const profileData = {
      id: 'profile-no-origin',
      type: 'Profile',
      width: 0.2,
      assembly: [
        { layer: 1, name: 'Wall', material_id: 'mat-a', thickness: 0.2, function: 'structure' }
      ]
    };
    const shapes = buildProfileShape(profileData);
    const pts = shapes[0].points;
    // origin defaults to width/2 = 0.1 → x0 = -0.1, x1 = 0.1
    expect(pts[0].x).toBeCloseTo(-0.1);
    expect(pts[1].x).toBeCloseTo(0.1);
  });

  test('zero-thickness layer is skipped or produces zero-width shape without throwing', () => {
    const profile = {
      id: 'p', type: 'Profile', width: 0.1,
      origin: { x: 0.05, y: 0 },
      assembly: [
        { layer: 1, name: 'Brick', material_id: 'mat-a', thickness: 0.1, function: 'structure' },
        { layer: 2, name: 'Air',   material_id: 'mat-b', thickness: 0.0, function: 'cavity' },
      ],
    };
    expect(() => buildProfileShape(profile)).not.toThrow();
    const shapes = buildProfileShape(profile);
    // Should return at least the non-zero layer
    expect(shapes.length).toBeGreaterThanOrEqual(1);
  });

  test('single-layer profile produces exactly one shape', () => {
    const profile = {
      id: 'p', type: 'Profile', width: 0.102,
      origin: { x: 0.051, y: 0 },
      assembly: [
        { layer: 1, name: 'Brick', material_id: 'mat-a', thickness: 0.102, function: 'structure' },
      ],
    };
    const shapes = buildProfileShape(profile);
    expect(shapes).toHaveLength(1);
  });
});
