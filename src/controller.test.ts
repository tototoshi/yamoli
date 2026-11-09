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
