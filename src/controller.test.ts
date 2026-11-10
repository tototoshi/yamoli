// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { OutlineStore } from './model';

// The controller starts from whatever storage loaded; give it a store per test, and save nowhere.
const mocks = vi.hoisted(() => ({ store: null as unknown as import('./model').OutlineStore }));
vi.mock('./storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./storage')>()),
  load: () => mocks.store,
  save: () => {},
}));

const { Controller } = await import('./controller');
type Ctl = InstanceType<typeof Controller>;

function setup(build: (s: OutlineStore, add: (parent: string, text: string) => string) => void): Ctl {
  const s = OutlineStore.create();
  build(s, (parent, text) => s.addChild(parent, -1, text).id);
  mocks.store = s;
  return new Controller();
}

/** A row editor for id, with the caret at start (or the selection start..end). */
function editor(ctl: Ctl, id: string, start = 0, end = start): HTMLTextAreaElement {
  const ta = document.createElement('textarea');
  ta.dataset.id = id;
  ta.dataset.fk = 'text:' + id;
  ta.value = ctl.store.node(id).text;
  document.body.append(ta);
  ta.setSelectionRange(start, end);
  return ta;
}

function press(ctl: Ctl, ta: HTMLTextAreaElement, key: string, opts: KeyboardEventInit = {}) {
  const e = new KeyboardEvent('keydown', { key, cancelable: true, ...opts });
  ctl.onTextKeydown(e, ta);
  return e;
}

const texts = (ctl: Ctl, id: string) => ctl.store.node(id).children.map((c) => ctl.store.node(c).text);

test('Backspace at the start of a row joins it to the row above', () => {
  let a = '', b = '';
  const ctl = setup((s, add) => {
    a = add(s.rootId, 'one');
    b = add(s.rootId, 'two');
  });
  press(ctl, editor(ctl, b), 'Backspace');
  expect(ctl.store.get(b)).toBeUndefined();
  expect(ctl.store.node(a).text).toBe('onetwo');
});

test('Backspace never joins a row into a field', () => {
  let item = '', tags = '', first = '', next = '';
  const ctl = setup((s, add) => {
    item = add(s.rootId, 'task');
    s.addField(item, 'duration', '3d');
    next = add(item, 'sub');
    tags = s.addField(item, 'tags').id;
    first = add(tags, 'outline');
  });
  // An item right below a field row.
  press(ctl, editor(ctl, next), 'Backspace');
  expect(ctl.store.node(next).text).toBe('sub');
  expect(ctl.store.fieldValue(item, 'duration')).toBe('3d');
  // The first element of a list, right below the list's own field.
  press(ctl, editor(ctl, first), 'Backspace');
  expect(ctl.store.node(first).text).toBe('outline');
  expect(ctl.store.node(tags).text).toBe('');
});

test('Tab does not put a row inside a block, even an empty one', () => {
  let row = '', item = '';
  const ctl = setup((s, add) => {
    item = add(s.rootId, 'item');
    s.addBlock(item, 'note', 'markdown', '');
    row = add(item, 'row');
  });
  press(ctl, editor(ctl, row), 'Tab');
  expect(ctl.store.parentOf(row)).toBe(item);
});

test('Enter at the end of a row with fields adds the row after them', () => {
  let item = '';
  const ctl = setup((s, add) => {
    item = add(s.rootId, 'item');
    s.addField(item, 'status', 'active');
    add(item, 'first');
  });
  press(ctl, editor(ctl, item, 4), 'Enter');
  const kids = ctl.store.node(item).children.map((c) => ctl.store.node(c));
  expect(kids.map((n) => n.key ?? n.text)).toEqual(['status', '', 'first']);
});

test('completing records the day, reopening removes it', () => {
  let a = '';
  const ctl = setup((s, add) => {
    a = add(s.rootId, 'task');
  });
  ctl.toggleComplete(a);
  expect(ctl.store.node(a).completed).toBe(true);
  expect(ctl.store.fieldValue(a, 'completed')).toMatch(/^\d{4}-\d\d-\d\d$/);
  ctl.toggleComplete(a);
  expect(ctl.store.field(a, 'completed')).toBeUndefined();
});

test('Shift+↓ at the end of a row starts selecting rows, and the same key goes no further', () => {
  let a = '', b = '';
  const ctl = setup((s, add) => {
    a = add(s.rootId, 'one');
    b = add(s.rootId, 'two');
    add(s.rootId, 'three');
  });
  const e = press(ctl, editor(ctl, a, 3), 'ArrowDown', { shiftKey: true });
  expect(ctl.selection).toEqual({ anchor: a, head: b });
  // The same event reaching the page-wide handler must not extend it again.
  expect(ctl.selectionKeydown(e)).toBe(false);
  expect(ctl.selectedRows()).toEqual([a, b]);
});

test('selected rows indent and outdent together, keeping their order', () => {
  let p = '', a = '', b = '', c = '';
  const ctl = setup((s, add) => {
    p = add(s.rootId, 'parent');
    a = add(s.rootId, 'a');
    b = add(s.rootId, 'b');
    c = add(s.rootId, 'c');
  });
  ctl.selectRows(a, c);
  ctl.selectionKeydown(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
  expect(texts(ctl, p)).toEqual(['a', 'b', 'c']);
  ctl.selectionKeydown(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true }));
  expect(texts(ctl, ctl.store.rootId)).toEqual(['parent', 'a', 'b', 'c']);
  expect([a, b, c].every((id) => ctl.store.parentOf(id) === ctl.store.rootId)).toBe(true);
});

test('⌘Enter on selected rows completes them all in one undo step', () => {
  let a = '', b = '';
  const ctl = setup((s, add) => {
    a = add(s.rootId, 'a');
    b = add(s.rootId, 'b');
  });
  ctl.toggleComplete(a); // one already done: the rest follow, none are reopened
  ctl.selectRows(a, b);
  ctl.selectionKeydown(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, cancelable: true }));
  expect([a, b].map((id) => ctl.store.node(id).completed)).toEqual([true, true]);
  ctl.undo();
  expect([a, b].map((id) => ctl.store.node(id).completed)).toEqual([true, false]);
});

test('dragging several rows moves them in order', () => {
  let p = '', a = '', b = '';
  const ctl = setup((s, add) => {
    a = add(s.rootId, 'a');
    add(s.rootId, 'x');
    b = add(s.rootId, 'b');
    p = add(s.rootId, 'target');
    add(p, 'kept');
  });
  ctl.moveNodes([a, b], p, null);
  expect(texts(ctl, p)).toEqual(['kept', 'a', 'b']);
  expect(texts(ctl, ctl.store.rootId)).toEqual(['x', 'target']);
});

test('a field or block cannot be zoomed into: its item opens instead', () => {
  let item = '', note = '';
  const ctl = setup((s, add) => {
    item = add(s.rootId, 'item');
    note = s.addBlock(item, 'note', 'markdown', 'text').id;
  });
  expect(ctl.hashFor(note)).toBe(ctl.hashFor(item));
  location.hash = '#/' + note;
  ctl.onHashChange();
  expect(ctl.zoomId).toBe(item);
});

test('a field name is completed only once a suggestion is picked, then its values are offered', () => {
  let a = '', b = '';
  const ctl = setup((s, add) => {
    a = add(s.rootId, 'a');
    s.addField(a, 'status', 'done');
    b = add(s.rootId, 'b');
  });
  ctl.addAttribute(b);
  const f = ctl.store.node(b).children[0];
  const input = document.createElement('input');
  input.dataset.id = f;
  input.dataset.fk = 'fkey:' + f;
  input.value = 'st';
  document.body.append(input);
  ctl.onKeyInput(f, input);
  expect(ctl.suggest).toMatchObject({ key: 'fkey:' + f, words: ['status'], selected: -1 });
  ctl.onKeyKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }), input);
  ctl.onKeyKeydown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }), input);
  expect(ctl.store.node(f).key).toBe('status');
  expect(ctl.suggest).toMatchObject({ key: 'text:' + f, words: ['done'], selected: -1 });
  // Enter with nothing picked is an ordinary Enter.
  const ta = editor(ctl, f);
  press(ctl, ta, 'ArrowDown');
  press(ctl, ta, 'Enter');
  expect(ctl.store.fieldValue(b, 'status')).toBe('done');
});

test('a row becomes a task and back; completing makes it one; ⌘L does it from the keyboard', () => {
  let a = '', b = '';
  const ctl = setup((s, add) => {
    a = add(s.rootId, 'note');
    b = add(s.rootId, 'chore');
  });
  const { store } = ctl;
  expect(store.isTask(a)).toBe(false);
  press(ctl, editor(ctl, a), 'l', { code: 'KeyL', metaKey: true });
  expect(store.isTask(a)).toBe(true);
  ctl.toggleComplete(b);
  ctl.toggleComplete(b); // reopened, still to do
  expect([store.isTask(b), store.node(b).completed]).toEqual([true, false]);
  // No longer a task: not completed either.
  ctl.toggleComplete(a);
  ctl.toggleTask([a]);
  expect([store.isTask(a), store.node(a).completed, store.field(a, 'completed')]).toEqual([false, false, undefined]);
});

test('Tasks only shows tasks, the rows they are under (even collapsed) and their fields', () => {
  let home = '', shop = '', milk = '', note = '', idea = '';
  const ctl = setup((s, add) => {
    home = add(s.rootId, 'Home');
    shop = add(home, 'Shopping');
    milk = add(shop, 'milk');
    s.setTask(milk, true);
    s.addField(milk, 'where', 'store');
    note = add(shop, 'opens at 9');
    idea = add(s.rootId, 'Ideas');
    add(idea, 'someday');
    s.setCollapsed(shop, true); // collapsed, yet its tasks show
  });
  ctl.toggleTasksOnly();
  ctl.taskRows = ctl.findTaskRows();
  expect(ctl.visibleRows()).toEqual([home, shop, milk, ctl.store.field(milk, 'where')!.id]);
  expect(ctl.isContextRow(shop)).toBe(true);
  expect(ctl.isContextRow(milk)).toBe(false);
  expect(ctl.visibleRows()).not.toContain(note);
  ctl.toggleTasksOnly(); // prefs are saved: leave them as they were
});

/** A paste of text into ta. */
function paste(ctl: Ctl, ta: HTMLTextAreaElement, text: string) {
  const e = new Event('paste', { cancelable: true }) as ClipboardEvent;
  Object.defineProperty(e, 'clipboardData', { value: { getData: () => text } });
  ctl.onTextPaste(e, ta);
  return e;
}

test('rows copied here paste back as they were: fields, blocks, multi-line text, done', () => {
  let api = '';
  let target = '';
  const ctl = setup((s, add) => {
    api = add(s.rootId, 'API');
    s.addField(api, 'tech', 'Go');
    const note = s.addField(api, 'note', '# Heading\nbody');
    note.format = 'markdown';
    add(api, 'line one\nline two');
    target = add(s.rootId, '');
  });
  let written = '';
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => void (written = t) }, configurable: true });
  ctl.selectRows(api, api);
  ctl.selectionKeydown(new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', metaKey: true, cancelable: true }));
  expect(written).toContain('- API');

  const e = paste(ctl, editor(ctl, target), written.replace(/\n/g, '\r\n'));
  expect(e.defaultPrevented).toBe(true);
  const { store } = ctl;
  const top = store.node(store.rootId).children;
  expect(top).toHaveLength(2); // the empty row became the copy
  const copy = top[1];
  expect(copy).not.toBe(api);
  expect(store.fieldValue(copy, 'tech')).toBe('Go');
  expect(store.field(copy, 'note')).toMatchObject({ format: 'markdown', text: '# Heading\nbody' });
  expect(store.items(copy).map((c) => store.node(c).text)).toEqual(['line one\nline two']);
});

test('a Markdown list from elsewhere keeps fields on their row and multi-line text in one row', () => {
  let target = '';
  const ctl = setup((s, add) => {
    target = add(s.rootId, '');
  });
  paste(ctl, editor(ctl, target), '- API\n  - tech: Go\n  - line one\n    line two\n    - grandchild\n');
  const { store } = ctl;
  const [api] = store.node(store.rootId).children;
  expect(store.node(api).text).toBe('API');
  expect(store.fieldValue(api, 'tech')).toBe('Go');
  const [line] = store.items(api);
  expect(store.node(line).text).toBe('line one\nline two');
  expect(texts(ctl, line)).toEqual(['grandchild']);
});
