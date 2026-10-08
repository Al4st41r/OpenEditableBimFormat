import { describe, test, expect } from 'vitest';
import { readyMessage, parseIncoming, buildOpenerReply, isTrustedReady, savedMessage, parseSaved } from './messages.js';
import { makeDetail } from '../detail/fixtures.js';

const OWN = 'https://architools.drawingtable.net';
const OPENER = { name: 'opener' };
const ev = (data, over = {}) => ({ origin: OWN, source: OPENER, data, ...over });
const ctx = { ownOrigin: OWN, opener: OPENER };

describe('page to opener', () => {
  test('the ready message has its own type (not the profile editor ready)', () => {
    expect(readyMessage()).toEqual({ type: 'detail-ready' });
  });

  test('saved message carries id, serialised detail and the previous id when renamed', () => {
    const m = savedMessage({ doc: makeDetail() });
    expect(m.type).toBe('detail-saved');
    expect(m.id).toBe('detail-box');
    expect(m.json.id).toBe('detail-box');
    expect(m.json.$schema).toBe('oebf://schema/0.1/detail');
    expect(m.previousId).toBeUndefined();
    expect(savedMessage({ doc: makeDetail(), previousId: 'detail-old' }).previousId).toBe('detail-old');
  });

  test('the saved message is structured-clone safe', () => {
    expect(() => structuredClone(savedMessage({ doc: makeDetail() }))).not.toThrow();
  });
});

describe('opener to page', () => {
  test('a bundle-handle message is parsed', () => {
    const handle = { kind: 'directory' };
    expect(parseIncoming(ev({ type: 'detail-bundle-handle', handle, activeDetailId: 'detail-a' }), ctx))
      .toEqual({ type: 'bundle-handle', handle, activeDetailId: 'detail-a' });
  });

  test('a snapshot message is parsed', () => {
    const snapshot = { projectName: 'P', details: [], profiles: {}, materials: {}, junctions: [] };
    expect(parseIncoming(ev({ type: 'detail-snapshot', snapshot, activeDetailId: null }), ctx))
      .toEqual({ type: 'snapshot', snapshot, activeDetailId: null });
  });

  test('the active detail id is optional', () => {
    const r = parseIncoming(ev({ type: 'detail-bundle-handle', handle: {} }), ctx);
    expect(r.activeDetailId).toBeNull();
  });

  test('messages from another origin are ignored', () => {
    expect(parseIncoming(ev({ type: 'detail-bundle-handle', handle: {} }, { origin: 'https://evil.example' }), ctx)).toBeNull();
  });

  test('messages from a window that is not the opener are ignored', () => {
    expect(parseIncoming(ev({ type: 'detail-bundle-handle', handle: {} }, { source: { name: 'other' } }), ctx)).toBeNull();
  });

  test('unknown types, missing payloads and junk are ignored without throwing', () => {
    for (const data of [null, undefined, 'x', 3, {}, { type: 'other' }, { type: 'detail-bundle-handle' }, { type: 'detail-snapshot' }, { type: 'detail-snapshot', snapshot: 'no' }]) {
      expect(() => parseIncoming(ev(data), ctx)).not.toThrow();
      expect(parseIncoming(ev(data), ctx)).toBeNull();
    }
  });

  test('the profile editor message types are not accepted here', () => {
    expect(parseIncoming(ev({ type: 'bundle-handle', handle: {} }), ctx)).toBeNull();
    expect(parseIncoming(ev({ type: 'memory-bundle', profiles: {} }), ctx)).toBeNull();
  });
});

describe('opener side', () => {
  test('isTrustedReady needs the right origin, source and type', () => {
    const tab = { name: 'tab' };
    const c = { ownOrigin: OWN, tab };
    expect(isTrustedReady({ origin: OWN, source: tab, data: { type: 'detail-ready' } }, c)).toBe(true);
    expect(isTrustedReady({ origin: 'x', source: tab, data: { type: 'detail-ready' } }, c)).toBe(false);
    expect(isTrustedReady({ origin: OWN, source: {}, data: { type: 'detail-ready' } }, c)).toBe(false);
    expect(isTrustedReady({ origin: OWN, source: tab, data: { type: 'ready' } }, c)).toBe(false);
    expect(isTrustedReady({ origin: OWN, source: tab, data: null }, c)).toBe(false);
  });

  test('buildOpenerReply sends the handle for a file-system bundle and a snapshot for a memory bundle', () => {
    expect(buildOpenerReply({ adapterType: 'fsa', handle: { h: 1 }, activeDetailId: 'd' }))
      .toEqual({ type: 'detail-bundle-handle', handle: { h: 1 }, activeDetailId: 'd' });
    const snapshot = { projectName: 'P' };
    expect(buildOpenerReply({ adapterType: 'memory', snapshot, activeDetailId: 'd' }))
      .toEqual({ type: 'detail-snapshot', snapshot, activeDetailId: 'd' });
  });

  test('buildOpenerReply rejects an unknown adapter type or a missing payload', () => {
    expect(() => buildOpenerReply({ adapterType: 'cloud' })).toThrow(/adapter/i);
    expect(() => buildOpenerReply({ adapterType: 'fsa' })).toThrow(/handle/i);
    expect(() => buildOpenerReply({ adapterType: 'memory' })).toThrow(/snapshot/i);
  });
});

describe('saved message: persisted flag and the opener side', () => {
  const tab = { name: 'tab' };
  const c = { ownOrigin: OWN, tab };
  const good = () => savedMessage({ doc: makeDetail(), persisted: true });

  test('savedMessage says whether the page already wrote the file', () => {
    expect(savedMessage({ doc: makeDetail() }).persisted).toBe(false);
    expect(savedMessage({ doc: makeDetail(), persisted: true }).persisted).toBe(true);
  });

  test('parseSaved accepts a good message from the opened tab', () => {
    const r = parseSaved({ origin: OWN, source: tab, data: good() }, c);
    expect(r).toEqual({ id: 'detail-box', json: good().json, previousId: null, persisted: true });
  });

  test('previousId is carried through when present', () => {
    const m = savedMessage({ doc: makeDetail(), previousId: 'detail-old' });
    expect(parseSaved({ origin: OWN, source: tab, data: m }, c).previousId).toBe('detail-old');
  });

  test('wrong origin, wrong window and wrong type are ignored', () => {
    expect(parseSaved({ origin: 'https://evil.example', source: tab, data: good() }, c)).toBeNull();
    expect(parseSaved({ origin: OWN, source: {}, data: good() }, c)).toBeNull();
    expect(parseSaved({ origin: OWN, source: tab, data: { ...good(), type: 'profile-saved' } }, c)).toBeNull();
  });

  test('a payload whose json does not match its id or type is ignored', () => {
    const m = good();
    for (const data of [{ ...m, id: 'other' }, { ...m, json: { ...m.json, type: 'Junction' } }, { ...m, json: null }, { ...m, id: 3 }, null, 'x']) {
      expect(parseSaved({ origin: OWN, source: tab, data }, c)).toBeNull();
    }
  });
});
