/*
 * Sample content, written in the current UI language: a small project broken
 * down like a WBS (phases > work packages > tasks) that shows dependencies
 * and scheduling at work, a system's architecture and a data flow diagram
 * drawn as diagrams, a mind map, and a slide deck explaining the app. Dates
 * are relative to today so the samples never go stale.
 */
import { formatDate, today, weekday, type Day } from './calendar';
import { lang, t } from './i18n';
import type { OutlineStore } from './model';

const SAMPLE_PREFIXES = ['サンプル: ', 'Sample: '];

/** A sample under parentId, told apart by a field only it has (`start`, `direction`), or by its value (`views: mindmap`). */
const findSample = (s: OutlineStore, parentId: string, field: string, value?: string) =>
  s
    .items(parentId)
    .find(
      (id) =>
        SAMPLE_PREFIXES.some((p) => s.node(id).text.startsWith(p)) &&
        s.field(id, field) &&
        (value === undefined || s.fieldValue(id, field) === value)
    );

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
  add(plan, t('要件定義', 'Requirements'), { duration: '3d', after: after(kickoff) });

  // A phase-level dependency: everything in design waits for planning.
  const design = add(proj.id, t('2. 設計', '2. Design'), { after: after(plan) });
  const ia = add(design, t('情報設計', 'Information architecture'), { duration: '2d' });
  const visual = add(design, t('デザイン', 'Visual design'));
  const wire = add(visual, t('ワイヤーフレーム', 'Wireframes'), { duration: '2d', after: after(ia) });
  const look = add(visual, t('ビジュアルデザイン', 'Mockups'), { duration: '3d', after: after(wire) });
  const apiDesign = add(design, t('API 設計', 'API design'), { duration: '2d', after: after(ia) });

  const build = add(proj.id, t('3. 実装', '3. Build'));
  const back = add(build, t('バックエンド', 'Back end'));
  const api = add(back, t('API 実装', 'API'), { duration: '1w', after: after(apiDesign) });
  const migrate = add(back, t('データ移行', 'Data migration'), { duration: '3d', after: after(api) });
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

/** Rows with fields under parent, for the samples. */
function adder(s: OutlineStore) {
  return (parent: string, text: string, attrs: Record<string, string> = {}) => {
    const n = s.addChild(parent, -1, text);
    for (const [k, v] of Object.entries(attrs)) s.addField(n.id, k, v);
    return n.id;
  };
}
const to = (id: string, label = '') => `[[${id}]]` + (label && ' ' + label);

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
      '「図」に切り替えると構成図になります。図の上でもそのまま編集できます。\n\n' +
        '**書き方**\n\n' +
        '- 行が箱。`to: [[API]] gRPC` のように属性に書いたリンクが矢印で、後ろの語がラベル\n' +
        '- `shape: frame` の行は下の行を囲む枠、`shape: container` は中に箱を並べる箱（枠でも入れ物でもない行の下の行は、箱の中に箇条書き）\n' +
        '- 枠に `layout: row`（横一列）/ `column`（縦一列）/ `grid`（格子）で、中の箱をアウトラインの順に並べる\n' +
        '- `shape`（actor / db / queue / external / process / store）・`color`・`icon` で見た目、`note` で説明\n' +
        '- `async:` に書いたリンクは破線、`both:` は両矢印、`link:` は線だけ。`direction: TB` で縦向き\n\n' +
        '**図の上での編集**\n\n' +
        '- 箱を選んでそのまま入力すると名前が変わる。右クリックで名前・説明・形・色\n' +
        '- 箱の端の丸から別の箱へドラッグで矢印。矢印を選ぶと両端の丸でつなぎ変え、右クリックで種類やラベル\n' +
        '- 箱を枠や箱の上にドラッグすると中へ移る。Delete で削除、⌘Z で元に戻す',
      'Switch to “Diagram” to see it drawn. You can edit it there too.\n\n' +
        '**Writing it**\n\n' +
        '- Each row is a box. A link in a field, like `to: [[API]] gRPC`, is an arrow labelled with the words after it\n' +
        '- A row with `shape: frame` is a frame around the rows under it; `shape: container` a box with boxes inside (under any other row, the rows are listed in its box)\n' +
        '- `layout: row` / `column` / `grid` on a frame lines up the boxes in it in outline order\n' +
        '- `shape` (actor / db / queue / external / process / store), `color` and `icon` for the look, `note` for a description\n' +
        '- Links under `async:` are dashed, under `both:` two-way, under `link:` plain lines. `direction: TB` draws it top to bottom\n\n' +
        '**Editing on the diagram**\n\n' +
        '- Select a box and type to rename it; right-click for its name, description, shape and colour\n' +
        '- Drag from the dot on a box to another for an arrow. A selected arrow’s end dots join it elsewhere; right-click it for its kind and label\n' +
        '- Drag a box onto a frame or a box to move it inside. Delete removes, ⌘Z undoes'
    )
  );
  const add = adder(s);

  // Rows first, arrows after: an arrow needs the id of the row it points at.
  const user = add(sys.id, t('ユーザー', 'User'), { shape: 'actor' });
  const cdn = add(sys.id, 'CDN', { icon: 'globe' });
  const vpc = add(sys.id, 'AWS VPC', { shape: 'frame solid', icon: 'cloud' });
  const pub = add(vpc, t('パブリック', 'Public'), { shape: 'frame' });
  const alb = add(pub, t('ロードバランサー', 'Load balancer'));
  const app = add(vpc, t('アプリ', 'App'), { shape: 'frame', layout: 'row' });
  const web = add(app, 'Web', { icon: 'browser', tech: 'Next.js' });
  // A box holding boxes: the API's parts.
  const api = add(app, 'API', {
    shape: 'container',
    icon: 'code',
    note: t('Go、3 台構成', 'Go, three instances'),
  });
  const members = add(api, t('会員', 'Members'));
  const orders = add(api, t('注文', 'Orders'));
  const stock = add(api, t('在庫', 'Stock'));
  const worker = add(app, t('ワーカー', 'Worker'), {
    icon: 'gear',
    note: t('メール送信や集計など、時間のかかる処理', 'Slow work: sending email, totals'),
    tech: 'Go',
  });
  const data = add(vpc, t('データ', 'Data'), { shape: 'frame', layout: 'column', note: t('毎晩バックアップ', 'Backed up nightly') });
  const db = add(data, t('データベース', 'Database'), { shape: 'db', tech: 'PostgreSQL 16' });
  const cache = add(data, t('キャッシュ', 'Cache'), { shape: 'db', tech: 'Redis' });
  const queue = add(data, t('ジョブキュー', 'Job queue'), { shape: 'queue', tech: 'SQS' });
  const pay = add(sys.id, t('決済', 'Payments'), { shape: 'external', tech: 'Stripe', color: 'purple' });
  const mail = add(sys.id, t('メール配信', 'Email'), { shape: 'external', icon: 'mail', tech: 'SendGrid' });

  s.addField(user, 'to', to(cdn, 'HTTPS'));
  s.addField(cdn, 'to', to(alb));
  s.addField(alb, 'to', to(web));
  s.addField(web, 'to', to(api, 'gRPC'));
  s.addField(members, 'to', to(db));
  s.addField(orders, 'to', [to(db, 'SQL'), to(pay)].join(', '));
  s.addField(stock, 'to', to(cache));
  // `async` lines are dashed.
  s.addField(orders, 'async', to(queue, t('投入', 'enqueue')));
  s.addField(worker, 'async', to(queue, t('取得', 'poll')));
  s.addField(worker, 'to', to(mail, 'API'));
  return sys.id;
}

/** Append an order process as a data flow diagram under parentId, in the Diagram view, and return its id. */
export function addDfdSample(s: OutlineStore, parentId: string): string {
  const dfd = s.addChild(parentId, -1, t('サンプル: 注文処理の DFD', 'Sample: Order handling, as a data flow diagram'));
  s.addField(dfd.id, 'views', 'diagram');
  s.addBlock(
    dfd.id,
    'note',
    'markdown',
    t(
      '「図」に切り替えるとデータフロー図になります。\n\n' +
        '- 外部エンティティはふつうの箱、プロセスは `shape: process`（楕円）、データストアは `shape: store`（2 本線）\n' +
        '- データフローは `to: [[1.0 注文受付]] 注文` のような矢印。後ろの語がデータの名前\n' +
        '- 矢印を選んでそのまま入力すると、データの名前を書き換えられる',
      'Switch to “Diagram” to see it as a data flow diagram.\n\n' +
        '- External entities are plain boxes, processes `shape: process` (ellipses), data stores `shape: store` (two lines)\n' +
        '- Data flows are arrows like `to: [[1.0 Take orders]] order`, the words after the link naming the data\n' +
        '- Select an arrow and type to rename its data'
    )
  );
  const add = adder(s);
  const customer = add(dfd.id, t('顧客', 'Customer'));
  const take = add(dfd.id, t('1.0 注文受付', '1.0 Take orders'), { shape: 'process' });
  const orders = add(dfd.id, t('D1 注文', 'D1 Orders'), { shape: 'store' });
  const allocate = add(dfd.id, t('2.0 在庫引当', '2.0 Allocate stock'), { shape: 'process' });
  const stock = add(dfd.id, t('D2 在庫', 'D2 Stock'), { shape: 'store' });
  const ship = add(dfd.id, t('3.0 出荷指示', '3.0 Order shipping'), { shape: 'process' });
  const warehouse = add(dfd.id, t('倉庫', 'Warehouse'));

  s.addField(customer, 'to', to(take, t('注文', 'order')));
  s.addField(take, 'to', to(orders, t('注文データ', 'order details')));
  s.addField(orders, 'to', to(allocate, t('未引当の注文', 'open orders')));
  s.addField(allocate, 'to', to(ship, t('引当済みの注文', 'allocated orders')));
  // Read and written both ways: one two-headed line.
  s.addField(allocate, 'both', to(stock, t('在庫数', 'stock levels')));
  s.addField(ship, 'to', [to(warehouse, t('出荷指示', 'shipping order')), to(customer, t('出荷通知', 'shipping notice'))].join(', '));
  return dfd.id;
}

/** Append the questions of a redesign as a mind map under parentId, in the Mind map view, and return its id. */
export function addMindMapSample(s: OutlineStore, parentId: string): string {
  const map = s.addChild(parentId, -1, t('サンプル: リニューアルの論点', 'Sample: Redesign, the questions'));
  s.addField(map.id, 'views', 'mindmap');
  // No note block here: the root is drawn, and a note would fill its box. The view's hint line tells the keys.
  const tree: [string, (string | [string, string[]])[]][] = [
    [t('目的', 'Goals'), [t('問い合わせを減らす', 'Fewer support requests'), t('スマホで使いやすく', 'Easy on phones')]],
    [
      t('課題', 'Problems'),
      [
        [t('表示が遅い', 'Slow pages'), [t('画像が重い', 'Heavy images'), t('サーバーが 1 台', 'A single server')]],
        t('情報が探しにくい', 'Hard to find things'),
      ],
    ],
    [
      t('打ち手', 'Ideas'),
      [t('CDN と画像の最適化', 'A CDN, lighter images'), t('情報設計の見直し', 'Rework the information architecture')],
    ],
    [
      t('リスク', 'Risks'),
      [t('公開日がずれる', 'The launch slips'), t('URL が変わり検索順位が落ちる', 'Changed URLs lose search ranking')],
    ],
  ];
  for (const [branch, leaves] of tree) {
    const b = s.addChild(map.id, -1, branch).id;
    for (const leaf of leaves) {
      const [text, under] = typeof leaf === 'string' ? [leaf, []] : leaf;
      const l = s.addChild(b, -1, text).id;
      for (const u of under) s.addChild(l, -1, u);
    }
  }
  return map.id;
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
  const map = findSample(s, parentId, 'views', 'mindmap') ?? addMindMapSample(s, parentId);

  const deck = s.addChild(parentId, -1, t('Yamoli の使い方', 'Using Yamoli'));
  s.addField(deck.id, 'views', 'slides');
  s.addField(deck.id, 'subtitle', t('アウトライン × YAML × プロジェクト管理', 'Outlines × YAML × project planning'));
  s.addField(
    deck.id,
    'notes',
    t(
      '「スライド」表示で開くとプレゼンになります。← → でページ送り、F で全画面、PDF ボタンで書き出し。',
      'Open it in the “Slides” view to present. ← → to page through, F for full screen, the PDF button to export.'
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
      [
        t('⌘/Ctrl+F で検索、⌘/Ctrl+Z で元に戻す', '⌘/Ctrl+F to search, ⌘/Ctrl+Z to undo'),
        [t('`status:進行中`、`is:late` / `is:done` で属性や状態も', '`status:active`, `is:late` / `is:done` for fields and states')],
      ],
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

  slide(t('図の上で編集', 'Editing on the diagram'), {}, [
    [
      t('箱を選んでそのまま入力すると名前が変わる', 'Select a box and type to rename it'),
      [t('右クリックで名前・説明・形・色', 'Right-click for its name, description, shape and colour')],
    ],
    [
      t('箱の端の丸から別の箱へドラッグで矢印', 'Drag from the dot on a box to another for an arrow'),
      [
        t('矢印を選んで入力でラベル、両端の丸でつなぎ変え', 'Select an arrow and type its label; its end dots join it elsewhere'),
        t('右クリックで実線・破線・両矢印・線だけ', 'Right-click for solid, dashed, two-way or a plain line'),
      ],
    ],
    t('箱を枠や箱の上にドラッグすると中へ移る', 'Drag a box onto a frame or a box to move it inside'),
    t('`shape: process` と `shape: store` で DFD も', '`shape: process` and `shape: store` for data flow diagrams'),
  ]);

  slide(
    t('マインドマップ', 'Mind maps'),
    {
      embed: `[[${map}]] mindmap`,
      notes: t(
        '行の入れ子をそのまま枝分かれで描きます。マインドマップのビューでは Tab で子、Enter で次の行を足せます。',
        'The nested rows, drawn as branches. In the Mind map view, Tab adds a row under, Enter one after.'
      ),
    },
    [
      t(
        'Tab で子、Enter で次、矢印キーで移動 — 「マインドマップ」ビューで開く',
        'Tab for a child, Enter for the next, arrows to move — open the Mind map view'
      ),
    ]
  );

  // With no link, `embed: diagram` draws the slide's own rows.
  const flow = slide(
    t('スライドの中で図を描く', 'Diagrams drawn on the slide'),
    {
      embed: 'diagram',
      notes: t(
        '`embed: diagram` だけ書くと、スライドの下の行がそのまま図になります。',
        'Write just `embed: diagram`, and the rows under the slide are drawn as the diagram.'
      ),
    },
    [
      t('アウトラインで書く', 'Write it as an outline'),
      t('図やガントで見る', 'See it as a diagram or a chart'),
      t('スライドで見せる', 'Show it as slides'),
    ]
  );
  const [write, see, show] = s.items(flow);
  s.addField(write, 'to', `[[${see}]]`);
  s.addField(see, 'to', `[[${show}]]`);
  s.addField(show, 'shape', 'actor');

  slide(t('ビュー', 'Views'), { layout: 'two-column' }, [
    [t('アウトライン', 'Outline'), [t('すべての編集はここで', 'Where all editing happens')]],
    [t('ガント', 'Gantt'), [t('日程を線表で', 'The schedule as a chart'), t('日付の列幅は切り替え可能', 'Adjustable day width')]],
    [t('図', 'Diagram'), [t('構成図・フロー図・DFD', 'Architecture, flows, data flow diagrams')]],
    [t('マインドマップ', 'Mind map'), [t('入れ子を枝分かれで', 'Nesting as branches')]],
    [
      t('スライド', 'Slides'),
      [
        t('項目 = デッキ、子 = 1 枚ずつ', 'An item is a deck, each row under it a slide'),
        '`layout` / `notes` / `image` / `theme` / `embed`',
        t('PDF ボタンで全ページを書き出し', 'The PDF button exports every slide'),
      ],
    ],
    ['YAML / JSON', [t('ズームした項目をデータとして', 'The zoomed item as data')]],
    [
      t('ビューを有効に', 'Turning views on'),
      [
        t(
          'ガント・図・マインドマップ・スライドは `views` 属性のある木だけ',
          'Gantt, Diagram, Mind map and Slides only where a `views` field is'
        ),
        t('表示バーの + から追加', 'Add one from the + in the view bar'),
      ],
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
