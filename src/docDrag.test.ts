import { expect, test } from 'vitest';
import { docDrop, type Line } from './docDrag';
import { OutlineStore } from './model';

/*
 * Doc
 *   intro            (a paragraph)
 *   # Plan
 *     step 1
 *       detail
 *     step 2
 *   end
 */
function setup() {
  const s = OutlineStore.create();
  const add = (parent: string, text: string) => s.addChild(parent, -1, text).id;
  const doc = add(s.rootId, 'Doc');
  const intro = add(doc, 'intro');
  const plan = add(doc, '# Plan');
  const step1 = add(plan, 'step 1');
  const detail = add(step1, 'detail');
  const step2 = add(plan, 'step 2');
  const end = add(doc, 'end');
  // Lines 20 high, 10 apart; list items indented 20 per level.
  const at = (id: string, row: number, left: number): Line => ({ id, top: row * 30, bottom: row * 30 + 20, left });
  const lines = [at(intro, 0, 0), at(plan, 1, 0), at(step1, 2, 20), at(detail, 3, 40), at(step2, 4, 20), at(end, 5, 20)];
  return { s, doc, intro, plan, step1, detail, step2, end, lines };
}

test('upper half of a line: before its row', () => {
  const { s, doc, intro, plan, step1, step2, lines } = setup();
  expect(docDrop(s, doc, lines, step2, 100, 32)).toMatchObject({ parentId: doc, beforeId: plan, top: 30 });
  expect(docDrop(s, doc, lines, intro, 100, 62)).toMatchObject({ parentId: plan, beforeId: step1, left: 20 });
});

test('lower half: first under it when rows are shown under it, else after it', () => {
  const { s, doc, intro, plan, step1, detail, step2, end, lines } = setup();
  expect(docDrop(s, doc, lines, end, 100, 45)).toMatchObject({ parentId: plan, beforeId: step1, left: 20, top: 50 });
  expect(docDrop(s, doc, lines, end, 100, 75)).toMatchObject({ parentId: step1, beforeId: detail, left: 40 });
  expect(docDrop(s, doc, lines, intro, 100, 135)).toMatchObject({ parentId: plan, beforeId: null, left: 20 });
  expect(docDrop(s, doc, lines, step2, 100, 15)).toMatchObject({ parentId: doc, beforeId: plan });
  expect(docDrop(s, doc, lines, intro, 100, 400)).toMatchObject({ parentId: doc, beforeId: null }); // below them all
  void end;
});

test('the pointer left of a last row climbs out of it', () => {
  const { s, doc, intro, plan, step1, detail, step2, lines } = setup();
  // After detail (the last under step 1): pointer at detail's text stays, left of it goes after step 1.
  expect(docDrop(s, doc, lines, intro, 45, 105)).toMatchObject({ parentId: step1, beforeId: null, left: 40 });
  expect(docDrop(s, doc, lines, intro, 20, 105)).toMatchObject({ parentId: plan, beforeId: step2, left: 20 });
  // After step 2, the last under # Plan: further left goes after the heading's section.
  expect(docDrop(s, doc, lines, intro, -10, 135)).toMatchObject({ parentId: doc, left: 0 });
  void detail;
});

test('not onto itself or the rows under it', () => {
  const { s, doc, step1, lines } = setup();
  expect(docDrop(s, doc, lines, step1, 100, 65)).toBeNull();
  expect(docDrop(s, doc, lines, step1, 100, 95)).toBeNull();
});
