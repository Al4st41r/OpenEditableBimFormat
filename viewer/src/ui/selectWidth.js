/**
 * selectWidth.js — Size a toolbar select to the option it shows (#163).
 *
 * A select is as wide as its longest option by default, which wastes toolbar room, and a max-width cuts the text of
 * the chosen option ("Materials (no ove"). Sizing it to the chosen option shows that option in full and nothing more.
 */

/** Room a select takes besides its text: padding, border and the drop-down arrow, in CSS pixels. */
export const SELECT_CHROME_PX = 34;

let _ctx = null;
/** The width of `text` in `font` (a CSS font shorthand), in CSS pixels. */
function measureText(text, font) {
  _ctx ??= document.createElement('canvas').getContext('2d');
  _ctx.font = font;
  return _ctx.measureText(text).width;
}

/**
 * Set the select's width to fit its chosen option, and keep it so as the choice changes.
 *
 * @param {HTMLSelectElement} select
 * @param {(text: string, font: string) => number} [measure] - text width in pixels (injected in tests)
 */
export function fitSelectToChoice(select, measure = measureText) {
  const fit = () => {
    const text = select.options[select.selectedIndex]?.textContent ?? '';
    const font = globalThis.getComputedStyle?.(select).font ?? '';
    select.style.width = `${Math.ceil(measure(text, font)) + SELECT_CHROME_PX}px`;
  };
  if (!select.dataset.fitChoice) {
    select.dataset.fitChoice = '1';
    select.addEventListener('change', fit);
  }
  fit();
}
