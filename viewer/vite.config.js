import { defineConfig } from 'vite';

export default defineConfig({
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
