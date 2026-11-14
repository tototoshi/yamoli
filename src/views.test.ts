import { expect, test } from 'vitest';
import { OutlineStore } from './model';
import { enabledViews } from './views';

test('a views field turns views on for its item and everything under it', () => {
  const s = OutlineStore.create();
  const project = s.addChild(s.rootId, -1, 'Project').id;
  s.addField(project, 'views', 'gantt, slides');
  const task = s.addChild(project, -1, 'Task').id;
  s.addField(task, 'views', '図、マインドマップ');
  const other = s.addChild(s.rootId, -1, 'Shopping').id;

  expect([...enabledViews(s, project)].sort()).toEqual(['gantt', 'slides']);
  // Views add up down the tree, in English or Japanese.
  expect([...enabledViews(s, task)].sort()).toEqual(['diagram', 'gantt', 'mindmap', 'slides']);
  expect(enabledViews(s, other).size).toBe(0);
  expect(enabledViews(s, s.rootId).size).toBe(0);
});

test('unknown words in a views field are ignored', () => {
  const s = OutlineStore.create();
  const item = s.addChild(s.rootId, -1, 'Item').id;
  s.addField(item, 'views', 'Gantt  kanban、スライド');
  expect([...enabledViews(s, item)].sort()).toEqual(['gantt', 'slides']);
});
