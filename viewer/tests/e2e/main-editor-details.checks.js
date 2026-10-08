// Main editor + detail editor integration check (#81 slice 3d). Plain JS, run in
// the page; writes PASS/FAIL lines to an on-screen <pre id="rep"> ending in DONE.
// Used by tests/e2e/main-editor-details.spec.js, or on a machine without Playwright:
//   shot-scraper "http://localhost:5199/oebf/editor.html?demo=1" -o out.png --wait 6000 \
//     --javascript "$(cat tests/e2e/main-editor-details.checks.js)" \
//     --wait-for "document.getElementById('rep')?.textContent.includes('DONE')" -b chromium \
//     --browser-arg=--enable-webgl --browser-arg=--ignore-gpu-blocklist --browser-arg=--use-gl=swiftshader
(() => {
  const log = [];
  const show = () => {
    let pre = document.getElementById('rep');
    if (!pre) { pre = document.createElement('pre'); pre.id = 'rep'; pre.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99;background:#000d;color:#9f9;font:12px monospace;padding:8px;white-space:pre-wrap;max-width:760px;margin:0'; document.body.appendChild(pre); }
    pre.textContent = log.join('\n');
  };
  const note = (ok, name, extra) => { log.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`); show(); };
  const E = window.__editor;
  const when = (cond, ms = 8000) => new Promise((res, rej) => { const t0 = Date.now(); const i = setInterval(() => { try { if (cond()) { clearInterval(i); res(); } else if (Date.now() - t0 > ms) { clearInterval(i); rej(new Error('timeout: ' + cond)); } } catch (e) { /* keep waiting */ } }, 100); });
  const zmax = (groups) => { let m = -Infinity; for (const g of groups) g.traverse((o) => { if (o.geometry) { o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox; if (b) m = Math.max(m, b.max.z); } }); return m; };

  when(() => E.junctions().length > 0 && E.junctionMarkers().length > 0).then(async () => {
    // tree
    const details = [...document.querySelectorAll('#details-list .tree-item')].map((e) => e.textContent);
    const subs = [...document.querySelectorAll('#subassemblies-list .tree-item')].map((e) => e.textContent);
    note(details.join() === 'detail-corner-cavity-butt', 'tree: Details lists the Detail entity', details);
    note(subs.length === 0, 'tree: Sub-assembly profiles section present and empty', subs);
    note(!document.getElementById('add-detail-btn').disabled && !document.getElementById('add-subassembly-btn').disabled, 'tree: both + buttons enabled');

    // junction markers at real positions
    const m = Object.fromEntries(E.junctionMarkers().map((j) => [j.id, j]));
    const at = (id, x, y) => m[id] && Math.abs(m[id].x - x) < 1e-6 && Math.abs(m[id].y - y) < 1e-6;
    note(at('junction-sw-corner', 0, 0) && at('junction-se-corner', 5.4, 0) && at('junction-nw-corner', 0, 8.5) && at('junction-ne-corner', 5.4, 8.5), 'markers: the four corners sit at their grid intersections');
    note(at('junction-ne-padstone', 5.4, 8.5), 'markers: the padstone (no location) is found from its walls', m['junction-ne-padstone']);
    note(m['junction-se-corner'].detailId === 'detail-corner-cavity-butt' && m['junction-ne-padstone'].detailId === null, 'markers: detail ids carried');

    // 3D groups
    const id = 'detail-corner-cavity-butt';
    const before = E.detailGroups(id);
    note(before.length === 4, 'scene: four detail groups', before.length);
    const z0 = zmax(before);

    // open the detail editor from the tree and answer the handoff
    const orig = window.open; window.open = (...a) => (window.__popup = orig.apply(window, a));
    document.querySelector('#details-list .tree-item').click();
    await when(() => window.__popup && window.__popup.__detailEditor && window.__popup.__detailEditor.state());
    const P = window.__popup, d = P.document;
    note(P.__detailEditor.state().doc.id === id, 'handoff: popup opened the detail from the tree (snapshot)', P.__detailEditor.status());

    // edit the extrusion and save from the popup
    d.querySelector('#left-panel .item:nth-of-type(1)'); // ensure panels rendered
    const ext = [...d.querySelectorAll('#right-panel .row')].find((r) => r.textContent.startsWith('Extrusion')).querySelector('input');
    ext.value = '3300'; ext.dispatchEvent(new P.Event('change', { bubbles: true }));
    d.getElementById('save-btn').click();
    await when(() => /updated/.test(E.status()));
    const after = E.detailGroups(id);
    note(after.length === 4, 'refresh: still four groups, replaced in place', after.length);
    note(Math.abs(zmax(after) - 3.3) < 1e-6 && z0 < 3, 'refresh: geometry now 3.3 m high (was 2.7)', { before: +z0.toFixed(3), after: +zmax(after).toFixed(3) });
    note(E.adapter()._map.get('details/' + id + '.json').includes('3.3'), 'refresh: the detail file was written by the editor');
    note(E.status().includes('4 junctions'), 'status says which junctions changed', E.status());

    // opening from a junction: the Open detail button
    const j = E.junctions().find((x) => x.id === 'junction-se-corner');
    note(!!j.detail_id, 'junction carries its detail id for the properties panel');
    note(window.__errors.length === 0 && P.__errors.length === 0, 'no page errors', [...window.__errors, ...P.__errors]);
    log.push('DONE'); show();
  }).catch((e) => { log.push('ERROR ' + e.message); log.push('DONE'); show(); });
})()
