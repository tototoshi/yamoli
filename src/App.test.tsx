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
const { setLang } = await import('./i18n');

let mounted: HTMLElement | null = null;

async function mount(build: (s: OutlineStore) => void) {
  // The last test's app goes, or it would answer this one's hash changes too.
  if (mounted) await act(() => render(null, mounted!));
  const s = OutlineStore.create();
  build(s);
  mocks.store = s;
  const root = (mounted = document.createElement('div'));
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
  let a = '',
    b = '',
    c = '',
    d = '';
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
  let a = '',
    b = '',
    duration = '';
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

test('Gantt, Diagram and Slides show only where a views field turns them on', async () => {
  setLang('en');
  let item = '';
  const root = await mount((s) => {
    item = s.addChild(s.rootId, -1, 'Plan').id;
    s.addChild(item, -1, 'Step');
  });
  const views = () => [...root.querySelectorAll('.view-switch button')].map((b) => b.textContent);
  const on = () => root.querySelector('.view-switch button.on')?.textContent;
  const settle = () => act(() => new Promise((r) => setTimeout(r, 0)));

  // Asking for a view that isn't on (an old link, say) shows the outline.
  await act(() => {
    location.hash = `#/${item}?view=gantt`;
  });
  await settle();
  expect(on()).toBe('Outline');
  expect(views()).toEqual(['Outline', 'Text', 'YAML', 'JSON']);

  // + turns one on: a views field on the item, and the view is shown.
  await act(() => root.querySelector<HTMLElement>('.view-bar .popup summary')!.click());
  await settle(); // the menu opens on the toggle event, which comes after the click
  const gantt = [...root.querySelectorAll<HTMLElement>('.view-add button')].find((b) => b.textContent!.startsWith('Gantt'))!;
  await act(() => gantt.click());
  await settle();
  expect(mocks.store.fieldValue(item, 'views')).toBe('gantt');
  expect(views()).toEqual(['Outline', 'Gantt', 'Text', 'YAML', 'JSON']);
  expect(on()).toBe('Gantt');

  // Undoing it goes back to the outline.
  await act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', key: 'z', ctrlKey: true, bubbles: true }));
  });
  await settle();
  expect(on()).toBe('Outline');
  expect(views()).toEqual(['Outline', 'Text', 'YAML', 'JSON']);
});
