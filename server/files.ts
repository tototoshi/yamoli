/*
 * Files added to the outline (pasted or dropped into a row) live next to the
 * outline file, named by their contents, and the outline refers to them as
 * `files/<sha256>.<ext>`:
 *
 *   POST /api/files?name=<file name>   the bytes → 200 { "ref": "files/….pdf", "size": 1234 }
 *   GET  /api/files/<name>[?name=…]    the file
 *
 * A file is never changed once written (the same contents give the same name),
 * so backups and undo only need the reference. Images (told apart by their
 * first bytes, not by their name or the request's Content-Type) are shown in
 * the page; anything else is only ever downloaded, under the name it came
 * with. Either way they are served so that nothing in them can run.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { isLocal } from './dataFile';

export const FILES_PATH = '/api/files';
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const NAME = /^[0-9a-f]{64}\.([a-z0-9]{1,10})$/;

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

/** Connect-style middleware for Vite's dev and preview servers. */
export function filesMiddleware(dir: string, allowRemote = !!process.env.YAMOLI_ALLOW_REMOTE) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const [url, search = ''] = (req.url ?? '').split('?');
    if (url !== FILES_PATH && !url.startsWith(FILES_PATH + '/')) return next();
    if (!allowRemote && !isLocal(req)) return void res.writeHead(403).end();
    const given = new URLSearchParams(search).get('name');
    try {
      if (req.method === 'POST' && url === FILES_PATH) {
        const bytes = await readBytes(req, MAX_FILE_BYTES);
        const r = bytes ? await saveFile(dir, bytes, given ?? undefined) : ({ status: 413, error: 'Too large' } as const);
        if (r.status !== 200) return void res.writeHead(r.status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(r.error);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ ref: r.ref, size: r.size }));
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
        res.writeHead(405, { Allow: 'GET, POST' }).end();
      }
    } catch (e) {
      console.error('[yamoli] file error', e);
      res.writeHead(500).end(String(e));
    }
  };
}
