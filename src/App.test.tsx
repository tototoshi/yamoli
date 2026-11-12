// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { expect, test, vi } from 'vitest';
import { OutlineStore } from './model';

// Render the app on a store per test, and save nowhere.
const mocks = vi.hoisted(() => ({ store: null as unknown as import('./model').OutlineStore }));
vi.mock('./storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./storage')>()),
  load: () => mocks.store,
  save: () => {},
}));
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const { App } = await import('./App');

async function mount(build: (s: OutlineStore) => void) {
  const s = OutlineStore.create();
  build(s);
  mocks.store = s;
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  await act(() => render(<App />, root));
  return root;
}

/** Type at the end of the row being edited. */
async function type(root: HTMLElement, text: string) {
  const ta = root.querySelector<HTMLTextAreaElement>('.outline textarea')!;
  await act(() => {
    ta.value += text;
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const rowText = (root: HTMLElement, id: string) => root.querySelector(`li[data-id="${id}"] > .row`)!.textContent;

test('typing in a row redraws the rows that link to it, and leaves the others alone', async () => {
  let a = '', b = '', c = '', d = '';
  const root = await mount((s) => {
    a = s.addChild(s.rootId, -1, 'Alpha').id;
    b = s.addChild(s.rootId, -1, `see [[${a}]]`).id;
    c = s.addChild(s.rootId, -1, 'Other').id;
    // A link in a field shows on the item that owns the field.
    d = s.addChild(s.rootId, -1, 'Delta').id;
    s.addField(d, 'ref', `[[${b}]]`);
  });
  const other = root.querySelector(`li[data-id="${c}"] > .row`);
  await type(root, 'beta');
  expect(rowText(root, b)).toContain('Alphabeta');
  // Labels follow links: d shows b's label, which shows a's.
  expect(root.querySelector(`li[data-id="${d}"]`)!.textContent).toContain('Alphabeta');
  expect(root.querySelector(`li[data-id="${c}"] > .row`)).toBe(other);
});

test('changing a duration redraws the dates of the rows that wait for it', async () => {
  let a = '', b = '', duration = '';
  const root = await mount((s) => {
    a = s.addChild(s.rootId, -1, 'Alpha').id;
    s.addField(a, 'start', '2026-11-02');
    duration = s.addField(a, 'duration', '2d').id;
    b = s.addChild(s.rootId, -1, 'Beta').id;
    s.addField(b, 'duration', '1d');
    s.addField(b, 'after', `[[${a}]]`);
  });
  const dates = () => root.querySelector(`li[data-id="${b}"] > .row .sched`)!.textContent;
  const before = dates();
  await act(() => root.querySelector<HTMLElement>(`.text-view[data-id="${duration}"]`)!.click());
  const ta = root.querySelector<HTMLTextAreaElement>(`textarea[data-id="${duration}"]`)!;
  await act(() => {
    ta.value = '5d';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(dates()).not.toBe(before);
});
