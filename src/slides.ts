/*
 * Slides from an outline: the zoomed item is the deck, each item under it a
 * slide (its text the title, its sub-items the bullets, its blocks the
 * content). Fields the slides view understands:
 *
 *   on the deck:   subtitle: …         shown on the title slide
 *                  theme: light | dark
 *   on a slide:    layout: default | center | two-column | title
 *                    (two-column: bullets beside the data, or split in half)
 *                  notes: …            speaker notes (also as a list)
 *                  image: https://…    picture beside the bullets
 *                  embed: [[item]]     that item's Gantt chart
 *                  embed: [[item]] diagram   …or its diagram (also `図`)
 *                  embed: diagram      the slide's own rows as a diagram
 *                                      (`gantt` / `ガント`: a Gantt chart), not bullets
 */
import { refIds } from './links';
import type { OutlineStore } from './model';

export type Layout = 'default' | 'title' | 'center' | 'two-column';
const LAYOUTS: Layout[] = ['default', 'title', 'center', 'two-column'];

export interface Bullet {
  id: string;
  children: Bullet[];
}

export interface Slide {
  /** The item the slide shows (the deck itself for the title slide). */
  id: string;
  layout: Layout;
  bullets: Bullet[];
  subtitle?: string;
  notes?: string;
  image?: string;
  embed?: string;
  /** What of the embedded item to show. */
  embedAs?: 'gantt' | 'diagram';
}

export interface Deck {
  theme: 'light' | 'dark';
  slides: Slide[];
}

export function buildDeck(store: OutlineStore, deckId: string): Deck {
  const value = (id: string, key: string) => {
    const f = store.field(id, key);
    return f
      ? store
          .fieldTexts(f.id)
          .filter((t) => t.trim())
          .join('\n') || undefined
      : undefined;
  };
  const bullets = (id: string): Bullet[] => store.items(id).map((c) => ({ id: c, children: bullets(c) }));

  const slides: Slide[] = [];
  if (deckId !== store.rootId) {
    slides.push({ id: deckId, layout: 'title', bullets: [], subtitle: value(deckId, 'subtitle'), notes: value(deckId, 'notes') });
  }
  for (const id of store.items(deckId)) {
    const layout = value(id, 'layout') as Layout | undefined;
    const embed = value(id, 'embed');
    // No link: the slide's own rows are drawn, rather than listed.
    const own = !!embed && !refIds(embed).length;
    slides.push({
      id,
      layout: layout && LAYOUTS.includes(layout) ? layout : 'default',
      bullets: own ? [] : bullets(id),
      subtitle: value(id, 'subtitle'),
      notes: value(id, 'notes'),
      image: value(id, 'image'),
      embed: own ? id : embed ? refIds(embed).find((r) => store.get(r)) : undefined,
      embedAs: embed ? (/diagram|図/i.test(embed.replace(/\[\[[^\]]*\]\]/g, '')) ? 'diagram' : 'gantt') : undefined,
    });
  }
  return { theme: value(deckId, 'theme') === 'dark' ? 'dark' : 'light', slides };
}

/** Split bullets into two columns of similar length (counting nested lines). */
export function splitColumns(bullets: Bullet[]): [Bullet[], Bullet[]] {
  const size = (b: Bullet): number => 1 + b.children.reduce((n, c) => n + size(c), 0);
  const total = bullets.reduce((n, b) => n + size(b), 0);
  let acc = 0;
  let i = 0;
  while (i < bullets.length - 1 && acc + size(bullets[i]) <= total / 2) acc += size(bullets[i++]);
  if (i === 0 && bullets.length) i = 1;
  return [bullets.slice(0, i), bullets.slice(i)];
}
