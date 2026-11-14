import { expect, test } from 'vitest';
import { parseDate, parseDateInput, WorkCalendar } from './calendar';
import { findCycles } from './deps';
import { moveTo, resizeTo, setDays } from './ganttEdit';
import { OutlineStore } from './model';
import { computeSchedule } from './schedule';

const day = (s: string) => parseDate(s)!;
const cal = new WorkCalendar();

/** A project starting Monday 2026-11-16 with one task under it, given fields. */
function project(fields: Record<string, string>) {
  const store = OutlineStore.create();
  const p = store.addChild(store.rootId, -1, 'Project').id;
  store.addField(p, 'start', '2026-11-16');
  const id = store.addChild(p, -1, 'Task').id;
  for (const [k, v] of Object.entries(fields)) store.addField(id, k, v);
  const sched = (x = id) => computeSchedule(store, findCycles(store)).byId.get(x);
  return { store, p, id, sched };
}

test('moving a bar sets its start; its working days stay the same', () => {
  const { store, id, sched } = project({ duration: '3d' });
  moveTo(store, id, sched()!, day('2026-11-19')); // Thursday: Thu, Fri, Mon
  expect(store.fieldValue(id, 'duration')).toBe('3d');
  expect(sched()).toMatchObject({ start: day('2026-11-19'), end: day('2026-11-23') });
});

test('moving an item given its last day moves the last day too', () => {
  const { store, id, sched } = project({ end: '2026-11-18' });
  moveTo(store, id, sched()!, day('2026-11-23'));
  expect(store.fieldValue(id, 'end')).toBe('2026-11-25');
  expect(sched()).toMatchObject({ start: day('2026-11-23'), end: day('2026-11-25') });
});

test('a bar moved before what it waits for stays after it', () => {
  const { store, p, id, sched } = project({ duration: '2d' });
  const next = store.addChild(p, -1, 'Next').id;
  store.addField(next, 'duration', '1d');
  store.addField(next, 'after', `[[${id}]]`);
  moveTo(store, next, sched(next)!, day('2026-11-16'));
  expect(sched(next)!.start).toBe(day('2026-11-18'));
});

test("dragging a bar's end sets its duration in working days, calendar days, or its end", () => {
  const work = project({ duration: '2d' });
  resizeTo(work.store, work.id, work.sched()!, day('2026-11-24'), cal); // Mon..Tue next week
  expect(work.store.fieldValue(work.id, 'duration')).toBe('7d');

  const calendar = project({ duration: '2cd' });
  resizeTo(calendar.store, calendar.id, calendar.sched()!, day('2026-11-22'), cal);
  expect(calendar.store.fieldValue(calendar.id, 'duration')).toBe('7cd');

  const until = project({ end: '2026-11-18' });
  resizeTo(until.store, until.id, until.sched()!, day('2026-11-20'), cal);
  expect(until.store.fieldValue(until.id, 'end')).toBe('2026-11-20');

  // Not before it starts.
  resizeTo(work.store, work.id, work.sched()!, day('2026-11-13'), cal);
  expect(work.store.fieldValue(work.id, 'duration')).toBe('7d');
});

test('typing days makes an item that long, or a milestone', () => {
  const { store, id, sched } = project({});
  setDays(store, id, sched(), 4, cal);
  expect(store.fieldValue(id, 'duration')).toBe('4d');
  setDays(store, id, sched(), 6, cal);
  expect(sched()).toMatchObject({ start: day('2026-11-16'), end: day('2026-11-23'), kind: 'task' });
  setDays(store, id, sched(), 0, cal);
  expect(sched()!.kind).toBe('milestone');
});

test('dates can be typed short, in the current year', () => {
  const now = day('2026-11-14');
  expect(parseDateInput('12/1', now)).toBe(day('2026-12-01'));
  expect(parseDateInput('2027/1/5', now)).toBe(day('2027-01-05'));
  expect(parseDateInput('2/30', now)).toBeNull();
  expect(parseDateInput('soon', now)).toBeNull();
});
