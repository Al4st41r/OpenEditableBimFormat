// Handoff check for the detail editor: plays the main editor's part (the opener).
// Opens detail-editor.html as a popup, answers its `detail-ready` with a bundle
// snapshot, edits and saves in the popup, and reports what the opener received.
//
// Run against a dev server on a machine without Playwright:
//   shot-scraper "http://localhost:5199/oebf/viewer.html" -o handoff.png \
//     --javascript "$(cat tests/e2e/detail-editor.handoff.checks.js)" \
//     --wait-for "document.getElementById('rep')?.textContent.includes('after save')" -b chromium
// Expected: ready, snapshot sent, popup shows the detail, dirty after edit,
// "opener got detail-saved", popup clean afterwards, errors=[].
(() => {
  const log = [];
  const show = () => {
    let pre = document.getElementById('rep');
    if (!pre) { pre = document.createElement('pre'); pre.id = 'rep'; pre.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99;background:#000d;color:#9f9;font:13px monospace;padding:10px;white-space:pre-wrap;max-width:900px'; document.body.appendChild(pre); }
    pre.textContent = log.join('\n');
  };
  const note = (s) => { log.push(s); show(); };
  const base = '/oebf/';
  const w = window.open(base + 'detail-editor.html');
  note('popup opened: ' + !!w);
  if (!w) return;
  window.addEventListener('message', (ev) => {
    if (ev.data?.type === 'detail-saved') note('opener got detail-saved: id=' + ev.data.id + ' regions=' + (ev.data.json.geometry?.regions?.length));
    if (ev.source !== w || ev.data?.type !== 'detail-ready') return;
    note('opener got detail-ready');
    Promise.all([
      import(base + 'src/editor/storageAdapter.js'), import(base + 'src/detail-editor/detailStore.js'),
      import(base + 'src/detail-editor/bundleSnapshot.js'), import(base + 'src/detail-editor/messages.js'),
      fetch(base + 'terraced-house.oebfz').then((r) => r.blob()),
    ]).then(async ([sa, store, snap, msgs, blob]) => {
      const adapter = await sa.MemoryAdapter.fromFile(new File([blob], 'terraced-house.oebfz'));
      const ctx = await store.loadDetailContext(adapter);
      const reply = msgs.buildOpenerReply({ adapterType: 'memory', snapshot: snap.buildSnapshot(ctx, 'detail-corner-cavity-butt'), activeDetailId: 'detail-corner-cavity-butt' });
      w.postMessage(reply, location.origin);
      note('opener sent ' + reply.type);
      setTimeout(() => {
        const E = w.__detailEditor;
        note('popup state: detail=' + E.state()?.doc.id + ' status=' + E.status());
        // edit then save from the popup: expect a detail-saved message back
        const d = w.document;
        const sel = [...d.querySelectorAll('#left-panel .item')].find((i) => i.textContent.includes('Region 0')); sel.click();
        const ext = [...d.querySelectorAll('#right-panel .row')].find((r) => r.textContent.startsWith('Extrusion')).querySelector('input');
        ext.value = '3000'; ext.dispatchEvent(new w.Event('change', { bubbles: true }));
        note('popup dirty=' + !d.getElementById('dirty').hidden + ' save enabled=' + !d.getElementById('save-btn').disabled);
        d.getElementById('save-btn').click();
        setTimeout(() => note('popup after save: status=' + E.status() + ' dirty=' + !d.getElementById('dirty').hidden + ' errors=' + JSON.stringify(w.__errors)), 500);
      }, 1500);
    }).catch((e) => note('ERROR ' + e.message));
  });
})()
