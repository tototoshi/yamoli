/*
 * Sample content, written in the current UI language: a small project broken
 * down like a WBS (phases > work packages > tasks) that shows dependencies
 * and scheduling at work, and a slide deck explaining the app. Dates are
 * relative to today so the samples never go stale.
 */
import { formatDate, today, weekday, type Day } from './calendar';
import { lang, t } from './i18n';
import type { OutlineStore } from './model';

const SAMPLE_PREFIXES = ['サンプル: ', 'Sample: '];

/** Append the sample project under parentId and return its id. */
export function addScheduleSample(s: OutlineStore, parentId: string, now: Day = today()): string {
  const monday = now + ((8 - weekday(now)) % 7); // today if Monday, else the next one
  const proj = s.addChild(parentId, -1, t('サンプル: Web サイト リニューアル', 'Sample: Website redesign'));
  s.addField(proj.id, 'start', formatDate(monday));
  if (lang() === 'ja') s.addField(proj.id, 'holidays', 'jp');
  // Notes go in a block, so every row stays a task.
  s.addBlock(
    proj.id,
    'note',
    'markdown',
    t(
      '日付は `duration` / `start` / `after` / `due` 属性から自動で計算されます。\n\n' +
        '- ★ はクリティカルパス（遅れると全体が遅れる作業）\n' +
        '- 「ガント」に切り替えると線表で見られます\n' +
        '- 説明やメモは行ではなくブロック（Alt+D）に書くと、作業と混ざりません',
      'Dates are worked out from the `duration` / `start` / `after` / `due` fields.\n\n' +
        '- ★ marks the critical path (work whose delay delays everything)\n' +
        '- Switch to “Gantt” to see it as a chart\n' +
        '- Notes go in a block (Alt+D) rather than a row, so they don’t mix with the tasks'
    )
  );

  const add = (parent: string, text: string, attrs: Record<string, string> = {}) => {
    const n = s.addChild(parent, -1, text);
    for (const [k, v] of Object.entries(attrs)) s.addField(n.id, k, v);
    return n.id;
  };
  const after = (...ids: string[]) => ids.map((id) => `[[${id}]]`).join(', ');

  const plan = add(proj.id, t('1. 企画', '1. Planning'));
  const kickoff = add(plan, t('キックオフ', 'Kickoff'), { duration: '0d' });
  s.setCompleted(kickoff, true);
  add(plan, t('要件定義', 'Requirements'), { duration: '3d', after: '^' }); // the item just above

  // A phase-level dependency: everything in design waits for planning.
  const design = add(proj.id, t('2. 設計', '2. Design'), { after: after(plan) });
  const ia = add(design, t('情報設計', 'Information architecture'), { duration: '2d' });
  // Sequential: each child comes after the one above it, no `after` needed.
  const visual = add(design, t('デザイン', 'Visual design'), { sequential: 'true' });
  add(visual, t('ワイヤーフレーム', 'Wireframes'), { duration: '2d', after: after(ia) });
  const look = add(visual, t('ビジュアルデザイン', 'Mockups'), { duration: '3d' });
  const apiDesign = add(design, t('API 設計', 'API design'), { duration: '2d', after: after(ia) });

  const build = add(proj.id, t('3. 実装', '3. Build'));
  const back = add(build, t('バックエンド', 'Back end'), { sequential: 'true' });
  const api = add(back, t('API 実装', 'API'), { duration: '1w', after: after(apiDesign) });
  const migrate = add(back, t('データ移行', 'Data migration'), { duration: '3d' });
  const front = add(build, t('フロントエンド', 'Front end'));
  const screens = add(front, t('画面実装', 'Pages'), { duration: '1w', after: after(look) });
  const wiring = add(front, t('API 連携', 'Connect to the API'), { duration: '2d', after: after(screens, api) });

  const ship = add(proj.id, t('4. 検証・公開', '4. Test and launch'));
  const legal = add(ship, t('法務レビュー', 'Legal review'), { duration: '5cd', after: after(look) });
  const test = add(ship, t('総合テスト', 'System test'), { duration: '3d', after: after(wiring, migrate), due: formatDate(monday + 25) });
  const release = add(ship, t('公開', 'Launch'), { duration: '0d', after: after(test, legal) });

  const ops = add(proj.id, t('5. 運用', '5. Operations'), { after: after(release) });
  add(ops, t('監視・改善', 'Monitoring and fixes'), { duration: '1w' });
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
    s.items(parentId).find((id) => SAMPLE_PREFIXES.some((p) => s.node(id).text.startsWith(p))) ??
    addScheduleSample(s, parentId);

  const deck = s.addChild(parentId, -1, t('Yamoli の使い方', 'Using Yamoli'));
  s.addField(deck.id, 'subtitle', t('アウトライン × YAML × プロジェクト管理', 'Outlines × YAML × project planning'));
  s.addField(
    deck.id,
    'notes',
    t('「スライド」表示で開くとプレゼンになります。← → でページ送り、F で全画面。', 'Open it in the “Slides” view to present. ← → to page through, F for full screen.')
  );

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

  slide(t('基本操作', 'The basics'), { notes: t('行の編集はふつうのテキストエディタと同じ感覚です。', 'Editing a row works like any text editor.') }, [
    [
      t('**Enter** で新しい行、**Tab / Shift+Tab** でインデント', '**Enter** for a new row, **Tab / Shift+Tab** to indent'),
      [t('Alt+Shift+↑↓ で行を移動、● をドラッグしても OK', 'Alt+Shift+↑↓ moves a row, or drag its ●')],
    ],
    [
      t('● をクリックすると、その項目に**ズームイン**', 'Click a ● to **zoom in** on that item'),
      [t('パンくずやブラウザの「戻る」でズームアウト', 'The breadcrumbs or the browser’s Back zoom out')],
    ],
    [t('● を右クリックで項目メニュー', 'Right-click a ● for the item menu'), [t('複製・削除・リンクをコピー・完了など', 'Duplicate, delete, copy link, complete …')]],
    t('⌘/Ctrl+F で検索、⌘/Ctrl+Z で元に戻す', '⌘/Ctrl+F to search, ⌘/Ctrl+Z to undo'),
  ]);

  const yaml = slide(
    t('属性 = YAML', 'Fields = YAML'),
    { layout: 'two-column', notes: t('左が書き方、右がアウトラインに書いた属性を YAML にしたものです。', 'On the left how to write fields; on the right the same fields as YAML.') },
    [
      [t('行頭で `name: ` と打つと**属性**の行に', 'Type `name: ` at the start of a row for a **field**'), [t('値の先頭で Backspace で戻る', 'Backspace at the value’s start undoes it')]],
      [
        t('値のない属性の下は入れ子に', 'A field without a value holds nested rows'),
        [t('子に属性 → オブジェクト', 'Fields below → an object'), t('子に普通の行 → リスト', 'Ordinary rows below → a list')],
      ],
      t('YAML の貼り付けもそのまま', 'Pasted YAML comes in as is'),
      t('属性で日程・スライドなどの振る舞いが変わる', 'Fields change what the app does: schedules, slides …'),
    ]
  );
  s.addBlock(yaml, 'example', 'code', 'start: 2026-11-09\nduration: 3d\nbudget:\n  amount: 1200000\n  currency: JPY\nlinks:\n  - https://example.com');

  slide(t('リンクと依存', 'Links and dependencies'), {}, [
    [t('`[[` で他の項目へのリンク', '`[[` links to another item'), [t('リンク先には「被リンク」として表示される', 'The target lists it under “Linked from”')]],
    [
      t('`after: [[作業]]` で依存関係', '`after: [[task]]` for a dependency'),
      [
        t('先行する作業が終わってから始まる', 'It starts once the other task is done'),
        t('is:ready / is:blocked で着手可・待ちを検索', 'is:ready / is:blocked find what can start and what waits'),
      ],
    ],
    [
      t('`after: ^` ですぐ上の作業の後', '`after: ^` for the task just above'),
      [t('親に `sequential: true` で、子が上から順番に', '`sequential: true` on a parent runs its children in order')],
    ],
    t('依存が循環していると ⚠ で知らせる', 'A dependency cycle is flagged with ⚠'),
  ]);

  slide(
    t('日程計算', 'Scheduling'),
    {
      embed: `[[${project}]]`,
      notes: t(
        'サンプルプロジェクトのガントをそのまま埋め込んでいます。元の項目を編集するとここも変わります。',
        'This is the sample project’s Gantt chart, embedded. Edit the project and it changes here too.'
      ),
    },
    [t('`start` / `duration` / `after` / `due` から日付を自動計算 — ★ はクリティカルパス', 'Dates come from `start` / `duration` / `after` / `due` — ★ is the critical path')]
  );

  slide(t('ビュー', 'Views'), { layout: 'two-column' }, [
    [t('アウトライン', 'Outline'), [t('すべての編集はここで', 'Where all editing happens')]],
    [t('ガント', 'Gantt'), [t('日程を線表で', 'The schedule as a chart'), t('日付の列幅は切り替え可能', 'Adjustable day width')]],
    [t('スライド', 'Slides'), [t('項目 = デッキ、子 = 1 枚ずつ', 'An item is a deck, each row under it a slide'), '`layout` / `notes` / `image` / `theme`']],
    ['YAML / JSON', [t('ズームした項目をデータとして', 'The zoomed item as data')]],
    [t('検索', 'Search'), [t('`status:進行中`、`budget.amount:1200000`', '`status:active`, `budget.amount:1200000`'), '`is:late` / `is:critical` / `is:done`']],
  ]);

  slide(t('保存', 'Saving'), {}, [
    [
      t('開発サーバーでは `~/yamoli/data.json` に保存', 'The dev server saves to `~/yamoli/data.json`'),
      [t('毎日のバックアップは `backups/` に 30 日分', 'Daily backups in `backups/`, 30 days')],
    ],
    t('別のタブや外部で変更されたら、読み込むか上書きするか選べる', 'If the file changes elsewhere, choose to load it or keep yours'),
    t('サーバーがないときはブラウザ（localStorage）に保存', 'Without a server, the outline is saved in the browser (localStorage)'),
  ]);

  slide(
    t('このスライド自体がアウトライン', 'These slides are an outline too'),
    { layout: 'center', notes: t('アウトラインに戻って、このデッキを自由に編集してみてください。', 'Go back to the outline and edit this deck as you like.') },
    [t('「このスライドを編集」から中身を書き換えてみてください', 'Try “Edit this slide” and change it')]
  );
  return deck.id;
}
