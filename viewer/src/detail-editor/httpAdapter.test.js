import { describe, test, expect, vi, afterEach } from 'vitest';
import { HttpAdapter, BUNDLE_NAME } from './httpAdapter.js';

const files = {
  'model.json': { details: ['d1'], elements: ['e1'] },
  'details/d1.json': { id: 'd1', members: [{ profile_id: 'p-a' }, { profile_id: 'p-b' }] },
  'elements/e1.json': { id: 'e1', profile_id: 'p-b' },
  'profiles/p-a.json': { id: 'p-a' },
};
const stub = () => vi.fn(async (url) => {
  const key = url.replace('http://x/b.oebf/', '');
  return key in files ? { ok: true, text: async () => JSON.stringify(files[key]) } : { ok: false, status: 404 };
});
afterEach(() => vi.unstubAllGlobals());

describe('BUNDLE_NAME', () => {
  test('accepts a plain folder name and refuses paths and other names', () => {
    expect(BUNDLE_NAME.test('nmb-two-storey.oebf')).toBe(true);
    expect(BUNDLE_NAME.test('terraced-house.oebf')).toBe(true);
    for (const bad of ['../x.oebf', 'a/b.oebf', 'x.json', '.oebf', '/etc/passwd', 'x.oebf/..']) expect(BUNDLE_NAME.test(bad)).toBe(false);
  });
});

describe('HttpAdapter', () => {
  test('fetches a file once and serves it from memory after', async () => {
    const f = stub(); vi.stubGlobal('fetch', f);
    const a = new HttpAdapter('http://x/b.oebf/', 'b');
    expect(await a.readJson('model.json')).toEqual(files['model.json']);
    await a.readJson('model.json');
    expect(f).toHaveBeenCalledTimes(1);
  });
  test('a missing file is an error naming the path', async () => {
    vi.stubGlobal('fetch', stub());
    await expect(new HttpAdapter('http://x/b.oebf/', 'b').readJson('nope.json')).rejects.toThrow('Missing file in bundle: nope.json');
  });
  test('open() lists the profiles used by details and elements, without duplicates', async () => {
    vi.stubGlobal('fetch', stub());
    const a = await HttpAdapter.open('http://x/b.oebf/', 'b');
    expect((await a.listDir('profiles')).sort()).toEqual(['p-a.json', 'p-b.json']);
    expect(await a.listDir('details')).toContain('d1.json');   // files already read show up as listed
  });
  test('writes stay in memory and are read back; the server is not written to', async () => {
    const f = stub(); vi.stubGlobal('fetch', f);
    const a = new HttpAdapter('http://x/b.oebf/', 'b');
    await a.writeJson('details/d1.json', { id: 'd1', edited: true });
    expect((await a.readJson('details/d1.json')).edited).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });
});
