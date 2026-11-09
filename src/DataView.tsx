/*
 * The zoomed item as YAML, JSON or a plain Markdown list (see serialize.ts),
 * read-only, for looking at the data the outline holds and copying it out.
 */
import { useState } from 'preact/hooks';
import { useCtl } from './context';
import { t } from './i18n';
import { toMarkdownList, toValue, toYaml } from './serialize';

export function DataView({ format }: { format: 'yaml' | 'json' | 'text' }) {
  const ctl = useCtl();
  const text =
    format === 'text'
      ? toMarkdownList(ctl.store, ctl.zoomId, (id) => ctl.shownChildren(id))
      : format === 'yaml'
        ? toYaml(toValue(ctl.store, ctl.zoomId))
        : JSON.stringify(toValue(ctl.store, ctl.zoomId), null, 2) + '\n';
  const [copied, setCopied] = useState(false);

  const copy = () =>
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });

  return (
    <section class="serial-view">
      <div class="serial-view-tools">
        <button class="mini" onClick={copy}>
          {copied ? t('コピーしました', 'Copied') : t('コピー', 'Copy')}
        </button>
        <span class="muted">{t('読み取り専用 — 編集はアウトラインで', 'Read-only — edit in the outline')}</span>
      </div>
      <pre class={'serial-view-text fmt-' + format}>{text}</pre>
    </section>
  );
}
