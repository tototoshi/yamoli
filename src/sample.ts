/*
 * Sample content, written in the current UI language: a small project broken
 * down like a WBS (phases > work packages > tasks) that shows dependencies
 * and scheduling at work, a system's architecture drawn as a diagram, and a
 * slide deck explaining the app. Dates are
 * relative to today so the samples never go stale.
 */
import { formatDate, today, weekday, type Day } from './calendar';
import { lang, t } from './i18n';
import type { OutlineStore } from './model';

const SAMPLE_PREFIXES = ['サンプル: ', 'Sample: '];

/** A sample under parentId, told apart by a field only it has (`start`, `direction`). */
const findSample = (s: OutlineStore, parentId: string, field: string) =>
  s.items(parentId).find((id) => SAMPLE_PREFIXES.some((p) => s.node(id).text.startsWith(p)) && s.field(id, field));

/** Append the sample project under parentId and return its id. */
export function addScheduleSample(s: OutlineStore, parentId: string, now: Day = today()): string {
  const monday = now + ((8 - weekday(now)) % 7); // today if Monday, else the next one
  const proj = s.addChild(parentId, -1, t('サンプル: Web サイト リニューアル', 'Sample: Website redesign'));
  s.addField(proj.id, 'views', 'gantt');
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

/** Append a web service's architecture under parentId, to be seen in the Diagram view, and return its id. */
export function addDiagramSample(s: OutlineStore, parentId: string): string {
  const sys = s.addChild(parentId, -1, t('サンプル: システム構成', 'Sample: System architecture'));
  s.addField(sys.id, 'views', 'diagram');
  s.addField(sys.id, 'direction', 'LR');
  s.addBlock(
    sys.id,
    'note',
    'markdown',
    t(
      '「図」に切り替えると構成図になります。\n\n' +
        '- 行が箱、`shape: frame` の行が子の行を囲む枠（枠でない行の子は箱の中に並ぶ）\n' +
        '- `to: [[API]] gRPC` のように属性に書いたリンクが矢印、後ろの語がラベル\n' +
        '- `shape` で形（actor / db / queue / external、枠の線は frame solid / frame none）、`color` で色、`icon` でアイコン\n' +
        '- `async:` に書いたリンクは点線、`both:` は両向き、`link:` は矢印なし\n' +
        '- `note:` に書いた説明は箱（枠なら名前の下）に文章で表示\n' +
        '- `direction: TB` で縦向き。箱をクリックするとその行を編集',
      'Switch to “Diagram” to see it drawn.\n\n' +
        '- Each row is a box; a row with `shape: frame` is a frame around the rows under it (other rows list theirs in the box)\n' +
        '- A link in a field, like `to: [[API]] gRPC`, is an arrow labelled with the words after it\n' +
        '- `shape` picks the shape (actor / db / queue / external; frame solid / frame none for a frame’s border), `color` the colour, `icon` an icon\n' +
        '- Links under `async:` are dashed, under `both:` two-way, under `link:` without arrows\n' +
        '- A `note:` shows in the box (under a frame’s name) as text\n' +
        '- `direction: TB` draws it top to bottom. Click a box to edit its row'
    )
  );
  const add = (parent: string, text: string, attrs: Record<string, string> = {}) => {
    const n = s.addChild(parent, -1, text);
    for (const [k, v] of Object.entries(attrs)) s.addField(n.id, k, v);
    return n.id;
  };
  const to = (id: string, label = '') => `[[${id}]]` + (label && ' ' + label);

  // Rows first, arrows after: an arrow needs the id of the row it points at.
  const user = add(sys.id, t('ユーザー', 'User'), { shape: 'actor' });
  const cdn = add(sys.id, 'CDN', { icon: 'globe' });
  const vpc = add(sys.id, 'AWS VPC', { shape: 'frame solid', icon: 'cloud' });
  const pub = add(vpc, t('パブリック', 'Public'), { shape: 'frame' });
  const alb = add(pub, t('ロードバランサー', 'Load balancer'));
  const app = add(vpc, t('アプリ', 'App'), { shape: 'frame' });
  const web = add(app, 'Web', { icon: 'browser', tech: 'Next.js' });
  const api = add(app, 'API', {
    icon: 'code',
    note: t('会員・注文・在庫を扱うバックエンド', 'The back end for members, orders and stock'),
    tech: 'Go',
    replicas: '3',
  });
  const worker = add(app, t('ワーカー', 'Worker'), {
    icon: 'gear',
    note: t('メール送信や集計など、時間のかかる処理', 'Slow work: sending email, totals'),
    tech: 'Go',
  });
  const data = add(vpc, t('データ', 'Data'), { shape: 'frame', note: t('毎晩バックアップ', 'Backed up nightly') });
  const db = add(data, t('データベース', 'Database'), { shape: 'db', tech: 'PostgreSQL 16' });
  const queue = add(data, t('ジョブキュー', 'Job queue'), { shape: 'queue', tech: 'SQS' });
  const pay = add(sys.id, t('決済', 'Payments'), { shape: 'external', tech: 'Stripe', color: 'purple' });
  const mail = add(sys.id, t('メール配信', 'Email'), { shape: 'external', icon: 'mail', tech: 'SendGrid' });

  s.addField(user, 'to', to(cdn, 'HTTPS'));
  s.addField(cdn, 'to', to(alb));
  s.addField(alb, 'to', to(web));
  s.addField(web, 'to', to(api, 'gRPC'));
  s.addField(api, 'to', [to(db, 'SQL'), to(pay, 'HTTPS')].join(', '));
  // `async` lines are dashed.
  s.addField(api, 'async', to(queue, t('投入', 'enqueue')));
  s.addField(worker, 'async', to(queue, t('取得', 'poll')));
  s.addField(worker, 'to', [to(db), to(mail, 'API')].join(', '));
  return sys.id;
}

/**
 * A slide deck explaining the app, written as an ordinary outline. The
 * scheduling slide embeds a project's Gantt chart (projectId, or a sample
 * project found or added beside the deck), and the diagram slide a sample
 * architecture's diagram, found or added the same way.
 */
export function addGuideSlides(s: OutlineStore, parentId: string, projectId?: string): string {
  const project = projectId ?? findSample(s, parentId, 'start') ?? addScheduleSample(s, parentId);
  const system = findSample(s, parentId, 'direction') ?? addDiagramSample(s, parentId);

  const deck = s.addChild(parentId, -1, t('Yamoli の使い方', 'Using Yamoli'));
  s.addField(deck.id, 'views', 'slides');
  s.addField(deck.id, 'subtitle', t('アウトライン × YAML × プロジェクト管理', 'Outlines × YAML × project planning'));
  s.addField(
    deck.id,
    'notes',
    t(
      '「スライド」表示で開くとプレゼンになります。← → でページ送り、F で全画面。',
      'Open it in the “Slides” view to present. ← → to page through, F for full screen.'
    )
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

  slide(
    t('基本操作', 'The basics'),
    { notes: t('行の編集はふつうのテキストエディタと同じ感覚です。', 'Editing a row works like any text editor.') },
    [
      [
        t('**Enter** で新しい行、**Tab / Shift+Tab** でインデント', '**Enter** for a new row, **Tab / Shift+Tab** to indent'),
        [t('Alt+Shift+↑↓ で行を移動、● をドラッグしても OK', 'Alt+Shift+↑↓ moves a row, or drag its ●')],
      ],
      [
        t('● をクリックすると、その項目に**ズームイン**', 'Click a ● to **zoom in** on that item'),
        [t('パンくずやブラウザの「戻る」でズームアウト', 'The breadcrumbs or the browser’s Back zoom out')],
      ],
      [
        t('● を右クリックで項目メニュー', 'Right-click a ● for the item menu'),
        [t('複製・削除・リンクをコピー・完了など', 'Duplicate, delete, copy link, complete …')],
      ],
      t('⌘/Ctrl+F で検索、⌘/Ctrl+Z で元に戻す', '⌘/Ctrl+F to search, ⌘/Ctrl+Z to undo'),
    ]
  );

  const yaml = slide(
    t('属性 = YAML', 'Fields = YAML'),
    {
      layout: 'two-column',
      notes: t(
        '左が書き方、右がアウトラインに書いた属性を YAML にしたものです。',
        'On the left how to write fields; on the right the same fields as YAML.'
      ),
    },
    [
      [
        t('行頭で `name: ` と打つと**属性**の行に', 'Type `name: ` at the start of a row for a **field**'),
        [t('値の先頭で Backspace で戻る', 'Backspace at the value’s start undoes it')],
      ],
      [
        t('値のない属性の下は入れ子に', 'A field without a value holds nested rows'),
        [t('子に属性 → オブジェクト', 'Fields below → an object'), t('子に普通の行 → リスト', 'Ordinary rows below → a list')],
      ],
      t('YAML の貼り付けもそのまま', 'Pasted YAML comes in as is'),
      t('属性で日程・スライドなどの振る舞いが変わる', 'Fields change what the app does: schedules, slides …'),
    ]
  );
  s.addBlock(
    yaml,
    'example',
    'code',
    'start: 2026-11-09\nduration: 3d\nbudget:\n  amount: 1200000\n  currency: JPY\nlinks:\n  - https://example.com'
  );

  slide(t('リンクと依存', 'Links and dependencies'), {}, [
    [
      t('`[[` で他の項目へのリンク', '`[[` links to another item'),
      [t('リンク先には「被リンク」として表示される', 'The target lists it under “Linked from”')],
    ],
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
    [
      t(
        '`start` / `duration` / `after` / `due` から日付を自動計算 — ★ はクリティカルパス',
        'Dates come from `start` / `duration` / `after` / `due` — ★ is the critical path'
      ),
    ]
  );

  slide(
    t('図', 'Diagrams'),
    {
      embed: `[[${system}]] diagram`,
      notes: t(
        'サンプルのシステム構成を図として埋め込んでいます。アウトラインの行と属性から描いています。',
        'The sample architecture, embedded as a diagram. It is drawn from the outline’s rows and fields.'
      ),
    },
    [
      t(
        '行が箱、`shape: frame` の行が枠、`to: [[…]]` が矢印 — 「図」ビューで開く',
        'Rows are boxes, rows with `shape: frame` frames, `to: [[…]]` arrows — open the Diagram view'
      ),
    ]
  );

  slide(t('ビュー', 'Views'), { layout: 'two-column' }, [
    [t('アウトライン', 'Outline'), [t('すべての編集はここで', 'Where all editing happens')]],
    [t('ガント', 'Gantt'), [t('日程を線表で', 'The schedule as a chart'), t('日付の列幅は切り替え可能', 'Adjustable day width')]],
    [t('図', 'Diagram'), [t('構成図・フロー図・マインドマップ', 'Architecture, flows, mind maps')]],
    [
      t('スライド', 'Slides'),
      [t('項目 = デッキ、子 = 1 枚ずつ', 'An item is a deck, each row under it a slide'), '`layout` / `notes` / `image` / `theme`'],
    ],
    ['YAML / JSON', [t('ズームした項目をデータとして', 'The zoomed item as data')]],
    [
      t('ビューを有効に', 'Turning views on'),
      [
        t('ガント・図・スライドは `views` 属性のある木だけ', 'Gantt, Diagram and Slides only where a `views` field is'),
        t('表示バーの + から追加', 'Add one from the + in the view bar'),
      ],
    ],
    [
      t('検索', 'Search'),
      [t('`status:進行中`、`budget.amount:1200000`', '`status:active`, `budget.amount:1200000`'), '`is:late` / `is:critical` / `is:done`'],
    ],
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
    {
      layout: 'center',
      notes: t('アウトラインに戻って、このデッキを自由に編集してみてください。', 'Go back to the outline and edit this deck as you like.'),
    },
    [t('「このスライドを編集」から中身を書き換えてみてください', 'Try “Edit this slide” and change it')]
  );
  return deck.id;
}
