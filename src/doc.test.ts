import { expect, test } from 'vitest';
import { buildDoc, docContents, headingOf, lineAt, occurrences, replaceIn, withHeading, type DocPart } from './doc';
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

test('numbered rows are a numbered list, quotations one after another one quotation, `---` a dividing line', () => {
  const s = OutlineStore.create();
  const add = (parent: string, text: string) => s.addChild(parent, -1, text).id;
  const p = add(s.rootId, 'Doc');
  const a = add(p, 'one');
  const b = add(p, 'two');
  const q = add(p, 'said');
  add(p, '---');
  const r = add(p, '---');
  add(r, 'under'); // with rows under it, a row like any other
  s.node(a).numbered = s.node(b).numbered = true;
  s.node(q).quote = true;
  const [rows] = buildDoc(s, p).parts;
  expect(rows.kind === 'rows' && rows.items.map((i) => i.kind === 'item' && [i.numbered, i.quote, i.rule])).toEqual([
    [true, false, false],
    [true, false, false],
    [false, true, false],
    [false, false, true],
    [false, false, false],
  ]);
});

test('a click away from the text goes into the line at that height, or the nearest, or the last below them all', () => {
  const lines = [
    { id: 'a', top: 0, bottom: 20, left: 40 },
    { id: 'b', top: 30, bottom: 70, left: 60 }, // two lines of text
    { id: 'c', top: 80, bottom: 100, left: 40 },
  ];
  expect(lineAt(lines, 500, 10)).toEqual({ id: 'a', start: false }); // right of it: its end
  expect(lineAt(lines, 50, 50)).toEqual({ id: 'b', start: true }); // left of it: its start
  expect(lineAt(lines, 500, 22)).toEqual({ id: 'a', start: false }); // between, nearer the one above
  expect(lineAt(lines, 500, 76)).toEqual({ id: 'c', start: false }); // between, nearer the one below
  expect(lineAt(lines, 10, 400)).toEqual({ id: 'c', start: false }); // below them all: the end of the last
  expect(lineAt(lines, 500, -30)).toEqual({ id: 'a', start: false });
  expect(lineAt([], 0, 0)).toBeNull();
});

test('occurrences and replaceIn: by case, without overlapping, one or all', () => {
  expect(occurrences('Plan the plan, PLAN!', 'plan')).toEqual([0, 9, 15]);
  expect(occurrences('aaaa', 'aa')).toEqual([0, 2]);
  expect(occurrences('abc', '')).toEqual([]);
  expect(replaceIn('Plan the plan, PLAN!', 'plan', 'map', 1)).toBe('Plan the map, PLAN!');
  expect(replaceIn('Plan the plan, PLAN!', 'plan', 'map', null)).toBe('map the map, map!');
  expect(replaceIn('abc', 'x', 'y', 0)).toBe('abc');
  expect(replaceIn('要件の要件', '要件', '仕様', null)).toBe('仕様の仕様');
});
