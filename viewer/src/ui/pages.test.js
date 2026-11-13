// pages.test.js — The app pages hang together: each is built, each app links home and takes the shared control styles,
// and the launch page offers every app (#157, #164).
import { test, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (f) => readFileSync(new URL(f, root), 'utf8');
const APPS = ['viewer.html', 'editor.html', 'profile-editor.html', 'detail-editor.html', 'detail-axo.html'];

test('every page in viewer/ is a Vite input, so none is a 404 once deployed', () => {
  const config = read('vite.config.js');
  const pages = readdirSync(root).filter((f) => f.endsWith('.html'));
  for (const page of pages) expect(config, page).toContain(`'${page}'`);
});

test('each app takes the shared control styles and links back to the applications page', () => {
  for (const app of APPS) {
    const html = read(app);
    expect(html, app).toContain('<link rel="stylesheet" href="/src/ui/ui.css">');
    expect(html, app).toMatch(/<a href="launch.html" class="home-link"[^>]*aria-label="[^"]+"/);
  }
});

test('pages link public files without the base, so Vite adds /oebf/ once in dev and build (#175)', () => {
  for (const page of readdirSync(root).filter((f) => f.endsWith('.html'))) {
    expect(read(page), page).not.toMatch(/(href|src)="\/oebf\//);
  }
});

test('the launch page has a card for every app, and a title of its own', () => {
  const launch = read('launch.html');
  for (const app of APPS) expect(launch, app).toContain(`<a href="${app}" class="card">`);
  const title = (html) => html.match(/<title>([^<]+)<\/title>/)[1];
  expect(title(launch)).not.toBe(title(read('index.html')));
});
