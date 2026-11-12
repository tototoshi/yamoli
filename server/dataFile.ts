/*
 * The outline lives in one JSON file on disk, served to the app by the
 * dev / preview server:
 *
 *   GET /api/data   200 + ETag with the file, or 204 when there is none yet
 *   PUT /api/data   If-Match: <etag> (or If-None-Match: * to create);
 *                   409 + the current ETag when someone else saved first
 *
 * Only this computer may use it, unless YAMOLI_ALLOW_REMOTE=1: started with
 * `--host`, the server is on the network, but the outline isn't (403).
 *
 * Writes go through a temporary file and a rename, and the first write of
 * each day keeps a copy of the previous contents in backups/, as does any
 * write that removes many rows at once.
 */
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

export const API_PATH = '/api/data';
const KEEP_BACKUPS = 30;
/** A write that removes at least this many rows keeps a copy of what was there. */
const BIG_DELETE = 10;
const KEEP_SNAPSHOTS = 20;

export const defaultDataPath = () => process.env.YAMOLI_DATA || join(homedir(), 'yamoli', 'data.json');
/** Where the file lived before the app was renamed to Yamoli. */
export const legacyDataPath = () => join(homedir(), 'outliner', 'data.json');

/**
 * Move a file from the legacy location to `path` when only the old one exists:
 * the whole folder (backups too) when the new folder isn't there yet, else
 * just the file. Returns whether anything moved.
 */
export async function migrateDataFile(path: string, legacy: string): Promise<boolean> {
  if ((await exists(path)) || !(await exists(legacy))) return false;
  if (await exists(dirname(path))) {
    await rename(legacy, path);
  } else {
    await mkdir(dirname(dirname(path)), { recursive: true });
    await rename(dirname(legacy), dirname(path));
  }
  return true;
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false
  );

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

/** The last write queued for each file, so the next one waits for it. */
const queues = new Map<string, Promise<unknown>>();
let tmpSeq = 0;

/**
 * Replace the file with `body` if it still matches `ifMatch` (an ETag, or
 * '*' / null meaning "only if there is no file yet").
 *
 * Writes to one file run one at a time, so two based on the same version
 * can't both pass the check: the second sees the first's ETag and gets 409.
 */
export function writeData(path: string, body: string, ifMatch: string | null): Promise<WriteResult> {
  const run = (queues.get(path) ?? Promise.resolve()).then(() => writeNow(path, body, ifMatch));
  const done = run.catch(() => {});
  queues.set(path, done);
  done.then(() => queues.get(path) === done && queues.delete(path));
  return run;
}

async function writeNow(path: string, body: string, ifMatch: string | null): Promise<WriteResult> {
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
  if (current !== null) await backup(path, countNodes(current) - countNodes(json));
  const tmp = `${path}.${process.pid}-${++tmpSeq}.tmp`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, path);
  return { status: 200, etag: etagOf(text) };
}

function countNodes(outline: string | { nodes: object }): number {
  try {
    const { nodes } = typeof outline === 'string' ? JSON.parse(outline) : outline;
    return Object.keys(nodes ?? {}).length;
  } catch {
    return 0;
  }
}

/**
 * Keep the file as it was before today's first write (`data-YYYY-MM-DD.json`)
 * and before a write that removes `removed` >= BIG_DELETE rows
 * (`data-YYYY-MM-DD-HHMMSS.json`); prune old copies of each kind.
 */
async function backup(path: string, removed: number) {
  const dir = join(dirname(path), 'backups');
  const stem = basename(path, '.json');
  const now = new Date();
  const day = now.toLocaleDateString('sv-SE'); // YYYY-MM-DD, local time
  await mkdir(dir, { recursive: true });
  const files = await readdir(dir);
  const keep = async (name: string, pattern: RegExp, limit: number) => {
    const existing = files.filter((f) => pattern.test(f)).sort();
    if (existing.includes(name)) return;
    await copyFile(path, join(dir, name));
    for (const old of [...existing, name].slice(0, -limit)) await rm(join(dir, old), { force: true });
  };
  const esc = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await keep(`${stem}-${day}.json`, new RegExp(`^${esc}-\\d{4}-\\d{2}-\\d{2}\\.json$`), KEEP_BACKUPS);
  if (removed >= BIG_DELETE) {
    const time = now.toLocaleTimeString('sv-SE').replaceAll(':', ''); // HHMMSS
    await keep(`${stem}-${day}-${time}.json`, new RegExp(`^${esc}-\\d{4}-\\d{2}-\\d{2}-\\d{6}\\.json$`), KEEP_SNAPSHOTS);
  }
}

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

/** Whether a request comes from this computer. */
export const isLocal = (req: IncomingMessage) => /^(127\.|::1$|::ffff:127\.)/.test(req.socket.remoteAddress ?? '');

/** Connect-style middleware for Vite's dev and preview servers. */
export function dataMiddleware(path: string, allowRemote = !!process.env.YAMOLI_ALLOW_REMOTE) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.url?.split('?')[0] !== API_PATH) return next();
    if (!allowRemote && !isLocal(req)) {
      return void res
        .writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
        .end('The outline file is only served to this computer (set YAMOLI_ALLOW_REMOTE=1 to share it)');
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Yamoli-File', encodeURIComponent(path));
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
      console.error('[yamoli] data file error', e);
      res.writeHead(500).end(String(e));
    }
  };
}
