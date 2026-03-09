import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: 'http://localhost:5174/oebf/',
  },
  webServer: {
    command: 'npm run dev -- --port 5174',
    url: 'http://localhost:5174/oebf/',
    reuseExistingServer: true,
  },
});
