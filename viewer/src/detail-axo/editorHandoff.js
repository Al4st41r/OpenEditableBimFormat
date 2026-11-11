/**
 * editorHandoff.js — The 3D editor opens the detail review page on the bundle it has open.
 *
 * The review page is opened with ?from=editor&detail=<id>. It sends { type: 'axo-ready' } to its opener, and the
 * editor answers with the bundle in whichever form it holds it:
 *
 *   { type: 'axo-bundle', kind: 'fsa',    name, handle }   a folder: the review page reads (and saves) it directly
 *   { type: 'axo-bundle', kind: 'server', name, base }     the live copy on the server: read over HTTP
 *   { type: 'axo-bundle', kind: 'files',  name, files }    a bundle held in memory: a copy of its files (path -> text)
 */

export const AXO_READY = 'axo-ready';
export const AXO_BUNDLE = 'axo-bundle';

/** The editor's answer for a storage adapter (FsaAdapter, ServerAdapter or MemoryAdapter, journalled or not). */
export function bundleMessage(adapter) {
  const inner = adapter.inner ?? adapter;
  const name = adapter.name;
  if (adapter.type === 'fsa') return { type: AXO_BUNDLE, kind: 'fsa', name, handle: adapter.dirHandle };
  if (adapter.type === 'server') return { type: AXO_BUNDLE, kind: 'server', name, base: adapter.base };
  return { type: AXO_BUNDLE, kind: 'files', name, files: new Map(inner._map) };
}

/** True when `event` is a message of `type` from `source` on this origin. */
export function isMessage(event, type, { ownOrigin, source }) {
  return event.origin === ownOrigin && event.source === source && event.data?.type === type;
}

/**
 * How the review page reads the bundle in an editor's answer.
 * @param {object} msg - an axo-bundle message
 * @param {{ fsaReader: (handle) => (path) => Promise<object>, httpReader: (base) => (path) => Promise<object> }} readers
 * @returns {{ readJson: (path: string) => Promise<object>, label: string, handle: object|null }}
 */
export function readerFor(msg, { fsaReader, httpReader }) {
  if (msg?.type !== AXO_BUNDLE) throw new Error('Not a bundle from the editor');
  const label = msg.name ?? 'bundle';
  if (msg.kind === 'fsa') return { readJson: fsaReader(msg.handle), label, handle: msg.handle };
  if (msg.kind === 'server') return { readJson: httpReader(`${msg.base}files/`), label, handle: null };
  if (msg.kind === 'files') {
    const files = msg.files instanceof Map ? msg.files : new Map(Object.entries(msg.files ?? {}));
    return {
      readJson: async (path) => {
        if (!files.has(path)) throw new Error(`Missing file in bundle: ${path}`);
        return JSON.parse(files.get(path));
      },
      label, handle: null,
    };
  }
  throw new Error(`Unknown bundle kind: ${msg.kind}`);
}
