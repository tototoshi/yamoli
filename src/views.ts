/*
 * The ways to show an item. The outline and the data views (text, YAML, JSON)
 * suit any item; the Gantt chart, the diagram, the slides and the table each
 * need rows written for them, so an item turns them on with a `views` field —
 * for itself and everything under it:
 *
 *   views: gantt, slides
 */
import type { OutlineStore } from './model';

export type View = 'outline' | 'table' | 'gantt' | 'diagram' | 'slides' | 'text' | 'yaml' | 'json';
export const VIEWS: View[] = ['outline', 'table', 'gantt', 'diagram', 'slides', 'text', 'yaml', 'json'];

/** Views shown only where a `views` field turns them on. */
export type DrawnView = 'table' | 'gantt' | 'diagram' | 'slides';
export const DRAWN_VIEWS: DrawnView[] = ['table', 'gantt', 'diagram', 'slides'];

export const VIEWS_KEY = 'views';

/** Names a `views` field understands, in English or Japanese. */
const NAMES: Record<string, DrawnView> = {
  table: 'table',
  gantt: 'gantt',
  diagram: 'diagram',
  slides: 'slides',
  表: 'table',
  テーブル: 'table',
  ガント: 'gantt',
  図: 'diagram',
  スライド: 'slides',
};

export const isDrawn = (view: View): view is DrawnView => (DRAWN_VIEWS as View[]).includes(view);

/** The drawn views turned on for id, by a `views` field on it or on an item above it. */
export function enabledViews(store: OutlineStore, id: string): Set<DrawnView> {
  const out = new Set<DrawnView>();
  for (const a of store.path(id)) {
    for (const word of (store.fieldValue(a, VIEWS_KEY) ?? '').toLowerCase().split(/[\s,、]+/)) {
      if (NAMES[word]) out.add(NAMES[word]);
    }
  }
  return out;
}
