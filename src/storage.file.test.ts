// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { OutlineStore } from './model';

// A server holding the outline file, whose writes finish when the test says so.
const outline = OutlineStore.create();
let finishWrite: (status: number) => void = () => {};
vi.stubGlobal(
  'fetch',
  vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const status = await new Promise<number>((r) => (finishWrite = r));
      return new Response(null, { status, headers: { ETag: '"2"' } });
    }
    return new Response(JSON.stringify(outline.toJSON()), { status: 200, headers: { 'X-Yamoli-File': 'data.json', ETag: '"1"' } });
  })
);

const { init, save, whenSaved } = await import('./storage');
await init();

/** How many writes the app has asked for. */
const writes = () => vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PUT').length;

const settled = (p: Promise<void>) =>
  p.then(
    () => 'saved',
    (e: Error) => 'failed: ' + e.message
  );

test('waiting for the file: until what was typed is written, and not past a failed write', async () => {
  let result = '';
  save(outline);
  void settled(whenSaved()).then((r) => (result = r));
  await vi.waitFor(() => expect(writes()).toBe(1));
  expect(result).toBe('');
  finishWrite(200);
  await vi.waitFor(() => expect(result).toBe('saved'));

  // Nothing to write: at once.
  expect(await settled(whenSaved())).toBe('saved');

  vi.spyOn(console, 'error').mockImplementation(() => {});
  save(outline);
  const failed = settled(whenSaved());
  await vi.waitFor(() => expect(writes()).toBe(2));
  finishWrite(500);
  expect(await failed).toMatch(/^failed/);
});
