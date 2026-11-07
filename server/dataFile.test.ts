// @vitest-environment node
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { readData, writeData } from './dataFile';

const outline = (text: string) => JSON.stringify({ rootId: 'r', nodes: { r: { id: 'r', text, children: [] } } });

test('create, update with the current ETag, and reject stale writes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'outliner-'));
  const path = join(dir, 'sub', 'data.json');
  expect(await readData(path)).toBeNull();

  const created = await writeData(path, outline('a'), '*');
  expect(created.status).toBe(200);
  const etag = (created as { etag: string }).etag;
  expect((await readData(path))?.etag).toBe(etag);
  expect(JSON.parse(await readFile(path, 'utf8')).nodes.r.text).toBe('a');

  // A second "create" or a write based on an old version is refused.
  expect(await writeData(path, outline('x'), '*')).toEqual({ status: 409, etag });
  const updated = await writeData(path, outline('b'), etag);
  expect(updated.status).toBe(200);
  expect((await writeData(path, outline('c'), etag)).status).toBe(409);

  // The version before today's first overwrite is kept.
  const backups = await readdir(join(dir, 'sub', 'backups'));
  expect(backups).toHaveLength(1);
  expect(JSON.parse(await readFile(join(dir, 'sub', 'backups', backups[0]), 'utf8')).nodes.r.text).toBe('a');
});

test('rejects bodies that are not outlines', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'outliner-')), 'data.json');
  expect((await writeData(path, 'nope', '*')).status).toBe(400);
  expect((await writeData(path, '{"rootId":"r","nodes":{}}', '*')).status).toBe(400);
  expect(await readData(path)).toBeNull();
});
