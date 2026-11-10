import { expect, test } from 'vitest';
import { jsonTokens, yamlTokens, type Token } from './highlight';

const kinds = (tokens: Token[]) => tokens.filter((t) => t.kind).map((t) => `${t.kind}:${t.text}`);

test('YAML: keys, scalars by kind, tags and block lines; the text is kept whole', () => {
  const yaml = [
    'name: API',
    'replicas: 3',
    'done: true',
    'after: "[[abc]]"',
    'links:',
    '  - https://example.com/a',
    '  - name: 田中',
    '    role: PM',
    'note: !markdown |-',
    '  # Heading',
    '',
    '  key: not a key',
    'tags: []',
  ].join('\n');
  const tokens = yamlTokens(yaml);
  expect(tokens.map((t) => t.text).join('')).toBe(yaml);
  expect(kinds(tokens)).toEqual([
    'key:name', 'punct::', 'str:API',
    'key:replicas', 'punct::', 'num:3',
    'key:done', 'punct::', 'lit:true',
    'key:after', 'punct::', 'str:"[[abc]]"',
    'key:links', 'punct::',
    'punct:-', 'str:https://example.com/a',
    'punct:-', 'key:name', 'punct::', 'str:田中',
    'key:role', 'punct::', 'str:PM',
    'key:note', 'punct::', 'tag:!markdown', 'punct:|-',
    'str:  # Heading', 'str:', 'str:  key: not a key',
    'key:tags', 'punct::', 'punct:[]',
  ].filter((k) => k !== 'str:'));
});

test('JSON: keys apart from string values', () => {
  const json = JSON.stringify({ a: 'x', n: -1.5, ok: false, z: null, list: ['y'] }, null, 2);
  const tokens = jsonTokens(json);
  expect(tokens.map((t) => t.text).join('')).toBe(json);
  expect(kinds(tokens)).toEqual(['key:"a"', 'str:"x"', 'key:"n"', 'num:-1.5', 'key:"ok"', 'lit:false', 'key:"z"', 'lit:null', 'key:"list"', 'str:"y"']);
});
