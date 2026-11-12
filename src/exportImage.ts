/*
 * Saving a drawing (the diagram) as a file or an image on the clipboard. The
 * page's SVG takes its look from the stylesheet, so a copy for elsewhere gets
 * the computed styles written onto each element.
 */

/** Styles that make up how SVG elements look; everything else is left to defaults. */
const PROPS = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-opacity',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'text-anchor',
  'text-decoration',
  'paint-order',
  'vector-effect',
];

/** A copy of svg that looks the same on its own: styles written in, on the page's background. */
export function standaloneSvg(svg: SVGSVGElement): string {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const from = [svg, ...svg.querySelectorAll('*')];
  const to = [copy, ...copy.querySelectorAll('*')];
  from.forEach((el, i) => {
    const cs = getComputedStyle(el);
    (to[i] as SVGElement).setAttribute('style', PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';'));
    to[i].removeAttribute('class');
  });

  // Arrowheads take the colour of their line (context-stroke), which not every viewer
  // supports: give each colour a marker of its own.
  const markers = new Map<string, string>();
  to.forEach((el, i) => {
    for (const attr of ['marker-start', 'marker-end']) {
      const ref = el.getAttribute(attr)?.match(/url\(#(.+)\)/)?.[1];
      const marker = ref && copy.querySelector(`marker#${CSS.escape(ref)}`);
      if (!marker) continue;
      const color = getComputedStyle(from[i]).stroke;
      let id = markers.get(color);
      if (!id) {
        id = `${ref}-${markers.size}`;
        const m = marker.cloneNode(true) as SVGMarkerElement;
        m.id = id;
        m.querySelectorAll('path').forEach((p) => p.setAttribute('style', `fill:${color};stroke:none`));
        marker.parentNode!.append(m);
        markers.set(color, id);
      }
      el.setAttribute(attr, `url(#${id})`);
    }
  });

  const [x, y, w, h] = (svg.getAttribute('viewBox') ?? '').split(/\s+/).map(Number);
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  Object.entries({ x, y, width: w, height: h, fill: getComputedStyle(document.body).backgroundColor }).forEach(([k, v]) =>
    bg.setAttribute(k, String(v))
  );
  copy.insertBefore(bg, copy.firstChild);
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(copy);
}

/** The SVG drawn into a PNG, at scale times its size (sharp on high-density screens). */
export async function svgToPng(svg: string, width: number, height: number, scale = 2): Promise<Blob> {
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const g = canvas.getContext('2d')!;
  g.scale(scale, scale);
  g.drawImage(img, 0, 0, width, height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG failed'))), 'image/png'));
}

/** Let the browser save blob as a file called name. */
export function saveFile(name: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** A file name from an item's text: characters file systems refuse replaced. */
export const fileName = (text: string, ext: string) =>
  (text
    .trim()
    .replace(/[\\/:*?"<>|\n]+/g, '_')
    .slice(0, 80) || 'diagram') +
  '.' +
  ext;
