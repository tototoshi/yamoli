import { expect, test } from 'vitest';
import { OutlineStore } from './model';
import { addColumn, setCell, tableColumns } from './TableView';

test('columns are the fields the rows use, in the order they first appear', () => {
  const s = OutlineStore.create();
  const a = s.addChild(s.rootId, -1, 'A').id;
  s.addField(a, 'status', 'open');
  s.addField(a, 'owner', 'Ann');
  const b = s.addChild(s.rootId, -1, 'B').id;
  s.addField(b, 'Status', 'done');
  s.addField(b, 'due', '2026-12-01');
  s.addChild(b, -1, 'not a field');
  expect(tableColumns(s, [a, b])).toEqual(['status', 'owner', 'due']);

  // A column added to every row comes after the others, not after the first row's fields.
  const c = s.addChild(s.rootId, -1, 'C').id;
  s.addField(c, 'body');
  addColumn(s, [c, a, b], 'notes');
  expect(tableColumns(s, [c, a, b])).toEqual(['body', 'status', 'owner', 'due', 'notes']);
});

test('editing a cell sets the row text or the field, adding a field it lacks', () => {
  const s = OutlineStore.create();
  const a = s.addChild(s.rootId, -1, 'A').id;
  s.addField(a, 'status', 'open');
  setCell(s, a, '', 'Renamed');
  setCell(s, a, 'Status', 'done');
  setCell(s, a, 'owner', 'Ann');
  expect(s.node(a).text).toBe('Renamed');
  expect(s.fieldValue(a, 'status')).toBe('done');
  expect(s.fieldValue(a, 'owner')).toBe('Ann');
  expect(s.node(a).children.length).toBe(2);
});

test('a new column gives every row the field, keeping the values there are', () => {
  const s = OutlineStore.create();
  const a = s.addChild(s.rootId, -1, 'A').id;
  const b = s.addChild(s.rootId, -1, 'B').id;
  s.addField(b, 'owner', 'Bob');
  addColumn(s, [a, b], 'owner');
  expect(s.field(a, 'owner')?.text).toBe('');
  expect(s.fieldValue(b, 'owner')).toBe('Bob');
  expect(s.node(b).children.length).toBe(1);
});
