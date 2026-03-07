import { describe, test, expect } from 'vitest';
import { loadBundle } from './loadBundle.js';

// ─── Mock File System Access API ────────────────────────────────────────────
//
// Builds a fake FileSystemDirectoryHandle from a flat map of
// relative paths → JSON-serialisable objects.
//
// Supports paths like "elements/element-wall.json" via recursive
// getDirectoryHandle calls, matching the real FSA API shape.

function mockDirHandle(files) {
  return {
    getDirectoryHandle: async (name) => {
      const prefix = name + '/';
      const sub = Object.fromEntries(
        Object.entries(files)
          .filter(([k]) => k.startsWith(prefix))
          .map(([k, v]) => [k.slice(prefix.length), v])
      );
      return mockDirHandle(sub);
    },
    getFileHandle: async (name) => {
      if (!(name in files)) throw new Error(`File not found: ${name}`);
      return {
        getFile: async () => ({
          text: async () => JSON.stringify(files[name]),
        }),
      };
    },
  };
}

// ─── Minimal valid bundle fixture ─────────────────────────────────────────

const MANIFEST = {
  format: 'oebf',
  format_version: '0.1.0',
  project_name: 'Test Bundle',
  units: 'metres',
  coordinate_system: 'right_hand_z_up',
};

const MODEL = {
  elements: ['element-wall-a'],
  junctions: [],
  arrays: [],
};

const MATERIALS = {
  materials: [
    { id: 'mat-brick', type: 'Material', name: 'Brick', category: 'masonry', colour_hex: '#c8602a' },
  ],
};

const PATH_A = {
  id: 'path-wall-a',
  type: 'Path',
  closed: false,
  segments: [{ type: 'line', start: { x: 0, y: 0, z: 0 }, end: { x: 5, y: 0, z: 0 } }],
};

const PROFILE_A = {
  id: 'profile-simple',
  type: 'Profile',
  width: 0.1,
  origin: { x: 0.05, y: 0 },
  assembly: [
    { layer: 1, name: 'Brick', material_id: 'mat-brick', thickness: 0.1, function: 'structure' },
  ],
};

const ELEMENT_A = {
  id: 'element-wall-a',
  type: 'Element',
  description: 'Test wall',
  path_id: 'path-wall-a',
  profile_id: 'profile-simple',
  sweep_mode: 'perpendicular',
};

function bundleFiles(overrides = {}) {
  return {
    'manifest.json':              MANIFEST,
    'model.json':                 MODEL,
    'materials/library.json':     MATERIALS,
    'elements/element-wall-a.json': ELEMENT_A,
    'paths/path-wall-a.json':     PATH_A,
    'profiles/profile-simple.json': PROFILE_A,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('loadBundle — happy path', () => {
  test('returns manifest with project_name', async () => {
    const dirHandle = mockDirHandle(bundleFiles());
    const { manifest } = await loadBundle(dirHandle);
    expect(manifest.project_name).toBe('Test Bundle');
  });

  test('returns one mesh per profile layer', async () => {
    const dirHandle = mockDirHandle(bundleFiles());
    const { meshes } = await loadBundle(dirHandle);
    expect(meshes).toHaveLength(1); // 1 element × 1 layer
  });

  test('mesh colour comes from the material library', async () => {
    const dirHandle = mockDirHandle(bundleFiles());
    const { meshes } = await loadBundle(dirHandle);
    expect(meshes[0].colour).toBe('#c8602a');
  });

  test('mesh carries elementId and description', async () => {
    const dirHandle = mockDirHandle(bundleFiles());
    const { meshes } = await loadBundle(dirHandle);
    expect(meshes[0].elementId).toBe('element-wall-a');
    expect(meshes[0].description).toBe('Test wall');
  });

  test('mesh has vertices, normals, and indices from sweep', async () => {
    const dirHandle = mockDirHandle(bundleFiles());
    const { meshes } = await loadBundle(dirHandle);
    expect(meshes[0].vertices).toBeInstanceOf(Float32Array);
    expect(meshes[0].normals).toBeInstanceOf(Float32Array);
    expect(meshes[0].indices).toBeInstanceOf(Uint32Array);
    expect(meshes[0].vertices.length).toBeGreaterThan(0);
  });

  test('multi-layer profile produces one mesh per layer', async () => {
    const multiProfile = {
      id: 'profile-cavity',
      type: 'Profile',
      width: 0.29,
      origin: { x: 0.145, y: 0 },
      assembly: [
        { layer: 1, name: 'Brick',   material_id: 'mat-brick',  thickness: 0.102, function: 'finish'    },
        { layer: 2, name: 'Block',   material_id: 'mat-brick',  thickness: 0.100, function: 'structure' },
        { layer: 3, name: 'Plaster', material_id: 'mat-brick',  thickness: 0.013, function: 'finish'    },
      ],
    };
    const files = bundleFiles({ 'profiles/profile-simple.json': multiProfile });
    const { meshes } = await loadBundle(mockDirHandle(files));
    expect(meshes).toHaveLength(3);
  });
});

describe('loadBundle — unknown material fallback', () => {
  test('mesh colour falls back to #888888 for an unknown material_id', async () => {
    const profileUnknownMat = {
      ...PROFILE_A,
      assembly: [{ layer: 1, name: 'X', material_id: 'mat-unknown', thickness: 0.1, function: 'structure' }],
    };
    const files = bundleFiles({ 'profiles/profile-simple.json': profileUnknownMat });
    const { meshes } = await loadBundle(mockDirHandle(files));
    expect(meshes[0].colour).toBe('#888888');
  });
});

describe('loadBundle — junctions', () => {
  const JUNCTION_A = {
    id: 'junction-ne-corner',
    type: 'Junction',
    rule: 'butt',
    elements: ['element-wall-north-gf', 'element-wall-east-gf'],
    trim_planes: [{ element_id: 'element-wall-north-gf', at_end: 'end',
                    plane_normal: { x: -1, y: 0, z: 0 },
                    plane_origin: { x: 5.4, y: 0, z: 0 } }],
  };

  test('returns junctions array with loaded junction objects', async () => {
    const model = { elements: ['element-wall-a'], junctions: ['junction-ne-corner'], arrays: [] };
    const files = bundleFiles({
      'model.json': model,
      'junctions/junction-ne-corner.json': JUNCTION_A,
    });
    const { junctions } = await loadBundle(mockDirHandle(files));
    expect(junctions).toHaveLength(1);
    expect(junctions[0].id).toBe('junction-ne-corner');
    expect(junctions[0].trim_planes).toHaveLength(1);
  });

  test('returns empty junctions array when model.junctions is empty', async () => {
    const { junctions } = await loadBundle(mockDirHandle(bundleFiles()));
    expect(junctions).toEqual([]);
  });

  test('skips a missing junction file without throwing', async () => {
    const model = { elements: ['element-wall-a'], junctions: ['junction-missing'], arrays: [] };
    const files = bundleFiles({ 'model.json': model });
    const { junctions, meshes } = await loadBundle(mockDirHandle(files));
    expect(junctions).toHaveLength(0);  // skipped
    expect(meshes).toHaveLength(1);     // elements still load
  });
});

describe('loadBundle — resilience', () => {
  test('skips a missing element file and loads the rest', async () => {
    const model = { elements: ['element-wall-a', 'element-missing'], junctions: [], arrays: [] };
    const files = bundleFiles({ 'model.json': model });
    const { meshes } = await loadBundle(mockDirHandle(files));
    // element-wall-a loads fine; element-missing is skipped with a warning
    expect(meshes).toHaveLength(1);
  });

  test('skips an element with a missing path file', async () => {
    const elementNoBath = { ...ELEMENT_A, path_id: 'path-nonexistent' };
    const files = bundleFiles({ 'elements/element-wall-a.json': elementNoBath });
    const { meshes } = await loadBundle(mockDirHandle(files));
    expect(meshes).toHaveLength(0);
  });
});
