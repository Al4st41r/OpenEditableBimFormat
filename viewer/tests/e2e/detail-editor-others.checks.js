// Detail assignment check (#81 slice 3e). Plain JS, run in the page; writes PASS/FAIL
// lines to an on-screen <pre id="rep"> ending in DONE. Used by tests/e2e/detail-assign.spec.js,
// or on a machine without Playwright:
//   shot-scraper "http://localhost:5199/oebf/detail-editor.html?demo=1" -o out.png --wait 5000 \
//     --javascript "$(cat tests/e2e/detail-editor-others.checks.js)" \
//     --wait-for "document.getElementById('rep')?.textContent.includes('DONE')" -b chromium
(() => {
  const log = [];
  const show = () => { let pre = document.getElementById('rep'); if (!pre) { pre = document.createElement('pre'); pre.id = 'rep'; pre.style.cssText = 'position:fixed;left:255px;bottom:6px;z-index:99;background:#000d;color:#9f9;font:12px monospace;padding:8px;white-space:pre-wrap;max-width:880px;margin:0'; document.body.appendChild(pre); } pre.textContent = log.join('\n'); };
  const note = (ok, name, extra) => { log.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`); show(); };
  const E = window.__detailEditor; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const J = (id) => JSON.parse(E.adapter()._map.get(`junctions/${id}.json`));
  (async () => {
    while (!(E.state() && E.state().doc)) await sleep(100);
    await sleep(300);
    const panel = document.getElementById('right-panel');
    const sel = [...panel.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'junction-ne-padstone'));
    note(!!sel && panel.textContent.includes('Other junctions'), 'others: the padstone (custom rule, not matching the condition) is offered', sel && [...sel.options].map((o) => o.textContent));
    const before = J('junction-ne-padstone');
    [...sel.parentElement.querySelectorAll('button')].find((b) => b.textContent === 'Assign…').click(); await sleep(200);
    const dlg = document.getElementById('loc-dialog');
    note(dlg.open && [...dlg.querySelectorAll('select')].map((s) => s.value).join() === 'grid-structural,2,B,storey-gf', 'others: picker pre-filled with 2 / B @ storey-gf');
    [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'Assign').click(); await sleep(300);
    const after = J('junction-ne-padstone');
    note(after.detail_id === 'detail-corner-cavity-butt' && after.rule === 'custom' && after.custom_geometry === before.custom_geometry, 'others: assigned, and the custom rule and geometry file are kept', { rule: after.rule, custom_geometry: after.custom_geometry });
    note([...panel.querySelectorAll('.box')].length === 5 && !panel.textContent.includes('Other junctions'), 'others: five junctions now use the detail, section gone');
    note(window.__errors.length === 0, 'no page errors', window.__errors);
    log.push('DONE'); show();
  })().catch((e) => { log.push('ERROR ' + e.message); log.push('DONE'); show(); });
})()
