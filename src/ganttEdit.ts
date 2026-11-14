/*
 * Editing the schedule from the Gantt chart: a bar moved, a bar's end
 * dragged, or a date typed in, written back as the fields the schedule
 * is worked out from (schedule.ts), so the outline stays the one source.
 *
 *   moved          start (and end, for an item given its last day)
 *   end dragged    duration (working days, or calendar days for 10cd), or end
 *   days typed     the same, as that many working days
 *
 * Dependencies still win: a bar moved before what it waits for stays after it.
 */
import { formatDate, parseDate, parseDuration, type Day, type WorkCalendar } from './calendar';
import type { OutlineStore } from './model';
import type { Sched } from './schedule';

/** Start s's item (scheduled as s) on day, keeping its length. */
export function moveTo(store: OutlineStore, id: string, s: Sched, day: Day) {
  store.setField(id, 'start', formatDate(day));
  if (!store.fieldValue(id, 'duration') && store.fieldValue(id, 'end')) store.setField(id, 'end', formatDate(day + s.end - s.start));
}

/** End s's item (a task scheduled as s) on day. */
export function resizeTo(store: OutlineStore, id: string, s: Sched, day: Day, cal: WorkCalendar) {
  if (day < s.start) return;
  const duration = store.fieldValue(id, 'duration');
  if (duration !== undefined) {
    const calendarDays = parseDuration(duration)?.unit === 'cd';
    store.setField(id, 'duration', calendarDays ? `${day - s.start + 1}cd` : `${Math.max(cal.workdaysBetween(s.start, day), 1)}d`);
  } else {
    // The end field is the last day from where the item would start without
    // its dependencies; move it by as much as the bar's end moves.
    const last = parseDate(store.fieldValue(id, 'end'));
    store.setField(id, 'end', formatDate(last === null ? day : last + day - s.end));
  }
}

/** Make s's item (s: undefined when not scheduled yet) take n working days; 0 makes it a milestone. */
export function setDays(store: OutlineStore, id: string, s: Sched | undefined, n: number, cal: WorkCalendar) {
  if (n > 0 && s?.kind === 'task') resizeTo(store, id, s, cal.addWorkdays(s.start, n), cal);
  else store.setField(id, 'duration', `${n}d`);
}
