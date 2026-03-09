import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: '/oebf/',
  build: {
    rollupOptions: {
      input: {
        main:          resolve(__dirname, 'index.html'),
        viewer:        resolve(__dirname, 'viewer.html'),
        editor:        resolve(__dirname, 'editor.html'),
        profileEditor: resolve(__dirname, 'profile-editor.html'),
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
  },
});
