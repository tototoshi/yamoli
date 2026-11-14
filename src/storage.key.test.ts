// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import { OutlineStore } from './model';

/** A server whose outline file at path doesn't exist yet (204) or holds outline; writes succeed. */
function server(path: string, outline: OutlineStore | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = { 'X-Yamoli-File': encodeURIComponent(path), ETag: '"1"' };
      if (init?.method === 'PUT') return new Response(null, { status: 200, headers });
      return outline
        ? new Response(JSON.stringify(outline.toJSON()), { status: 200, headers })
        : new Response(null, { status: 204, headers });
    })
  );
}

/** A fresh copy of the storage module (its state is per page load), started against the server. */
async function start() {
  vi.resetModules();
  const storage = await import('./storage');
  await storage.init();
  return storage;
}

const outlineWith = (text: string) => {
  const s = OutlineStore.create();
  s.addChild(s.rootId, -1, text);
  return s;
};
const texts = (s: OutlineStore) => s.node(s.rootId).children.map((c) => s.node(c).text);

beforeEach(() => localStorage.clear());

test("a new outline file doesn't start from another file's copy in this browser", async () => {
  server('/work/a.json', outlineWith('in A'));
  const a = await start();
  a.save(a.load());
  a.flush();
  expect(localStorage.getItem('yamoli:v1:/work/a.json')).toContain('in A');

  server('/work/b.json', null); // a new file
  const b = await start();
  expect(texts(b.load())).not.toContain('in A');
});

test("a missing file starts again from this browser's copy of that same file", async () => {
  server('/work/a.json', outlineWith('in A'));
  const a = await start();
  a.save(a.load());
  a.flush();

  server('/work/a.json', null); // deleted since
  const again = await start();
  expect(texts(again.load())).toEqual(['in A']);
});
