// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { OutlineStore } from './model';

// macOS's Emacs keys: the platform is read when the controller loads.
const mocks = vi.hoisted(() => {
  Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
  return { store: null as unknown as import('./model').OutlineStore };
});
vi.mock('./storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./storage')>()),
  load: () => mocks.store,
  save: () => {},
}));

const { Controller } = await import('./controller');

test('Ctrl+K deletes to the end of the line itself, and at the end joins the next row', () => {
  const s = OutlineStore.create();
  const a = s.addChild(s.rootId, -1, 'one').id;
  s.addChild(s.rootId, -1, 'two');
  mocks.store = s;
  const ctl = new Controller();
  const ta = document.createElement('textarea');
  ta.dataset.id = a;
  ta.dataset.fk = 'text:' + a;
  ta.value = 'one';
  document.body.append(ta);
  const ctrlK = () => {
    const e = new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, cancelable: true });
    ctl.onTextKeydown(e, ta);
    return e;
  };

  ta.setSelectionRange(1, 1);
  expect(ctrlK().defaultPrevented).toBe(false); // left to the browser
  expect(s.node(s.rootId).children).toHaveLength(2);

  ta.setSelectionRange(3, 3);
  expect(ctrlK().defaultPrevented).toBe(true);
  expect(s.node(s.rootId).children.map((c) => s.node(c).text)).toEqual(['onetwo']);
});
