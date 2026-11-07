import { OutlineStore } from './model';

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

export function load(): OutlineStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return OutlineStore.fromJSON(JSON.parse(raw));
  } catch (e) {
    console.warn('Failed to load outline, starting fresh', e);
  }
  return seed();
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pending: OutlineStore | null = null;

export function save(store: OutlineStore) {
  pending = store;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 250);
}

export function flush() {
  clearTimeout(saveTimer);
  if (!pending) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pending.toJSON()));
    pending = null;
  } catch (e) {
    console.error('Failed to save outline', e);
  }
}

window.addEventListener('beforeunload', flush);

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

  const shop = s.addChild(r, -1, '買い物リスト');
  ['牛乳', '卵', 'パン'].forEach((t) => s.addChild(shop.id, -1, t));
  s.setCollapsed(shop.id, true);
  return s;
}
