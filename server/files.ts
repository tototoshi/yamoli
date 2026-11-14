/*
 * Files added to the outline (pasted or dropped into a row) live next to the
 * outline file, named by their contents, and the outline refers to them as
 * `files/<sha256>.<ext>`:
 *
 *   POST   /api/files?name=<file name>   the bytes → 200 { "ref": "files/….pdf", "size": 1234 }
 *   GET    /api/files/<name>[?name=…]    the file
 *   GET    /api/files/unused             { "count", "bytes" } of files nothing uses any more
 *   DELETE /api/files/unused             removes them
 *   GET    /api/backup.zip               the outline file and the files it uses, in one archive
 *   POST   /api/backup.zip               such an archive: its files are kept, its outline returned (not saved)
 *
 * A file is never changed once written (the same contents give the same name),
 * so backups and undo only need the reference. Images (told apart by their
 * first bytes, not by their name or the request's Content-Type) are shown in
 * the page; anything else is only ever downloaded, under the name it came
 * with. Either way they are served so that nothing in them can run.
 *
 * A file nothing uses — not the outline file, not any of its backups — is
 * left alone for a week (it may have just been added, or be undone back),
 * and after that removed only when asked.
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { isLocal } from './dataFile';
import { unzip, zip } from './zip';

export const FILES_PATH = '/api/files';
export const BACKUP_PATH = '/api/backup.zip';
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_BACKUP_BYTES = 1024 * 1024 * 1024;
/** How long a file nothing uses is kept before it may be removed. */
export const KEEP_UNUSED_MS = 7 * 24 * 60 * 60 * 1000;

const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const NAME = /^[0-9a-f]{64}\.([a-z0-9]{1,10})$/;
const REF = /files\/([0-9a-f]{64}\.[a-z0-9]{1,10})/g;

/** The kept files an outline (its JSON text) refers to, by name. */
export const filesUsedBy = (text: string) => new Set([...text.matchAll(REF)].map((m) => m[1]));

/** The image format of bytes, from their signature; null for anything else. */
export function imageType(b: Buffer): string | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString('latin1'))) return 'gif';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

/**
 * The extension a file is kept under: an image's own, else the one its name
 * has (`bin` when it has none, or claims to be an image it isn't).
 */
export function extensionFor(bytes: Buffer, name = ''): string {
  const image = imageType(bytes);
  if (image) return image;
  const ext = name.match(/\.([A-Za-z0-9]{1,10})$/)?.[1].toLowerCase();
  return ext && !(ext in IMAGE_TYPES) && ext !== 'jpeg' ? ext : 'bin';
}

export type SaveResult = { status: 200; ref: string; size: number } | { status: 413; error: string };

/** Keep a file in dir under the name of its contents. */
export async function saveFile(dir: string, bytes: Buffer, name?: string): Promise<SaveResult> {
  if (bytes.length > MAX_FILE_BYTES) return { status: 413, error: `Larger than ${MAX_FILE_BYTES / 1024 / 1024} MB` };
  const file = `${createHash('sha256').update(bytes).digest('hex')}.${extensionFor(bytes, name)}`;
  const path = join(dir, file);
  const there = await stat(path).then(
    () => true,
    () => false
  );
  if (!there) {
    await mkdir(dir, { recursive: true });
    const tmp = `${path}.${process.pid}-${Date.now()}.tmp`;
    await writeFile(tmp, bytes);
    await rename(tmp, path);
  }
  return { status: 200, ref: `files/${file}`, size: bytes.length };
}

const readText = (path: string) => readFile(path, 'utf8').catch(() => null);

/** Every outline whose files are worth keeping: the file itself and its backups. */
async function outlines(dataPath: string): Promise<string[]> {
  const backups = join(dirname(dataPath), 'backups');
  const names = (await readdir(backups).catch(() => [] as string[])).filter((f) => f.endsWith('.json'));
  const texts = await Promise.all([dataPath, ...names.map((n) => join(backups, n))].map(readText));
  return texts.filter((t): t is string => t !== null);
}

/** Files in dir that neither the outline file nor any backup uses, kept longer ago than KEEP_UNUSED_MS. */
export async function unusedFiles(dir: string, dataPath: string, now = Date.now()): Promise<{ name: string; size: number }[]> {
  const used = new Set<string>();
  for (const text of await outlines(dataPath)) filesUsedBy(text).forEach((f) => used.add(f));
  const out: { name: string; size: number }[] = [];
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    if (!NAME.test(name) || used.has(name)) continue;
    const s = await stat(join(dir, name));
    if (now - s.mtimeMs > KEEP_UNUSED_MS) out.push({ name, size: s.size });
  }
  return out;
}

/** The outline file and the files it uses, as a ZIP archive (data.json, files/…); null without an outline file. */
export async function backupZip(dir: string, dataPath: string): Promise<Buffer | null> {
  const text = await readText(dataPath);
  if (text === null) return null;
  const entries = [{ name: 'data.json', data: Buffer.from(text, 'utf8') }];
  for (const name of filesUsedBy(text)) {
    const data = await readFile(join(dir, name)).catch(() => null);
    if (data) entries.push({ name: `files/${name}`, data });
  }
  return zip(entries);
}

/**
 * Keep the files in a backup archive (each checked against its name) and
 * return its outline, for the app to load like any other.
 */
export async function restoreZip(dir: string, archive: Buffer): Promise<string> {
  const entries = unzip(archive);
  const data = entries.find((e) => e.name === 'data.json');
  if (!data) throw new Error('No data.json in the archive');
  await mkdir(dir, { recursive: true });
  for (const e of entries) {
    const name = e.name.match(/^files\/([^/]+)$/)?.[1];
    if (!name || !NAME.test(name) || createHash('sha256').update(e.data).digest('hex') !== name.slice(0, 64)) continue;
    const path = join(dir, name);
    if (await stat(path).catch(() => null)) continue;
    await writeFile(`${path}.tmp`, e.data);
    await rename(`${path}.tmp`, path);
  }
  return data.data.toString('utf8');
}

/** Content-Disposition for downloading a file under name (the name it came with), or its own. */
export function attachment(name: string | null, fallback: string): string {
  const clean = (name ?? '').replace(/[\u0000-\u001f\u007f/\\]/g, '').trim() || fallback;
  const ascii = clean.replace(/[^\x20-\x7e]|["%;]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}

/** The bytes of a request, or null once there are more than limit. */
const readBytes = (req: IncomingMessage, limit: number) =>
  new Promise<Buffer | null>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= limit) chunks.push(c);
    });
    req.on('end', () => resolve(size > limit ? null : Buffer.concat(chunks)));
    req.on('error', reject);
  });

const json = (res: ServerResponse, value: unknown) =>
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(value));

/** Connect-style middleware for Vite's dev and preview servers; dataPath is the outline file the files belong with. */
export function filesMiddleware(dir: string, dataPath: string, allowRemote = !!process.env.YAMOLI_ALLOW_REMOTE) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const [url, search = ''] = (req.url ?? '').split('?');
    if (url !== FILES_PATH && !url.startsWith(FILES_PATH + '/') && url !== BACKUP_PATH) return next();
    if (!allowRemote && !isLocal(req)) return void res.writeHead(403).end();
    const given = new URLSearchParams(search).get('name');
    try {
      if (url === BACKUP_PATH && req.method === 'GET') {
        const archive = await backupZip(dir, dataPath);
        if (!archive) return void res.writeHead(404).end();
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Cache-Control': 'no-store' }).end(archive);
      } else if (url === BACKUP_PATH && req.method === 'POST') {
        const archive = await readBytes(req, MAX_BACKUP_BYTES);
        if (!archive) return void res.writeHead(413).end('Too large');
        const text = await restoreZip(dir, archive).catch((e: Error) => e);
        if (text instanceof Error) return void res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end(text.message);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(text);
      } else if (url === FILES_PATH + '/unused' && (req.method === 'GET' || req.method === 'DELETE')) {
        const unused = await unusedFiles(dir, dataPath);
        if (req.method === 'DELETE') for (const f of unused) await rm(join(dir, f.name), { force: true });
        json(res, { count: unused.length, bytes: unused.reduce((n, f) => n + f.size, 0) });
      } else if (req.method === 'POST' && url === FILES_PATH) {
        const bytes = await readBytes(req, MAX_FILE_BYTES);
        const r = bytes ? await saveFile(dir, bytes, given ?? undefined) : ({ status: 413, error: 'Too large' } as const);
        if (r.status !== 200) return void res.writeHead(r.status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(r.error);
        json(res, { ref: r.ref, size: r.size });
      } else if (req.method === 'GET') {
        const file = decodeURIComponent(url.slice(FILES_PATH.length + 1));
        const m = file.match(NAME);
        const bytes = m && (await readFile(join(dir, file)).catch(() => null));
        if (!m || !bytes) return void res.writeHead(404).end();
        const image = IMAGE_TYPES[m[1]];
        res
          .writeHead(200, {
            'Content-Type': image ?? 'application/octet-stream',
            ...(image ? {} : { 'Content-Disposition': attachment(given, file) }),
            'Cache-Control': 'private, max-age=31536000, immutable',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; sandbox",
          })
          .end(bytes);
      } else {
        res.writeHead(405).end();
      }
    } catch (e) {
      console.error('[yamoli] file error', e);
      res.writeHead(500).end(String(e));
    }
  };
}
