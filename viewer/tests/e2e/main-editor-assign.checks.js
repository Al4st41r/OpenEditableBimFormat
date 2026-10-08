// Detail assignment check (#81 slice 3e). Plain JS, run in the page; writes PASS/FAIL
// lines to an on-screen <pre id="rep"> ending in DONE. Used by tests/e2e/detail-assign.spec.js,
// or on a machine without Playwright:
//   shot-scraper "http://localhost:5199/oebf/editor.html?demo=1" -o out.png --wait 5000 \
//     --javascript "$(cat tests/e2e/main-editor-assign.checks.js)" \
//     --wait-for "document.getElementById('rep')?.textContent.includes('DONE')" -b chromium \
//     --browser-arg=--enable-webgl --browser-arg=--ignore-gpu-blocklist --browser-arg=--use-gl=swiftshader
(() => {
  const log = [];
  const show = () => { let pre = document.getElementById('rep'); if (!pre) { pre = document.createElement('pre'); pre.id = 'rep'; pre.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99;background:#000d;color:#9f9;font:12px monospace;padding:8px;white-space:pre-wrap;max-width:800px;margin:0'; document.body.appendChild(pre); } pre.textContent = log.join('\n'); };
  const note = (ok, name, extra) => { log.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`); show(); };
  const E = window.__editor, id = 'detail-corner-cavity-butt';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (cond, ms = 8000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timeout ' + cond); await sleep(100); } };
  const groupOf = (jid) => E.detailGroups(id).find((g) => g.userData.junctionId === jid);
  const box3 = (g) => { let b = null; g.traverse((o) => { if (o.geometry) { o.geometry.computeBoundingBox(); const bb = o.geometry.boundingBox.clone(); b = b ? b.union(bb) : bb; } }); return b; };
  const J = (jid) => JSON.parse(E.adapter()._map.get(`junctions/${jid}.json`));
  const marker = (jid) => E.junctionMarkers().find((m) => m.id === jid);

  (async () => {
    await until(() => E.junctions().length > 0 && E.junctionMarkers().length > 0);
    await sleep(500);
    const orig = window.open; window.open = (...a) => (window.__popup = orig.apply(window, a));
    document.querySelector('#details-list .tree-item').click();
    await until(() => window.__popup && window.__popup.__detailEditor && window.__popup.__detailEditor.state());
    await sleep(400);
    const P = window.__popup, d = P.document;
    const pbox = (jid) => [...d.querySelectorAll('#right-panel .box')].find((b) => b.textContent.includes(jid));
    const pbtn = (root, label) => [...root.querySelectorAll('button')].find((b) => b.textContent === label);
    note(E.detailGroups(id).length === 4, 'start: four detail groups in the 3D view');

    // unassign SW in the popup
    pbtn(pbox('junction-sw-corner'), 'Unassign').click();
    await until(() => E.detailGroups(id).length === 3);
    note(!groupOf('junction-sw-corner') && !('detail_id' in J('junction-sw-corner')), 'unassign: SW group removed from the 3D view; junction file updated by the editor');
    note(marker('junction-sw-corner').detailId === null, 'unassign: SW marker no longer has a detail');
    note(/junction-sw-corner updated/.test(E.status()), 'unassign: status', E.status());

    // assign it again via the candidate list
    await sleep(300);
    const cand = [...d.querySelectorAll('#right-panel .item')].find((i) => i.querySelector('button') && i.textContent.includes('junction-sw-corner'));
    pbtn(cand, 'Assign…').click(); await sleep(200);
    pbtn(d.getElementById('loc-dialog'), 'Assign').click();
    await until(() => E.detailGroups(id).length === 4);
    note(!!groupOf('junction-sw-corner') && J('junction-sw-corner').detail_id === id, 'assign: SW group is back in the 3D view; file has the link');
    const sw = box3(groupOf('junction-sw-corner'));
    note(Math.abs((sw.min.x + sw.max.x) / 2) < 0.5 && Math.abs((sw.min.y + sw.max.y) / 2) < 0.5, 'assign: the new geometry sits at the SW corner', { x: +((sw.min.x + sw.max.x) / 2).toFixed(3), y: +((sw.min.y + sw.max.y) / 2).toFixed(3) });
    note(marker('junction-sw-corner').detailId === id, 'assign: SW marker has the detail again');

    // mirror NE: the trim block should move to the other side of the through wall (the east wall at x = 5.4)
    const ne0 = box3(groupOf('junction-ne-corner')); const cx0 = (ne0.min.x + ne0.max.x) / 2;
    const cb = pbox('junction-ne-corner').querySelector('input[type=checkbox]'); cb.checked = true; cb.dispatchEvent(new P.Event('change', { bubbles: true }));
    await until(() => { const g = groupOf('junction-ne-corner'); if (!g) return false; const b = box3(g); return Math.abs((b.min.x + b.max.x) / 2 - cx0) > 0.1; });
    const ne1 = box3(groupOf('junction-ne-corner')); const cx1 = (ne1.min.x + ne1.max.x) / 2;
    note(cx0 > 5.4 && cx1 < 5.4, 'mirror: NE block moved from the east face to the west face of the east wall', { before: +cx0.toFixed(3), after: +cx1.toFixed(3) });
    note(J('junction-ne-corner').detail_mirrored === true && E.detailGroups(id).length === 4, 'mirror: flag saved and still four groups');

    // override SE width to the maximum
    const w0 = (() => { const b = box3(groupOf('junction-se-corner')); return Math.max(b.max.x - b.min.x, b.max.y - b.min.y); })();
    const inp = pbox('junction-se-corner').querySelector('input[type=number]'); inp.value = '0.1'; inp.dispatchEvent(new P.Event('change', { bubbles: true }));
    await until(() => { const g = groupOf('junction-se-corner'); if (!g) return false; const b = box3(g); return Math.max(b.max.x - b.min.x, b.max.y - b.min.y) > w0 + 0.01; });
    const b2 = box3(groupOf('junction-se-corner'));
    note(Math.abs(Math.max(b2.max.x - b2.min.x, b2.max.y - b2.min.y) - 0.1) < 1e-6 && J('junction-se-corner').detail_overrides.cavity_closer_width_m === 0.1, 'override: SE block widened from 0.075 to 0.1 m', { before: +w0.toFixed(3) });

    note(window.__errors.length === 0 && P.__errors.length === 0, 'no page errors', [...window.__errors, ...P.__errors]);
    log.push('DONE'); show();
  })().catch((e) => { log.push('ERROR ' + e.message); log.push('DONE'); show(); });
})()
