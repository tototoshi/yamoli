/*
 * The ways to show an item. The outline and the data views (text, YAML, JSON)
 * suit any item; the Gantt chart, the diagram, the mind map and the slides each need rows
 * written for them, so an item turns them on with a `views` field — for
 * itself and everything under it:
 *
 *   views: gantt, slides
 */
import type { OutlineStore } from './model';

export type View = 'outline' | 'gantt' | 'diagram' | 'mindmap' | 'slides' | 'text' | 'yaml' | 'json';
export const VIEWS: View[] = ['outline', 'gantt', 'diagram', 'mindmap', 'slides', 'text', 'yaml', 'json'];

/** Views shown only where a `views` field turns them on. */
export type DrawnView = 'gantt' | 'diagram' | 'mindmap' | 'slides';
export const DRAWN_VIEWS: DrawnView[] = ['gantt', 'diagram', 'mindmap', 'slides'];

export const VIEWS_KEY = 'views';

/** Names a `views` field understands, in English or Japanese. */
const NAMES: Record<string, DrawnView> = {
  gantt: 'gantt',
  diagram: 'diagram',
  mindmap: 'mindmap',
  slides: 'slides',
  ガント: 'gantt',
  図: 'diagram',
  マインドマップ: 'mindmap',
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
