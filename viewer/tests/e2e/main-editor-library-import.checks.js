// Library import check (issue #100): a material imported from the default library is written in the
// bundle's format (prefixed id, type, library-only fields under properties). Plain JS, run in the editor
// with the demo bundle; see main-editor-snap.checks.js for the shot-scraper command.
(() => {
  const log = [];
  const show = () => { let pre = document.getElementById('rep'); if (!pre) { pre = document.createElement('pre'); pre.id = 'rep'; pre.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;background:#000d;color:#9f9;font:12px monospace;padding:8px;white-space:pre-wrap;max-width:900px;margin:0'; document.body.appendChild(pre); } pre.textContent = log.join('\n'); };
  const note = (ok, name, extra) => { log.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`); show(); };
  const E = window.__editor;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (cond, ms = 10000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timeout ' + cond); await sleep(100); } };
  const lib = () => JSON.parse(E.adapter()._map.get('materials/library.json')).materials;
  (async () => {
    await until(() => E.junctions().length > 0);
    await sleep(500);
    const before = lib().length;
    document.getElementById('lib-btn').click();
    await until(() => document.querySelectorAll('#lib-modal button').length > 3, 8000);
    const use = [...document.querySelectorAll('#lib-modal button')].find((b) => b.textContent === 'Use');
    note(!!use, 'the library browser lists materials with a Use button');
    use.click(); await sleep(800);
    const added = lib().at(-1);
    note(lib().length === before + 1, 'one material was added', lib().length);
    note(/^mat-[a-z0-9-]+$/.test(added.id) && added.type === 'Material', 'it has a prefixed id and a type', added.id);
    note(added.properties && typeof added.properties === 'object' && !('carbon_kgCO2e_per_kg' in added), 'library-only fields sit under properties', Object.keys(added));
    const lib0 = JSON.parse(E.adapter()._map.get('materials/library.json'));
    note(lib0['$schema'] === 'oebf://schema/0.1/materials' && !('version' in lib0), 'the library file has the schema id and no stray version');
    note(window.__errors === undefined || window.__errors.length === 0, 'no page errors', window.__errors);
    log.push('DONE'); show();
  })().catch((e) => { log.push('ERROR ' + e.message); log.push('DONE'); show(); });
})()
