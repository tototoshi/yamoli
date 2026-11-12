// @vitest-environment node
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { migrateDataFile, readData, writeData } from './dataFile';

const outline = (text: string) => JSON.stringify({ rootId: 'r', nodes: { r: { id: 'r', text, children: [] } } });

test('create, update with the current ETag, and reject stale writes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'yamoli-'));
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

test('of two writes based on the same version at once, only one wins', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'yamoli-')), 'data.json');
  const { etag } = (await writeData(path, outline('a'), '*')) as { etag: string };
  const results = await Promise.all([writeData(path, outline('b'), etag), writeData(path, outline('c'), etag)]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  const winner = results.findIndex((r) => r.status === 200) === 0 ? 'b' : 'c';
  expect(JSON.parse(await readFile(path, 'utf8')).nodes.r.text).toBe(winner);
});

test('keeps a copy before a write that removes many rows', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'yamoli-'));
  const path = join(dir, 'data.json');
  const withRows = (n: number) => {
    const nodes: Record<string, object> = { r: { id: 'r', text: '', children: [] as string[] } };
    for (let i = 0; i < n; i++) {
      nodes['n' + i] = { id: 'n' + i, text: 'row ' + i, children: [] };
      (nodes.r as { children: string[] }).children.push('n' + i);
    }
    return JSON.stringify({ rootId: 'r', nodes });
  };
  const snapshots = async () => (await readdir(join(dir, 'backups'))).filter((f) => /-\d{6}\.json$/.test(f));

  let { etag } = (await writeData(path, withRows(20), '*')) as { etag: string };
  // Removing a few rows only keeps the day's backup.
  ({ etag } = (await writeData(path, withRows(15), etag)) as { etag: string });
  expect(await snapshots()).toHaveLength(0);
  // Removing ten or more keeps what was there just before.
  await writeData(path, withRows(5), etag);
  const kept = await snapshots();
  expect(kept).toHaveLength(1);
  expect(Object.keys(JSON.parse(await readFile(join(dir, 'backups', kept[0]), 'utf8')).nodes)).toHaveLength(16);
  // The day's backup is still the version from before the first write.
  const daily = (await readdir(join(dir, 'backups'))).filter((f) => !kept.includes(f));
  expect(daily).toHaveLength(1);
  expect(Object.keys(JSON.parse(await readFile(join(dir, 'backups', daily[0]), 'utf8')).nodes)).toHaveLength(21);
});

test('rejects bodies that are not outlines', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'yamoli-')), 'data.json');
  expect((await writeData(path, 'nope', '*')).status).toBe(400);
  expect((await writeData(path, '{"rootId":"r","nodes":{}}', '*')).status).toBe(400);
  expect(await readData(path)).toBeNull();
});

test('moves data from the legacy folder, backups and all, unless the new file exists', async () => {
  const home = await mkdtemp(join(tmpdir(), 'yamoli-'));
  const legacy = join(home, 'outliner', 'data.json');
  const path = join(home, 'yamoli', 'data.json');
  expect(await migrateDataFile(path, legacy)).toBe(false); // nothing to move

  await mkdir(join(home, 'outliner', 'backups'), { recursive: true });
  await writeFile(legacy, outline('old'));
  await writeFile(join(home, 'outliner', 'backups', 'data-2026-11-07.json'), outline('older'));
  expect(await migrateDataFile(path, legacy)).toBe(true);
  expect(JSON.parse(await readFile(path, 'utf8')).nodes.r.text).toBe('old');
  expect(await readdir(join(home, 'yamoli', 'backups'))).toEqual(['data-2026-11-07.json']);
  expect(await readdir(home)).toEqual(['yamoli']);

  // Never overwrites: with a file at the new place the legacy one stays put.
  await mkdir(join(home, 'outliner'));
  await writeFile(legacy, outline('stale'));
  expect(await migrateDataFile(path, legacy)).toBe(false);
  expect(JSON.parse(await readFile(path, 'utf8')).nodes.r.text).toBe('old');
});
