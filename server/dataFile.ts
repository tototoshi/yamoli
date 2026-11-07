/*
 * The outline lives in one JSON file on disk, served to the app by the
 * dev / preview server:
 *
 *   GET /api/data   200 + ETag with the file, or 204 when there is none yet
 *   PUT /api/data   If-Match: <etag> (or If-None-Match: * to create);
 *                   409 + the current ETag when someone else saved first
 *
 * Writes go through a temporary file and a rename, and the first write of
 * each day keeps a copy of the previous contents in backups/.
 */
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

export const API_PATH = '/api/data';
const KEEP_BACKUPS = 30;

export const defaultDataPath = () => process.env.OUTLINER_DATA || join(homedir(), 'outliner', 'data.json');

const etagOf = (text: string) => '"' + createHash('sha1').update(text).digest('hex') + '"';

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

export async function readData(path: string): Promise<{ text: string; etag: string } | null> {
  const text = await readText(path);
  return text === null ? null : { text, etag: etagOf(text) };
}

export type WriteResult = { status: 200; etag: string } | { status: 409; etag: string | null } | { status: 400; error: string };

/**
 * Replace the file with `body` if it still matches `ifMatch` (an ETag, or
 * '*' / null meaning "only if there is no file yet").
 */
export async function writeData(path: string, body: string, ifMatch: string | null): Promise<WriteResult> {
  let json: any;
  try {
    json = JSON.parse(body);
  } catch {
    return { status: 400, error: 'Body is not JSON' };
  }
  if (!json || typeof json !== 'object' || typeof json.rootId !== 'string' || !json.nodes?.[json.rootId]) {
    return { status: 400, error: 'Not an outline' };
  }
  const current = await readText(path);
  const currentTag = current === null ? null : etagOf(current);
  if (currentTag !== (ifMatch === '*' ? null : ifMatch)) return { status: 409, etag: currentTag };

  const text = JSON.stringify(json, null, 2) + '\n';
  await mkdir(dirname(path), { recursive: true });
  if (current !== null) await backup(path);
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, path);
  return { status: 200, etag: etagOf(text) };
}

/** Keep the file as it was before today's first write; prune old copies. */
async function backup(path: string) {
  const dir = join(dirname(path), 'backups');
  const stem = basename(path, '.json');
  const day = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD, local time
  const target = join(dir, `${stem}-${day}.json`);
  await mkdir(dir, { recursive: true });
  const existing = (await readdir(dir)).filter((f) => f.startsWith(stem + '-') && f.endsWith('.json')).sort();
  if (existing.includes(basename(target))) return;
  await copyFile(path, target);
  for (const old of [...existing, basename(target)].slice(0, -KEEP_BACKUPS)) await rm(join(dir, old), { force: true });
}

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

/** Connect-style middleware for Vite's dev and preview servers. */
export function dataMiddleware(path: string) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.url?.split('?')[0] !== API_PATH) return next();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Outliner-File', encodeURIComponent(path));
    try {
      if (req.method === 'GET') {
        const data = await readData(path);
        if (!data) return void res.writeHead(204).end();
        if (req.headers['if-none-match'] === data.etag) return void res.writeHead(304, { ETag: data.etag }).end();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ETag: data.etag }).end(data.text);
      } else if (req.method === 'PUT') {
        const ifMatch = (req.headers['if-match'] as string | undefined) ?? (req.headers['if-none-match'] === '*' ? '*' : null);
        const r = await writeData(path, await readBody(req), ifMatch);
        if (r.status === 400) return void res.writeHead(400).end(r.error);
        res.writeHead(r.status, r.etag ? { ETag: r.etag } : {}).end();
      } else {
        res.writeHead(405, { Allow: 'GET, PUT' }).end();
      }
    } catch (e) {
      console.error('[outliner] data file error', e);
      res.writeHead(500).end(String(e));
    }
  };
}
