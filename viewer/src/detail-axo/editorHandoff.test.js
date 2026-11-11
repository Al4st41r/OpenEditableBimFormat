import { describe, test, expect } from 'vitest';
import { bundleMessage, isMessage, readerFor, AXO_BUNDLE, AXO_READY } from './editorHandoff.js';

const readers = { fsaReader: (h) => async (p) => ({ from: 'fsa', h, p }), httpReader: (base) => async (p) => ({ from: 'http', url: base + p }) };

describe('editor to detail review hand-over', () => {
  test('a folder goes as its handle', () => {
    const handle = { name: 'h' };
    expect(bundleMessage({ type: 'fsa', name: 'h', dirHandle: handle })).toEqual({ type: AXO_BUNDLE, kind: 'fsa', name: 'h', handle });
  });

  test('the live copy goes as its address, and is read under files/', async () => {
    const msg = bundleMessage({ type: 'server', name: 'Live', base: '/oebf-live/api/' });
    expect(msg).toEqual({ type: AXO_BUNDLE, kind: 'server', name: 'Live', base: '/oebf-live/api/' });
    expect(await readerFor(msg, readers).readJson('model.json')).toEqual({ from: 'http', url: '/oebf-live/api/files/model.json' });
  });

  test('a bundle in memory goes as a copy of its files, read back as JSON', async () => {
    const inner = { type: 'memory', name: 'demo', _map: new Map([['model.json', '{"details":["d1"]}']]) };
    const journalled = Object.assign(Object.create(inner), { inner });
    const msg = bundleMessage(journalled);
    expect(msg.kind).toBe('files');
    inner._map.set('model.json', '{}');   // a copy: later edits in the editor do not change what was sent
    const r = readerFor(msg, readers);
    expect(await r.readJson('model.json')).toEqual({ details: ['d1'] });
    await expect(r.readJson('none.json')).rejects.toThrow(/Missing/);
    expect(r).toMatchObject({ label: 'demo', handle: null });
  });

  test('a folder is read through the review page’s own reader and keeps its handle', async () => {
    const r = readerFor({ type: AXO_BUNDLE, kind: 'fsa', name: 'x', handle: 'H' }, readers);
    expect(r.handle).toBe('H');
    expect(await r.readJson('a.json')).toEqual({ from: 'fsa', h: 'H', p: 'a.json' });
  });

  test('messages are only taken from the expected window on this origin', () => {
    const tab = {};
    const ev = (o) => ({ origin: 'https://a', source: tab, data: { type: AXO_READY }, ...o });
    expect(isMessage(ev(), AXO_READY, { ownOrigin: 'https://a', source: tab })).toBe(true);
    expect(isMessage(ev({ origin: 'https://b' }), AXO_READY, { ownOrigin: 'https://a', source: tab })).toBe(false);
    expect(isMessage(ev({ source: {} }), AXO_READY, { ownOrigin: 'https://a', source: tab })).toBe(false);
    expect(() => readerFor({ type: 'other' }, readers)).toThrow();
  });
});
