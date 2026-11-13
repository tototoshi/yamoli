/*
 * Files kept next to the outline file (server/files.ts). The outline refers
 * to one as `files/<sha256>.<ext>`, which the server serves at api/files/….
 */

/** Keep a file next to the outline file; resolves to its reference (`files/<hash>.pdf`) and size. */
export async function uploadFile(file: File): Promise<{ ref: string; size: number }> {
  const res = await fetch('./api/files?name=' + encodeURIComponent(file.name), { method: 'POST', body: file });
  if (!res.ok) throw new Error((await res.text()) || `${res.status}`);
  return res.json();
}

/** Whether a reference is to an image, which is shown rather than downloaded. */
export const isImageRef = (ref: string) => /\.(png|jpg|gif|webp)$/.test(ref);

/** The URL of a reference to a kept file (`files/…`); anything else (a web address) as it is. */
export const fileUrl = (ref: string) => (/^files\/[^/?#]+$/.test(ref) ? './api/' + ref : ref);

/** The URL that downloads a kept file under the name it came with. */
export const downloadUrl = (ref: string, name: string) => fileUrl(ref) + (name ? '?name=' + encodeURIComponent(name) : '');

/** What was pasted or dropped, as files. */
export const filesIn = (dt: DataTransfer | null | undefined): File[] => [...(dt?.files ?? [])];

/** A file size for people: 980 B, 12 KB, 3.4 MB. */
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const [n, unit] = bytes < 1024 * 1024 ? [bytes / 1024, 'KB'] : [bytes / 1024 / 1024, 'MB'];
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${unit}`;
}
