/*
 * Slides from an outline: the zoomed item is the deck, each item under it a
 * slide (its text the title, its sub-items the bullets, its blocks the
 * content). Fields the slides view understands:
 *
 *   on the deck:   subtitle: …         shown on the title slide
 *                  theme: light | dark
 *                  reveal: yes         every slide's bullets shown one at a time
 *   on a slide:    layout: default | center | two-column | title | section
 *                          | cards | steps | numbers | statement
 *                    (two-column: bullets beside the data, or split in half;
 *                    section: a chapter's first page; cards, steps, numbers:
 *                    each bullet a card, a step, a big number, the rows under
 *                    it inside; statement: the first bullet large, alone)
 *                  reveal: yes | no    its bullets shown one at a time (or not, whatever the deck says)
 *                  notes: …            speaker notes (also as a list)
 *                  image: https://…    picture beside the bullets (pictures: a list under it)
 *                  image-at: right | left | below | full | background
 *                                      where it goes (右 / 左 / 下 / 大きく / 背景): beside the
 *                                      bullets, under them, alone under the title, behind it all
 *                  embed: [[item]]     that item's Gantt chart
 *                  embed: [[item]] diagram   …or its diagram (also `図`),
 *                                      or mind map (`mindmap` / `マインドマップ`)
 *                  embed: diagram      the slide's own rows as a diagram
 *                                      (`mindmap`, `gantt`: a mind map, a Gantt chart), not bullets
 */
import { refIds } from './links';
import type { OutlineNode, OutlineStore } from './model';

export type Layout = 'default' | 'title' | 'center' | 'two-column' | 'section' | 'cards' | 'steps' | 'numbers' | 'statement';
export type ImageAt = 'right' | 'left' | 'below' | 'full' | 'background';
const IMAGE_AT: Record<string, ImageAt> = {
  right: 'right',
  left: 'left',
  below: 'below',
  full: 'full',
  background: 'background',
  右: 'right',
  左: 'left',
  下: 'below',
  大きく: 'full',
  背景: 'background',
};
const LAYOUTS: Layout[] = ['default', 'title', 'center', 'two-column', 'section', 'cards', 'steps', 'numbers', 'statement'];

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
  /** Its pictures' addresses, in order. */
  images: string[];
  /** Where the pictures go (with any, or their field). */
  imageAt: ImageAt;
  embed?: string;
  /** What of the embedded item to show. */
  embedAs?: 'gantt' | 'diagram' | 'mindmap';
  /** Its bullets shown one at a time, each with those under it. */
  reveal?: boolean;
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

  const yes = (v: string | undefined) => (v === undefined ? undefined : !/^(no|false|off|いいえ|しない)$/i.test(v.trim()));
  const revealAll = yes(value(deckId, 'reveal')) ?? false;
  const slides: Slide[] = [];
  if (deckId !== store.rootId) {
    slides.push({
      id: deckId,
      layout: 'title',
      bullets: [],
      subtitle: value(deckId, 'subtitle'),
      notes: value(deckId, 'notes'),
      images: [],
      imageAt: 'right',
    });
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
      images: imageRows(store, id)
        .map((n) => n.text.trim())
        .filter(Boolean),
      imageAt: IMAGE_AT[value(id, 'image-at')?.trim().toLowerCase() ?? ''] ?? 'right',
      embed: own ? id : embed ? refIds(embed).find((r) => store.get(r)) : undefined,
      embedAs: embed ? embedKind(embed.replace(/\[\[[^\]]*\]\]/g, '')) : undefined,
      reveal: yes(value(id, 'reveal')) ?? revealAll,
    });
  }
  return { theme: value(deckId, 'theme') === 'dark' ? 'dark' : 'light', slides };
}

/**
 * The rows holding a slide's pictures: its `image` field, with one; the rows
 * of the list under it, with several (empty ones too, to be typed in).
 */
export function imageRows(store: OutlineStore, id: string): OutlineNode[] {
  const f = store.field(id, 'image');
  if (!f) return [];
  const list = f.children.map((c) => store.node(c)).filter((n) => n.key === null);
  return list.length ? (f.text.trim() ? [f, ...list] : list) : [f];
}

/** Add a picture to a slide: its `image` field's value with none, else the list under it (one value made the list's first). */
export function addImage(store: OutlineStore, id: string, ref: string) {
  const f = store.field(id, 'image');
  if (!f) return void store.addField(id, 'image', ref);
  if (!f.text.trim() && !f.children.length) return store.setText(f.id, ref);
  if (f.text.trim()) {
    store.addChild(f.id, 0, f.text.trim());
    store.setText(f.id, '');
  }
  store.addChild(f.id, -1, ref);
}

/** Take a picture (its row) off a slide: a list of one left is that one value again, none no field. */
export function removeImage(store: OutlineStore, id: string, row: string) {
  const f = store.field(id, 'image');
  if (!f) return;
  if (row === f.id) store.setText(f.id, '');
  else store.remove(row);
  const left = imageRows(store, id).filter((n) => n.text.trim() || n.id !== f.id);
  if (!left.length) return store.remove(f.id);
  if (left.length === 1 && left[0].id !== f.id && !left[0].children.length) {
    store.setText(f.id, left[0].text);
    store.remove(left[0].id);
  }
}

/** What an `embed` asks to show, from its words: a mind map, a diagram, else a Gantt chart. */
const embedKind = (words: string) => (/mindmap|マインドマップ/i.test(words) ? 'mindmap' : /diagram|図/i.test(words) ? 'diagram' : 'gantt');

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
