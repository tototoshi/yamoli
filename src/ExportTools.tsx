/*
 * Buttons that save a drawing (the diagram, the Gantt chart) as an SVG or PNG
 * file, or copy it as an image to paste into documents.
 */
import { useCtl } from './context';
import { fileName, saveFile, svgToPng } from './exportImage';
import { t } from './i18n';

/** A drawing ready to save: a standalone SVG and its size. */
export interface Drawing {
  svg: string;
  width: number;
  height: number;
}

export function ExportTools({ drawing, name, class: cls }: { drawing: () => Drawing; name: string; class?: string }) {
  const ctl = useCtl();
  const fail = () => ctl.showToast(t('画像を作れませんでした', 'Couldn’t make the image'));
  const png = () => {
    const { svg, width, height } = drawing();
    return svgToPng(svg, width, height);
  };
  const copy = () => {
    try {
      // The PNG goes in as a promise so the copy stays within the click (Safari asks for that).
      navigator.clipboard
        .write([new ClipboardItem({ 'image/png': png() })])
        .then(() => ctl.showToast(t('画像としてコピーしました', 'Copied as an image')), fail);
    } catch {
      fail();
    }
  };
  return (
    <div class={cls}>
      <button class="mini" title={t('SVG ファイルとして保存', 'Save as an SVG file')} onClick={() => saveFile(fileName(name, 'svg'), new Blob([drawing().svg], { type: 'image/svg+xml' }))}>
        SVG
      </button>
      <button
        class="mini"
        title={t('PNG 画像として保存（2 倍の解像度）', 'Save as a PNG image (at twice the size)')}
        onClick={() => png().then((b) => saveFile(fileName(name, 'png'), b), fail)}
      >
        PNG
      </button>
      <button class="mini" title={t('PNG 画像をクリップボードへ（資料に貼り付け）', 'PNG image to the clipboard, to paste into documents')} onClick={copy}>
        {t('画像をコピー', 'Copy image')}
      </button>
    </div>
  );
}
