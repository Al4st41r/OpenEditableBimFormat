// Local run on a machine whose installed Chromium build differs from Playwright's pinned one.
// PW_CHROMIUM=/path/to/headless_shell npx playwright test -c playwright.local.config.js
import base from './playwright.config.js';
const exe = process.env.PW_CHROMIUM;
export default {
  ...base,
  projects: base.projects.map((p) => ({
    ...p,
    use: { ...p.use, launchOptions: { ...p.use.launchOptions, ...(exe ? { executablePath: exe } : {}) } },
  })),
};
