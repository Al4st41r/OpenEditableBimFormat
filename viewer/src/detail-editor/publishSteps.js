/**
 * publishSteps.js
 *
 * What to do with the files the Publish button downloads, so the served copy of a bundle shows the edit. The site
 * serves a build of the repository, so a browser cannot write to it: the files go into the repo and the site is rebuilt.
 */

/**
 * @param {{ bundleName: string, detailId: string, profiles?: Array<{ id: string, svg: boolean }>, materials?: boolean }} o
 * @returns {{ files: Array<{ name: string, to: string }>, commands: string[] }}
 */
export function publishSteps({ bundleName, detailId, profiles = [], materials = false }) {
  const base = `example/${bundleName}`;
  const files = [{ name: `${detailId}.json`, to: `${base}/details/${detailId}.json` }];
  for (const p of profiles) {
    files.push({ name: `${p.id}.json`, to: `${base}/profiles/${p.id}.json` });
    if (p.svg) files.push({ name: `${p.id}.svg`, to: `${base}/profiles/${p.id}.svg` });
  }
  if (materials) files.push({ name: 'library.json', to: `${base}/materials/library.json` });
  const commands = [
    `cd ifc-tools && uv run oebf validate ../${base}`,
    `cd ifc-tools && uv run --quiet --with zstandard python ../tools/pack_oebfz.py ../${base} ../viewer/public/${bundleName.replace(/\.oebf$/, '')}.oebfz`,
    'cd viewer && npm test && npm run build',
    `git add -A && git commit -m "Update ${detailId}" && git push`,
  ];
  return { files, commands };
}
