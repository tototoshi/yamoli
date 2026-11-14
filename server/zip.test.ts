// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { unzip, zip } from './zip';

const entries = [
  { name: 'data.json', data: Buffer.from(JSON.stringify({ text: 'あいう'.repeat(500) })) },
  { name: 'files/報告書.bin', data: Buffer.from([0, 1, 2, 3, 255]) },
  { name: 'empty.txt', data: Buffer.alloc(0) },
];

test('what is zipped unzips the same', () => {
  expect(unzip(zip(entries))).toEqual(entries);
});

test('other tools read the archives', async () => {
  // Python's zipfile follows the standard, UTF-8 names included (macOS's own unzip ignores that flag).
  const dir = await mkdtemp(join(tmpdir(), 'yamoli-zip-'));
  await writeFile(join(dir, 'a.zip'), zip(entries));
  const read =
    'import json, sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps({n: list(z.read(n)) for n in z.namelist()}))';
  const got = JSON.parse(execFileSync('python3', ['-I', '-c', read, join(dir, 'a.zip')], { encoding: 'utf8' }));
  expect(Object.keys(got)).toEqual(entries.map((e) => e.name));
  expect(Buffer.from(got['files/報告書.bin'])).toEqual(entries[1].data);
  expect(Buffer.from(got['data.json'])).toEqual(entries[0].data);
});

test('anything else is refused', () => {
  expect(() => unzip(Buffer.from('not a zip at all, not even close'))).toThrow(/Not a ZIP/);
  const damaged = zip([{ name: 'a.txt', data: Buffer.from('hello hello hello') }]);
  damaged[30 + 'a.txt'.length + 1] ^= 0xff; // a byte of the packed data
  expect(() => unzip(damaged)).toThrow();
});
