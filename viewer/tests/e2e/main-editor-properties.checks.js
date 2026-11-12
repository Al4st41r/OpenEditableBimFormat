// Properties panel checks (issue #83, #98): element fields, path nodes, storey, offsets re-render. Run in the editor
// page with the demo bundle; writes PASS/FAIL lines to an on-screen <pre id="rep"> ending in DONE.
// Run by tests/e2e/main-editor-checks.spec.js.
(() => {
  const log = [];
  const show = () => { let pre = document.getElementById('rep'); if (!pre) { pre = document.createElement('pre'); pre.id = 'rep'; pre.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99;background:#000d;color:#9f9;font:12px monospace;padding:8px;white-space:pre-wrap;max-width:900px;margin:0'; document.body.appendChild(pre); } pre.textContent = log.join('\n'); };
  const note = (ok, name, extra) => { log.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`); show(); };
  const E = window.__editor;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (cond, ms = 10000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timeout ' + cond); await sleep(100); } };
  const file = (p) => JSON.parse(E.adapter()._map.get(p));
  const set = async (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); await sleep(700); };
  const xSpan = (elementId) => {
    let lo = Infinity, hi = -Infinity;
    E.scene().traverse((o) => { if (o.isMesh && o.userData?.elementId === elementId) { const a = o.geometry.attributes.position; for (let i = 0; i < a.count; i++) { lo = Math.min(lo, a.getX(i)); hi = Math.max(hi, a.getX(i)); } } });
    return hi - lo;
  };
  (async () => {
    try {
      await until(() => E.junctions().length > 0);
      await sleep(500);
      const id = 'element-wall-south-gf';
      document.querySelector('#elements-list .tree-item[data-element-id="element-wall-south-gf"]').click();
      await until(() => document.getElementById('field-ifc_type'));

      note(['field-ifc_type', 'field-description', 'field-sweep_mode', 'field-cap_start', 'field-cap_end', 'field-start_offset', 'field-end_offset'].every((f) => document.getElementById(f)), 'element field rows are shown');
      note(document.getElementById('field-twist_per_metre') === null, 'twist rate hidden for perpendicular sweeps');

      await set('field-description', 'South wall edited');
      note(file(`elements/${id}.json`).description === 'South wall edited', 'description is written to the element file');
      await set('field-ifc_type', 'Wall');
      note(/IFC type starts with/.test(E.status()) && file(`elements/${id}.json`).ifc_type === 'IfcWall', 'invalid IFC type refused', E.status());
      await set('field-ifc_type', 'IfcWallStandardCase');
      note(file(`elements/${id}.json`).ifc_type === 'IfcWallStandardCase', 'IFC type written');

      const before = xSpan(id);
      await set('field-start_offset', '1000');
      note(file(`elements/${id}.json`).start_offset === 1 && Math.abs(xSpan(id) - (before - 1)) < 0.01, 'start offset 1000 mm shortens the wall by 1 m', { before, after: xSpan(id) });

      await set('field-sweep_mode', 'twisted');
      note(!!document.getElementById('field-twist_per_metre'), 'twisted sweep shows the twist rate');
      await set('field-sweep_mode', 'perpendicular');

      // path section
      note(document.getElementById('node-0-x') && document.getElementById('node-1-y'), 'path nodes are listed');
      const path = file('paths/path-wall-south-gf.json');
      const endX = path.segments[0].end.x;
      await set('node-1-x', '0.5m');
      note(Math.abs(file('paths/path-wall-south-gf.json').segments[0].end.x - 0.5) < 1e-9 && endX !== 0.5, 'node coordinate edit is written to the path file');

      // slab material
      document.querySelector('#elements-list .tree-item[data-element-id="slab-gf"]').click();
      await until(() => document.getElementById('field-material_id'));
      const slabId = E.selectedId();
      const mat = document.getElementById('field-material_id');
      const other = [...mat.options].map((o) => o.value).find((v) => v !== mat.value);
      await set('field-material_id', other);
      note(file(`slabs/${slabId}.json`).material_id === other, 'slab material written to the slab file', { other });

      // storey: the demo has one ('Ground Floor'); add a storey 3 m above it so its height is derived
      const demoStoreys = E.storeys().getAll();
      note(demoStoreys.length >= 1, 'the demo has a storey', demoStoreys.map((s) => s.name));
      const gf = [...demoStoreys].sort((a, b) => b.z_m - a.z_m)[0];   // the top one, so the new storey is next above it
      E.storeys()._addStorey('storey-test-above', 'Test above', gf.z_m + 3, true);
      const gfIndex = E.storeys().getAll().findIndex((s) => s.id === gf.id);
      document.querySelectorAll('#storeys-list .tree-item-name')[gfIndex].click();
      await sleep(300);
      await until(() => document.querySelector('#props-content h3')?.textContent === 'Storey');
      note(!!document.getElementById('field-name') && !!document.getElementById('field-z_m'), 'storey name and elevation shown');
      note([...document.querySelectorAll('#props-content .prop-row')].some((r) => /Height/.test(r.textContent) && /3000/.test(r.querySelector('input').value)), 'storey height is derived from the next storey');
      await set('field-name', 'Ground renamed');
      const storeyFile = [...E.adapter()._map.keys()].find((k) => k.startsWith('groups/') && JSON.parse(E.adapter()._map.get(k)).name === 'Ground renamed');
      note(storeyFile === `groups/${gf.id}.json`, 'storey name written to its group file', storeyFile);
    } catch (e) { note(false, 'script error', String(e)); }
    log.push('DONE'); show();
  })();
})();
