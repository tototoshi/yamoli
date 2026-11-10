import { expect, test } from 'vitest';
import { FIELD_TYPED, parseOutlineText, type TextRow } from './fields';

const show = (rows: TextRow[]): unknown[] =>
  rows.map((r) => [r.key === null ? r.text : `${r.key}: ${r.text}`, ...(r.children.length ? [show(r.children)] : [])]);

test('typing `name: ` is recognised, prose and URLs are not', () => {
  expect('duration: '.match(FIELD_TYPED)?.[1]).toBe('duration');
  expect('担当: 田中'.match(FIELD_TYPED)?.[1]).toBe('担当');
  expect('Note to self: x'.match(FIELD_TYPED)).toBeNull();
  expect('https://example.com'.match(FIELD_TYPED)).toBeNull();
});

test('YAML-ish text becomes a tree of rows and fields', () => {
  const yaml = [
    'duration: 3d',
    'after: "[[abc]]"',
    'budget:',
    '  amount: 1200000',
    '  currency: JPY',
    'links:',
    '  - https://example.com/spec',
    '  - https://example.com/figma',
    'members:',
    '  - name: 田中',
    '    role: PM',
    '  - name: 鈴木',
    '# a comment',
  ].join('\n');
  expect(show(parseOutlineText(yaml))).toEqual([
    ['duration: 3d'],
    ['after: [[abc]]'],
    ['budget: ', [['amount: 1200000'], ['currency: JPY']]],
    ['links: ', [['https://example.com/spec'], ['https://example.com/figma']]],
    ['members: ', [['', [['name: 田中'], ['role: PM']]], ['', [['name: 鈴木']]]]],
  ]);
});

test('a plain nested list keeps its shape', () => {
  expect(show(parseOutlineText('- a\n  - b\n- c'))).toEqual([['a', [['b']]], ['c']]);
});

test('block scalars become block fields, tagged with their format', () => {
  const rows = parseOutlineText(
    [
      'note: !markdown |',
      '  # 見出し',
      '',
      '  本文: コロンも中身',
      '    インデントは保つ',
      'plain: |-',
      '  a',
      '  b',
      'items:',
      '  - name: x',
      '    body: !code |',
      '      let a = 1',
      '    after: y',
      'short: !csv a,b',
      'next: 1',
    ].join('\n')
  );
  const strip = (r: TextRow): unknown => ({ key: r.key, text: r.text, format: r.format, children: r.children.map(strip) });
  expect(rows.map(strip)).toEqual([
    { key: 'note', text: '# 見出し\n\n本文: コロンも中身\n  インデントは保つ', format: 'markdown', children: [] },
    { key: 'plain', text: 'a\nb', format: 'text', children: [] },
    {
      key: 'items',
      text: '',
      format: undefined,
      children: [
        {
          key: null,
          text: '',
          format: undefined,
          children: [
            { key: 'name', text: 'x', format: undefined, children: [] },
            { key: 'body', text: 'let a = 1', format: 'code', children: [] },
            { key: 'after', text: 'y', format: undefined, children: [] },
          ],
        },
      ],
    },
    { key: 'short', text: 'a,b', format: 'csv', children: [] },
    { key: 'next', text: '1', format: undefined, children: [] },
  ]);
});

test('a pasted checklist keeps which lines are to do and which are done', () => {
  const rows = parseOutlineText('- [ ] milk\n- [x] eggs\n  - [ ] free range\n- bread');
  expect(rows.map((r) => [r.text, r.task])).toEqual([
    ['milk', 'open'],
    ['eggs', 'done'],
    ['bread', undefined],
  ]);
  expect(rows[1].children[0]).toMatchObject({ text: 'free range', task: 'open' });
});

test('a Markdown list reads `- name: value` as a field and indented lines as more text', () => {
  expect(show(parseOutlineText('- API\n  - tech: Go\n  - one\n    two\n    - three'))).toEqual([
    ['API', [['tech: Go'], ['one\ntwo', [['three']]]]],
  ]);
  // YAML, with an object's other keys under its first, is still read as YAML.
  expect(show(parseOutlineText('- name: x\n  role: PM'))).toEqual([['', [['name: x'], ['role: PM']]]]);
});
