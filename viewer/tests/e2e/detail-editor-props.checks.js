// Region priority and plan cut height controls (#183); trim into two regions, extend a region edge, and the setting to
// always extend to edges carried on (#185). Run in the page by tests/e2e/detail-editor.spec.js on the demo (the
// terraced-house corner plan, cut_height_m 1.0, extrusion 2.7). Plain JS, no imports. Each check waits for the state
// it expects (#177). Returns (a promise of) PASS / FAIL lines.
(async () => {
  const R = [];
  const ok = (name, cond, extra) => R.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`);
  const E = window.__detailEditor, svg = document.getElementById('canvas');
  const px = (x, y) => { const v = E.view(), s = E.size(), r = svg.getBoundingClientRect(); return { clientX: r.left + s.width / 2 + (x - v.cx) * v.scale, clientY: r.top + s.height / 2 - (y - v.cy) * v.scale }; };
  const ptr = (type, x, y) => svg.dispatchEvent(new PointerEvent(type, { ...px(x, y), button: 0, pointerId: 1, bubbles: true }));
  const click = (x, y) => { ptr('pointerdown', x, y); ptr('pointerup', x, y); };
  const key = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (cond, ms = 4000) => { const t0 = Date.now(); for (;;) { try { if (cond()) return true; } catch { /* not there yet */ } if (Date.now() - t0 > ms) return false; await sleep(50); } };
  const doc = () => E.state().doc;
  const regions = () => doc().geometry.regions;
  const marks = () => doc().annotations ?? [];
  const tool = (t) => document.getElementById(`tool-${t}`).click();
  const tab = (label) => [...document.querySelectorAll('#right-panel .tab')].find((b) => b.textContent.startsWith(label)).click();
  const dirty = () => !document.getElementById('dirty').hidden;
  const type = (el, value) => { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); };
  const field = (id) => document.getElementById(id);
  const undo = () => document.getElementById('undo-btn').click();
  const redo = () => document.getElementById('redo-btn').click();
  const ID = 'detail-corner-cavity-butt';

  try {
    await until(() => doc()?.id === ID);

    // ── #183 a. cut height in the Detail tab ──
    tab('Detail');
    ok('a. cut height shown for the plan, in mm', await until(() => field('cut-height')?.value === '1000'), field('cut-height')?.value);
    ok('a. clean before editing', !dirty());
    type(field('cut-height'), '1500');
    ok('a. typed 1500 sets cut_height_m 1.5 and marks the detail dirty', await until(() => doc().cut_height_m === 1.5 && dirty()), doc().cut_height_m);
    type(field('cut-height'), '3000');
    ok('a. above the extrusion is refused with a reason', await until(() => /above the top/.test(E.status())) && doc().cut_height_m === 1.5, E.status());
    type(field('cut-height'), '');
    ok('a. blank clears it', await until(() => !('cut_height_m' in doc())));
    undo();
    ok('a. undo brings 1.5 back', await until(() => doc().cut_height_m === 1.5 && field('cut-height')?.value === '1500'), doc().cut_height_m);

    // ── #183 b. priority in the region panel ──
    [...document.querySelectorAll('#left-panel .item')].find((i) => i.textContent.includes('Region 0')).click();
    ok('b. priority field shows 0 by default', await until(() => field('region-priority')?.value === '0'), field('region-priority')?.value);
    type(field('region-priority'), '5');
    ok('b. priority 5 set on region 0', await until(() => regions()[0].priority === 5));
    type(field('region-priority'), '120');
    ok('b. out of range is refused', await until(() => /-99 to 99/.test(E.status())) && regions()[0].priority === 5, E.status());
    undo();
    ok('b. undo clears it', await until(() => !('priority' in regions()[0])));
    redo();
    ok('b. redo sets it again', await until(() => regions()[0].priority === 5 && field('region-priority')?.value === '5'));

    // ── #183 c. save and read back ──
    document.getElementById('save-btn').click();
    ok('c. saved', await until(() => !dirty() && /Saved/.test(E.status())), E.status());
    const saved = await E.adapter().readJson(`details/${ID}.json`);
    ok('c. the saved JSON has the cut height and the priority', saved.cut_height_m === 1.5 && saved.geometry.regions[0].priority === 5,
      { cut: saved.cut_height_m, p: saved.geometry.regions.map((r) => r.priority) });

    // ── #185 a. trim a U into two regions ──
    key('Escape');
    tool('select');
    if (E.snapState().on) key('s');   // exact points, well away from the walls
    await until(() => E.snapState().on === false);
    const n = regions().length;
    tool('polygon');
    for (const [x, y] of [[8, 5], [8.3, 5], [8.3, 5.3], [8.2, 5.3], [8.2, 5.1], [8.1, 5.1], [8.1, 5.3], [8, 5.3]]) click(x, y);
    key('Enter');
    ok('d. U drawn', await until(() => regions().length === n + 1), regions().length);
    const nm = marks().length;
    tool('line'); click(7.9, 5.2); click(8.4, 5.2); key('Enter');
    ok('d. line across both arms', await until(() => marks().length === nm + 1));
    tool('trim'); click(8.15, 5);
    ok('d. the trim leaves two regions of the same material', await until(() => regions().length === n + 2 && regions()[n + 1].material_id === regions()[n].material_id),
      regions().slice(n).map((r) => r.vertices));
    ok('d. and says so', /2 pieces/.test(E.status()), E.status());
    undo();
    ok('d. one undo puts the U back', await until(() => regions().length === n + 1 && regions()[n].vertices.length === 8));

    // ── #185 b. extend a region edge ──
    const nr = regions().length;
    tool('rect');
    ptr('pointerdown', 9, 5); ptr('pointermove', 9.2, 5.2); ptr('pointerup', 9.2, 5.2);
    ok('e. square drawn', await until(() => regions().length === nr + 1));
    const nl = marks().length;
    tool('line'); click(9.5, 4.8); click(9.5, 5.4); key('Enter');
    await until(() => marks().length === nl + 1);
    tool('extend'); click(9.19, 5);
    ok('e. the bottom edge runs on to the line', await until(() => regions()[nr].vertices.some((v) => Math.abs(v.x - 9.5) < 1e-6 && Math.abs(v.y - 5) < 1e-6)), regions()[nr].vertices);

    // ── #185 c. the setting, off by default, remembered ──
    document.getElementById('snap-menu').open = true;
    const cb = () => document.getElementById('extend-carried');
    ok('f. Extend to edges carried on: off by default', await until(() => cb() && cb().checked === false && E.snapState().extendCarried === false));
    const stub = marks().length;
    tool('line'); click(10, 5.5); click(10.1, 5.5); key('Enter');
    tool('line'); click(10.3, 5.6); click(10.3, 5.9); key('Enter');   // stops short of y = 5.5
    tool('line'); click(10.6, 5); click(10.6, 6); key('Enter');       // something real further on
    await until(() => marks().length === stub + 3);
    tool('extend'); click(10.09, 5.5);
    ok('f. off: runs to the real line', await until(() => Math.abs(marks()[stub].points[1].x - 10.6) < 1e-6), marks()[stub].points);
    undo();
    await until(() => Math.abs(marks()[stub].points[1].x - 10.1) < 1e-6);
    cb().click();
    ok('f. on, and remembered', await until(() => E.snapState().extendCarried === true && JSON.parse(localStorage.getItem('oebf-detail-snap')).extendCarried === true));
    tool('extend'); click(10.09, 5.5);
    ok('f. on: runs to the nearer edge carried on', await until(() => Math.abs(marks()[stub].points[1].x - 10.3) < 1e-6), marks()[stub].points);
    cb().click();
    await until(() => E.snapState().extendCarried === false);
    document.getElementById('snap-menu').open = false;
    key('s');

    ok('g. no page errors', window.__errors.length === 0, window.__errors);
  } catch (e) { R.push('EXCEPTION ' + e.stack.split('\n').slice(0, 3).join(' | ')); }
  return R;
})()
