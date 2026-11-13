// Profile change check (issue #91). Plain JS, run in the main editor page; writes PASS/FAIL
// lines to an on-screen <pre id="rep"> ending in DONE. Used by tests/e2e/profile-change.spec.js, or:
//   shot-scraper "http://localhost:5199/oebf/editor.html?demo=1" -o out.png --wait 6000 \
//     --javascript "$(cat tests/e2e/main-editor-profile-change.checks.js)" \
//     --wait-for "document.getElementById('rep')?.textContent.includes('DONE')" -b chromium \
//     --browser-arg=--enable-webgl --browser-arg=--ignore-gpu-blocklist --browser-arg=--use-gl=swiftshader
(() => {
  const log = [];
  const show = () => { let pre = document.getElementById('rep'); if (!pre) { pre = document.createElement('pre'); pre.id = 'rep'; pre.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99;background:#000d;color:#9f9;font:12px monospace;padding:8px;white-space:pre-wrap;max-width:900px;margin:0'; document.body.appendChild(pre); } pre.textContent = log.join('\n'); };
  const note = (ok, name, extra) => { log.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`); show(); };
  const E = window.__editor;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (cond, ms = 10000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timeout ' + cond); await sleep(100); } };
  (async () => {
    await until(() => E.junctions().length > 0);
    await until(() => document.querySelector('#elements-list .tree-item[data-element-id="element-wall-south-gf"]') && E.elementMeshes('element-wall-south-gf') > 0);
    const A = E.adapter(), id = 'element-wall-south-gf';
    const base = JSON.parse(A._map.get('profiles/profile-cavity-250.json'));
    const mat = base.assembly[0].material_id;
    // as the library browser used to write it (library format), and a broken profile
    await A.writeJson('profiles/solid-wall.json', { '$schema': 'oebf://schema/0.1/profile', id: 'solid-wall', type: 'Profile', description: 'lib', profile_type: 'wall', origin_x: 0, layers: [{ id: 'brick', name: 'Solid Brick', thickness_m: 0.215, material_id: mat, function: 'structure' }, { id: 'air', name: 'Cavity', thickness_m: 0.05, material_id: null, function: 'insulation' }] });
    await A.writeJson('profiles/profile-broken.json', { '$schema': 'oebf://schema/0.1/profile', id: 'profile-broken', type: 'Profile', description: 'broken' });
    document.querySelector('#elements-list .tree-item[data-element-id="element-wall-south-gf"]').click();
    const select = () => document.querySelector('#props-content select');
    // wait for the state a check expects instead of a fixed pause (#186); on a timeout the check after it reports FAIL
    const wait = (cond, ms) => until(() => { try { return cond(); } catch { return false; } }, ms).catch(() => {});
    await wait(() => E.selectedId() === id && [...(select()?.options ?? [])].some((o) => o.value === 'solid-wall'));
    const choose = async (pid, done) => { select().value = pid; select().dispatchEvent(new Event('change', { bubbles: true })); await wait(done); };
    const profileOf = () => JSON.parse(A._map.get('elements/' + id + '.json')).profile_id;

    const before = E.elementMeshes(id);
    note(before === 4, 'start: the wall has its four layer meshes', before);

    await choose('solid-wall', () => profileOf() === 'solid-wall' && /Profile updated: solid-wall/.test(E.status()) && E.elementMeshes(id) === 2);
    note(profileOf() === 'solid-wall' && /Profile updated: solid-wall/.test(E.status()), 'library profile: applied, element file updated', E.status());
    note(E.elementMeshes(id) === 2, 'library profile: the wall is rebuilt with the two layers (not gone)', E.elementMeshes(id));

    await choose('profile-broken', () => /failed/.test(E.status()) && /profile-broken/.test(E.status()));
    note(/failed/.test(E.status()) && /profile-broken/.test(E.status()), 'broken profile: the failure names the profile', E.status());
    note(E.elementMeshes(id) === 2 && profileOf() === 'solid-wall', 'broken profile: the wall keeps its geometry and its profile', { meshes: E.elementMeshes(id), profile: profileOf() });

    await choose('profile-cavity-250', () => profileOf() === 'profile-cavity-250' && E.elementMeshes(id) === 4);
    note(E.elementMeshes(id) === 4 && profileOf() === 'profile-cavity-250', 'back to the cavity profile: four meshes again', E.elementMeshes(id));
    note(window.__errors.length === 0, 'no page errors', window.__errors);
    log.push('DONE'); show();
  })().catch((e) => { log.push('ERROR ' + e.message); log.push('DONE'); show(); });
})()
