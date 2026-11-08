import { expect, test } from 'vitest';
import { OutlineStore } from './model';
import { Tagged, toValue, toYaml } from './serialize';

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
    children: [
      { text: '要件定義', done: true },
      'メモ: 未定',
      { text: '説明', body: new Tagged('markdown', '# 見出し\n本文') },
    ],
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
