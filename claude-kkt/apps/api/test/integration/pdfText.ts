/**
 * Text extraction for the PDFs the API renders (pdfkit with embedded, subset DejaVu Sans): parses every object, maps each font
 * resource name (/F1 …) to its ToUnicode CMap, then walks the content streams following `Tf` font switches and decodes the hex strings
 * of `TJ` operators (2-byte glyph ids through the CMap; standard fonts fall back to WinAnsi/latin1).
 */
import { inflateSync } from "node:zlib";

interface PdfObject {
  dict: string;
  stream: Buffer | null;
}

function parseObjects(buf: Buffer): Map<number, PdfObject> {
  const latin = buf.toString("latin1");
  const out = new Map<number, PdfObject>();
  const re = /(\d+) 0 obj\s*([\s\S]*?)endobj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latin)) !== null) {
    const body = m[2]!;
    const si = body.indexOf("stream");
    if (si >= 0 && /^stream\r?\n/.test(body.slice(si))) {
      const dict = body.slice(0, si);
      const start = si + (body[si + 6] === "\r" ? 8 : 7);
      const len = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
      const end = len ? start + Number(len[1]) : body.lastIndexOf("endstream");
      let raw = Buffer.from(body.slice(start, end), "latin1");
      if (/\/FlateDecode/.test(dict)) {
        try {
          raw = inflateSync(raw);
        } catch {
          /* leave as is */
        }
      }
      out.set(Number(m[1]), { dict, stream: raw });
    } else {
      out.set(Number(m[1]), { dict: body, stream: null });
    }
  }
  return out;
}

/** gid → text of a ToUnicode CMap (bfrange with arrays, bfrange with a start value, bfchar). */
function parseCmap(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  const hexToStr = (h: string): string => {
    const units: number[] = [];
    for (let i = 0; i + 4 <= h.length; i += 4) units.push(parseInt(h.slice(i, i + 4), 16));
    return String.fromCharCode(...units);
  };
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const r of block[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F\s]+>)/g)) {
      const lo = parseInt(r[1]!, 16);
      const hi = parseInt(r[2]!, 16);
      const target = r[3]!;
      if (target.startsWith("[")) {
        const items = [...target.matchAll(/<([0-9a-fA-F\s]*)>/g)].map((x) => x[1]!.replace(/\s+/g, ""));
        items.forEach((h, i) => map.set(lo + i, hexToStr(h)));
      } else {
        const base = target.slice(1, -1).replace(/\s+/g, "");
        const first = parseInt(base, 16);
        for (let g = lo; g <= hi; g += 1) map.set(g, String.fromCharCode(first + (g - lo)));
      }
    }
  }
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const r of block[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F\s]+)>/g)) map.set(parseInt(r[1]!, 16), hexToStr(r[2]!.replace(/\s+/g, "")));
  }
  return map;
}

/** Font facts of a rendered PDF: BaseFont names, whether the font files are embedded, and the decoded ToUnicode maps. */
export function pdfFonts(buf: Buffer): { baseFonts: string[]; embedded: boolean; unicode: Set<string> } {
  const objs = parseObjects(buf);
  const baseFonts = new Set<string>();
  const unicode = new Set<string>();
  let embedded = false;
  for (const o of objs.values()) {
    if (/\/Type\s*\/Font\b/.test(o.dict)) {
      const bf = /\/BaseFont\s*\/([^\s/<>[\]]+)/.exec(o.dict);
      if (bf) baseFonts.add(bf[1]!);
      const tu = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(o.dict);
      const cmap = tu ? objs.get(Number(tu[1]))?.stream : null;
      if (cmap) for (const s of parseCmap(cmap.toString("latin1")).values()) unicode.add(s);
    }
    if (/\/FontFile2\s+\d+\s+0\s+R/.test(o.dict)) embedded = true;
  }
  return { baseFonts: [...baseFonts], embedded, unicode };
}

/** Text of a pdfkit PDF (one line per TJ run). */
export function pdfText(buf: Buffer): string {
  const objs = parseObjects(buf);
  // font resource name → gid map (null for simple fonts)
  const fontByName = new Map<string, Map<number, string> | null>();
  for (const o of objs.values()) {
    for (const res of o.dict.matchAll(/\/Font\s*<<([\s\S]*?)>>/g)) {
      for (const f of res[1]!.matchAll(/\/([A-Za-z0-9_.+-]+)\s+(\d+)\s+0\s+R/g)) {
        const font = objs.get(Number(f[2]));
        if (!font) continue;
        const tu = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(font.dict);
        const cmap = tu ? objs.get(Number(tu[1]))?.stream : null;
        fontByName.set(f[1]!, cmap ? parseCmap(cmap.toString("latin1")) : null);
      }
    }
  }
  const out: string[] = [];
  for (const o of objs.values()) {
    if (!o.stream || /\/Type\s*\/(XObject|Font|FontDescriptor)|\/Subtype\s*\/(Image|Type0|CIDFontType2)|\/Length1/.test(o.dict)) continue;
    const content = o.stream.toString("latin1");
    if (!/\bTJ\b|\bTj\b/.test(content)) continue;
    let current: Map<number, string> | null = null;
    for (const tok of content.matchAll(/\/([A-Za-z0-9_.+-]+)\s+[\d.]+\s+Tf|\[((?:<[0-9A-Fa-f]*>\s*-?[\d.]*\s*)+)\]\s*TJ/g)) {
      if (tok[1] !== undefined) {
        current = fontByName.get(tok[1]) ?? null;
        continue;
      }
      const hex = [...tok[2]!.matchAll(/<([0-9A-Fa-f]*)>/g)].map((h) => h[1]!).join("");
      if (current) {
        let s = "";
        for (let i = 0; i + 4 <= hex.length; i += 4) s += current.get(parseInt(hex.slice(i, i + 4), 16)) ?? "�";
        out.push(s);
      } else {
        out.push(Buffer.from(hex, "hex").toString("latin1"));
      }
    }
  }
  return out.join("\n");
}
