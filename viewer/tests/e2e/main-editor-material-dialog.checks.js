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
  (async () => {
    await until(() => E.junctions().length > 0);
    await sleep(500);
    const before = lib().length;
    $('add-material-btn').click(); await sleep(400);
    note($('material-dialog').open, 'the dialog opens (no prompt)');
    note($('material-existing').children.length === before, 'the existing library is listed below the form', $('material-existing').children.length);

    $('material-name').value = 'brick'; $('material-name').dispatchEvent(new Event('input', { bubbles: true }));
    note(/Similar/.test($('material-warning').textContent) && $('material-existing').querySelector('.similar'), 'a similar name is flagged and highlighted', $('material-warning').textContent);

    $('material-name').value = ''; $('material-form').requestSubmit(); await sleep(200);
    note($('material-dialog').open && /name/i.test($('material-warning').textContent), 'an empty name is refused and the dialog stays open');

    $('material-name').value = 'Brick Common'; $('material-colour-hex').value = '#fa0'; $('material-colour-hex').dispatchEvent(new Event('input', { bubbles: true }));
    $('material-form').requestSubmit(); await sleep(600);
    const added = lib().at(-1);
    note(!$('material-dialog').open && lib().length === before + 1, 'submit closes the dialog and adds a material', lib().length);
    note(added.id === 'mat-brick-common-2', 'a duplicate name gets a unique id instead of overwriting', added.id);
    note(added.colour_hex === '#FFAA00' && added.category === 'custom' && added.type === 'Material', 'colour is normalised and the required category is set', added);
    note(!!document.querySelector(`#materials-list [data-id="${added.id}"]`), 'it appears in the materials list');

    $('add-material-btn').click(); await sleep(300);
    $('material-cancel').click(); await sleep(300);
    note(!$('material-dialog').open && lib().length === before + 1, 'cancel adds nothing');
    note(window.__errors === undefined || window.__errors.length === 0, 'no page errors', window.__errors);
    log.push('DONE'); show();
  })().catch((e) => { log.push('ERROR ' + e.message); log.push('DONE'); show(); });
})()
