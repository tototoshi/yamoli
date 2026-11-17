/*
 * The ways to show an item. The outline and the data views (text, YAML, JSON)
 * suit any item; the document, the Gantt chart, the diagram, the mind map and the slides each need rows
 * written for them, so an item turns them on with a `views` field — for
 * itself and everything under it:
 *
 *   views: gantt, slides
 */
import { t } from './i18n';
import type { OutlineStore } from './model';

export type View = 'outline' | 'doc' | 'gantt' | 'diagram' | 'mindmap' | 'slides' | 'text' | 'yaml' | 'json';
export const VIEWS: View[] = ['outline', 'doc', 'gantt', 'diagram', 'mindmap', 'slides', 'text', 'yaml', 'json'];

/** Views shown only where a `views` field turns them on. */
export type DrawnView = 'doc' | 'gantt' | 'diagram' | 'mindmap' | 'slides';
export const DRAWN_VIEWS: DrawnView[] = ['doc', 'gantt', 'diagram', 'mindmap', 'slides'];

export const VIEWS_KEY = 'views';

/** Names a `views` field understands, in English or Japanese. */
const NAMES: Record<string, DrawnView> = {
  doc: 'doc',
  document: 'doc',
  ドキュメント: 'doc',
  文書: 'doc',
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

/** What each view is called, on its button and its badge. */
export const viewName = (view: View): string =>
  ({
    outline: t('アウトライン', 'Outline'),
    doc: t('ドキュメント', 'Document'),
    gantt: t('ガント', 'Gantt'),
    diagram: t('図', 'Diagram'),
    mindmap: t('マインドマップ', 'Mind map'),
    slides: t('スライド', 'Slides'),
    text: t('テキスト', 'Text'),
    yaml: 'YAML',
    json: 'JSON',
  })[view];

/** The drawn views id's own `views` field turns on (not those of the items above it). */
export function ownViews(store: OutlineStore, id: string): DrawnView[] {
  const words = (store.fieldValue(id, VIEWS_KEY) ?? '').toLowerCase().split(/[\s,、]+/);
  return DRAWN_VIEWS.filter((v) => words.some((w) => NAMES[w] === v));
}

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
