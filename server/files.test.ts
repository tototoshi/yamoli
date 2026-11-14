// @vitest-environment node
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { expect, test } from 'vitest';
import { attachment, backupZip, extensionFor, filesMiddleware, imageType, restoreZip, saveFile, unusedFiles } from './files';
import { unzip, zip } from './zip';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

test('images are told by their first bytes', () => {
  expect(imageType(PNG)).toBe('png');
  expect(imageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
  expect(imageType(Buffer.from('GIF89a...'))).toBe('gif');
  expect(imageType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]))).toBe('webp');
  expect(imageType(SVG)).toBeNull();
  expect(imageType(Buffer.from('hello'))).toBeNull();
});

test('an image is kept under the name of its contents, once', async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'yamoli-')), 'files');
  const a = await saveFile(dir, PNG);
  expect(a).toMatchObject({ status: 200, ref: expect.stringMatching(/^files\/[0-9a-f]{64}\.png$/) });
  expect(await saveFile(dir, PNG)).toEqual(a);
  expect(await readdir(dir)).toEqual([(a as { ref: string }).ref.slice('files/'.length)]);
});

test('other files keep the extension of their name, but never pass for an image', () => {
  expect(extensionFor(PNG, 'shot.bin')).toBe('png');
  expect(extensionFor(Buffer.from('%PDF-1.7'), '報告書.PDF')).toBe('pdf');
  expect(extensionFor(SVG, 'logo.svg')).toBe('svg');
  expect(extensionFor(Buffer.from('<html>'), 'fake.png')).toBe('bin');
  expect(extensionFor(Buffer.from('x'), 'README')).toBe('bin');
  expect(extensionFor(Buffer.from('x'), 'a.tar.gz')).toBe('gz');
});

test('a download keeps the name the file came with, safely', () => {
  expect(attachment('報告書.pdf', 'x.pdf')).toBe(`attachment; filename="___.pdf"; filename*=UTF-8''${encodeURIComponent('報告書.pdf')}`);
  expect(attachment('a"b;\r\n/c.txt', 'x.txt')).toBe(
    `attachment; filename="a_b_c.txt"; filename*=UTF-8''${encodeURIComponent('a"b;c.txt')}`
  );
  expect(attachment(null, 'abc.pdf')).toContain('filename="abc.pdf"');
});

/** Run the middleware on a request; the response's status, headers and body. */
async function call(dir: string, method: string, url: string, body?: Buffer, remoteAddress = '127.0.0.1', allowRemote = false) {
  const req = Object.assign(Readable.from(body ? [body] : []), { method, url, headers: {}, socket: { remoteAddress } });
  const out = { status: 0, headers: {} as Record<string, string>, body: Buffer.alloc(0) };
  const res = {
    writeHead: (s: number, h: Record<string, string> = {}) => ((out.status = s), (out.headers = h), res),
    end: (b?: string | Buffer) => ((out.body = Buffer.from(b ?? '')), res),
  };
  let passed = false;
  await filesMiddleware(dir, join(dir, '..', 'data.json'), allowRemote)(
    req as unknown as IncomingMessage,
    res as unknown as ServerResponse,
    () => (passed = true)
  );
  return { ...out, passed };
}

test('serves kept files so that nothing in them runs, and only to this computer', async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'yamoli-')), 'files');
  const up = await call(dir, 'POST', '/api/files', PNG);
  expect(up.status).toBe(200);
  const { ref } = JSON.parse(up.body.toString());
  expect(await readFile(join(dir, ref.slice('files/'.length)))).toEqual(PNG);

  const got = await call(dir, 'GET', '/api/' + ref);
  expect(got.status).toBe(200);
  expect(got.body).toEqual(PNG);
  expect(got.headers).toMatchObject({ 'Content-Type': 'image/png', 'X-Content-Type-Options': 'nosniff' });
  expect(got.headers['Content-Security-Policy']).toContain('sandbox');

  // Anything else is only ever downloaded, under the name it came with.
  const svg = JSON.parse((await call(dir, 'POST', '/api/files?name=logo.svg', SVG)).body.toString());
  expect(svg).toMatchObject({ ref: expect.stringMatching(/\.svg$/), size: SVG.length });
  const down = await call(dir, 'GET', `/api/${svg.ref}?name=logo.svg`);
  expect(down.headers).toMatchObject({ 'Content-Type': 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
  expect(down.headers['Content-Disposition']).toMatch(/^attachment; filename="logo.svg"/);
  expect(down.body).toEqual(SVG);
  expect((await call(dir, 'GET', '/api/files/../data.json')).status).toBe(404);
  expect((await call(dir, 'GET', '/api/files/' + 'a'.repeat(64) + '.png')).status).toBe(404);
  expect((await call(dir, 'GET', '/api/' + ref, undefined, '192.168.1.20')).status).toBe(403);
  expect((await call(dir, 'GET', '/api/' + ref, undefined, '192.168.1.20', true)).status).toBe(200);
  expect((await call(dir, 'GET', '/api/data')).passed).toBe(true);
});

/** An outline file in a folder of its own, with files/ and backups/ beside it. */
async function folder() {
  const root = await mkdtemp(join(tmpdir(), 'yamoli-'));
  return { root, dir: join(root, 'files'), data: join(root, 'data.json'), backups: join(root, 'backups') };
}
const outlineUsing = (...refs: string[]) =>
  JSON.stringify({
    rootId: 'r',
    nodes: { r: { id: 'r', text: '', children: [] }, ...Object.fromEntries(refs.map((r, i) => [`n${i}`, { text: r }])) },
  });
const WEEK = 7 * 24 * 60 * 60 * 1000;

test('a file is unused only when neither the outline nor any backup uses it, and it was kept over a week ago', async () => {
  const { dir, data, backups } = await folder();
  const [inOutline, inBackup, unused] = await Promise.all(
    ['a', 'b', 'c'].map(async (x) => (await saveFile(dir, Buffer.from(x), `${x}.txt`)) as { ref: string })
  );
  await writeFile(data, outlineUsing(inOutline.ref));
  await mkdir(backups);
  await writeFile(join(backups, 'data-2026-11-01.json'), outlineUsing(inBackup.ref));
  const name = (ref: string) => ref.slice('files/'.length);

  expect(await unusedFiles(dir, data)).toEqual([]); // all just kept
  expect(await unusedFiles(dir, data, Date.now() + WEEK + 1000)).toEqual([{ name: name(unused.ref), size: 1 }]);
});

test('a backup archive holds the outline and the files it uses, and restores them', async () => {
  const from = await folder();
  const used = (await saveFile(from.dir, PNG)) as { ref: string };
  await saveFile(from.dir, Buffer.from('not used'), 'x.txt');
  await writeFile(from.data, outlineUsing(used.ref));
  const archive = (await backupZip(from.dir, from.data))!;
  expect(unzip(archive).map((e) => e.name)).toEqual(['data.json', used.ref]);

  const to = await folder();
  expect(await restoreZip(to.dir, archive)).toBe(outlineUsing(used.ref));
  expect(await readdir(to.dir)).toEqual([used.ref.slice('files/'.length)]);
  expect(await backupZip(to.dir, to.data)).toBeNull(); // the outline isn't written: the app loads it

  // A file whose contents don't match its name, or outside files/, is not put back.
  const forged = zip([
    { name: 'data.json', data: Buffer.from('{}') },
    { name: `files/${'0'.repeat(64)}.png`, data: PNG },
    { name: '../evil.txt', data: Buffer.from('x') },
  ]);
  const elsewhere = await folder();
  await restoreZip(elsewhere.dir, forged);
  expect(await readdir(elsewhere.dir)).toEqual([]);
  await expect(restoreZip(elsewhere.dir, zip([{ name: 'a.txt', data: Buffer.from('x') }]))).rejects.toThrow(/data.json/);
});
