// Add material dialog check (issue #95). Plain JS, run in the main editor with the demo bundle:
//   shot-scraper "http://localhost:5199/oebf/editor.html?demo=1" -o out.png --wait 6000 \
//     --javascript "$(cat tests/e2e/main-editor-material-dialog.checks.js)" \
//     --wait-for "document.getElementById('rep')?.textContent.includes('DONE')" -b chromium \
//     --browser-arg=--enable-webgl --browser-arg=--ignore-gpu-blocklist --browser-arg=--use-gl=swiftshader
(() => {
  const log = [];
  const show = () => { let pre = document.getElementById('rep'); if (!pre) { pre = document.createElement('pre'); pre.id = 'rep'; pre.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;background:#000d;color:#9f9;font:12px monospace;padding:8px;white-space:pre-wrap;max-width:900px;margin:0'; document.body.appendChild(pre); } pre.textContent = log.join('\n'); };
  const note = (ok, name, extra) => { log.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`); show(); };
  const E = window.__editor;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (cond, ms = 10000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timeout ' + cond); await sleep(100); } };
  const $ = (id) => document.getElementById(id);
  const lib = () => JSON.parse(E.adapter()._map.get('materials/library.json')).materials;
  // wait for the state a check expects instead of a fixed pause (#186); on a timeout the check after it reports FAIL
  const wait = (cond, ms) => until(() => { try { return cond(); } catch { return false; } }, ms).catch(() => {});
  (async () => {
    await until(() => E.junctions().length > 0);
    await until(() => !$('add-material-btn').disabled);
    const before = lib().length;
    const dlg = () => document.querySelector('dialog.oebf-dialog[open]');
    const field = (n) => dlg().querySelector(`[name="${n}"]`);
    const type = (n, v) => { field(n).value = v; field(n).dispatchEvent(new Event('input', { bubbles: true })); };
    const rows = () => dlg().querySelectorAll('.oebf-dialog-row');
    $('add-material-btn').click(); await wait(() => dlg() && rows().length === before);
    note(!!dlg(), 'the shared dialog opens');
    note(rows().length === before, 'the existing library is listed below the form', rows().length);

    type('name', 'brick');
    note(/Similar/.test(dlg().querySelector('.oebf-dialog-note').textContent) && dlg().querySelector('.oebf-dialog-row.highlight'), 'a similar name is flagged and highlighted');

    type('name', ''); dlg().querySelector('button[type=submit]').click(); await wait(() => /needed/i.test(dlg().textContent));
    note(!!dlg() && /needed/i.test(dlg().textContent), 'an empty name is refused and the dialog stays open');

    type('name', 'Brick Common'); type('id', 'mat-brick-common-2'); type('colour', '#fa0');
    dlg().querySelector('button[type=submit]').click();
    await wait(() => !dlg() && lib().length === before + 1 && document.querySelector(`#materials-list [data-id="${lib().at(-1).id}"]`));
    const added = lib().at(-1);
    note(!dlg() && lib().length === before + 1, 'submit closes the dialog and adds a material', lib().length);
    note(added.id === 'mat-brick-common-2', 'the id is the one given', added.id);
    note(added.colour_hex === '#FFAA00' && added.category === 'custom' && added.type === 'Material', 'colour is normalised and the required category is set', added);
    note(!!document.querySelector(`#materials-list [data-id="${added.id}"]`), 'it appears in the materials list');

    $('add-material-btn').click(); await wait(() => dlg());
    dlg().querySelector('button[value=cancel]').click(); await wait(() => !dlg());
    note(!dlg() && lib().length === before + 1, 'cancel adds nothing');
    note(window.__errors === undefined || window.__errors.length === 0, 'no page errors', window.__errors);
    log.push('DONE'); show();
  })().catch((e) => { log.push('ERROR ' + e.message); log.push('DONE'); show(); });
})()
