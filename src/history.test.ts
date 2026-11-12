import { expect, test } from 'vitest';
import { UndoHistory, type Entry, type State } from './history';

/** A state of one part, for the tests that only care about one value. */
const S = (v: string): State => new Map([['x', v]]);
const value = (e: Entry<unknown> | null) => e && { state: e.state.get('x'), meta: e.meta };

test('undo / redo walk through recorded states', () => {
  const h = new UndoHistory<string>(S('a'));
  h.record(S('b'), 'at-a');
  h.record(S('c'), 'at-b');
  expect(value(h.undo('at-c'))).toEqual({ state: 'b', meta: 'at-b' });
  expect(value(h.undo('at-b'))).toEqual({ state: 'a', meta: 'at-a' });
  expect(h.undo('at-a')).toBeNull();
  expect(value(h.redo('x'))).toEqual({ state: 'b', meta: 'at-b' });
  expect(value(h.redo('x'))).toEqual({ state: 'c', meta: 'at-c' });
  expect(h.canRedo).toBe(false);
});

test('unchanged state is not recorded; new record clears redo', () => {
  const h = new UndoHistory<null>(S('a'));
  expect(h.record(S('a'), null)).toBe(false);
  expect(h.canUndo).toBe(false);
  h.record(S('b'), null);
  h.undo(null);
  expect(h.canRedo).toBe(true);
  h.record(S('c'), null);
  expect(h.canRedo).toBe(false);
});

test('typing in one field coalesces until a pause or another action', () => {
  const h = new UndoHistory<string>(S(''));
  h.record(S('h'), 'm0', 'text:1', 0);
  h.record(S('he'), 'm1', 'text:1', 300);
  h.record(S('hel'), 'm2', 'text:1', 600);
  h.record(S('hel!'), 'm3', 'text:1', 2000); // pause > 1s starts a new step
  h.record(S('hel!?'), 'm4', 'text:2', 2100); // different field
  expect(value(h.undo(''))?.state).toBe('hel!');
  expect(value(h.undo(''))?.state).toBe('hel');
  expect(value(h.undo(''))).toEqual({ state: '', meta: 'm0' });
});

test('history is capped', () => {
  const h = new UndoHistory<null>(S('0'), 3);
  for (let i = 1; i <= 5; i++) h.record(S(String(i)), null);
  let n = 0;
  while (h.undo(null)) n++;
  expect(n).toBe(3);
});

test('steps keep only the parts that changed, added and removed ones too', () => {
  const big = new Map(Array.from({ length: 1000 }, (_, i) => [`n${i}`, `node ${i}`]));
  const h = new UndoHistory<null>(big);
  const edited = new Map(big).set('n5', 'changed').set('new', 'added');
  edited.delete('n9');
  h.record(edited, null);
  const step = (h as unknown as { undoStack: { patch: Map<string, unknown> }[] }).undoStack[0];
  expect([...step.patch.keys()].sort()).toEqual(['n5', 'n9', 'new']);

  const back = h.undo(null)!.state;
  expect(back.get('n5')).toBe('node 5');
  expect(back.get('n9')).toBe('node 9');
  expect(back.has('new')).toBe(false);
  expect(back.size).toBe(1000);
  const again = h.redo(null)!.state;
  expect([again.get('n5'), again.get('new'), again.has('n9')]).toEqual(['changed', 'added', false]);
});

test('a part added and then changed within one coalesced step is gone again on undo', () => {
  const h = new UndoHistory<null>(new Map([['a', '1']]));
  h.record(
    new Map([
      ['a', '1'],
      ['b', 'x'],
    ]),
    null,
    'k',
    0
  );
  h.record(
    new Map([
      ['a', '1'],
      ['b', 'xy'],
    ]),
    null,
    'k',
    100
  );
  const back = h.undo(null)!.state;
  expect([...back.entries()]).toEqual([['a', '1']]);
});
