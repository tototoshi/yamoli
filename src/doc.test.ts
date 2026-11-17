import { expect, test } from 'vitest';
import { buildDoc, setDoc, type DocPart } from './doc';
import { OutlineStore } from './model';

/** The parts in short: `h2 Text`, `p Text`, `list[A, B]`, `text[A, B]`, `data`, `embed diagram`. */
function sketch(s: OutlineStore, parts: DocPart[]): string[] {
  const label = (id: string) => s.node(id).text;
  return parts.map((p) =>
    p.kind === 'heading'
      ? `h${p.level} ${label(p.id)}`
      : p.kind === 'para'
        ? `p ${[p.id, ...(p.more?.ids ?? [])].map(label).join('')}`
        : p.kind === 'rows'
          ? `${p.style}[${p.items.map((i) => label(i.id) + (i.items.length ? `(${i.items.map((j) => label(j.id)).join(', ')})` : '')).join(', ')}]`
          : p.kind === 'data'
            ? 'data'
            : `embed ${p.as}`
  );
}

test('rows with rows under them are headings; rows without, a list of phrases or paragraphs of sentences', () => {
  const s = OutlineStore.create();
  const add = (parent: string, text: string) => s.addChild(parent, -1, text).id;
  const doc = add(s.rootId, 'Doc');
  s.addField(doc, 'description', 'What it is about');
  s.addField(doc, 'views', 'doc');
  const team = add(doc, 'チーム');
  add(team, '田中');
  add(team, '佐藤');
  const why = add(doc, '背景');
  add(why, '前のサイトは古くなった。');
  add(why, '問い合わせが増えている');
  const plan = add(why, '進め方は次のとおり：');
  add(plan, '調査');
  add(add(plan, '設計'), '画面');
  const deep = add(add(why, '詳細'), '深い見出し');
  add(add(deep, 'もっと深い'), '一番下');

  const d = buildDoc(s, doc);
  expect(d.lead).toBe('What it is about');
  expect(sketch(s, d.parts)).toEqual([
    'h2 チーム',
    'list[田中, 佐藤]',
    'h2 背景',
    'text[前のサイトは古くなった。, 問い合わせが増えている]',
    'p 進め方は次のとおり：',
    'list[調査, 設計(画面)]',
    'h3 詳細',
    'h4 深い見出し',
    'p もっと深い',
    'list[一番下]',
  ]);
});

test('doc: list or text on a row decides for the rows under it, and tasks are marked as such', () => {
  const s = OutlineStore.create();
  const add = (parent: string, text: string) => s.addChild(parent, -1, text).id;
  const doc = add(s.rootId, 'Doc');
  const a = add(doc, 'A');
  s.addField(a, 'doc', '箇条書き');
  add(add(a, '一つ目。'), '中');
  const b = add(doc, 'B');
  s.addField(b, 'doc', 'text');
  const todo = add(b, 'やること');
  s.setTask(todo, true);

  const d = buildDoc(s, doc);
  expect(sketch(s, d.parts)).toEqual(['h2 A', 'list[一つ目。(中)]', 'h2 B', 'text[やること]']);
  const rows = d.parts.filter((p) => p.kind === 'rows');
  expect(rows.map((p) => p.auto)).toEqual([false, false]);
  expect(rows[1].items[0].task).toBe(true);
});

test('blocks are drawn where they are, and an embed draws its item (or the row its own rows)', () => {
  const s = OutlineStore.create();
  const add = (parent: string, text: string) => s.addChild(parent, -1, text).id;
  const doc = add(s.rootId, 'Doc');
  const sys = add(s.rootId, 'System');
  const a = add(doc, 'A');
  s.addBlock(a, 'note', 'markdown', '**hi**');
  s.addField(a, 'embed', `[[${sys}]] 図`);
  add(a, 'x');
  const own = add(doc, 'Flow');
  s.addField(own, 'embed', 'mindmap');
  add(own, 'hidden');

  const d = buildDoc(s, doc);
  // A row holding only a drawing is a heading over it, as one holding rows.
  expect(sketch(s, d.parts)).toEqual(['h2 A', 'data', 'embed diagram', 'list[x]', 'h2 Flow', 'embed mindmap']);
  expect(d.parts.at(-1)).toEqual({ kind: 'embed', id: own, as: 'mindmap' });
});

test('doc: heading or body on a row makes it one, whatever it would be; setDoc keeps the style beside it', () => {
  const s = OutlineStore.create();
  const add = (parent: string, text: string) => s.addChild(parent, -1, text).id;
  const doc = add(s.rootId, 'Doc');
  const lone = add(doc, '単独の見出し');
  const sec = add(doc, 'まとめ');
  add(sec, '結論');
  add(doc, '最後の行');

  setDoc(s, lone, 'role', 'heading');
  setDoc(s, sec, 'style', 'text');
  setDoc(s, sec, 'role', 'body');
  expect(s.fieldValue(sec, 'doc')).toBe('body, text');
  const d = buildDoc(s, doc);
  expect(sketch(s, d.parts)).toEqual(['h2 単独の見出し', 'p まとめ結論', 'list[最後の行]']);
  // What each would be with nothing set: the switch writes only a change from that.
  expect(d.parts.filter((p) => p.kind === 'heading' || p.kind === 'para').map((p) => 'auto' in p && p.auto)).toEqual(['body', 'heading']);

  setDoc(s, sec, 'role', null);
  setDoc(s, sec, 'style', null);
  setDoc(s, lone, 'role', null);
  expect(s.field(sec, 'doc')).toBeUndefined();
  expect(sketch(s, buildDoc(s, doc).parts)).toEqual(['list[単独の見出し]', 'h2 まとめ', 'list[結論]', 'list[最後の行]']);
});

test('sentences under a paragraph are its next sentences, all one paragraph; words, a list under it', () => {
  const s = OutlineStore.create();
  const add = (parent: string, text: string) => s.addChild(parent, -1, text).id;
  const doc = add(s.rootId, 'Doc');
  const why = add(doc, '背景');
  const old = add(why, '今のポータルは古い。');
  add(add(old, 'スマホで見づらい。'), '特に表が崩れる。');
  add(old, '検索も弱い');
  add(why, '問い合わせが増えている。');
  const ask = add(why, '要望は次のとおり：');
  add(ask, '検索');
  add(ask, '通知');

  expect(sketch(s, buildDoc(s, doc).parts)).toEqual([
    'h2 背景',
    'p 今のポータルは古い。スマホで見づらい。特に表が崩れる。検索も弱い',
    'text[問い合わせが増えている。]',
    'p 要望は次のとおり：',
    'list[検索, 通知]',
  ]);
});
