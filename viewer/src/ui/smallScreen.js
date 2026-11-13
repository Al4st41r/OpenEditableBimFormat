/**
 * smallScreen.js — On a phone, an editing app says once that it is made for a larger screen (#160).
 *
 * The page still works there (its panels become drawers); the note only sets expectations. Dismissing it keeps it
 * away for the rest of the session.
 */

/** Below this width (CSS pixels) the apps use their phone layout; it matches the stylesheets' 699px breakpoint. */
export const PHONE_MAX_WIDTH = 699;

/** Whether the window is phone-sized now. */
export function isPhone(win = globalThis.window) {
  return !!win?.matchMedia?.(`(max-width: ${PHONE_MAX_WIDTH}px)`).matches;
}

/**
 * Show the note on a phone, unless it was dismissed earlier in this session.
 *
 * @param {string} key - names the app, so each app's note is dismissed on its own
 * @param {string} text
 * @returns {HTMLElement|null} the note, or null when none is shown
 */
export function noteSmallScreen(key, text) {
  if (!isPhone()) return null;
  const store = `oebf-small-note-${key}`;
  try { if (sessionStorage.getItem(store)) return null; } catch { /* storage unavailable: show it */ }
  const note = document.createElement('div');
  note.className = 'oebf-small-note';
  note.setAttribute('role', 'note');
  const span = document.createElement('span');
  span.textContent = text;
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.title = 'Dismiss';
  close.setAttribute('aria-label', 'Dismiss');
  close.addEventListener('click', () => {
    note.remove();
    try { sessionStorage.setItem(store, '1'); } catch { /* storage unavailable */ }
  });
  note.append(span, close);
  document.body.appendChild(note);
  return note;
}
