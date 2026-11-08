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
