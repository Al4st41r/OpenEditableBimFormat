// Handoff check for the detail editor: plays the main editor's part (the opener).
// Opens detail-editor.html as a popup, answers its `detail-ready` with a bundle
// snapshot, edits the extrusion and saves in the popup, and checks that the opener
// receives `detail-saved`. Writes PASS/FAIL lines to <pre id="rep"> ending in DONE.
// Run in viewer.html by tests/e2e/editor-checks.spec.js.
(() => {
  const log = [];
  const show = () => {
    let pre = document.getElementById('rep');
    if (!pre) { pre = document.createElement('pre'); pre.id = 'rep'; pre.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99;background:#000d;color:#9f9;font:13px monospace;padding:10px;white-space:pre-wrap;max-width:900px'; document.body.appendChild(pre); }
    pre.textContent = log.join('\n');
  };
  const note = (ok, name, extra) => { log.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`); show(); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (cond, ms = 15000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timeout ' + cond); await sleep(100); } };
  const base = '/oebf/';
  let ready = false, saved = null;
  (async () => {
    try {
      const w = window.open(base + 'detail-editor.html');
      note(!!w, 'popup opened');
      window.addEventListener('message', (ev) => {
        if (ev.data?.type === 'detail-saved') saved = ev.data;
        if (ev.source === w && ev.data?.type === 'detail-ready') ready = true;
      });
      await until(() => ready);
      note(true, 'opener got detail-ready');
      const [sa, store, snap, msgs, blob] = await Promise.all([
        import(base + 'src/editor/storageAdapter.js'), import(base + 'src/detail-editor/detailStore.js'),
        import(base + 'src/detail-editor/bundleSnapshot.js'), import(base + 'src/detail-editor/messages.js'),
        fetch(base + 'terraced-house.oebfz').then((r) => r.blob()),
      ]);
      const adapter = await sa.MemoryAdapter.fromFile(new File([blob], 'terraced-house.oebfz'));
      const ctx = await store.loadDetailContext(adapter);
      const reply = msgs.buildOpenerReply({ adapterType: 'memory', snapshot: snap.buildSnapshot(ctx, 'detail-corner-cavity-butt'), activeDetailId: 'detail-corner-cavity-butt' });
      w.postMessage(reply, location.origin);
      await until(() => w.__detailEditor?.state()?.doc.id === 'detail-corner-cavity-butt');
      note(true, 'popup shows the detail sent by the opener');

      // edit the extrusion (Detail tab) and save from the popup: expect detail-saved back
      const d = w.document;
      [...d.querySelectorAll('#right-panel .tab')].find((b) => b.textContent.startsWith('Detail')).click();
      await until(() => [...d.querySelectorAll('#right-panel .row')].some((r) => r.textContent.startsWith('Extrusion')));
      const ext = [...d.querySelectorAll('#right-panel .row')].find((r) => r.textContent.startsWith('Extrusion')).querySelector('input');
      ext.value = '3000'; ext.dispatchEvent(new w.Event('change', { bubbles: true }));
      // wait for the state rather than a fixed pause (#177)
      await until(() => !d.getElementById('dirty').hidden && !d.getElementById('save-btn').disabled, 5000).catch(() => {});
      note(!d.getElementById('dirty').hidden && !d.getElementById('save-btn').disabled, 'popup is dirty and Save is enabled after the edit');
      d.getElementById('save-btn').click();
      await until(() => saved);
      note(saved.id === 'detail-corner-cavity-butt' && Math.abs(saved.json.geometry?.extrusion_m - 3) < 1e-9, 'opener got detail-saved with the edit', { id: saved.id, extrusion_m: saved.json.geometry?.extrusion_m });
      await until(() => d.getElementById('dirty').hidden);
      note(true, 'popup is clean after save');
      note(!(w.__errors?.length), 'no popup errors', w.__errors);
      w.close();
    } catch (e) { note(false, 'script error', String(e)); }
    log.push('DONE'); show();
  })();
})();
