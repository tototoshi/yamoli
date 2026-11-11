// @vitest-environment jsdom
import { expect, test } from 'vitest';
import guideEn from '../docs/guide.en.md?raw';
import guideJa from '../docs/guide.ja.md?raw';
import { headings } from './DocsView';

const guide = (l: string) => (l === 'en' ? guideEn : guideJa);

test('the Japanese and English guides have the same sections', () => {
  const ja = headings(guide('ja'));
  const en = headings(guide('en'));
  expect(ja.map((h) => h.level)).toEqual(en.map((h) => h.level));
  expect(en.map((h) => h.text)).toContain('Scheduling');
});

test('headings in code blocks are not sections', () => {
  expect(headings('## A\n```\n## not this\n```\n### B')).toEqual([
    { level: 2, text: 'A' },
    { level: 3, text: 'B' },
  ]);
});
