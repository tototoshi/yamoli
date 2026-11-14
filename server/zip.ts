/*
 * Just enough of the ZIP format for backups: writing entries (deflated, UTF-8
 * names) and reading back such archives (stored or deflated entries, no
 * Zip64, no encryption).
 */
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

export interface ZipEntry {
  name: string;
  data: Buffer;
}

const UTF8 = 0x0800; // general purpose flag: names are UTF-8

/** A ZIP archive of the entries. */
export function zip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const packed = deflateRawSync(data);
    const [method, body] = packed.length < data.length ? [8, packed] : [0, data];
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, body);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4); // version made by
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(UTF8, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

/** The entries of a ZIP archive (directories left out); throws on anything it can't read. */
export function unzip(archive: Buffer): ZipEntry[] {
  // The end record is in the last 22 bytes plus a comment of up to 64 KB.
  let end = -1;
  for (let i = archive.length - 22; i >= Math.max(0, archive.length - 22 - 0xffff); i--) {
    if (archive.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('Not a ZIP file');
  const count = archive.readUInt16LE(end + 10);
  let p = archive.readUInt32LE(end + 16);
  const out: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (archive.readUInt32LE(p) !== 0x02014b50) throw new Error('Broken ZIP directory');
    const method = archive.readUInt16LE(p + 10);
    const crc = archive.readUInt32LE(p + 16);
    const packedSize = archive.readUInt32LE(p + 20);
    const nameLen = archive.readUInt16LE(p + 28);
    const extraLen = archive.readUInt16LE(p + 30);
    const commentLen = archive.readUInt16LE(p + 32);
    const at = archive.readUInt32LE(p + 42);
    const name = archive.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (archive.readUInt32LE(at) !== 0x04034b50) throw new Error(`Broken ZIP entry: ${name}`);
    const start = at + 30 + archive.readUInt16LE(at + 26) + archive.readUInt16LE(at + 28);
    const body = archive.subarray(start, start + packedSize);
    if (method !== 0 && method !== 8) throw new Error(`Unsupported compression in ${name}`);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    if (crc32(data) !== crc) throw new Error(`Damaged ZIP entry: ${name}`);
    out.push({ name, data });
  }
  return out;
}
