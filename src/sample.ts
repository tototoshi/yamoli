/*
 * A small project that shows dependencies and scheduling at work. Dates are
 * relative to today so the sample never goes stale.
 */
import { formatDate, today, weekday, type Day } from './calendar';
import type { OutlineStore } from './model';

/** Append the sample project under parentId and return its id. */
export function addScheduleSample(s: OutlineStore, parentId: string, now: Day = today()): string {
  const monday = now + ((8 - weekday(now)) % 7); // today if Monday, else the next one
  const proj = s.addChild(parentId, -1, 'サンプル: Web サイト リニューアル');
  s.addAttribute(proj.id, 'start', formatDate(monday));
  s.addAttribute(proj.id, 'holidays', 'jp');
  s.addChild(proj.id, -1, '右の日付は duration / start / after / due 属性から自動で計算されます（★ はクリティカルパス）');

  const add = (text: string, attrs: Record<string, string>) => {
    const n = s.addChild(proj.id, -1, text);
    for (const [k, v] of Object.entries(attrs)) s.addAttribute(n.id, k, v);
    return n.id;
  };
  const kickoff = add('キックオフ', { duration: '0d' });
  s.setCompleted(kickoff, true);
  const design = add('デザイン', { duration: '3d', after: `[[${kickoff}]]` });
  const api = add('API 実装', { duration: '1w', after: `[[${design}]]` });
  const ui = add('画面実装', { duration: '4d', after: `[[${design}]]` });
  const review = add('法務レビュー', { duration: '5cd', after: `[[${design}]]` });
  const test = add('テスト', { duration: '2d', after: `[[${api}]], [[${ui}]]`, due: formatDate(monday + 10) });
  add('公開', { duration: '0d', after: `[[${test}]], [[${review}]]` });
  return proj.id;
}
