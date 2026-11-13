// Interaction checks for the detail editor page, run in the browser by
// tests/e2e/detail-editor.spec.js. Plain JS (no imports) so it can also be
// pasted into `shot-scraper --javascript` on a machine without Playwright.
// Returns (a promise of) an array of "PASS ..." / "FAIL ..." lines. Checks that follow an action wait for the state
// they expect (until(), up to a few seconds) rather than reading it straight after the events.
(async () => {
  const R = [];
  const ok = (name, cond, extra) => R.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`);
  const E = window.__detailEditor, svg = document.getElementById('canvas');
  const rect = () => svg.getBoundingClientRect();
  const px = (x, y) => { const v = E.view(), s = E.size(), r = rect(); return { clientX: r.left + s.width / 2 + (x - v.cx) * v.scale, clientY: r.top + s.height / 2 - (y - v.cy) * v.scale }; };
  const ptr = (type, x, y, extra = {}) => svg.dispatchEvent(new PointerEvent(type, { ...px(x, y), button: 0, pointerId: 1, bubbles: true, ...extra }));
  const key = (k, o = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...o }));
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const items = (panel) => [...document.querySelectorAll(`#${panel} .item`)];
  const doc = () => E.state().doc;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /** Poll until cond() holds; true when it did, false after `ms`. Never throws, so a check still reports FAIL. */
  const until = async (cond, ms = 4000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  const saveOn = () => document.getElementById('save-btn').disabled === false && document.getElementById('dirty').hidden === false;

  try {
    ok('a. loaded detail', doc().id === 'detail-corner-cavity-butt' && doc().members.length === 2, doc().id);
    ok('a. overlay hidden', document.getElementById('empty').hidden === true);

    // b. select region from the list
    click(items('left-panel').find((i) => i.textContent.includes('Region 0')));
    ok('b. region selected', E.state().selection?.type === 'region');

    // c. drag vertex 0 by +20 mm. The distance is in metres, not pixels: region 0 is 50 mm wide, and 30 px dragged the
    // vertex past its neighbour (a self-crossing region, so Save stayed off) whenever the canvas fitted at a smaller
    // scale (#177).
    const v0 = doc().geometry.regions[0].vertices[0];
    ptr('pointerdown', v0.x, v0.y); ptr('pointermove', v0.x + 0.02, v0.y); ptr('pointerup', v0.x + 0.02, v0.y);
    await until(() => doc().geometry.regions[0].vertices[0].x > v0.x);
    const moved = doc().geometry.regions[0].vertices[0];
    ok('c. vertex moved', moved.x > v0.x && moved.x < 0.05, { from: v0.x, to: moved.x });
    ok('c. dirty and save enabled', await until(saveOn), { save: document.getElementById('save-btn').disabled, dirty: !document.getElementById('dirty').hidden, status: E.status() });

    // d. undo / redo
    key('z', { ctrlKey: true });
    ok('d. undo restores', await until(() => doc().geometry.regions[0].vertices[0].x === v0.x));
    ok('d. clean again', await until(() => document.getElementById('save-btn').disabled === true));
    key('y', { ctrlKey: true });
    ok('d. redo reapplies', await until(() => doc().geometry.regions[0].vertices[0].x === moved.x));
    key('z', { ctrlKey: true });
    await until(() => doc().geometry.regions[0].vertices[0].x === v0.x);

    // e. rectangle tool
    click(document.getElementById('tool-rect'));
    ok('e. rect tool active', await until(() => E.state().tool === 'rect'));
    ptr('pointerdown', 0.2, 0.25); ptr('pointermove', 0.3, 0.3); ptr('pointerup', 0.3, 0.3);
    ok('e. rectangle added', await until(() => doc().geometry.regions.length === 2), doc().geometry.regions.at(-1));

    // f. polygon tool
    click(document.getElementById('tool-polygon'));
    ptr('pointerdown', 0.35, 0.2); ptr('pointerdown', 0.45, 0.2); ptr('pointerdown', 0.45, 0.3);
    svg.dispatchEvent(new MouseEvent('dblclick', { ...px(0.45, 0.3), bubbles: true }));
    ok('f. polygon added', await until(() => doc().geometry.regions.length === 3));
    click(document.getElementById('tool-select'));

    // g. select a member (opens the Properties tab), edit its insertion x through the panel input
    click(items('left-panel').find((i) => i.textContent.includes('butting-wall')));
    const insertX = () => [...document.querySelectorAll('#right-panel .row')].find((r) => r.textContent.startsWith('Insert x'))?.querySelector('input');
    ok('g. member editor shown', await until(() => !!insertX()));
    const offsetInput = insertX();
    offsetInput.value = '10'; offsetInput.dispatchEvent(new Event('change', { bubbles: true }));
    ok('g. offset edited (mm to m)', await until(() => Math.abs(doc().members[1].placement.offset_x_m - 0.01) < 1e-9), doc().members[1].placement);

    // h. wheel zoom
    const s0 = E.view().scale;
    svg.dispatchEvent(new WheelEvent('wheel', { ...px(0, 0), deltaY: -100, bubbles: true, cancelable: true }));
    ok('h. zoom in', E.view().scale > s0);
    key('f'); ok('h. fit key', Math.abs(E.view().scale - s0) / s0 < 0.5);

    // i. parameter preview slider moves the drawing, not the document
    const before = JSON.stringify(doc());
    click([...document.querySelectorAll('#right-panel .tab')].find((b) => b.textContent.startsWith('Detail')));   // parameters are on the Detail tab
    await until(() => !!document.querySelector('#right-panel input[type=range]'));
    const slider = document.querySelector('#right-panel input[type=range]');
    slider.value = slider.max; slider.dispatchEvent(new Event('input', { bubbles: true }));
    ok('i. preview does not touch the document', await until(() => E.state().preview?.cavity_closer_width_m > 0.05) && JSON.stringify(doc()) === before, E.state().preview);

    // j. save to memory bundle
    click(document.getElementById('save-btn'));
    const stored = () => E.adapter()._map.get('details/detail-corner-cavity-butt.json');
    ok('j. saved to the bundle', await until(() => !!stored() && JSON.parse(stored()).geometry.regions.length === 3), E.status());

    // k. errors
    ok('k. no page errors', window.__errors.length === 0, window.__errors);
  } catch (e) { R.push('EXCEPTION ' + e.stack.split('\n').slice(0, 3).join(' | ')); }
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;left:260px;bottom:8px;z-index:99;background:#000c;color:#9f9;font:12px monospace;padding:8px;max-width:880px;white-space:pre-wrap;margin:0';
  pre.textContent = R.join('\n');
  document.body.appendChild(pre);
  return R;
})()
