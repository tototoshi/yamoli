/*
 * A small project, broken down like a WBS (phases > work packages > tasks),
 * that shows dependencies and scheduling at work. Dates are relative to
 * today so the sample never goes stale.
 */
import { formatDate, today, weekday, type Day } from './calendar';
import type { OutlineStore } from './model';

/** Append the sample project under parentId and return its id. */
export function addScheduleSample(s: OutlineStore, parentId: string, now: Day = today()): string {
  const monday = now + ((8 - weekday(now)) % 7); // today if Monday, else the next one
  const proj = s.addChild(parentId, -1, 'サンプル: Web サイト リニューアル');
  s.addField(proj.id, 'start', formatDate(monday));
  s.addField(proj.id, 'holidays', 'jp');
  // Notes go in a data block, so every row stays a task.
  s.addData(
    proj.id,
    'markdown',
    '日付は `duration` / `start` / `after` / `due` 属性から自動で計算されます。\n\n' +
      '- ★ はクリティカルパス（遅れると全体が遅れる作業）\n' +
      '- 「ガント」に切り替えると線表で見られます\n' +
      '- 説明やメモは行ではなくデータ（Alt+D）に書くと、作業と混ざりません'
  );

  const add = (parent: string, text: string, attrs: Record<string, string> = {}) => {
    const n = s.addChild(parent, -1, text);
    for (const [k, v] of Object.entries(attrs)) s.addField(n.id, k, v);
    return n.id;
  };
  const after = (...ids: string[]) => ids.map((id) => `[[${id}]]`).join(', ');

  const plan = add(proj.id, '1. 企画');
  const kickoff = add(plan, 'キックオフ', { duration: '0d' });
  s.setCompleted(kickoff, true);
  add(plan, '要件定義', { duration: '3d', after: after(kickoff) });

  // A phase-level dependency: everything in design waits for planning.
  const design = add(proj.id, '2. 設計', { after: after(plan) });
  const ia = add(design, '情報設計', { duration: '2d' });
  const visual = add(design, 'デザイン');
  const wire = add(visual, 'ワイヤーフレーム', { duration: '2d', after: after(ia) });
  const look = add(visual, 'ビジュアルデザイン', { duration: '3d', after: after(wire) });
  const apiDesign = add(design, 'API 設計', { duration: '2d', after: after(ia) });

  const build = add(proj.id, '3. 実装');
  const back = add(build, 'バックエンド');
  const api = add(back, 'API 実装', { duration: '1w', after: after(apiDesign) });
  const migrate = add(back, 'データ移行', { duration: '3d', after: after(api) });
  const front = add(build, 'フロントエンド');
  const screens = add(front, '画面実装', { duration: '1w', after: after(look) });
  const wiring = add(front, 'API 連携', { duration: '2d', after: after(screens, api) });

  const ship = add(proj.id, '4. 検証・公開');
  const legal = add(ship, '法務レビュー', { duration: '5cd', after: after(look) });
  const test = add(ship, '総合テスト', { duration: '3d', after: after(wiring, migrate), due: formatDate(monday + 25) });
  const release = add(ship, '公開', { duration: '0d', after: after(test, legal) });

  const ops = add(proj.id, '5. 運用', { after: after(release) });
  add(ops, '監視・改善', { duration: '1w' });
  return proj.id;
}

/**
 * A slide deck explaining the app, written as an ordinary outline. The
 * scheduling slide embeds a project's Gantt chart: projectId, or a sample
 * project found or added beside the deck.
 */
export function addGuideSlides(s: OutlineStore, parentId: string, projectId?: string): string {
  const project =
    projectId ??
    s.items(parentId).find((id) => s.node(id).text.startsWith('サンプル: ')) ??
    addScheduleSample(s, parentId);

  const deck = s.addChild(parentId, -1, 'Outliner の使い方');
  s.addField(deck.id, 'subtitle', 'アウトライン × YAML × プロジェクト管理');
  s.addField(deck.id, 'notes', '「スライド」表示で開くとプレゼンになります。← → でページ送り、F で全画面。');

  const slide = (title: string, fields: Record<string, string>, bullets: (string | [string, string[]])[]) => {
    const n = s.addChild(deck.id, -1, title);
    for (const [k, v] of Object.entries(fields)) s.addField(n.id, k, v);
    for (const b of bullets) {
      const [text, children] = typeof b === 'string' ? [b, []] : b;
      const row = s.addChild(n.id, -1, text);
      for (const c of children) s.addChild(row.id, -1, c);
    }
    return n.id;
  };

  slide('基本操作', { notes: '行の編集はふつうのテキストエディタと同じ感覚です。' }, [
    ['**Enter** で新しい行、**Tab / Shift+Tab** でインデント', ['Alt+Shift+↑↓ で行を移動、● をドラッグしても OK']],
    ['● をクリックすると、その項目に**ズームイン**', ['パンくずやブラウザの「戻る」でズームアウト']],
    ['● を右クリックで項目メニュー', ['複製・削除・リンクをコピー・完了など']],
    '⌘/Ctrl+F で検索、⌘/Ctrl+Z で元に戻す',
  ]);

  const yaml = slide('属性 = YAML', { layout: 'two-column', notes: '左が書き方、右がアウトラインに書いた属性を YAML にしたものです。' }, [
    ['行頭で `name: ` と打つと**属性**の行に', ['値の先頭で Backspace で戻る']],
    ['値のない属性の下は入れ子に', ['子に属性 → オブジェクト', '子に普通の行 → リスト']],
    'YAML の貼り付けもそのまま',
    '属性で日程・スライドなどの振る舞いが変わる',
  ]);
  s.addData(yaml, 'code', 'start: 2026-11-09\nduration: 3d\nbudget:\n  amount: 1200000\n  currency: JPY\nlinks:\n  - https://example.com');

  slide('リンクと依存', {}, [
    ['`[[` で他の項目へのリンク', ['リンク先には「被リンク」として表示される']],
    ['`after: [[作業]]` で依存関係', ['先行する作業が終わってから始まる', 'is:ready / is:blocked で着手可・待ちを検索']],
    '依存が循環していると ⚠ で知らせる',
  ]);

  slide('日程計算', { embed: `[[${project}]]`, notes: 'サンプルプロジェクトのガントをそのまま埋め込んでいます。元の項目を編集するとここも変わります。' }, [
    '`start` / `duration` / `after` / `due` から日付を自動計算 — ★ はクリティカルパス',
  ]);

  slide('ビュー', { layout: 'two-column' }, [
    ['アウトライン', ['すべての編集はここで']],
    ['ガント', ['日程を線表で', '日付の列幅は切り替え可能']],
    ['スライド', ['項目 = デッキ、子 = 1 枚ずつ', '`layout` / `notes` / `image` / `theme`']],
    ['検索', ['`status:進行中`、`budget.amount:1200000`', '`is:late` / `is:critical` / `is:done`']],
  ]);

  slide('保存', {}, [
    ['開発サーバーでは `~/outliner/data.json` に保存', ['毎日のバックアップは `backups/` に 30 日分']],
    '別のタブや外部で変更されたら、読み込むか上書きするか選べる',
    'サーバーがないときはブラウザ（localStorage）に保存',
  ]);

  slide('このスライド自体がアウトライン', { layout: 'center', notes: 'アウトラインに戻って、このデッキを自由に編集してみてください。' }, [
    '「このスライドを編集」から中身を書き換えてみてください',
  ]);
  return deck.id;
}
