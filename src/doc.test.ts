import { expect, test } from 'vitest';
import { buildDoc, docContents, headingOf, setDocStyle, withHeading, type DocPart } from './doc';
import { OutlineStore } from './model';

/** The parts in short: `h1 Text`, `list[A, B(C)]`, `text[A, B]`, `data`, `embed diagram`. */
function sketch(s: OutlineStore, parts: DocPart[]): string[] {
  const label = (id: string) => s.node(id).text;
  return parts.map((p) =>
    p.kind === 'heading'
      ? `h${p.level} ${label(p.id)}`
      : p.kind === 'list'
        ? `${p.style}[${p.items.map((i) => label(i.id) + (i.items.length ? `(${i.items.map((j) => label(j.id)).join(', ')})` : '')).join(', ')}]`
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
  expect(d.parts.flatMap((p) => (p.kind === 'list' ? p.items.filter((i) => i.task).map((i) => i.id) : []))).toEqual([todo]);
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
    'list[まとめ]', // after the heading's rows, as nothing is there to end its section
    'list[設計]', // rows under another row: a list of their own, its style switched on its own
  ]);
});

test('blocks are drawn where they are, and an embed draws its item (or the row its own rows)', () => {
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
  expect(sketch(s, d.parts)).toEqual(['h1 # A', 'data', 'embed diagram', 'list[x]', 'list[Flow]']);
  const flow = d.parts.at(-1)!;
  expect(flow.kind === 'list' && flow.items[0].extras).toEqual([{ kind: 'embed', id: own, as: 'mindmap' }]);
});

test('headingOf reads the #s, withHeading sets them', () => {
  expect(headingOf('## 進め方')).toEqual({ level: 2, prefix: 3 });
  expect(headingOf('#tag')).toBeNull(); // a tag, not a heading
  expect(headingOf('#### four')).toBeNull();
  expect(withHeading('## 進め方', 1)).toBe('# 進め方');
  expect(withHeading('進め方', 3)).toBe('### 進め方');
  expect(withHeading('# 進め方', 0)).toBe('進め方');
});

test('doc: text makes paragraphs of the rows under a row, and of those in the sections under it; doc: list a list again', () => {
  const s = OutlineStore.create();
  const add = (parent: string, text: string) => s.addChild(parent, -1, text).id;
  const doc = add(s.rootId, 'Doc');
  setDocStyle(s, doc, 'text');
  add(doc, '前書き');
  const why = add(doc, '# 背景');
  const old = add(why, '今のポータルは古い');
  add(old, 'スマホで見づらい');
  const ask = add(doc, '# 要望');
  s.addField(ask, 'doc', '箇条書き');
  add(ask, '検索');
  const parts = buildDoc(s, doc).parts;
  expect(sketch(s, parts)).toEqual(['text[前書き]', 'h1 # 背景', 'text[今のポータルは古い(スマホで見づらい)]', 'h1 # 要望', 'list[検索]']);
  const rows = parts.filter((p) => p.kind === 'list');
  expect(rows.map((p) => [p.under, p.inherited])).toEqual([
    [doc, 'list'],
    [why, 'text'],
    [ask, 'text'],
  ]);
  setDocStyle(s, doc, null);
  expect(s.field(doc, 'doc')).toBeUndefined();
});
