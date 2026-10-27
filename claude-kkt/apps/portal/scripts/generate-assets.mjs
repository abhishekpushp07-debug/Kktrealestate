// Generates the navy/gold placeholder brand assets (icon, adaptive icon, splash, favicon)
// without any image library: plain RGBA pixels → zlib-deflated PNG.
// Run: node scripts/generate-assets.mjs   (writes into assets/images)
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "assets", "images");
mkdirSync(out, { recursive: true });

const NAVY = [0x0b, 0x1f, 0x3a, 0xff];
const GOLD = [0xc9, 0xa2, 0x27, 0xff];
const IVORY = [0xf8, 0xf6, 0xf1, 0xff];
const WHITE = [0xff, 0xff, 0xff, 0xff];
const CLEAR = [0, 0, 0, 0];

const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(width, height, pixelAt) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelAt(x, y);
      const o = y * (width * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Anti-aliased sampling: average 4 sub-samples per pixel. */
function aa(fn) {
  return (x, y) => {
    const acc = [0, 0, 0, 0];
    const offs = [0.25, 0.75];
    for (const dx of offs) for (const dy of offs) {
      const p = fn(x + dx, y + dy);
      for (let i = 0; i < 4; i++) acc[i] += p[i];
    }
    return acc.map((v) => Math.round(v / 4));
  };
}

/** The KKT mark: a gold ring with a slender "K"-like chevron + pillar, centred in a square of `size`. */
function mark(size, fg, bg, scale = 1) {
  const c = size / 2;
  const R = (size / 2) * 0.78 * scale;
  const ringW = size * 0.045 * scale;
  const barW = size * 0.075 * scale;
  return (x, y) => {
    const dx = x - c, dy = y - c;
    const d = Math.hypot(dx, dy);
    if (d <= R && d >= R - ringW) return fg;
    const top = c - R * 0.52, bottom = c + R * 0.52;
    const left = c - R * 0.34;
    if (x >= left && x <= left + barW && y >= top && y <= bottom) return fg; // pillar
    // two diagonal arms of the K
    const armStart = left + barW;
    const mid = c;
    const t1 = Math.abs((y - mid) - (x - armStart) * -1.05); // upper arm  (going up-right)
    const t2 = Math.abs((y - mid) - (x - armStart) * 1.05); // lower arm (going down-right)
    const armLen = R * 0.56;
    if (x >= armStart && x <= armStart + armLen) {
      if (t1 <= barW * 0.72 && y <= mid + barW * 0.4 && y >= top) return fg;
      if (t2 <= barW * 0.72 && y >= mid - barW * 0.4 && y <= bottom) return fg;
    }
    return bg;
  };
}

function roundedSquare(size, radius, inner) {
  return (x, y) => {
    const rx = Math.max(Math.abs(x - size / 2) - (size / 2 - radius), 0);
    const ry = Math.max(Math.abs(y - size / 2) - (size / 2 - radius), 0);
    if (Math.hypot(rx, ry) > radius) return CLEAR;
    return inner(x, y);
  };
}

// App icon (1024): navy rounded square with the gold mark (OS masks the corners itself, keep square).
writeFileSync(join(out, "icon.png"), png(1024, 1024, aa(mark(1024, GOLD, NAVY, 0.9))));
// Android adaptive icon layers (1024): foreground mark on transparent, solid navy background, white monochrome.
writeFileSync(join(out, "android-icon-foreground.png"), png(1024, 1024, aa(mark(1024, GOLD, CLEAR, 0.62))));
writeFileSync(join(out, "android-icon-background.png"), png(1024, 1024, () => NAVY));
writeFileSync(join(out, "android-icon-monochrome.png"), png(1024, 1024, aa(mark(1024, WHITE, CLEAR, 0.62))));
// Splash image (gold mark on transparent; background colour comes from app.json).
writeFileSync(join(out, "splash-icon.png"), png(512, 512, aa(mark(512, GOLD, CLEAR, 1))));
// Favicon (64): small navy rounded tile.
writeFileSync(join(out, "favicon.png"), png(64, 64, aa(roundedSquare(64, 12, mark(64, GOLD, NAVY, 0.95)))));
// Web/PWA tile used by the login hero as a decorative asset.
writeFileSync(join(out, "wordmark-tile.png"), png(256, 256, aa(roundedSquare(256, 40, mark(256, GOLD, IVORY, 0.9)))));
console.log("assets written to", out);
