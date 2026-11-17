import { expect, test } from 'vitest';
import { buildDoc, docRoleAt, setDoc, type DocPart } from './doc';
import { OutlineStore } from './model';

/** The parts in short: `h2 Text`, `list[A, B(C)]`, `text[A, B]`, `data`, `embed diagram`. */
function sketch(s: OutlineStore, parts: DocPart[]): string[] {
  const label = (id: string) => s.node(id).text;
  return parts.map((p) =>
    p.kind === 'heading'
      ? `h${p.level} ${label(p.id)}`
      : p.kind === 'rows'
        ? `${p.style}[${p.items.map((i) => label(i.id) + (i.items.length ? `(${i.items.map((j) => label(j.id)).join(', ')})` : '')).join(', ')}]`
        : p.kind === 'data'
          ? 'data'
          : `embed ${p.as}`
  );
}

test('rows holding rows, with only such rows after them, are headings two levels deep; the others a list', () => {
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
  const plan = add(why, '進め方');
  add(plan, '調査');
  add(add(plan, '設計'), '画面');
  const deep = add(add(why, '詳細'), '深い行');
  add(add(deep, 'もっと深い'), '一番下');

  const d = buildDoc(s, doc);
  expect(d.lead).toBe('What it is about');
  expect(sketch(s, d.parts)).toEqual([
    'h2 チーム',
    'list[田中, 佐藤]',
    'h2 背景',
    'list[前のサイトは古くなった。, 問い合わせが増えている]', // the section's opening
    'h3 進め方',
    'list[調査, 設計(画面)]', // 設計 holds a row, but among others: a nested list
    'h3 詳細',
    'list[深い行(もっと深い)]', // three levels down: no heading
  ]);
});

test('a row holding rows with rows holding nothing after it is a line of the body: lists nest, headings do not break them', () => {
  const s = OutlineStore.create();
  const add = (parent: string, text: string) => s.addChild(parent, -1, text).id;
  const doc = add(s.rootId, 'Doc');
  add(doc, '検索を中心にする');
  add(add(doc, 'よく使うリンクを上に'), '部署ごとに選べる');
  const last = add(doc, '通知をまとめる');
  expect(sketch(s, buildDoc(s, doc).parts)).toEqual(['list[検索を中心にする, よく使うリンクを上に(部署ごとに選べる), 通知をまとめる]']);
  // The wording does not matter: a sentence or a colon changes nothing.
  s.node(last).text = '通知をまとめる。';
  s.node(s.node(doc).children[1]).text = 'リンクは次のとおり：';
  expect(sketch(s, buildDoc(s, doc).parts)).toEqual(['list[検索を中心にする, リンクは次のとおり：(部署ごとに選べる), 通知をまとめる。]']);
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
  const end = add(doc, '最後の行');

  setDoc(s, lone, 'role', 'heading');
  setDoc(s, sec, 'style', 'text');
  setDoc(s, sec, 'role', 'body');
  expect(s.fieldValue(sec, 'doc')).toBe('body, text');
  expect(sketch(s, buildDoc(s, doc).parts)).toEqual(['h2 単独の見出し', 'list[まとめ(結論), 最後の行]']);
  // What each would be with nothing set: the switch writes only a change from that.
  expect(docRoleAt(s, doc, lone)).toEqual({ now: 'heading', auto: 'body' });
  expect(docRoleAt(s, doc, sec)).toEqual({ now: 'body', auto: 'body' });

  setDoc(s, sec, 'role', null);
  setDoc(s, sec, 'style', null);
  setDoc(s, lone, 'role', null);
  expect(s.field(sec, 'doc')).toBeUndefined();
  expect(sketch(s, buildDoc(s, doc).parts)).toEqual(['list[単独の見出し, まとめ(結論), 最後の行]']);
  // With nothing after it, it is a heading of itself, the rows before it the opening.
  s.remove(end);
  expect(sketch(s, buildDoc(s, doc).parts)).toEqual(['list[単独の見出し]', 'h2 まとめ', 'list[結論]']);
  setDoc(s, sec, 'role', 'body');
  expect(docRoleAt(s, doc, sec)).toEqual({ now: 'body', auto: 'heading' });
  expect(sketch(s, buildDoc(s, doc).parts)).toEqual(['list[単独の見出し, まとめ(結論)]']);
});

test('doc: text makes paragraphs of the rows under the row, and of those in the sections under it; rows under a paragraph are a list', () => {
  const s = OutlineStore.create();
  const add = (parent: string, text: string) => s.addChild(parent, -1, text).id;
  const doc = add(s.rootId, 'Doc');
  s.addField(doc, 'doc', '段落');
  add(doc, '前書き');
  const why = add(doc, '背景');
  const old = add(why, '今のポータルは古い');
  add(old, 'スマホで見づらい');
  add(old, '検索も弱い');
  add(why, '問い合わせが増えている');
  const ask = add(doc, '要望');
  s.addField(ask, 'doc', 'list');
  add(ask, '検索');
  add(ask, '通知');

  const parts = buildDoc(s, doc).parts;
  expect(sketch(s, parts)).toEqual([
    'text[前書き]',
    'h2 背景',
    'text[今のポータルは古い(スマホで見づらい, 検索も弱い), 問い合わせが増えている]',
    'h2 要望',
    'list[検索, 通知]',
  ]);
  const rows = parts.filter((p) => p.kind === 'rows');
  expect(rows.map((p) => p.auto)).toEqual([false, true, false]);
  expect(rows[1].items[0].text).toBe(false); // listed under it
});
