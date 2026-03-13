import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  snapshotDir: './tests/e2e/screenshots',
  use: {
    baseURL: 'http://localhost:5174/oebf/',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--enable-webgl',
            '--ignore-gpu-blocklist',
            '--use-gl=swiftshader',
          ],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 5174',
    url: 'http://localhost:5174/oebf/',
    reuseExistingServer: true,
  },
});
