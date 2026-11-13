// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { OutlineStore } from './model';

// A store per test, saved nowhere, with a server to keep images (whose upload is faked).
const mocks = vi.hoisted(() => ({ store: null as unknown as import('./model').OutlineStore, server: true }));
vi.mock('./storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./storage')>()),
  load: () => mocks.store,
  save: () => {},
  canAddFiles: () => mocks.server,
}));
vi.mock('./files', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./files')>()),
  uploadImage: async (f: File) => `files/${f.name}`,
}));

const { Controller } = await import('./controller');

function setup() {
  const s = OutlineStore.create();
  const item = s.addChild(s.rootId, -1, 'Spec').id;
  mocks.store = s;
  return { ctl: new Controller(), item };
}

/** Paste into item's row: files, and text if any. */
function paste(ctl: InstanceType<typeof Controller>, id: string, files: File[], text = '') {
  const ta = document.createElement('textarea');
  ta.dataset.id = id;
  const data = { getData: () => text, files } as unknown as DataTransfer;
  const e = Object.assign(new Event('paste', { cancelable: true }), { clipboardData: data }) as ClipboardEvent;
  ctl.onTextPaste(e, ta);
  return e;
}

const png = (name: string) => new File([new Uint8Array([0x89, 0x50])], name, { type: 'image/png' });
const blocks = (ctl: InstanceType<typeof Controller>, id: string) =>
  ctl.store
    .node(id)
    .children.map((c) => ctl.store.node(c))
    .filter((n) => n.format !== null);

test('a pasted screenshot is kept and added to the item as an image block', async () => {
  const { ctl, item } = setup();
  const e = paste(ctl, item, [png('a.png'), png('b.png')]);
  expect(e.defaultPrevented).toBe(true);
  await vi.waitFor(() => expect(blocks(ctl, item)).toHaveLength(2));
  expect(blocks(ctl, item).map((b) => [b.key, b.format, b.text])).toEqual([
    ['image', 'image', 'files/a.png'],
    ['image2', 'image', 'files/b.png'],
  ]);
  // One undo step takes them away again.
  ctl.undo();
  expect(blocks(ctl, item)).toHaveLength(0);
});

test('with text on the clipboard too, the text is pasted, not the image', () => {
  const { ctl, item } = setup();
  const e = paste(ctl, item, [png('cells.png')], 'a\tb');
  expect(e.defaultPrevented).toBe(false);
  expect(blocks(ctl, item)).toHaveLength(0);
});

test('without a file to keep images beside, pasting one says so', () => {
  mocks.server = false;
  const { ctl, item } = setup();
  paste(ctl, item, [png('a.png')]);
  expect(ctl.toast?.message).toMatch(/file|ファイル/);
  expect(blocks(ctl, item)).toHaveLength(0);
  mocks.server = true;
});
