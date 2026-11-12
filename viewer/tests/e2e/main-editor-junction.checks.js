// Main editor + detail editor integration check (#81 slice 3d). Plain JS, run in
// the page; writes PASS/FAIL lines to an on-screen <pre id="rep"> ending in DONE.
// Used by tests/e2e/main-editor-details.spec.js, or on a machine without Playwright:
//   shot-scraper "http://localhost:5199/oebf/editor.html?demo=1" -o out.png --wait 6000 \
//     --javascript "$(cat tests/e2e/main-editor-junction.checks.js)" \
//     --wait-for "document.getElementById('rep')?.textContent.includes('DONE')" -b chromium \
//     --browser-arg=--enable-webgl --browser-arg=--ignore-gpu-blocklist --browser-arg=--use-gl=swiftshader
(() => {
  const log = [];
  const show = () => { let pre = document.getElementById('rep'); if (!pre) { pre = document.createElement('pre'); pre.id = 'rep'; pre.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99;background:#000d;color:#9f9;font:12px monospace;padding:8px;white-space:pre-wrap;max-width:760px;margin:0'; document.body.appendChild(pre); } pre.textContent = log.join('\n'); };
  const note = (ok, name, extra) => { log.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`); show(); };
  const E = window.__editor;
  const when = (cond, ms = 20000) => new Promise((res, rej) => { const t0 = Date.now(); const i = setInterval(() => { try { if (cond()) { clearInterval(i); res(); } else if (Date.now() - t0 > ms) { clearInterval(i); rej(new Error('timeout')); } } catch (e) {} }, 100); });
  const buttons = () => [...document.querySelectorAll('#props-content button')].map((b) => b.textContent);
  when(() => E.junctionMarkers().length >= 5 && E.junctions().some((j) => j.id === 'junction-se-corner')).then(async () => {
    // padstone: no detail, so no Open detail button
    E.showJunction('junction-ne-padstone');
    note(!buttons().includes('Open detail'), 'padstone: no Open detail button', buttons());

    // SE corner: shows the link and opens the detail editor
    E.showJunction('junction-se-corner');
    const panel = document.getElementById('props-content').textContent;
    note(panel.includes('detail-corner-cavity-butt') && buttons().includes('Open detail'), 'SE corner: detail shown with an Open detail button', buttons());

    // Apply must keep the detail link, location, override and trim data (was overwritten before)
    const A = E.adapter(), write = A.writeJson;
    const before = JSON.parse(A._map.get('junctions/junction-se-corner.json'));
    let written = false;   // Apply reads then writes asynchronously: wait for the write, not a fixed delay
    A.writeJson = async (path, ...rest) => { const r = await write.call(A, path, ...rest); if (path === 'junctions/junction-se-corner.json') written = true; return r; };
    [...document.querySelectorAll('#props-content button')].find((b) => b.textContent === 'Apply').click();
    await when(() => written).finally(() => { A.writeJson = write; });
    const after = JSON.parse(E.adapter()._map.get('junctions/junction-se-corner.json'));
    const keep = ['detail_id', 'location', 'detail_overrides', 'priority', 'trim_planes', 'description', 'elements'];
    note(keep.every((k) => JSON.stringify(after[k]) === JSON.stringify(before[k])), 'Apply keeps detail_id, location, overrides, priority, trim planes', { detail_id: after.detail_id, overrides: after.detail_overrides, priority: after.priority });

    // Open detail opens the page on that detail
    const orig = window.open; window.open = (...a) => (window.__popup = orig.apply(window, a));
    [...document.querySelectorAll('#props-content button')].find((b) => b.textContent === 'Open detail').click();
    await when(() => window.__popup && window.__popup.__detailEditor && window.__popup.__detailEditor.state(), 60000);   // a new page: slow to start when the machine is busy
    note(window.__popup.__detailEditor.state().doc.id === 'detail-corner-cavity-butt', 'Open detail opens the detail editor on that detail');
    note(window.__errors.length === 0 && window.__popup.__errors.length === 0, 'no page errors', [...window.__errors, ...window.__popup.__errors]);
    log.push('DONE'); show();
  }).catch((e) => { log.push('ERROR ' + e.message); log.push('DONE'); show(); });
})()
