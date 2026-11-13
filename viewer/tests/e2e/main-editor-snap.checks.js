// Smart cursor and typed length checks for the 3D editor (issue #105, slice 3). Plain JS, run in the
// editor page with the demo bundle; writes PASS/FAIL lines to an on-screen <pre id="rep"> ending in DONE.
//   shot-scraper "http://localhost:5199/oebf/editor.html?demo=1" -o out.png --wait 6000 \
//     --javascript "$(cat tests/e2e/main-editor-snap.checks.js)" \
//     --wait-for "document.getElementById('rep')?.textContent.includes('DONE')" -b chromium \
//     --browser-arg=--enable-webgl --browser-arg=--ignore-gpu-blocklist --browser-arg=--use-gl=swiftshader
(() => {
  const log = [];
  const show = () => { let pre = document.getElementById('rep'); if (!pre) { pre = document.createElement('pre'); pre.id = 'rep'; pre.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99;background:#000d;color:#9f9;font:12px monospace;padding:8px;white-space:pre-wrap;max-width:900px;margin:0'; document.body.appendChild(pre); } pre.textContent = log.join('\n'); };
  const note = (ok, name, extra) => { log.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`); show(); };
  const E = window.__editor;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (cond, ms = 10000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timeout ' + cond); await sleep(100); } };
  const canvas = document.querySelector('#viewport canvas') ?? document.querySelector('canvas');
  const ev = (type, x, y, extra = {}) => canvas.dispatchEvent(new MouseEvent(type, { ...E.worldToScreen(x, y), bubbles: true, button: 0, ...extra }));
  const path = (id) => E.registryPaths().find((p) => p.id === id);
  // wait for the state a check expects instead of a fixed pause (#186); on a timeout the check after it reports FAIL
  const wait = (cond, ms) => until(() => { try { return cond(); } catch { return false; } }, ms).catch(() => {});
  // the node handles are placed in the scene when the next frame is drawn, and only then can a drag pick them
  const nextFrame = async () => { const n = E.renderFrames(); await wait(() => E.renderFrames() > n, 3000); };
  const active = (id) => document.getElementById(id).classList.contains('active');
  const tipShown = () => [...document.querySelectorAll('body > div')].some((d) => d.style.whiteSpace === 'pre' && d.style.display === 'block' && /X /.test(d.textContent));
  (async () => {
    await until(() => E.junctions().length > 0);
    await until(() => path('path-wall-south-gf') && document.querySelector('#elements-list .tree-item[data-element-id="element-wall-south-gf"]'));

    // the engine over the real registry and grid
    const near = E.planSnap({ x: 0.02, y: 8.49 }, { tolerance: 0.1 });
    note(near.kind === 'endpoint' && near.point.x === 0 && near.point.y === 8.5, 'planSnap: near a wall corner snaps to the endpoint', near.kind);
    const alt = E.planSnap({ x: 0.02, y: 8.49 }, { tolerance: 0.1, suspend: true });
    note(alt.kind === 'none', 'planSnap: suspend returns the raw point', alt.kind);

    // drawing a wall with the smart cursor
    // the plan camera is placed when the next frame is drawn; the wall tool activates once the default profile is ready
    const frames = E.renderFrames();
    document.getElementById('view-plan').click(); await wait(() => E.renderFrames() > frames);
    document.getElementById('tool-wall').click(); await wait(() => active('tool-wall'));
    const before = E.registryPaths().length;
    // the drawing tool handles each event as it is dispatched, so no pause is needed between them
    ev('mousemove', 5.4 + 0.03, 8.5 - 0.03);
    ev('click', 5.4 + 0.03, 8.5 - 0.03, { detail: 1 });
    ev('mousemove', 9, 8.5); ev('click', 9.04, 8.52, { detail: 1 });
    ev('dblclick', 9.04, 8.52, { detail: 2 }); await until(() => E.registryPaths().length > before, 6000).catch(() => {});
    const made = E.registryPaths().at(-1);
    const seg = made?.segments?.[0];
    note(E.registryPaths().length === before + 1 && seg && Math.abs(seg.start.x - 5.4) < 1e-6 && Math.abs(seg.start.y - 8.5) < 1e-6, 'wall start snapped to the existing corner', seg?.start);
    note(seg && Math.abs(seg.end.y - 8.5) < 1e-6 && Math.abs(seg.end.x - 9) < 0.06, 'wall end aligned with the corner (same y)', seg?.end);

    // typed length with attached paths following
    document.getElementById('tool-select').click();
    document.querySelector('#elements-list .tree-item[data-element-id="element-wall-south-gf"]').click();
    await wait(() => E.selectedId() === 'element-wall-south-gf' && document.getElementById('seg-length-0'));
    const inp = document.getElementById('seg-length-0');
    note(!!inp, 'length field shown in the properties panel');
    const sel = [...document.querySelectorAll('#props-content select')].find((s) => [...s.options].some((o) => o.value === 'centre'));
    sel.value = 'end'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    inp.value = '5000'; inp.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(() => JSON.parse(E.adapter()._map.get('paths/path-wall-east-gf.json')).segments[0].end.x === 5 && /followed/.test(E.status()));
    const south = path('path-wall-south-gf').segments[0], east = path('path-wall-east-gf').segments[0];
    note(Math.abs(south.start.x - 5) < 1e-6 && south.end.x === 0, 'typed 5000: south wall is 5 m, end held', south);
    note(Math.abs(east.end.x - 5) < 1e-6 && Math.abs(east.end.y) < 1e-6, 'attached east wall followed the moved end', east.end);
    note(JSON.parse(E.adapter()._map.get('paths/path-wall-east-gf.json')).segments[0].end.x === 5, 'the attached path was saved');
    note(/followed/.test(E.status()), 'status reports the attached path', E.status());

    const bad = document.getElementById('seg-length-0');
    bad.value = 'abc'; bad.dispatchEvent(new Event('change', { bubbles: true })); await wait(() => /Could not read/.test(E.status()));
    note(/Could not read/.test(E.status()) && path('path-wall-south-gf').segments[0].start.x === south.start.x, 'invalid text is refused and nothing changes', E.status());
    // dragging a node with the smart cursor (#107)
    document.getElementById('tool-path-edit').click(); await wait(() => active('tool-path-edit')); await nextFrame();
    const drag = async (to, extra = {}) => {
      const from = { ...path('path-wall-south-gf').segments[0].start };
      ev('mousedown', from.x, from.y);
      window.dispatchEvent(new MouseEvent('mousemove', { ...E.worldToScreen(to.x, to.y), bubbles: true, ...extra }));
      await wait(tipShown, 2000);
      const tip = tipShown();
      window.dispatchEvent(new MouseEvent('mouseup', { ...E.worldToScreen(to.x, to.y), bubbles: true, ...extra }));
      // the node has moved once the registry holds the new start
      await wait(() => { const at = path('path-wall-south-gf').segments[0].start; return at.x !== from.x || at.y !== from.y; });
      return { at: path('path-wall-south-gf').segments[0].start, tip };
    };
    const cursor = { x: 5.37, y: 1.3 };
    const snapped = await drag(cursor);
    note(Math.hypot(snapped.at.x - cursor.x, snapped.at.y - cursor.y) > 1e-6, 'node drag snaps (the result differs from the raw cursor)', snapped.at);
    note(snapped.tip, 'node drag shows the tooltip');
    document.getElementById('tool-path-edit').click(); await nextFrame();
    const raw = await drag({ x: 5.2, y: 2.1 }, { altKey: true });
    note(Math.abs(raw.at.x - 5.2) < 0.1 && Math.abs(raw.at.y - 2.1) < 0.1, 'Alt suspends snapping during a node drag', raw.at);
    note(window.__errors === undefined || window.__errors.length === 0, 'no page errors', window.__errors);
    log.push('DONE'); show();
  })().catch((e) => { log.push('ERROR ' + e.message); log.push('DONE'); show(); });
})()
