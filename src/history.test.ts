import { expect, test } from 'vitest';
import { UndoHistory } from './history';

test('undo / redo walk through recorded states', () => {
  const h = new UndoHistory<string>('a');
  h.record('b', 'at-a');
  h.record('c', 'at-b');
  expect(h.undo('at-c')).toEqual({ state: 'b', meta: 'at-b' });
  expect(h.undo('at-b')).toEqual({ state: 'a', meta: 'at-a' });
  expect(h.undo('at-a')).toBeNull();
  expect(h.redo('x')).toEqual({ state: 'b', meta: 'at-b' });
  expect(h.redo('x')).toEqual({ state: 'c', meta: 'at-c' });
  expect(h.canRedo).toBe(false);
});

test('unchanged state is not recorded; new record clears redo', () => {
  const h = new UndoHistory<null>('a');
  expect(h.record('a', null)).toBe(false);
  expect(h.canUndo).toBe(false);
  h.record('b', null);
  h.undo(null);
  expect(h.canRedo).toBe(true);
  h.record('c', null);
  expect(h.canRedo).toBe(false);
});

test('typing in one field coalesces until a pause or another action', () => {
  const h = new UndoHistory<string>('');
  h.record('h', 'm0', 'text:1', 0);
  h.record('he', 'm1', 'text:1', 300);
  h.record('hel', 'm2', 'text:1', 600);
  h.record('hel!', 'm3', 'text:1', 2000); // pause > 1s starts a new step
  h.record('hel!?', 'm4', 'text:2', 2100); // different field
  expect(h.undo('')?.state).toBe('hel!');
  expect(h.undo('')?.state).toBe('hel');
  expect(h.undo('')).toEqual({ state: '', meta: 'm0' });
});

test('history is capped', () => {
  const h = new UndoHistory<null>('0', 3);
  for (let i = 1; i <= 5; i++) h.record(String(i), null);
  let n = 0;
  while (h.undo(null)) n++;
  expect(n).toBe(3);
});
