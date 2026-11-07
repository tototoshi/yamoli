import { OutlineStore } from './model';
import { addScheduleSample } from './sample';

const STORAGE_KEY = 'outliner:v1';
const PREFS_KEY = 'outliner:prefs';

export interface Prefs {
  showCompleted: boolean;
}

export function loadPrefs(): Prefs {
  const defaults: Prefs = { showCompleted: true };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    return defaults;
  }
}

export function savePrefs(prefs: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (e) {
    console.error('Failed to save preferences', e);
  }
}

// ================================================================ outline

/*
 * When the app is served by our dev / preview server the outline is kept in a
 * file on disk (server/dataFile.ts); otherwise in this browser's localStorage.
 * A copy always goes to localStorage too, as a fallback.
 *
 * Every write names the version it was based on (ETag), so a stale tab can't
 * overwrite newer data: it gets a conflict and the user picks a side.
 */

const API = './api/data';

export type SaveState =
  | { kind: 'local' } // no server: this browser only
  | { kind: 'saved' }
  | { kind: 'saving' }
  | { kind: 'error'; message: string } // retried automatically
  | { kind: 'conflict' }; // the file changed elsewhere while we had unsaved edits

let state: SaveState = { kind: 'local' };
const listeners = new Set<() => void>();
/** Path of the outline file on disk, when saving to one. */
export let dataFile: string | null = null;

export const saveState = () => state;
export function onSaveState(fn: () => void) {
  listeners.add(fn);
}
function setState(next: SaveState) {
  state = next;
  listeners.forEach((fn) => fn());
}

let initial: OutlineStore;
let etag: string | null = null; // null: no file yet
/** Called with the file's contents when it changed elsewhere and we had nothing unsaved. */
let onExternal: (store: OutlineStore) => void = () => {};

export function onExternalChange(fn: (store: OutlineStore) => void) {
  onExternal = fn;
}

function loadLocal(): OutlineStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return OutlineStore.fromJSON(JSON.parse(raw));
  } catch (e) {
    console.warn('Failed to load outline, starting fresh', e);
  }
  return seed();
}

/** Find out where the outline lives and load it; call once before rendering. */
export async function init(): Promise<void> {
  let res: Response;
  try {
    res = await fetch(API, { cache: 'no-store' });
  } catch {
    res = new Response(null, { status: 404 });
  }
  const file = res.headers.get('X-Outliner-File');
  if (!file || (res.status !== 200 && res.status !== 204)) {
    initial = loadLocal();
    return;
  }
  dataFile = decodeURIComponent(file);
  if (res.status === 204) {
    // No file yet: start it from what this browser had (or the sample).
    initial = loadLocal();
    setState({ kind: 'saved' });
    save(initial);
    return;
  }
  try {
    initial = OutlineStore.fromJSON(await res.json());
    etag = res.headers.get('ETag');
    setState({ kind: 'saved' });
  } catch (e) {
    // Never overwrite a file we could not read; work from the browser copy.
    console.error('Failed to read the outline file', e);
    dataFile = null;
    initial = loadLocal();
    setState({ kind: 'error', message: 'ファイルを読み込めませんでした。ブラウザ内のデータを表示しています（ファイルには保存しません）' });
  }
}

export const load = () => initial;

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pending: OutlineStore | null = null;
/** Serialized outline not yet confirmed written to the file. */
let unsaved: string | null = null;
let inflight = false;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

export function save(store: OutlineStore) {
  pending = store;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 250);
}

export function flush() {
  clearTimeout(saveTimer);
  if (!pending) return;
  const json = JSON.stringify(pending.toJSON());
  pending = null;
  try {
    localStorage.setItem(STORAGE_KEY, json);
  } catch (e) {
    console.error('Failed to save outline to the browser', e);
  }
  if (!dataFile) return;
  unsaved = json;
  push();
}

const putInit = (body: string, keepalive = false): RequestInit => ({
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', ...(etag ? { 'If-Match': etag } : { 'If-None-Match': '*' }) },
  body,
  keepalive,
});

/** Write the latest unsaved outline, one request at a time. */
function push() {
  if (inflight || unsaved === null || state.kind === 'conflict') return;
  const json = unsaved;
  inflight = true;
  clearTimeout(retryTimer);
  setState({ kind: 'saving' });
  fetch(API, putInit(json))
    .then(async (res) => {
      if (res.status === 409) return setState({ kind: 'conflict' });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      etag = res.headers.get('ETag');
      if (unsaved === json) unsaved = null;
      setState({ kind: unsaved === null ? 'saved' : 'saving' });
    })
    .catch((e) => {
      console.error('Failed to save outline file', e);
      setState({ kind: 'error', message: 'ファイルに保存できません（サーバーが止まっている？）。自動で再試行します' });
      retryTimer = setTimeout(push, 5000);
    })
    .finally(() => {
      inflight = false;
      if (state.kind === 'saving') push();
    });
}

/** Look for changes made elsewhere (another tab, an editor) and take them if we can. */
async function checkExternal() {
  if (!dataFile || inflight || pending || state.kind === 'conflict') return;
  const res = await fetch(API, { cache: 'no-store', headers: etag ? { 'If-None-Match': etag } : {} }).catch(() => null);
  if (!res || res.status !== 200) return;
  if (unsaved !== null || pending) return setState({ kind: 'conflict' });
  try {
    const store = OutlineStore.fromJSON(await res.json());
    etag = res.headers.get('ETag');
    onExternal(store);
  } catch (e) {
    console.error('Failed to read the changed outline file', e);
  }
}

/** Settle a conflict: take the file's version, or overwrite it with ours. */
export async function resolveConflict(keep: 'file' | 'mine', mine: OutlineStore) {
  const res = await fetch(API, { cache: 'no-store' }).catch(() => null);
  if (!res || (res.status !== 200 && res.status !== 204)) {
    setState({ kind: 'error', message: 'ファイルを確認できませんでした' });
    return;
  }
  etag = res.headers.get('ETag');
  if (keep === 'file' && res.status === 200) {
    const store = OutlineStore.fromJSON(await res.json());
    pending = null;
    unsaved = null;
    setState({ kind: 'saved' });
    onExternal(store);
  } else {
    unsaved = JSON.stringify(mine.toJSON());
    setState({ kind: 'saving' });
    push();
  }
}

window.addEventListener('focus', checkExternal);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && checkExternal());

window.addEventListener('beforeunload', (e) => {
  flush();
  if (unsaved === null || state.kind === 'conflict') return;
  if (inflight) e.preventDefault(); // a write is under way; ask the user to wait
  else fetch(API, putInit(unsaved, true)).catch(() => {}); // too large for keepalive: the browser copy remains
});

function seed(): OutlineStore {
  const s = OutlineStore.create();
  const r = s.rootId;
  const welcome = s.addChild(r, -1, 'Outliner へようこそ');
  s.addChild(welcome.id, -1, 'Enter で新しい行、Tab / Shift+Tab でインデント');
  s.addChild(welcome.id, -1, '左の ● をクリックするとその項目にズームイン（パンくずでズームアウト）');
  s.addChild(welcome.id, -1, 'Alt+A で属性、Alt+D でデータを追加');

  const proj = s.addChild(r, -1, 'プロジェクト A');
  s.addAttribute(proj.id, 'status', '進行中');
  s.addAttribute(proj.id, 'due', '2026-12-01');
  const spec = s.addChild(proj.id, -1, '仕様');
  s.addData(
    spec.id,
    'markdown',
    '## 概要\n\nアウトラインの各行は **属性** と **データ** を持てます。\n\n- 属性: key / value のペア\n- データ: フォーマット付きの本文\n  - Markdown, JSON, CSV, Code, Text\n\n| 項目 | 状態 |\n| --- | :---: |\n| zoom | 済 |\n| attribute | 済 |'
  );
  const conf = s.addChild(proj.id, -1, '設定');
  s.addData(conf.id, 'json', '{"theme":"auto","fontSize":15,"tags":["outline","notes"],"beta":true}');
  const sales = s.addChild(proj.id, -1, '売上');
  s.addData(sales.id, 'csv', 'month,amount\n2026-09,120\n2026-10,135\n2026-11,150');

  addScheduleSample(s, r);

  const shop = s.addChild(r, -1, '買い物リスト');
  ['牛乳', '卵', 'パン'].forEach((t) => s.addChild(shop.id, -1, t));
  s.setCollapsed(shop.id, true);
  return s;
}
