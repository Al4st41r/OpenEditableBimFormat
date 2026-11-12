/**
 * profileChoice.js — Which profile the profile editor opens when a bundle loads (#162).
 * The one asked for when the bundle has it, otherwise the first in the list, so the
 * canvas is not left blank.
 */

/** The id to open from `ids` (in list order): `requested` when present, else the first; null when there are none. */
export function initialProfileId(ids, requested) {
  if (requested && ids.includes(requested)) return requested;
  return ids[0] ?? null;
}

/** The prompt shown over the canvas when no profile is open. */
export function emptyCanvasPrompt({ bundleOpen, profileCount }) {
  if (!bundleOpen) return 'Open a bundle to edit its profiles.';
  if (profileCount === 0) return 'This bundle has no profiles yet. Press New to start one.';
  return 'Choose a profile from the list above, or press New to start one.';
}
