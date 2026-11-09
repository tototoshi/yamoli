/*
 * The zoomed item as YAML or JSON (see serialize.ts), read-only, for looking
 * at the data the outline holds and copying it out.
 */
import { useState } from 'preact/hooks';
import { useCtl } from './context';
import { t } from './i18n';
import { toValue, toYaml } from './serialize';

export function DataView({ format }: { format: 'yaml' | 'json' }) {
  const ctl = useCtl();
  const value = toValue(ctl.store, ctl.zoomId);
  const text = format === 'yaml' ? toYaml(value) : JSON.stringify(value, null, 2) + '\n';
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
