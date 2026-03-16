import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname2 = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  base: '/oebf/',
  resolve: {
    alias: {
      // Force ESM source entry points to avoid CJS circular dependency in
      // three-mesh-bvh and three-bvh-csg when running under Vitest node env.
      'three-mesh-bvh': resolve(__dirname2, 'node_modules/three-mesh-bvh/src/index.js'),
      'three-bvh-csg': resolve(__dirname2, 'node_modules/three-bvh-csg/src/index.js'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main:          resolve(__dirname2, 'index.html'),
        launch:        resolve(__dirname2, 'launch.html'),
        viewer:        resolve(__dirname2, 'viewer.html'),
        editor:        resolve(__dirname2, 'editor.html'),
        profileEditor: resolve(__dirname2, 'profile-editor.html'),
      },
    },
  },
  server: {
    fs: {
      allow: ['..'], // allow serving example/ bundle files via public/ symlink
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
    server: {
      deps: {
        // Force ESM builds for three-bvh-csg and three-mesh-bvh to avoid
        // the CJS circular dependency that breaks in the node environment.
        inline: ['three-bvh-csg', 'three-mesh-bvh'],
      },
    },
  },
});
