/**
 * notice.js — Two kinds of feedback the status bar alone does not give:
 *
 *   showBusy(host, text) / setBusy(text) / hideBusy()   a veil with a spinner over a pane while something slow runs
 *   showError(message)                                  a banner at the top of the page that stays until dismissed
 *
 * Both are announced to screen readers.
 */

const CSS = `
.oebf-busy { position: absolute; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center; background: rgba(20,20,20,0.55); pointer-events: all; }
.oebf-busy-box { display: flex; align-items: center; gap: 10px; background: #222; color: #eee; border: 1px solid #555; border-radius: 6px; padding: 12px 16px; font: 13px 'Barlow', system-ui, sans-serif; }
.oebf-busy-spin { width: 16px; height: 16px; border: 2px solid #555; border-top-color: #6e8ec8; border-radius: 50%; animation: oebf-spin 0.8s linear infinite; }
@keyframes oebf-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .oebf-busy-spin { animation-duration: 3s; } }
.oebf-errors { position: fixed; top: 8px; left: 50%; transform: translateX(-50%); z-index: 2000; display: flex; flex-direction: column; gap: 6px; max-width: min(640px, calc(100vw - 32px)); }
.oebf-error { display: flex; align-items: flex-start; gap: 10px; background: #4a1f1f; color: #fff; border: 1px solid #a04848; border-radius: 4px; padding: 8px 10px 8px 12px; font: 13px 'Barlow', system-ui, sans-serif; box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
.oebf-error span { flex: 1; white-space: pre-line; }
.oebf-error button { background: none; border: none; color: #fff; cursor: pointer; font-size: 16px; line-height: 1; padding: 0 2px; }
`;

function ensureStyle() {
  if (document.getElementById('oebf-notice-style')) return;
  const style = document.createElement('style');
  style.id = 'oebf-notice-style';
  style.textContent = CSS;
  document.head.appendChild(style);
}

let _busy = null;

/**
 * Cover `host` (which should be positioned) with a busy veil.
 * @param {HTMLElement} host
 * @param {string} text
 */
export function showBusy(host, text) {
  ensureStyle();
  hideBusy();
  const veil = document.createElement('div');
  veil.className = 'oebf-busy';
  veil.setAttribute('role', 'status');
  veil.setAttribute('aria-live', 'polite');
  const box = document.createElement('div');
  box.className = 'oebf-busy-box';
  const spin = document.createElement('div');
  spin.className = 'oebf-busy-spin';
  const label = document.createElement('span');
  label.textContent = text;
  box.append(spin, label);
  veil.appendChild(box);
  host.appendChild(veil);
  _busy = { veil, label };
}

/** Change the text of the busy veil, eg to name the step under way. */
export function setBusy(text) { if (_busy) _busy.label.textContent = text; }

export function hideBusy() {
  _busy?.veil.remove();
  _busy = null;
}

/**
 * Show an error until it is dismissed. The same message twice in a row is shown once.
 * @param {string} message
 */
export function showError(message) {
  ensureStyle();
  let stack = document.querySelector('.oebf-errors');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'oebf-errors';
    document.body.appendChild(stack);
  }
  if (stack.lastElementChild?.dataset.message === message) return;
  const item = document.createElement('div');
  item.className = 'oebf-error';
  item.dataset.message = message;
  item.setAttribute('role', 'alert');
  const text = document.createElement('span');
  text.textContent = message;
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.title = 'Dismiss';
  close.setAttribute('aria-label', 'Dismiss');
  close.addEventListener('click', () => item.remove());
  item.append(text, close);
  stack.appendChild(item);
  while (stack.children.length > 3) stack.firstElementChild.remove();
}
