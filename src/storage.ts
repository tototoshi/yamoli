import { OutlineStore } from './model';
import type { View } from './controller';
import { lang, t, type Lang } from './i18n';
import { addGuideSlides, addScheduleSample } from './sample';

const STORAGE_KEY = 'yamoli:v1';
const PREFS_KEY = 'yamoli:prefs';

// Keys from before the app was renamed to Yamoli.
for (const [from, to] of [
  ['outliner:v1', STORAGE_KEY],
  ['outliner:prefs', PREFS_KEY],
]) {
  try {
    const old = localStorage.getItem(from);
    if (old !== null && localStorage.getItem(to) === null) localStorage.setItem(to, old);
    localStorage.removeItem(from);
  } catch {
    // storage unavailable: nothing to move
  }
}

export type FieldsMode = 'show' | 'fold' | 'hide';

export interface Prefs {
  showCompleted: boolean;
  /** Field rows (`key: value`) in the outline: shown, folded into a summary per row, or hidden. */
  fields: FieldsMode;
  /** How items were last viewed, when not as an outline. */
  views: Record<string, Exclude<View, 'outline'>>;
  /** Index into the Gantt chart's day widths. */
  ganttScale: number;
  /** The UI language the user picked; the browser's when unset. */
  lang?: Lang;
}

export function loadPrefs(): Prefs {
  const defaults: Prefs = { showCompleted: true, fields: 'show', views: {}, ganttScale: 2 };
  try {
    const { ganttItems, showFields, ...saved } = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    const prefs: Prefs = { ...defaults, ...saved };
    // Earlier versions could only show or hide fields.
    if (showFields === false && !saved.fields) prefs.fields = 'hide';
    // Earlier versions only remembered Gantt charts.
    if (Array.isArray(ganttItems)) for (const id of ganttItems) prefs.views[id] ??= 'gantt';
    return prefs;
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
  const file = res.headers.get('X-Yamoli-File');
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
    setState({
      kind: 'error',
      message: t(
        'ファイルを読み込めませんでした。ブラウザ内のデータを表示しています（ファイルには保存しません）',
        'Couldn’t read the file. Showing the copy in this browser (not saved to the file)'
      ),
    });
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
      setState({
        kind: 'error',
        message: t('ファイルに保存できません（サーバーが止まっている？）。自動で再試行します', 'Can’t save to the file (is the server down?). Retrying'),
      });
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
    setState({ kind: 'error', message: t('ファイルを確認できませんでした', 'Couldn’t check the file') });
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
  const welcome = s.addChild(r, -1, t('Yamoli へようこそ', 'Welcome to Yamoli'));
  s.addChild(welcome.id, -1, t('Enter で新しい行、Tab / Shift+Tab でインデント', 'Enter for a new row, Tab / Shift+Tab to indent'));
  s.addChild(
    welcome.id,
    -1,
    t('左の ● をクリックするとその項目にズームイン（パンくずでズームアウト）', 'Click the ● on the left to zoom into an item (the breadcrumbs zoom out)')
  );
  s.addChild(
    welcome.id,
    -1,
    t('Alt+A で属性、Alt+D でブロック（Markdown などの複数行）を追加', 'Alt+A adds a field, Alt+D a block (multi-line Markdown and such)')
  );

  const proj = s.addChild(r, -1, t('プロジェクト A', 'Project A'));
  s.addField(proj.id, 'status', t('進行中', 'active'));
  s.addField(proj.id, 'due', '2026-12-01');
  const spec = s.addChild(proj.id, -1, t('仕様', 'Spec'));
  s.addBlock(
    spec.id,
    'body',
    'markdown',
    t(
      '## 概要\n\nアウトラインの各行は **属性** を持てます。\n\n- 1行の値: `status: 進行中`\n- 入れ子: 属性の下に属性（オブジェクト）や行（リスト）\n- ブロック: フォーマット付きの複数行\n  - Markdown, CSV, Code, Text\n\n| 項目 | 状態 |\n| --- | :---: |\n| zoom | 済 |\n| attribute | 済 |',
      '## Overview\n\nEach row of the outline can have **fields**.\n\n- A one-line value: `status: active`\n- Nesting: fields (an object) or rows (a list) under a field\n- Blocks: multi-line values with a format\n  - Markdown, CSV, Code, Text\n\n| Feature | Status |\n| --- | :---: |\n| zoom | done |\n| fields | done |'
    )
  );
  // Settings are plain nested fields: an object and a list.
  const conf = s.addChild(proj.id, -1, t('設定', 'Settings'));
  s.addField(conf.id, 'theme', 'auto');
  s.addField(conf.id, 'fontSize', '15');
  const tags = s.addField(conf.id, 'tags');
  ['outline', 'notes'].forEach((tag) => s.addChild(tags.id, -1, tag));
  s.addField(conf.id, 'beta', 'true');
  const sales = s.addChild(proj.id, -1, t('売上', 'Sales'));
  s.addBlock(sales.id, 'table', 'csv', 'month,amount\n2026-09,120\n2026-10,135\n2026-11,150');

  const sample = addScheduleSample(s, r);
  s.setCollapsed(addGuideSlides(s, r, sample), true);

  const shop = s.addChild(r, -1, t('買い物リスト', 'Shopping list'));
  (lang() === 'ja' ? ['牛乳', '卵', 'パン'] : ['Milk', 'Eggs', 'Bread']).forEach((item) => s.addChild(shop.id, -1, item));
  s.setCollapsed(shop.id, true);
  return s;
}
