// Detail assignment check (#81 slice 3e). Plain JS, run in the page; writes PASS/FAIL
// lines to an on-screen <pre id="rep"> ending in DONE. Used by tests/e2e/detail-assign.spec.js,
// or on a machine without Playwright:
//   shot-scraper "http://localhost:5199/oebf/detail-editor.html?demo=1" -o out.png --wait 5000 \
//     --javascript "$(cat tests/e2e/detail-editor-assign.checks.js)" \
//     --wait-for "document.getElementById('rep')?.textContent.includes('DONE')" -b chromium
(() => {
  const log = [];
  const show = () => { let pre = document.getElementById('rep'); if (!pre) { pre = document.createElement('pre'); pre.id = 'rep'; pre.style.cssText = 'position:fixed;left:255px;bottom:6px;z-index:99;background:#000d;color:#9f9;font:11.5px monospace;padding:8px;white-space:pre-wrap;max-width:880px;margin:0'; document.body.appendChild(pre); } pre.textContent = log.join('\n'); };
  const note = (ok, name, extra) => { log.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`); show(); };
  const E = window.__detailEditor;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const J = (id) => JSON.parse(E.adapter()._map.get(`junctions/${id}.json`));
  const boxes = () => [...document.querySelectorAll('#right-panel .box')];
  const box = (id) => boxes().find((b) => b.textContent.includes(id));
  const btn = (root, label) => [...root.querySelectorAll('button')].find((b) => b.textContent === label);
  const cands = () => [...document.querySelectorAll('#right-panel .item')].filter((i) => i.querySelector('button'));
  const setNum = (input, v) => { input.value = String(v); input.dispatchEvent(new Event('change', { bubbles: true })); };

  (async () => {
    while (!(E.state() && E.state().doc)) await sleep(100);
    await sleep(300);
    note(boxes().length === 4, 'usage: four junctions listed with their settings', boxes().length);
    const se = box('junction-se-corner');
    note(se.textContent.includes('2 / A @ storey-gf') && se.querySelector('input[type=number]').value === '0.075' && !!btn(se, 'Reset'), 'usage: SE shows its location and overridden width 0.075 with Reset');
    note(box('junction-sw-corner').textContent.includes('default') , 'usage: SW shows the default value');

    // unassign SW
    const swBefore = J('junction-sw-corner');
    btn(box('junction-sw-corner'), 'Unassign').click(); await sleep(250);
    const sw = J('junction-sw-corner');
    note(!('detail_id' in sw) && !('location' in sw), 'unassign: link and location removed from the junction file');
    note(JSON.stringify(sw.priority) === JSON.stringify(swBefore.priority) && JSON.stringify(sw.trim_planes) === JSON.stringify(swBefore.trim_planes) && sw.rule === 'butt', 'unassign: priority, trim planes and rule kept');
    note(boxes().length === 3, 'unassign: three junctions left', boxes().length);
    const c = cands();
    note(c.length === 1 && c[0].textContent.includes('junction-sw-corner') && c[0].textContent.includes('1 / A @ storey-gf') && !c[0].textContent.includes('approx'), 'candidates: SW is offered with the suggestion 1 / A @ storey-gf', c.map((x) => x.textContent));

    // assign through the picker
    btn(c[0], 'Assign…').click(); await sleep(150);
    const dlg = document.getElementById('loc-dialog');
    const sel = [...dlg.querySelectorAll('select')].map((s) => s.value);
    note(dlg.open && sel.join() === 'grid-structural,1,A,storey-gf', 'picker: opens pre-filled from the suggestion', sel);
    btn(dlg, 'Assign').click(); await sleep(250);
    const sw2 = J('junction-sw-corner');
    note(sw2.detail_id === 'detail-corner-cavity-butt' && JSON.stringify(sw2.location.axes) === '["1","A"]' && sw2.location.level_id === 'storey-gf', 'assign: junction file has the detail and location', sw2.location);
    note(JSON.stringify(sw2.priority) === JSON.stringify(swBefore.priority) && boxes().length === 4 && cands().length === 0, 'assign: other fields kept, four junctions again, no candidates');

    // overrides
    const input = () => box('junction-se-corner').querySelector('input[type=number]');
    setNum(input(), 0.09); await sleep(250);
    note(J('junction-se-corner').detail_overrides.cavity_closer_width_m === 0.09, 'override: 0.09 written');
    setNum(input(), 0.5); await sleep(250);
    note(J('junction-se-corner').detail_overrides.cavity_closer_width_m === 0.09 && /outside/.test(E.status()), 'override: out of range refused, file unchanged', E.status());
    btn(box('junction-se-corner'), 'Reset').click(); await sleep(250);
    note(!('detail_overrides' in J('junction-se-corner')), 'override: Reset removes the override (empty map not stored)');

    // mirror
    const cb = () => box('junction-nw-corner').querySelector('input[type=checkbox]');
    cb().checked = true; cb().dispatchEvent(new Event('change', { bubbles: true })); await sleep(250);
    note(J('junction-nw-corner').detail_mirrored === true, 'mirror: flag written');
    cb().checked = false; cb().dispatchEvent(new Event('change', { bubbles: true })); await sleep(250);
    note(!('detail_mirrored' in J('junction-nw-corner')), 'mirror: cleared flag is omitted');

    // unsaved changes lock junction edits
    const ext = [...document.querySelectorAll('#right-panel .row')].find((r) => r.textContent.startsWith('Extrusion')).querySelector('input');
    setNum(ext, 3000); await sleep(150);
    note(/Save the detail before/.test(document.getElementById('right-panel').textContent) && btn(box('junction-ne-corner'), 'Unassign').disabled, 'lock: junction controls disabled while the detail has unsaved changes');
    document.getElementById('undo-btn').click(); await sleep(150);
    note(!btn(box('junction-ne-corner'), 'Unassign').disabled, 'lock: enabled again after undo');

    // change location
    btn(box('junction-ne-corner'), 'Change location').click(); await sleep(150);
    const dlg2 = document.getElementById('loc-dialog');
    note(dlg2.open && [...dlg2.querySelectorAll('select')].map((s) => s.value).join() === 'grid-structural,2,B,storey-gf', 'change location: picker shows the current location');
    btn(dlg2, 'Cancel').click();
    note(window.__errors.length === 0, 'no page errors', window.__errors);
    log.push('DONE'); show();
  })().catch((e) => { log.push('ERROR ' + e.message + ' ' + (e.stack || '').split('\n')[1]); log.push('DONE'); show(); });
})()
