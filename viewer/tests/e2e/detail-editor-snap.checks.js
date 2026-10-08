// Smart cursor and dimension checks for the detail editor (issue #105, slice 2).
//   shot-scraper "http://localhost:5199/oebf/detail-editor.html?demo=1" -o out.png --wait 5000 \
//     --javascript "$(cat tests/e2e/detail-editor-snap.checks.js)" -b chromium --wait 6000
(() => {
  const log = [];
  const show = () => { let pre = document.getElementById('rep'); if (!pre) { pre = document.createElement('pre'); pre.id = 'rep'; pre.style.cssText = 'position:fixed;left:255px;bottom:6px;z-index:99;background:#000d;color:#9f9;font:11.5px monospace;padding:8px;white-space:pre-wrap;max-width:880px;margin:0'; document.body.appendChild(pre); } pre.textContent = log.join('\n'); };
  const note = (ok, name, extra) => { log.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`); show(); };
  const E = window.__detailEditor, svg = document.getElementById('canvas');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const px = (x, y) => { const v = E.view(), s = E.size(), r = svg.getBoundingClientRect(); return { clientX: r.left + s.width / 2 + (x - v.cx) * v.scale, clientY: r.top + s.height / 2 - (y - v.cy) * v.scale }; };
  const ptr = (type, x, y, extra = {}) => svg.dispatchEvent(new PointerEvent(type, { ...px(x, y), button: 0, pointerId: 1, bubbles: true, ...extra }));
  const doc = () => E.state().doc;
  (async () => {
    await sleep(500);
    const v0 = doc().geometry.regions[0].vertices[0];
    document.getElementById('tool-rect').click();
    ptr('pointermove', v0.x + 0.002, v0.y + 0.002); await sleep(100);
    note(E.hint()?.snap?.kind === 'endpoint', 'hover near a vertex snaps to the endpoint', E.hint()?.snap?.kind);
    note(!document.getElementById('tip').hidden && document.getElementById('tip').textContent.length > 0, 'tooltip visible', document.getElementById('tip').textContent);
    ptr('pointermove', v0.x + 0.002, v0.y + 0.002, { altKey: true }); await sleep(100);
    note(E.hint()?.snap?.kind !== 'endpoint', 'Alt suspends snapping', E.hint()?.snap?.kind);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true })); await sleep(50);
    note(E.snapState().on === false, 'S key toggles snapping off');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
    document.getElementById('tool-select').click();
    // edge length via panel
    [...document.querySelectorAll('#left-panel .item')].find((i) => i.textContent.includes('Region 0')).click(); await sleep(150);
    const row = [...document.querySelectorAll('#right-panel .row')].find((r) => r.textContent.startsWith('Edge 0'));
    note(!!row, 'edge length field shown');
    const before = JSON.stringify(doc().geometry.regions[0].vertices);
    const inp = row.querySelector('input'); inp.value = '123+77'; inp.dispatchEvent(new Event('change', { bubbles: true })); await sleep(150);
    const vs = doc().geometry.regions[0].vertices;
    const len = Math.hypot(vs[1].x - vs[0].x, vs[1].y - vs[0].y);
    note(JSON.stringify(vs) !== before && Math.abs(len - 0.2) < 1e-6, 'typed 123+77 sets edge length 200 mm', len);
    document.getElementById('undo-btn').click(); await sleep(100);
    note(JSON.stringify(doc().geometry.regions[0].vertices) === before, 'undo restores the edge');
    note(window.__errors.length === 0, 'no page errors', window.__errors);
    log.push('DONE'); show();
  })().catch((e) => { log.push('ERROR ' + e.message); log.push('DONE'); show(); });
})()
