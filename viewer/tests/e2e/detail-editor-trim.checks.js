// Trim, extend and move-by-points checks for the detail editor (#166), run in the page by
// tests/e2e/detail-editor.spec.js. Plain JS, no imports. Everything is drawn well away from the demo detail's walls
// (around x = 5, y = 5), where the only other things are the reference lines through the origin. Each check waits for
// the state it expects (#177). Returns (a promise of) PASS / FAIL lines.
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
  const marks = () => doc().annotations ?? [];
  const near = (p, x, y) => Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6;
  const tool = (t) => document.getElementById(`tool-${t}`).click();
  const button = (label) => [...document.querySelectorAll('#right-panel button')].find((b) => b.textContent === label);
  /** Draw a two-point line with the line tool; resolves to the new mark's index. */
  const line = async (a, b) => {
    const n = marks().length;
    tool('line'); click(...a); click(...b); key('Enter');
    await until(() => marks().length === n + 1);
    return n;
  };

  try {
    await until(() => doc());
    // the vertical reference line through the origin (plan detail: a grid line each way)
    const gx = (doc().reference_lines ?? []).find((l) => l.axis === 'x')?.offset_m ?? 0;

    // a. trim against a reference line: a line from x = gx - 0.5 to gx + 0.5 at y = 5, cut back from the right
    const a = await line([gx - 0.5, 5], [gx + 0.5, 5]);
    const start = marks()[a]?.points[0];   // where the click snapped to
    ok('a. line drawn across the reference line', marks()[a]?.type === 'line' && start.x < gx && marks()[a].points[1].x > gx, { gx, line: marks()[a] });
    tool('trim'); click(gx + 0.4, 5);
    ok('a. trimmed back to the reference line', await until(() => near(marks()[a].points.at(-1), gx, 5) && near(marks()[a].points[0], start.x, 5)), marks()[a]?.points);

    // b. extend to an edge carried on past its end: a stub at y = 5.5 and a post at x = 5.3 that stops short of it
    const b = await line([5, 5.5], [5.1, 5.5]);
    await line([5.3, 5.6], [5.3, 5.9]);
    tool('extend'); click(5.09, 5.5);
    ok('b. extended to the post carried on', await until(() => near(marks()[b].points[1], 5.3, 5.5)), marks()[b]?.points);
    ok('b. says it carried the edge on, not as an error', /carried on/.test(E.status()) && !document.getElementById('status').classList.contains('error'), E.status());

    // c. trim a region's outline: a rectangle cut by a vertical line at x = 5.3, its right part cut away
    tool('rect');
    const nr = doc().geometry.regions.length;
    ptr('pointerdown', 5, 6); ptr('pointermove', 5.4, 6.2); ptr('pointerup', 5.4, 6.2);
    ok('c. rectangle drawn', await until(() => doc().geometry.regions.length === nr + 1));
    await line([5.3, 5.9], [5.3, 6.3]);
    tool('trim'); click(5.4, 6.1);
    const xs = () => doc().geometry.regions[nr].vertices.map((v) => v.x);
    ok('c. outline trimmed to the line', await until(() => Math.max(...xs()) === 5.3 && Math.min(...xs()) === 5), doc().geometry.regions[nr]?.vertices);

    // d. move a mark by two points: select line a, Move by 2 points, from its start to 0.2 m above it
    tool('select');
    click((start.x + gx) / 2, 5);
    ok('d. mark selected', await until(() => E.state().selection?.type === 'annotation' && E.state().selection.index === a), E.state().selection);
    ok('d. Move by 2 points offered for a mark', await until(() => !!button('Move by 2 points')));
    button('Move by 2 points').click();
    click(start.x, 5); click(start.x, 5.2);
    ok('d. mark moved', await until(() => near(marks()[a].points[0], start.x, 5.2) && near(marks()[a].points[1], gx, 5.2)), marks()[a]?.points);

    // e. copy a member by two points: the butting wall, 1 m to the right
    const before = doc().members.find((m) => m.role === 'butting-wall');
    [...document.querySelectorAll('#left-panel .item')].find((i) => i.textContent.includes('butting-wall')).click();
    ok('e. Copy by 2 points offered for a member', await until(() => E.state().selection?.type === 'member' && !!button('Copy by 2 points')));
    button('Copy by 2 points').click();
    click(5, 7); click(6, 7);
    ok('e. member copied under a new role and selected', await until(() => doc().members.length === 3 && E.state().selection?.role === doc().members[2].role), doc().members.map((m) => m.role));
    const copy = doc().members[2];
    ok('e. copy shifted 1 m in x, original kept', Math.abs(copy.placement.offset_x_m - before.placement.offset_x_m - 1) < 1e-6
      && copy.placement.offset_y_m === before.placement.offset_y_m && JSON.stringify(doc().members.find((m) => m.role === 'butting-wall')) === JSON.stringify(before), copy.placement);

    ok('f. no page errors', window.__errors.length === 0, window.__errors);
  } catch (e) { R.push('EXCEPTION ' + e.stack.split('\n').slice(0, 3).join(' | ')); }
  return R;
})()
