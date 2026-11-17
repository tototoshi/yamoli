import { t } from './i18n';
import { nodeLabel } from './links';
import { blockers, dependencies, dependents, depStatus, missingDependencies } from './deps';
import { useCtl } from './context';
import { shortDate, today } from './calendar';
import { schedTooltip } from './gantt';
import { ownViews, viewName, type DrawnView } from './views';

// ================================================================ views

/** A small picture of each drawn view, on a 12×12 grid. */
const VIEW_PICTURES: Record<DrawnView, string> = {
  doc: 'M2.5 1.5h5l2 2v7h-7zM4 5h4M4 7h4M4 9h2.5',
  gantt: 'M2 3h5M4 6h6M3 9h4',
  diagram: 'M1.5 2.5h4v3h-4zM6.5 6.5h4v3h-4zM3.5 5.5v2.5h3',
  mindmap: 'M5 6h2M7 6 9.5 2.5M7 6h3M7 6l2.5 3.5M1.5 4.5h3.5v3H1.5z',
  slides: 'M1.5 2.5h9v6h-9zM6 8.5V10M4 10.5h4',
};

/** The views an item's own `views` field turns on, each opening the item in it. */
export function ViewBadges({ id }: { id: string }) {
  const ctl = useCtl();
  return (
    <>
      {ownViews(ctl.store, id).map((view) => (
        <a
          key={view}
          class="view-badge"
          href={ctl.hashFor(id, view)}
          title={t(`${viewName(view)}で開く`, `Open as ${viewName(view).toLowerCase()}`)}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d={VIEW_PICTURES[view]} />
          </svg>
          {viewName(view)}
        </a>
      ))}
    </>
  );
}

// ================================================================ dependencies

/** Ready / waiting / cycle marker for open rows that have dependencies. */
export function DepBadge({ id }: { id: string }) {
  const ctl = useCtl();
  const { store } = ctl;
  const status = depStatus(store, id, ctl.cycles);
  const missing = missingDependencies(store, id);
  const broken = missing.length > 0 && !store.node(id).completed && (
    <span
      class="dep-badge cycle"
      title={t(
        'after のリンク先が見つかりません（削除された？）。この依存は日程に効いていません',
        'An item in `after` is gone (deleted?), so it no longer holds this up'
      )}
    >
      ⚠ {t('依存先なし', 'Missing')} {missing.length}
    </span>
  );
  if (status === 'none' || (store.node(id).completed && status !== 'cycle')) return broken || null;
  if (broken) return broken;
  if (status === 'ready') {
    return (
      <span class="dep-badge ready" title={t('前提がすべて完了しています', 'Everything it waits for is done')}>
        {t('着手可', 'Ready')}
      </span>
    );
  }
  if (status === 'cycle') {
    return (
      <span class="dep-badge cycle" title={t('依存関係が循環しています', 'Dependency cycle')}>
        {t('循環', 'Cycle')}
      </span>
    );
  }
  const waiting = blockers(store, id);
  return (
    <span
      class="dep-badge blocked"
      title={t('待っている: ', 'Waiting for: ') + waiting.map((w) => nodeLabel(store, w)).join(t('、', ', '))}
    >
      {t('待ち', 'Waiting')} {waiting.length}
    </span>
  );
}

export function DependencyPanel({ id }: { id: string }) {
  const ctl = useCtl();
  const { store } = ctl;
  const before = dependencies(store, id);
  const after = dependents(store, id);
  if (!before.length && !after.length) return null;
  const chip = (d: string) => (
    <a key={d} class={'ref' + (store.node(d).completed ? ' done' : '')} href={ctl.hashFor(d)}>
      {nodeLabel(store, d)}
    </a>
  );
  return (
    <div class="deps">
      {before.length > 0 && (
        <div class="deps-row">
          <span class="deps-title">{t('前提', 'After')}</span>
          {before.map(chip)}
          <DepBadge id={id} />
        </div>
      )}
      {after.length > 0 && (
        <div class="deps-row">
          <span class="deps-title">{t('後続', 'Before')}</span>
          {after.map(chip)}
        </div>
      )}
    </div>
  );
}

// ================================================================ schedule

/** Computed dates next to a row: "11/10 → 11/12", "◆ 11/24", late / critical marks. */
export function SchedLabel({ id, header }: { id: string; header?: boolean }) {
  const { schedule, store } = useCtl();
  const invalid = schedule.invalid.get(id);
  const bad = invalid && (
    <span class="sched invalid" title={t('この値を解釈できません', 'Can’t read this value')}>
      ⚠ {invalid}
    </span>
  );
  if (schedule.unscheduled.has(id)) {
    return (
      <>
        <span
          class="sched unscheduled"
          title={t(
            'start がこの行にも親にもなく、日程を計算できる依存もありません',
            'No start on this row or above it, and no scheduled dependency'
          )}
        >
          {t('開始日未設定', 'No start date')}
        </span>
        {bad}
      </>
    );
  }
  const s = schedule.byId.get(id);
  if (!s) return bad || null;
  const now = today();
  const done = store.node(id).completed;
  const span = s.end - s.start + 1;
  const range = s.kind === 'milestone' ? `◆ ${shortDate(s.start, now)}` : `${shortDate(s.start, now)} → ${shortDate(s.end, now)}`;
  const tip = schedTooltip(s);
  let cls = 'sched ' + s.kind;
  if (s.critical && s.kind !== 'summary') cls += ' critical';
  if (header) cls += ' header';
  return (
    <>
      <span class={cls} title={tip}>
        {s.critical && s.kind !== 'summary' && <span class="crit">★</span>}
        {range}
        {s.kind === 'summary' && <span class="span">{t(`${span}日`, `${span}d`)}</span>}
        {s.delayed && <span class="delayed">↷</span>}
        {s.late > 0 && !done && <span class="late">{t(`${s.late}日超過`, `${s.late}d late`)}</span>}
      </span>
      {bad}
    </>
  );
}
