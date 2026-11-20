import { expect, test } from 'vitest';
import { buildDoc, docContents, headingOf, withHeading, type DocPart } from './doc';
import { OutlineStore } from './model';

/** The parts in short: `h1 Text`, `list[A, B(C)]` (a paragraph `¶A`), `data`, `embed diagram`. */
function sketch(s: OutlineStore, parts: DocPart[]): string[] {
  const label = (id: string) => (s.node(id).paragraph ? '¶' : '') + s.node(id).text;
  return parts.map((p) =>
    p.kind === 'heading'
      ? `h${p.level} ${label(p.id)}`
      : p.kind === 'rows'
        ? `list[${p.items.map((i) => (i.kind !== 'item' ? i.kind : label(i.id) + (i.items.length ? `(${i.items.map((j) => (j.kind === 'item' ? label(j.id) : j.kind)).join(', ')})` : ''))).join(', ')}]`
        : p.kind === 'data'
          ? 'data'
          : `embed ${p.as}`
  );
}

test('rows are a bulleted list nested as they are, however they are laid out', () => {
  const s = OutlineStore.create();
  const add = (parent: string, text: string) => s.addChild(parent, -1, text).id;
  const doc = add(s.rootId, 'Doc');
  s.addField(doc, 'description', 'What it is about');
  const team = add(doc, 'チーム');
  add(team, '田中');
  add(add(doc, '背景'), '前のサイトは古くなった。');
  const d = buildDoc(s, doc);
  expect(d.lead).toBe('What it is about');
  expect(sketch(s, d.parts)).toEqual(['list[チーム(田中), 背景(前のサイトは古くなった。)]']);
});

test('a # row is a heading, the rows under it its section after it; tasks are marked as such', () => {
  const s = OutlineStore.create();
  const add = (parent: string, text: string) => s.addChild(parent, -1, text).id;
  const doc = add(s.rootId, 'Doc');
  add(doc, '前書き');
  const why = add(doc, '# 背景');
  add(add(why, '古い'), 'スマホで見づらい');
  const how = add(why, '## 進め方');
  const todo = add(how, '調査');
  s.setTask(todo, true);
  add(doc, '後書き');
  const d = buildDoc(s, doc);
  expect(sketch(s, d.parts)).toEqual([
    'list[前書き]',
    'h1 # 背景',
    'list[古い(スマホで見づらい)]',
    'h2 ## 進め方',
    'list[調査]',
    'list[後書き]',
  ]);
  expect(d.parts.flatMap((p) => (p.kind === 'rows' ? p.items.filter((i) => i.kind === 'item' && i.task).map((i) => i.id) : []))).toEqual([
    todo,
  ]);
  expect(docContents(s, d.parts).map((c) => [c.level, c.text])).toEqual([
    [1, '背景'],
    [2, '進め方'],
  ]);
});

test('a # row inside a list ends it, as in Markdown: it and the rows after it in its place come after', () => {
  const s = OutlineStore.create();
  const add = (parent: string, text: string) => s.addChild(parent, -1, text).id;
  const doc = add(s.rootId, 'Doc');
  const plan = add(doc, '企画');
  add(plan, 'キックオフ');
  add(add(plan, '## 要件定義'), 'ヒアリング');
  add(plan, 'まとめ');
  add(doc, '設計');
  expect(sketch(s, buildDoc(s, doc).parts)).toEqual([
    'list[企画(キックオフ)]',
    'h2 ## 要件定義',
    'list[ヒアリング]',
    'list[まとめ, 設計]', // after the heading's rows, as nothing is there to end its section
  ]);
});

test('blocks are drawn where they are among the rows, and an embed draws its item (or the row its own rows)', () => {
  const s = OutlineStore.create();
  const add = (parent: string, text: string) => s.addChild(parent, -1, text).id;
  const doc = add(s.rootId, 'Doc');
  const sys = add(s.rootId, 'System');
  const a = add(doc, '# A');
  s.addBlock(a, 'note', 'markdown', '**hi**');
  s.addField(a, 'embed', `[[${sys}]] 図`);
  add(a, 'x');
  const own = add(doc, 'Flow');
  s.addField(own, 'embed', 'mindmap');
  add(own, 'hidden');
  const d = buildDoc(s, doc);
  // (Flow is not in A's section, but no more than in Markdown is anything there to end it.)
  // A's block where it is, before its row x (its embed drawn after the heading).
  expect(sketch(s, d.parts)).toEqual(['h1 # A', 'embed diagram', 'list[data, x]', 'list[Flow]']);
  const flow = d.parts.at(-1)!;
  expect(flow.kind === 'rows' && flow.items[0].kind === 'item' && flow.items[0].extras).toEqual([
    { kind: 'embed', id: own, as: 'mindmap' },
  ]);
});

test('headingOf reads the #s, withHeading sets them', () => {
  expect(headingOf('## 進め方')).toEqual({ level: 2, prefix: 3 });
  expect(headingOf('#tag')).toBeNull(); // a tag, not a heading
  expect(headingOf('#### four')).toBeNull();
  expect(withHeading('## 進め方', 1)).toBe('# 進め方');
  expect(withHeading('進め方', 3)).toBe('### 進め方');
  expect(withHeading('# 進め方', 0)).toBe('進め方');
});

test('a row marked as a paragraph is one among the list items, the rows under it after it', () => {
  const s = OutlineStore.create();
  const add = (parent: string, text: string) => s.addChild(parent, -1, text).id;
  const doc = add(s.rootId, 'Doc');
  add(doc, '検索');
  const p = add(doc, 'ここからは文章。');
  s.node(p).paragraph = true;
  add(p, '電話');
  add(doc, '通知');
  const parts = buildDoc(s, doc).parts;
  expect(sketch(s, parts)).toEqual(['list[検索, ¶ここからは文章。(電話), 通知]']);
  expect(parts[0].kind === 'rows' && parts[0].items.map((i) => i.kind === 'item' && i.para)).toEqual([false, true, false]);
});

test('a block among rows is drawn between them, in a list item too', () => {
  const s = OutlineStore.create();
  const add = (parent: string, text: string) => s.addChild(parent, -1, text).id;
  /** A row made a code block where it is (as ``` typed on it does). */
  const code = (parent: string, text: string) => {
    const id = add(parent, text);
    s.setKey(id, 'code');
    s.setFormat(id, 'code');
  };
  const doc = add(s.rootId, 'Doc');
  add(doc, 'before');
  code(doc, 'npm test');
  const a = add(doc, 'after');
  add(a, 'one');
  code(a, 'ls');
  add(a, 'two');
  expect(sketch(s, buildDoc(s, doc).parts)).toEqual(['list[before, data, after(one, data, two)]']);
});
