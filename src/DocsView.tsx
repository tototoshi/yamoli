/*
 * The usage guide (docs/guide.ja.md, docs/guide.en.md) in the interface's
 * language, opened from the ? menu at #/docs. A contents list at the side
 * scrolls to each section; the page's own hash stays #/docs, since the app
 * routes on the hash.
 */
import { useMemo } from 'preact/hooks';
import guideEn from '../docs/guide.en.md?raw';
import guideJa from '../docs/guide.ja.md?raw';
import { renderFormat } from './formats';
import { lang, t } from './i18n';

/** The guide's section headings (## and ###), in order, outside code blocks. */
export function headings(src: string): { level: 2 | 3; text: string }[] {
  const out: { level: 2 | 3; text: string }[] = [];
  let code = false;
  for (const line of src.split('\n')) {
    if (line.startsWith('```')) code = !code;
    const m = !code && line.match(/^(##|###) (.+)$/);
    if (m) out.push({ level: m[1].length as 2 | 3, text: m[2].replace(/[`*]/g, '') });
  }
  return out;
}

export function DocsView() {
  const src = lang() === 'en' ? guideEn : guideJa;
  const { html, toc } = useMemo(() => {
    let i = 0;
    // Headings numbered in order, for the contents list to scroll to.
    const html = renderFormat('markdown', src).replace(/<h([23])>/g, (_, level) => `<h${level} id="doc-${i++}">`);
    return { html, toc: headings(src) };
  }, [src]);

  return (
    <div class="docs">
      <nav class="docs-toc" aria-label={t('目次', 'Contents')}>
        <a href="#/" class="docs-back">
          ← {t('アウトラインに戻る', 'Back to the outline')}
        </a>
        {toc.map((h, i) => (
          <button key={i} class={'docs-toc-item level-' + h.level} onClick={() => document.getElementById(`doc-${i}`)?.scrollIntoView({ behavior: 'smooth' })}>
            {h.text}
          </button>
        ))}
      </nav>
      <article class="docs-body" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
