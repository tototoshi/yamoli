/*
 * Images kept next to the outline file (server/files.ts). The outline refers
 * to one as `files/<sha256>.<ext>`, which the server serves at api/files/….
 */

/** Keep an image next to the outline file; resolves to its reference (`files/<hash>.png`). */
export async function uploadImage(blob: Blob): Promise<string> {
  const res = await fetch('./api/files', { method: 'POST', body: blob });
  if (!res.ok) throw new Error((await res.text()) || `${res.status}`);
  return (await res.json()).ref;
}

/** The URL of a reference to a kept file (`files/…`); anything else (a web address) as it is. */
export const fileUrl = (ref: string) => (/^files\/[^/]+$/.test(ref) ? './api/' + ref : ref);

/** The images among what was pasted or dropped. */
export const imageFiles = (dt: DataTransfer | null | undefined): File[] =>
  [...(dt?.files ?? [])].filter((f) => f.type.startsWith('image/'));
