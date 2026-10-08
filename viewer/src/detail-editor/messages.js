/**
 * messages.js
 *
 * postMessage protocol between the main editor (opener) and the detail editor
 * page. Message types are prefixed `detail-` so they never collide with the
 * profile editor's `ready` / `bundle-handle` / `memory-bundle`.
 *
 *   page -> opener   detail-ready
 *                    detail-saved          { id, json, previousId? }
 *   opener -> page   detail-bundle-handle  { handle, activeDetailId }   (file-system bundle)
 *                    detail-snapshot       { snapshot, activeDetailId }  (memory bundle, eg Firefox)
 *
 * Pure: callers pass event objects and contexts, so it is testable without a DOM.
 */

import { serializeDetail } from './detailSerializer.js';

export const readyMessage = () => ({ type: 'detail-ready' });

export function savedMessage({ doc, previousId }) {
  const m = { type: 'detail-saved', id: doc.id, json: serializeDetail(doc) };
  if (previousId !== undefined) m.previousId = previousId;
  return m;
}

const isObject = (x) => x !== null && typeof x === 'object';

/**
 * Parse a message arriving at the page. Returns null for anything that is not
 * from the same origin and the opener window, or is malformed.
 *
 * @returns {{ type: 'bundle-handle', handle, activeDetailId } | { type: 'snapshot', snapshot, activeDetailId } | null}
 */
export function parseIncoming(event, { ownOrigin, opener }) {
  if (event?.origin !== ownOrigin || event.source !== opener) return null;
  const d = event.data;
  if (!isObject(d)) return null;
  const activeDetailId = d.activeDetailId ?? null;
  if (d.type === 'detail-bundle-handle' && isObject(d.handle)) return { type: 'bundle-handle', handle: d.handle, activeDetailId };
  if (d.type === 'detail-snapshot' && isObject(d.snapshot)) return { type: 'snapshot', snapshot: d.snapshot, activeDetailId };
  return null;
}

/** Opener side: is this the ready message from the tab we opened? */
export function isTrustedReady(event, { ownOrigin, tab }) {
  return event?.origin === ownOrigin && event.source === tab && isObject(event.data) && event.data.type === 'detail-ready';
}

/** Opener side: the reply to a trusted ready message. */
export function buildOpenerReply({ adapterType, handle, snapshot, activeDetailId = null }) {
  if (adapterType === 'fsa') {
    if (!handle) throw new Error('A file-system bundle needs a directory handle');
    return { type: 'detail-bundle-handle', handle, activeDetailId };
  }
  if (adapterType === 'memory') {
    if (!snapshot) throw new Error('A memory bundle needs a snapshot');
    return { type: 'detail-snapshot', snapshot, activeDetailId };
  }
  throw new Error(`Unknown adapter type "${adapterType}"`);
}
