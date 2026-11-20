import { expect, test } from 'vitest';
import { OutlineStore } from './model';
import { Tagged, toMarkdownList, toValue, toYaml } from './serialize';

function project() {
  const s = OutlineStore.create();
  const p = s.addChild(s.rootId, -1, 'プロジェクト').id;
  s.addField(p, 'start', '2026-11-09');
  const budget = s.addField(p, 'budget').id;
  s.addField(budget, 'amount', '1200000');
  s.addField(budget, 'fixed', 'true');
  const links = s.addField(p, 'links').id;
  s.addChild(links, -1, 'https://example.com');
  s.addField(p, 'owner');
  const a = s.addChild(p, -1, '要件定義').id;
  s.setCompleted(a, true);
  s.addChild(p, -1, 'メモ: 未定');
  const note = s.addChild(p, -1, '説明').id;
  s.addBlock(note, 'body', 'markdown', '# 見出し\n本文');
  return { s, p, budget, note };
}

test('items become text or objects; fields become plain YAML values', () => {
  const { s, p, budget, note } = project();
  expect(toValue(s, p)).toEqual({
    text: 'プロジェクト',
    start: '2026-11-09',
    budget: { amount: 1200000, fixed: true },
    links: ['https://example.com'],
    owner: null,
    children: [{ text: '要件定義', done: true }, 'メモ: 未定', { text: '説明', body: new Tagged('markdown', '# 見出し\n本文') }],
  });
  expect(toValue(s, budget)).toEqual({ budget: { amount: 1200000, fixed: true } });
  expect(toValue(s, s.rootId)).toEqual([toValue(s, p)]);
  expect(JSON.parse(JSON.stringify(toValue(s, note)))).toEqual({ text: '説明', body: '# 見出し\n本文' });
});

test('a field named like an item key keeps its name', () => {
  const s = OutlineStore.create();
  const a = s.addChild(s.rootId, -1, 'a').id;
  s.addField(a, 'text', 'field');
  expect(toValue(s, a)).toEqual({ _text: 'a', text: 'field' });
});

test('YAML output, quoting only where plain scalars would misread', () => {
  const { s, p } = project();
  expect(toYaml(toValue(s, p))).toBe(
    [
      'text: プロジェクト',
      'start: 2026-11-09',
      'budget:',
      '  amount: 1200000',
      '  fixed: true',
      'links:',
      '  - https://example.com',
      'owner:',
      'children:',
      '  - text: 要件定義',
      '    done: true',
      '  - "メモ: 未定"',
      '  - text: 説明',
      '    body: !markdown |-',
      '      # 見出し',
      '      本文',
      '',
    ].join('\n')
  );
  expect(toYaml(['1', 'yes', '', '- x', 'ok #1', [], {}])).toBe('- "1"\n- "yes"\n- ""\n- "- x"\n- "ok #1"\n- []\n- {}\n');
});

test('linked items carry their id so references resolve', () => {
  const s = OutlineStore.create();
  const p = s.addChild(s.rootId, -1, 'p').id;
  const a = s.addChild(p, -1, 'a').id;
  const b = s.addChild(p, -1, 'b').id;
  s.addField(b, 'after', `[[${a}]]`);
  s.addChild(p, -1, 'c');
  expect(toValue(s, p)).toEqual({
    text: 'p',
    children: [{ id: a, text: 'a' }, { text: 'b', after: `[[${a}]]` }, 'c'],
  });
  expect(toYaml(toValue(s, a))).toBe(`id: ${a}\ntext: a\n`);
});

test('toMarkdownList: a nested list with link labels, fields and tasks as checklist items', () => {
  const s = OutlineStore.create();
  const p = s.addChild(s.rootId, -1, 'plan').id;
  const a = s.addChild(p, -1, '**design**').id;
  s.setCompleted(a, true);
  const b = s.addChild(p, -1, 'build\nsecond line').id;
  s.addField(b, 'after', `[[${a}]]`);
  s.addBlock(b, 'note', 'markdown', 'some **words**');
  s.addChild(b, -1, 'step');
  s.setTask(s.addChild(p, -1, 'ship').id, true);
  const all = (id: string) => s.node(id).children;
  expect(toMarkdownList(s, p, all)).toBe(
    '- [x] **design**\n- build\n  second line\n  - after: design\n\n  some **words**\n\n  - step\n- [ ] ship\n'
  );
  expect(toMarkdownList(s, s.rootId, all)).toMatch(/^- plan\n  - \[x\]/);
  expect(toMarkdownList(s, a, all)).toBe('');
});

test('toMarkdownList: a # row is a heading, its rows the list after it; one inside a list ends it', () => {
  const s = OutlineStore.create();
  const add = (parent: string, text: string) => s.addChild(parent, -1, text).id;
  const p = add(s.rootId, 'Doc');
  add(p, 'intro');
  const why = add(p, '# 背景');
  add(add(why, '古い'), 'スマホで見づらい');
  const plan = add(why, '企画');
  add(plan, 'キックオフ');
  add(add(plan, '## 要件定義'), 'ヒアリング');
  const all = (id: string) => s.node(id).children;
  expect(toMarkdownList(s, p, all)).toBe(
    '- intro\n\n# 背景\n\n- 古い\n  - スマホで見づらい\n- 企画\n  - キックオフ\n\n## 要件定義\n\n- ヒアリング\n'
  );
});

test('toMarkdownList: a row marked as a paragraph is one, the rows under it a list after it', () => {
  const s = OutlineStore.create();
  const add = (parent: string, text: string) => s.addChild(parent, -1, text).id;
  const p = add(s.rootId, 'Doc');
  add(p, '検索');
  const a = add(p, '前のサイトは古い。');
  const b = add(p, '問い合わせが増えている。');
  add(b, '電話');
  s.node(a).paragraph = s.node(b).paragraph = true;
  const rows = (id: string) => s.items(id);
  expect(toMarkdownList(s, p, rows)).toBe('- 検索\n\n前のサイトは古い。\n\n問い合わせが増えている。\n\n- 電話\n');
});

test('toMarkdownList: a code block is fenced with its language where it is, in a list item indented under it', () => {
  const s = OutlineStore.create();
  const add = (parent: string, text: string) => s.addChild(parent, -1, text).id;
  const code = (parent: string, format: string, text: string) => {
    const id = add(parent, text);
    s.setKey(id, s.freeKey(parent, 'code'));
    s.setFormat(id, format);
  };
  const p = add(s.rootId, 'Doc');
  add(p, 'run');
  code(p, 'code:sh', 'npm test');
  const a = add(p, 'then');
  code(a, 'code', 'a ``` in it\nline 2');
  s.addBlock(a, 'pic', 'image', 'files/x.png');
  const all = (id: string) => s.node(id).children;
  expect(toMarkdownList(s, p, all)).toBe('- run\n```sh\nnpm test\n```\n- then\n  ````\n  a ``` in it\n  line 2\n  ````\n');
});

test('a paragraph row says so in its data, as a task does', () => {
  const s = OutlineStore.create();
  const p = s.addChild(s.rootId, -1, '前のサイトは古い。');
  p.paragraph = true;
  expect(toValue(s, p.id)).toEqual({ text: '前のサイトは古い。', paragraph: true });
  expect(toYaml(toValue(s, p.id))).toBe('text: 前のサイトは古い。\nparagraph: true\n');
});

test("the Text view's Markdown comes back as the rows it was written from, code blocks and all", async () => {
  const { parseOutlineText } = await import('./fields');
  const s = OutlineStore.create();
  const add = (parent: string, text: string) => s.addChild(parent, -1, text).id;
  const p = add(s.rootId, 'Doc');
  const a = add(p, 'setup');
  const code = add(a, 'npm i\nnpm test');
  s.setKey(code, 'code');
  s.setFormat(code, 'code:sh');
  add(a, 'done');
  const all = (id: string) => s.node(id).children;
  const back = parseOutlineText(toMarkdownList(s, p, all));
  expect(back).toMatchObject([
    { text: 'setup', children: [{ key: 'code', format: 'code:sh', text: 'npm i\nnpm test' }, { text: 'done' }] },
  ]);
});
