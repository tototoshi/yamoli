// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { guideHeadings, guideOutline, guideText } from './DocsView';
import type { OutlineStore } from './model';

const both = (['ja', 'en'] as const).map((l) => ({ l, ...guideOutline(guideText(l)) }));

/** Every row under id, fields and blocks too. */
const all = (store: OutlineStore, id: string): string[] => store.node(id).children.flatMap((c) => [c, ...all(store, c)]);

test('the Japanese and English guides have the same sections', () => {
  const [ja, en] = both.map(({ store, rootId }) => guideHeadings(store, rootId));
  expect(ja.map((h) => h.level)).toEqual(en.map((h) => h.level));
  expect(en.map((h) => h.text)).toContain('Scheduling');
  expect(ja.length).toBeGreaterThan(20);
});

test('the guides have no fields but those meant (a line read as one by mistake would vanish from the page)', () => {
  for (const { store, rootId } of both) {
    const keys = new Set(all(store, rootId).flatMap((id) => store.node(id).key ?? []));
    expect([...keys].filter((k) => !['views', 'description', '例', '表', 'example', 'table'].includes(k))).toEqual([]);
    // Tables and examples are Markdown blocks.
    for (const id of all(store, rootId)) {
      const n = store.node(id);
      if (['例', '表', 'example', 'table'].includes(n.key ?? '')) expect(n.format).toBe('markdown');
      // No Markdown left in a row of its own: a table line or a fence outside a block.
      if (n.format === null) expect(n.text).not.toMatch(/^(\||```)/);
    }
  }
});
