/**
 * Minimal ZIP writer (PKWARE APPNOTE 4.5 subset): local file headers, central directory, end-of-central-directory record.
 * Entries are buffered, so CRC-32 and sizes are known up front (no data descriptors); payloads are DEFLATEd with zlib.deflateRaw
 * (method 8) unless storing is smaller (method 0). File names are UTF-8 (general-purpose flag bit 11). No dependency beyond node:zlib.
 * Limits: < 4 GiB per entry / archive and < 65 535 entries (no ZIP64), plenty for a tenant backup; exceeding them throws.
 */
import { deflateRawSync, inflateRawSync } from "node:zlib";

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (IEEE 802.3, as used by ZIP/gzip/PNG) of a buffer. */
export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS date/time pair used in ZIP headers (local time, 2-second resolution; years before 1980 clamp to 1980). */
export function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const VERSION_NEEDED = 20;
const VERSION_MADE_BY = 20;
const FLAG_UTF8 = 0x0800;
const MAX_U32 = 0xffffffff;

interface Entry {
  name: Buffer;
  method: 0 | 8;
  crc: number;
  compressed: Buffer;
  uncompressedSize: number;
  time: number;
  date: number;
  offset: number;
}

/** Builds a ZIP archive in memory. Add entries with file(), then build() returns the bytes. */
export class ZipWriter {
  private readonly entries: Entry[] = [];
  private offset = 0;
  private readonly names = new Set<string>();

  constructor(private readonly modified: Date = new Date()) {}

  /** Adds one file. Names use forward slashes and must be unique (ASCII/UTF-8, no leading slash or `..`). */
  file(name: string, data: Buffer | string): this {
    if (!/^[^/\\][^\\]*$/.test(name) || name.split("/").some((seg) => seg === "" || seg === "..")) throw new Error(`Invalid ZIP entry name: ${name}`);
    if (this.names.has(name)) throw new Error(`Duplicate ZIP entry: ${name}`);
    if (this.entries.length >= 65_535) throw new Error("ZIP entry limit (65535) exceeded");
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
    if (raw.length > MAX_U32) throw new Error(`ZIP entry too large: ${name}`);
    const deflated = deflateRawSync(raw, { level: 6 });
    const useDeflate = deflated.length < raw.length;
    const nameBuf = Buffer.from(name, "utf8");
    const { time, date } = dosDateTime(this.modified);
    const entry: Entry = { name: nameBuf, method: useDeflate ? 8 : 0, crc: crc32(raw), compressed: useDeflate ? deflated : raw, uncompressedSize: raw.length, time, date, offset: this.offset };
    this.entries.push(entry);
    this.names.add(name);
    this.offset += 30 + nameBuf.length + entry.compressed.length;
    if (this.offset > MAX_U32) throw new Error("ZIP archive exceeds 4 GiB");
    return this;
  }

  /** Number of entries added so far. */
  get count(): number {
    return this.entries.length;
  }

  /** Serialises the archive: [local header + data]* , central directory, EOCD. */
  build(): Buffer {
    const parts: Buffer[] = [];
    for (const e of this.entries) {
      const h = Buffer.alloc(30);
      h.writeUInt32LE(SIG_LOCAL, 0);
      h.writeUInt16LE(VERSION_NEEDED, 4);
      h.writeUInt16LE(FLAG_UTF8, 6);
      h.writeUInt16LE(e.method, 8);
      h.writeUInt16LE(e.time, 10);
      h.writeUInt16LE(e.date, 12);
      h.writeUInt32LE(e.crc, 14);
      h.writeUInt32LE(e.compressed.length, 18);
      h.writeUInt32LE(e.uncompressedSize, 22);
      h.writeUInt16LE(e.name.length, 26);
      h.writeUInt16LE(0, 28);
      parts.push(h, e.name, e.compressed);
    }
    const cdStart = this.offset;
    let cdSize = 0;
    for (const e of this.entries) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(SIG_CENTRAL, 0);
      c.writeUInt16LE(VERSION_MADE_BY, 4);
      c.writeUInt16LE(VERSION_NEEDED, 6);
      c.writeUInt16LE(FLAG_UTF8, 8);
      c.writeUInt16LE(e.method, 10);
      c.writeUInt16LE(e.time, 12);
      c.writeUInt16LE(e.date, 14);
      c.writeUInt32LE(e.crc, 16);
      c.writeUInt32LE(e.compressed.length, 20);
      c.writeUInt32LE(e.uncompressedSize, 24);
      c.writeUInt16LE(e.name.length, 28);
      c.writeUInt16LE(0, 30); // extra
      c.writeUInt16LE(0, 32); // comment
      c.writeUInt16LE(0, 34); // disk number start
      c.writeUInt16LE(0, 36); // internal attributes
      c.writeUInt32LE(0, 38); // external attributes
      c.writeUInt32LE(e.offset, 42);
      parts.push(c, e.name);
      cdSize += 46 + e.name.length;
    }
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(SIG_EOCD, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(this.entries.length, 8);
    eocd.writeUInt16LE(this.entries.length, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdStart, 16);
    eocd.writeUInt16LE(0, 20);
    parts.push(eocd);
    return Buffer.concat(parts);
  }
}

/** One entry as read back from a central directory (used by tests and the self-check after building a backup). */
export interface ZipEntryInfo {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

/** Parses the central directory of a ZIP buffer (no ZIP64); throws when the EOCD record or an entry signature is missing. */
export function readCentralDirectory(zip: Buffer): ZipEntryInfo[] {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65_535); i--) {
    if (zip.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("ZIP: end of central directory not found");
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const out: ZipEntryInfo[] = [];
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== SIG_CENTRAL) throw new Error(`ZIP: bad central directory signature at ${p}`);
    const nameLen = zip.readUInt16LE(p + 28), extraLen = zip.readUInt16LE(p + 30), commentLen = zip.readUInt16LE(p + 32);
    out.push({
      method: zip.readUInt16LE(p + 10), crc: zip.readUInt32LE(p + 16), compressedSize: zip.readUInt32LE(p + 20), uncompressedSize: zip.readUInt32LE(p + 24),
      localHeaderOffset: zip.readUInt32LE(p + 42), name: zip.subarray(p + 46, p + 46 + nameLen).toString("utf8"),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Extracts and verifies (CRC-32) one entry located through its central-directory record. */
export function readZipEntry(zip: Buffer, entry: ZipEntryInfo): Buffer {
  const p = entry.localHeaderOffset;
  if (zip.readUInt32LE(p) !== SIG_LOCAL) throw new Error(`ZIP: bad local header signature for ${entry.name}`);
  const nameLen = zip.readUInt16LE(p + 26), extraLen = zip.readUInt16LE(p + 28);
  const start = p + 30 + nameLen + extraLen;
  const raw = zip.subarray(start, start + entry.compressedSize);
  if (entry.method !== 8 && entry.method !== 0) throw new Error(`ZIP: unsupported method ${entry.method}`);
  const data = entry.method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
  if (data.length !== entry.uncompressedSize || crc32(data) !== entry.crc) throw new Error(`ZIP: CRC mismatch for ${entry.name}`);
  return data;
}
