// Building reference navigation check (#81 phase 4). Plain JS, run in the main editor page;
// writes PASS/FAIL lines to an on-screen <pre id="rep"> ending in DONE. Used by
// tests/e2e/detail-reference.spec.js, or without Playwright:
//   shot-scraper "http://localhost:5199/oebf/editor.html?demo=1" -o out.png --wait 6000 \
//     --javascript "$(cat tests/e2e/main-editor-reference.checks.js)" \
//     --wait-for "document.getElementById('rep')?.textContent.includes('DONE')" -b chromium \
//     --browser-arg=--enable-webgl --browser-arg=--ignore-gpu-blocklist --browser-arg=--use-gl=swiftshader
(() => {
  const log = [];
  const show = () => { let pre = document.getElementById('rep'); if (!pre) { pre = document.createElement('pre'); pre.id = 'rep'; pre.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99;background:#000d;color:#9f9;font:12px monospace;padding:8px;white-space:pre-wrap;max-width:800px;margin:0'; document.body.appendChild(pre); } pre.textContent = log.join('\n'); };
  const note = (ok, name, extra) => { log.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`); show(); };
  const E = window.__editor;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (cond, ms = 8000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timeout ' + cond); await sleep(100); } };
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  (async () => {
    await until(() => E.junctions().length > 0 && E.junctionMarkers().length > 0);
    await sleep(500);
    const orig = window.open; window.open = (...a) => (window.__popup = orig.apply(window, a));
    document.querySelector('#details-list .tree-item').click();
    await until(() => window.__popup && window.__popup.__detailEditor && window.__popup.__detailEditor.state());
    await sleep(500);
    const P = window.__popup, d = P.document;
    const markers = () => [...d.querySelectorAll('#right-panel .ref svg g[data-junction]')];
    const marker = (id) => markers().find((g) => g.getAttribute('data-junction') === id);
    note(markers().length === 5, 'plan: five markers drawn (four corners and the padstone)', markers().length);
    note(d.querySelector('#right-panel .legend').textContent.includes('detail-corner-cavity-butt (4)') && d.querySelector('#right-panel .legend').textContent.includes('no detail (1)'), 'legend: 4 using the detail, 1 with none', d.querySelector('#right-panel .legend').textContent);
    note(marker('junction-se-corner').querySelector('title').textContent.includes('uses this detail'), 'tooltip: marker names its junction and state');

    // click a marker: highlights its row
    marker('junction-se-corner').dispatchEvent(new P.MouseEvent('click', { bubbles: true }));
    await sleep(200);
    const hl = d.querySelector('#right-panel .box.hl');
    note(hl && hl.getAttribute('data-id') === 'junction-se-corner', 'click a marker: its usage row is highlighted');
    note(!!d.querySelector('#right-panel .ref + .legend') && d.querySelector('#right-panel').textContent.includes('Show in 3D editor'), 'click a marker: Show in 3D editor offered');

    // show in 3D
    const t0 = E.cameraTarget();
    [...d.querySelectorAll('#right-panel button')].find((b) => b.textContent === 'Show in 3D editor').click();
    await until(() => near(E.cameraTarget().x, 5.4) && near(E.cameraTarget().y, 0));
    note(near(E.cameraTarget().x, 5.4) && near(E.cameraTarget().y, 0), 'show in 3D: the 3D camera now looks at the SE corner', { from: [+t0.x.toFixed(2), +t0.y.toFixed(2)], to: [E.cameraTarget().x, E.cameraTarget().y] });
    const panel = document.getElementById('props-content').textContent;
    note(panel.includes('Junction') && panel.includes('element-wall-south-gf') && panel.includes('detail-corner-cavity-butt'), 'show in 3D: junction selected in the properties panel');
    note(panel.includes('Also used at (3)'), 'properties: lists the 3 other places this detail is used');

    // navigate between instances from the main editor
    [...document.querySelectorAll('#props-content button')].find((b) => b.textContent === 'junction-nw-corner').click();
    await sleep(200);
    note(near(E.cameraTarget().x, 0) && near(E.cameraTarget().y, 8.5), 'also used at: clicking junction-nw-corner moves the camera to the NW corner', E.cameraTarget());
    note(/junction-nw-corner/.test(E.status()), 'status', E.status());

    // toggle highlight off, click a marker with no detail
    marker('junction-se-corner').dispatchEvent(new P.MouseEvent('click', { bubbles: true })); await sleep(150);
    note(!d.querySelector('#right-panel .box.hl'), 'click the same marker again: highlight cleared');
    note(window.__errors.length === 0 && P.__errors.length === 0, 'no page errors', [...window.__errors, ...P.__errors]);
    log.push('DONE'); show();
  })().catch((e) => { log.push('ERROR ' + e.message); log.push('DONE'); show(); });
})()
