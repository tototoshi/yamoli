// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { formatDate, today } from './calendar';
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
  let a = '',
    b = '';
  const ctl = setup((s, add) => {
    a = add(s.rootId, 'one');
    b = add(s.rootId, 'two');
  });
  press(ctl, editor(ctl, b), 'Backspace');
  expect(ctl.store.get(b)).toBeUndefined();
  expect(ctl.store.node(a).text).toBe('onetwo');
});

test('Backspace never joins a row into a field', () => {
  let item = '',
    tags = '',
    first = '',
    next = '';
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
  let row = '',
    item = '';
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
  let a = '',
    b = '';
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
  let p = '',
    a = '',
    b = '',
    c = '';
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

test('⌘Shift+Enter on selected rows completes them all in one undo step', () => {
  let a = '',
    b = '';
  const ctl = setup((s, add) => {
    a = add(s.rootId, 'a');
    b = add(s.rootId, 'b');
  });
  ctl.toggleComplete(a); // one already done: the rest follow, none are reopened
  ctl.selectRows(a, b);
  ctl.selectionKeydown(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, shiftKey: true, cancelable: true }));
  expect([a, b].map((id) => ctl.store.node(id).completed)).toEqual([true, true]);
  ctl.undo();
  expect([a, b].map((id) => ctl.store.node(id).completed)).toEqual([true, false]);
});

test('dragging several rows moves them in order', () => {
  let p = '',
    a = '',
    b = '';
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
  let item = '',
    note = '';
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
  let a = '',
    b = '';
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
  let a = '',
    b = '';
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
  let home = '',
    shop = '',
    milk = '',
    note = '',
    idea = '';
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

/** A paste of text into ta (and of html, as copied from a page). */
function paste(ctl: Ctl, ta: HTMLTextAreaElement, text: string, html = '') {
  const e = new Event('paste', { cancelable: true }) as ClipboardEvent;
  Object.defineProperty(e, 'clipboardData', { value: { getData: (type: string) => (type === 'text/html' ? html : text) } });
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

test('Copy tree takes everything under an item, hidden rows too, and pastes it back whole', async () => {
  let a = '';
  let target = '';
  const ctl = setup((s, add) => {
    a = add(s.rootId, 'A');
    s.addField(a, 'owner', 'toshi');
    const b = add(a, 'B');
    add(b, 'C');
    s.setCompleted(add(a, 'done one'), true);
    s.node(a).collapsed = true;
    target = add(s.rootId, '');
  });
  let written = '';
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => void (written = t) }, configurable: true });
  ctl.copyTree(a);
  await Promise.resolve();
  expect(written).toBe('- A\n  - owner: toshi\n  - B\n    - C\n  - [x] done one\n');

  paste(ctl, editor(ctl, target), written);
  const { store } = ctl;
  const copy = store.node(store.rootId).children[1];
  expect(store.node(copy)).toMatchObject({ text: 'A', collapsed: true });
  expect(store.fieldValue(copy, 'owner')).toBe('toshi');
  expect(texts(ctl, copy).slice(1)).toEqual(['B', 'done one']);
  expect(store.node(store.items(copy)[1]).completed).toBe(true);
});

test('boxes copied in the diagram paste after another, their links among them going to the copies', () => {
  let api = '';
  let web = '';
  let db = '';
  const ctl = setup((s, add) => {
    api = add(s.rootId, 'API');
    const orders = add(api, 'Orders');
    const stock = add(api, 'Stock');
    db = add(s.rootId, 'DB');
    s.addField(orders, 'to', `[[${stock}]] call, [[${db}]] SQL`);
    web = add(s.rootId, 'Web');
  });
  const { store } = ctl;
  const text = ctl.copyItems([api]);
  const [copy] = ctl.pasteItems(text, store.rootId, store.indexOf(web) + 1);
  expect(store.items(store.rootId).map((c) => store.node(c).text)).toEqual(['API', 'DB', 'Web', 'API']);
  const [orders, stock] = store.items(copy);
  // The arrow inside goes to the copy of Stock; the one out still to DB.
  expect(store.fieldValue(orders, 'to')).toBe(`[[${stock}]] call, [[${db}]] SQL`);

  // Text from elsewhere comes in a box a line.
  expect(ctl.pasteItems('Queue\nCache', store.rootId, 0).map((c) => store.node(c).text)).toEqual(['Queue', 'Cache']);
});

test('#/docs opens the guide over the outline, and leaving it comes back', () => {
  let a = '';
  const ctl = setup((s, add) => {
    a = add(s.rootId, 'A');
  });
  ctl.bind(() => {});
  location.hash = `#/${a}`;
  ctl.onHashChange();
  location.hash = '#/docs';
  ctl.onHashChange();
  expect(ctl.docs).toBe(true);
  expect(ctl.zoomId).toBe(a); // the outline underneath is as it was
  location.hash = `#/${a}`;
  ctl.onHashChange();
  expect(ctl.docs).toBe(false);
  location.hash = '';
});

test('starting on #/docs shows the guide with home underneath', () => {
  location.hash = '#/docs';
  const ctl = setup(() => {});
  expect(ctl.docs).toBe(true);
  expect(ctl.zoomId).toBe(ctl.store.rootId);
  location.hash = '';
});

test('⌘Enter adds a row below, after the rows under it, wherever the caret is; ⌘Shift+Enter completes', () => {
  let a = '',
    b = '';
  const ctl = setup((s, add) => {
    a = add(s.rootId, 'parent');
    add(a, 'child');
    b = add(s.rootId, 'next');
  });
  const { store } = ctl;
  press(ctl, editor(ctl, a, 2), 'Enter', { metaKey: true });
  expect(store.node(store.rootId).children.map((c) => store.node(c).text)).toEqual(['parent', '', 'next']);
  expect(store.node(a).text).toBe('parent'); // not split at the caret
  expect(texts(ctl, a)).toEqual(['child']);

  press(ctl, editor(ctl, b), 'Enter', { metaKey: true, shiftKey: true });
  expect(store.node(b).completed).toBe(true);
});

test('the schedule is worked out again only when what it reads changes', () => {
  let a = '';
  const ctl = setup((s, add) => {
    a = add(s.rootId, 'A');
    s.addField(a, 'start', '2026-11-10');
    s.addField(a, 'duration', '2d');
  });
  ctl.refreshSchedule();
  const first = ctl.schedule;
  ctl.store.setText(a, 'A renamed');
  ctl.refreshSchedule();
  expect(ctl.schedule).toBe(first);
  ctl.store.setText(ctl.store.field(a, 'duration')!.id, '3d');
  ctl.refreshSchedule();
  expect(ctl.schedule).not.toBe(first);
});

test('undo puts back the whole outline from the steps', () => {
  let a = '';
  const ctl = setup((s, add) => {
    a = add(s.rootId, 'A');
    add(a, 'child');
  });
  const ta = editor(ctl, a, 1);
  press(ctl, ta, 'Enter', { metaKey: true }); // a new row below
  ctl.store.setText(a, 'A2');
  ctl.commit(null);
  ctl.undo();
  ctl.undo();
  const top = () => ctl.store.node(ctl.store.rootId).children.map((c) => ctl.store.node(c).text);
  expect(top()).toEqual(['A']);
  expect(texts(ctl, a)).toEqual(['child']);
  ctl.redo();
  expect(top()).toEqual(['A', '']);
});

test('a field added from the diagram is typed in the outline, which the view switches to', () => {
  let a = '';
  const ctl = setup((s, add) => {
    a = add(s.rootId, 'A');
    s.addField(a, 'views', 'diagram');
    add(a, 'box');
  });
  ctl.bind(() => {});
  location.hash = `#/${a}?view=diagram`;
  ctl.onHashChange();
  expect(ctl.view).toBe('diagram');
  ctl.addAttribute(a);
  const f = ctl.store.node(a).children.find((c) => ctl.store.node(c).key === '')!;
  ctl.onHashChange();
  expect(ctl.view).toBe('outline');
  expect(ctl.activeField).toBe('fkey:' + f);
  location.hash = '';
});

test('text copied from a page pastes with its links, on one line or many', () => {
  let a = '';
  const ctl = setup((s, add) => {
    a = add(s.rootId, 'Read  first');
  });
  const ta = editor(ctl, a, 5);
  const e = paste(ctl, ta, 'the guide', '<a href="https://example.com/guide">the guide</a>');
  expect(e.defaultPrevented).toBe(true);
  expect(ctl.store.node(a).text).toBe('Read [the guide](https://example.com/guide) first');

  const b = ctl.store.addSiblingAfter(a, '').id;
  paste(ctl, editor(ctl, b), 'One\nTwo', '<p><a href="https://one.example">One</a></p><p>Two</p>');
  expect(texts(ctl, ctl.store.rootId).slice(1)).toEqual(['[One](https://one.example)', 'Two']);
});

test('in the document, the arrow keys go through every row, folded or not, and past the fields', () => {
  let a = '',
    b = '',
    c = '';
  const ctl = setup((s, add) => {
    a = add(s.rootId, 'A');
    s.addField(a, 'views', 'doc');
    b = add(a, 'B');
    s.addField(b, 'note', 'x');
    c = add(b, 'C');
    s.setCollapsed(b, true);
  });
  ctl.bind(() => {});
  location.hash = `#/${a}?view=doc`;
  ctl.onHashChange();
  expect(ctl.visibleRows()).toEqual([b, c]);
  location.hash = '';
});

test('on a slide, Backspace at the start of a field keeps it a field; emptied, it takes the field away', () => {
  let deck = '',
    slide = '',
    sub = '',
    notes = '';
  const ctl = setup((s, add) => {
    deck = add(s.rootId, 'Deck');
    s.addField(deck, 'views', 'slides');
    slide = add(deck, 'Slide');
    sub = s.addField(slide, 'subtitle', 'Sub').id;
    notes = s.addField(slide, 'notes', '').id;
  });
  ctl.bind(() => {});
  location.hash = `#/${deck}?view=slides`;
  ctl.onHashChange();
  press(ctl, editor(ctl, sub), 'Backspace');
  expect(ctl.store.node(sub).key).toBe('subtitle'); // not a row (a bullet) now
  expect(ctl.store.node(sub).text).toBe('Sub');
  press(ctl, editor(ctl, notes), 'Backspace');
  expect(ctl.store.get(notes)).toBeUndefined();
  ctl.store.setText(sub, '');
  press(ctl, editor(ctl, sub), 'Backspace');
  expect(ctl.store.get(sub)).toBeUndefined();
  expect(ctl.pendingFocus).toEqual(expect.objectContaining({ key: 'text:' + slide }));
  location.hash = '';
});

test('on a slide, Enter in its title makes its first bullet, before those it has', () => {
  let deck = '',
    slide = '',
    old = '';
  const ctl = setup((s, add) => {
    deck = add(s.rootId, 'Deck');
    s.addField(deck, 'views', 'slides');
    slide = add(deck, 'Title');
    s.addField(slide, 'notes', 'n');
    old = add(slide, 'Old bullet');
    s.setCollapsed(slide, true);
  });
  ctl.bind(() => {});
  location.hash = `#/${deck}?view=slides`;
  ctl.onHashChange();
  press(ctl, editor(ctl, slide, 5), 'Enter');
  expect(ctl.store.items(deck)).toEqual([slide]); // no slide after it
  expect(ctl.store.items(slide).map((c) => ctl.store.node(c).text)).toEqual(['', 'Old bullet']);
  expect(ctl.store.items(slide)[1]).toBe(old);
  location.hash = '';
});

test('⌘⌥1 to ⌘⌥3 make the line a heading (its #s written), ⌘⌥0 a plain row again; the caret stays on its word', () => {
  let line = '';
  const ctl = setup((s, add) => {
    line = add(s.rootId, 'A sentence.');
  });
  const mod = { altKey: true, metaKey: true, ctrlKey: true };
  expect(press(ctl, editor(ctl, line, 2), '¡', { ...mod, code: 'Digit1' }).defaultPrevented).toBe(true);
  expect(ctl.store.node(line).text).toBe('# A sentence.');
  expect(ctl.pendingFocus).toEqual(expect.objectContaining({ key: 'text:' + line, start: 4 }));
  press(ctl, editor(ctl, line, 4), '™', { ...mod, code: 'Digit2' });
  expect(ctl.store.node(line).text).toBe('## A sentence.');
  press(ctl, editor(ctl, line), 'º', { ...mod, code: 'Digit0' });
  expect(ctl.store.node(line).text).toBe('A sentence.');
});

test('in the document view, Backspace at the start of a line joins it to the one before, its rows kept in place', () => {
  let doc = '',
    intro = '',
    sec = '',
    a = '',
    b = '';
  const ctl = setup((s, add) => {
    doc = add(s.rootId, 'Doc');
    s.addField(doc, 'views', 'doc');
    intro = add(doc, 'Intro.');
    sec = add(doc, '# Section');
    a = add(sec, 'A.');
    b = add(sec, 'B.');
    s.addField(sec, 'owner', 'me');
  });
  location.hash = `#/${doc}?view=doc`;
  ctl.onHashChange();
  expect(press(ctl, editor(ctl, sec), 'Backspace').defaultPrevented).toBe(true);
  expect(ctl.store.node(intro).text).toBe('Intro.Section');
  expect(ctl.store.items(doc)).toEqual([intro, a, b]); // the section's rows where they were, a level up
  expect(ctl.store.field(intro, 'owner')?.text).toBe('me');
  expect(ctl.pendingFocus).toEqual(expect.objectContaining({ key: 'text:' + intro }));
  // The first line under its parent joins the parent (a list item being made a paragraph first).
  press(ctl, editor(ctl, a), 'Backspace');
  expect(ctl.store.node(a).paragraph).toBe(true);
  press(ctl, editor(ctl, a), 'Backspace');
  expect(ctl.store.node(intro).text).toBe('Intro.SectionA.');
});

test('⌘D bookmarks the row (again: takes it out); bookmarks come first in the jump box, in outline order', () => {
  let a = '';
  let b = '';
  const ctl = setup((s, add) => {
    add(s.rootId, 'Alpha');
    a = add(s.rootId, 'Beta');
    b = add(a, 'Gamma');
  });
  press(ctl, editor(ctl, b), 'd', { code: 'KeyD', ctrlKey: true });
  ctl.toggleBookmark([a]);
  expect(ctl.store.bookmarks()).toEqual([a, b]);
  expect(ctl.jumpCandidates('').slice(0, 2)).toEqual([a, b]);
  expect(ctl.jumpCandidates('gam')).toEqual([b]);
  press(ctl, editor(ctl, b), 'd', { code: 'KeyD', ctrlKey: true });
  expect(ctl.store.bookmarks()).toEqual([a]);
  // Kept with the outline.
  expect(OutlineStore.fromJSON(JSON.parse(JSON.stringify(ctl.store.toJSON()))).bookmarks()).toEqual([a]);
});

test('typing [ ] at the start of a row makes it a task ([x] a completed one); Backspace at its start a plain row again', () => {
  let a = '';
  let b = '';
  const ctl = setup((s, add) => {
    add(s.rootId, 'before');
    a = add(s.rootId, '');
    b = add(s.rootId, '');
  });
  const type = (id: string, value: string) => {
    const ta = editor(ctl, id);
    ta.value = value;
    ta.setSelectionRange(value.length, value.length);
    ctl.onTextInput(id, ta);
  };
  type(a, '[ ] ');
  expect(ctl.store.node(a)).toMatchObject({ text: '', task: true, completed: false });
  type(b, '［x］ ');
  expect(ctl.store.node(b)).toMatchObject({ text: '', task: true, completed: true });
  type(a, 'buy milk');
  press(ctl, editor(ctl, a), 'Backspace');
  expect(ctl.store.node(a)).toMatchObject({ text: 'buy milk', task: false });
  press(ctl, editor(ctl, a), 'Backspace'); // now it joins the row above
  expect(texts(ctl, ctl.store.rootId)[0]).toBe('beforebuy milk');
});

test('typing # at the start of a row keeps the caret in it, the line being drawn anew as a heading', () => {
  let a = '';
  const ctl = setup((s, add) => {
    a = add(s.rootId, 'Plan');
  });
  const ta = editor(ctl, a);
  ta.value = '# Plan';
  ta.setSelectionRange(2, 2);
  ctl.onTextInput(a, ta);
  expect(ctl.store.node(a).text).toBe('# Plan');
  expect(ctl.pendingFocus).toEqual(expect.objectContaining({ key: 'text:' + a, start: 2 }));
});

test('in the document view, Backspace at the start of a list item makes it a paragraph; - typed makes it one again; Enter keeps the kind', () => {
  let doc = '';
  let a = '';
  let b = '';
  const ctl = setup((s, add) => {
    doc = add(s.rootId, 'Doc');
    s.addField(doc, 'views', 'doc');
    a = add(doc, 'first');
    b = add(doc, 'second');
  });
  location.hash = `#/${doc}?view=doc`;
  ctl.onHashChange();
  press(ctl, editor(ctl, b), 'Backspace');
  expect(ctl.store.node(b)).toMatchObject({ text: 'second', paragraph: true });
  expect(ctl.store.node(a).paragraph).toBe(false);
  press(ctl, editor(ctl, b, 6), 'Enter');
  const c = ctl.store.node(doc).children.at(-1)!;
  expect(ctl.store.node(c).paragraph).toBe(true);
  const ta = editor(ctl, b);
  ta.value = '- second';
  ta.setSelectionRange(2, 2);
  ctl.onTextInput(b, ta);
  expect(ctl.store.node(b)).toMatchObject({ text: 'second', paragraph: false });
});

test('typing // offers dates: Enter writes today in its place, a date typed after it that date', () => {
  let a = '';
  const ctl = setup((s, add) => {
    a = add(s.rootId, '締切 ');
  });
  const type = (value: string) => {
    const ta = editor(ctl, a, value.length);
    ta.value = value;
    ta.setSelectionRange(value.length, value.length);
    ctl.onTextInput(a, ta);
    return ta;
  };
  let ta = type('締切 //');
  expect(ctl.picker?.dates?.map((d) => d.day)).toEqual([today(), today() + 1, today() - 1, expect.any(Number), null]);
  press(ctl, ta, 'Enter');
  expect(ctl.store.node(a).text).toBe(`締切 ${formatDate(today())}`);
  ta = type('締切 //12/24');
  expect(ctl.picker?.dates?.[0].label).toMatch(/12-24/);
  press(ctl, ta, 'Enter');
  expect(ctl.store.node(a).text).toMatch(/^締切 \d{4}-12-24$/);
  type('https://');
  expect(ctl.picker).toBeNull();
});

test('``` and a space (or Enter) on a row makes it a code block where it is, ```ts one in TypeScript', () => {
  let a = '';
  let b = '';
  let c = '';
  const ctl = setup((s, add) => {
    add(s.rootId, 'before');
    a = add(s.rootId, '');
    b = add(s.rootId, '');
    c = add(s.rootId, 'after');
  });
  const ta = editor(ctl, a);
  ta.value = '```';
  ta.setSelectionRange(3, 3);
  ctl.onTextInput(a, ta);
  expect(ctl.store.node(a).key).toBeNull(); // a language may follow
  ta.value = '``` ';
  ta.setSelectionRange(4, 4);
  ctl.onTextInput(a, ta);
  expect(ctl.store.node(a)).toMatchObject({ key: 'code', format: 'code', text: '' });
  expect(ctl.store.node(ctl.store.rootId).children.indexOf(a)).toBe(1);
  expect(ctl.pendingFocus).toEqual(expect.objectContaining({ key: 'text:' + a }));

  const tb = editor(ctl, b);
  tb.value = '```ts';
  tb.setSelectionRange(5, 5);
  press(ctl, tb, 'Enter');
  expect(ctl.store.node(b)).toMatchObject({ format: 'code:ts', text: '' });
  expect(ctl.store.node(b).key).not.toBe('code'); // a key of its own beside a's
  expect(ctl.store.node(c).key).toBeNull();
});

test('in the document view, ⌘Enter in a block goes on to a new line right after it', () => {
  let doc = '';
  let code = '';
  const ctl = setup((s, add) => {
    doc = add(s.rootId, 'Doc');
    s.addField(doc, 'views', 'doc');
    add(doc, 'before');
    code = add(doc, '');
    s.setKey(code, 'code');
    s.setFormat(code, 'code');
    add(doc, 'after');
  });
  location.hash = `#/${doc}?view=doc`;
  ctl.onHashChange();
  press(ctl, editor(ctl, code), 'Enter', { metaKey: true, ctrlKey: true });
  const kids = ctl.store.node(doc).children;
  const next = kids[kids.indexOf(code) + 1];
  expect(ctl.store.node(next)).toMatchObject({ text: '', key: null });
  expect(ctl.pendingFocus).toEqual(expect.objectContaining({ key: 'text:' + next }));
});
