/**
 * toolbar.js — Behaviour shared by the editors' toolbars.
 *
 * When a toolbar wraps, a separator can land at the start or end of a row, where it separates nothing. Hide those.
 */

/**
 * Which separators sit at the edge of a row. Pure: works on the middles of the items in toolbar order.
 *
 * @param {{ sep: boolean, mid: number }[]} items - every visible item in order, with the y of its middle (items of
 *   different heights are centred in a row, so their middles agree where their tops do not)
 * @returns {boolean[]} for each item, whether it is a separator to hide
 */
export function edgeSeparators(items, tolerance = 4) {
  return items.map((it, i) => {
    if (!it.sep) return false;
    const prev = items.slice(0, i).reverse().find((x) => !x.sep);
    const next = items.slice(i + 1).find((x) => !x.sep);
    if (!prev || !next) return true;                       // first or last in the toolbar
    const apart = (a, b) => Math.abs(a.mid - b.mid) > tolerance;
    return apart(prev, it) || apart(next, it);              // starts or ends a row
  });
}

/**
 * Keep a toolbar's separators off the edges of its rows as it resizes.
 *
 * @param {HTMLElement} bar
 * @param {string} [selector] - what counts as a separator
 */
export function tidyToolbarSeparators(bar, selector = '.sep, .toolbar-sep') {
  if (!bar) return;
  const run = () => {
    const kids = [...bar.children].filter((el) => el.offsetParent !== null);   // skip display:none
    // measure with every separator shown, so hiding one does not move the others
    for (const el of kids) if (el.matches(selector)) el.style.visibility = '';
    const items = kids.map((el) => ({ el, sep: el.matches(selector), mid: el.offsetTop + el.offsetHeight / 2 }));
    edgeSeparators(items).forEach((hide, i) => { if (hide) items[i].el.style.visibility = 'hidden'; });
  };
  new ResizeObserver(run).observe(bar);
  run();
}
