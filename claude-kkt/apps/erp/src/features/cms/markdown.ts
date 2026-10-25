/**
 * Minimal, safe Markdown: a small block + inline parser that produces a tree, rendered either as
 * React (Markdown.tsx) or as escaped HTML (tests, plain-text previews). Raw HTML in the source is
 * never interpreted — it is shown as text — and link / image URLs are allow-listed by scheme.
 *
 * Supported: ATX headings, paragraphs, unordered and ordered lists, fenced code blocks, block
 * quotes, horizontal rules, bold, italic, inline code, links, images, hard line breaks.
 */

export type InlineNode =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong"; children: InlineNode[] }
  | { type: "em"; children: InlineNode[] }
  | { type: "link"; href: string; title: string | null; children: InlineNode[] }
  | { type: "image"; src: string; alt: string }
  | { type: "br" };

export type BlockNode =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: InlineNode[] }
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "list"; ordered: boolean; start: number; items: InlineNode[][] }
  | { type: "code"; lang: string | null; text: string }
  | { type: "quote"; children: BlockNode[] }
  | { type: "hr" };

/* ------------------------------------------------------------------ */
/* URL safety                                                           */
/* ------------------------------------------------------------------ */

const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

/**
 * Returns the URL when it is safe to emit as an href/src, else null.
 * Absolute URLs must use http(s)/mailto/tel; relative paths (`/x`, `./x`, `#x`, `x`) are allowed;
 * `javascript:`, `data:`, `vbscript:` and anything with control characters are rejected.
 */
export function sanitizeUrl(raw: string): string | null {
  const url = raw.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  if (!url) return null;
  // Decode entities / percent-encoding that could hide a scheme (e.g. "java&#115;cript:").
  const probe = url.replace(/&#x?[0-9a-f]+;?/gi, "").replace(/%[0-9a-f]{2}/gi, "").toLowerCase();
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(probe);
  if (schemeMatch) {
    const scheme = `${schemeMatch[1]?.toLowerCase() ?? ""}:`;
    return SAFE_SCHEMES.has(scheme) ? url : null;
  }
  if (url.startsWith("//")) return null;
  return url;
}

/* ------------------------------------------------------------------ */
/* Inline parser                                                        */
/* ------------------------------------------------------------------ */

function pushText(out: InlineNode[], text: string): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.type === "text") last.text += text;
  else out.push({ type: "text", text });
}

/** Finds the matching `)` for a link/image destination starting at `start` (index after `(`), honouring nesting and `\)`. */
function findClosingParen(src: string, start: number): number {
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      if (depth === 0) return i;
      depth -= 1;
    }
    if (ch === "\n") return -1;
  }
  return -1;
}

/** Finds the matching `]` for link text starting at `start` (index after `[`). */
function findClosingBracket(src: string, start: number): number {
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

function splitDestination(inner: string): { href: string; title: string | null } {
  const text = inner.trim();
  const match = /^(<[^>]*>|\S+)(?:\s+(?:"([^"]*)"|'([^']*)'))?$/.exec(text);
  if (!match) return { href: text, title: null };
  const href = (match[1] ?? "").replace(/^<|>$/g, "");
  return { href, title: match[2] ?? match[3] ?? null };
}

export function parseInline(src: string): InlineNode[] {
  const out: InlineNode[] = [];
  let i = 0;
  let buffer = "";
  const flush = () => {
    pushText(out, buffer);
    buffer = "";
  };

  while (i < src.length) {
    const ch = src[i] ?? "";
    const next = src[i + 1] ?? "";

    // Escapes
    if (ch === "\\" && next && /[\\`*_{}[\]()#+\-.!>|~]/.test(next)) {
      buffer += next;
      i += 2;
      continue;
    }

    // Hard line break: backslash or two spaces before a newline
    if (ch === "\n") {
      if (buffer.endsWith("  ") || buffer.endsWith("\\")) {
        buffer = buffer.replace(/(  |\\)$/, "");
        flush();
        out.push({ type: "br" });
      } else {
        buffer += " ";
      }
      i += 1;
      continue;
    }

    // Inline code
    if (ch === "`") {
      let run = 1;
      while (src[i + run] === "`") run += 1;
      const fence = "`".repeat(run);
      const close = src.indexOf(fence, i + run);
      if (close !== -1) {
        flush();
        out.push({ type: "code", text: src.slice(i + run, close).replace(/\n/g, " ").trim() });
        i = close + run;
        continue;
      }
      buffer += ch;
      i += 1;
      continue;
    }

    // Image
    if (ch === "!" && next === "[") {
      const closeBracket = findClosingBracket(src, i + 2);
      if (closeBracket !== -1 && src[closeBracket + 1] === "(") {
        const closeParen = findClosingParen(src, closeBracket + 2);
        if (closeParen !== -1) {
          const alt = src.slice(i + 2, closeBracket);
          const { href } = splitDestination(src.slice(closeBracket + 2, closeParen));
          const safe = sanitizeUrl(href);
          flush();
          if (safe) out.push({ type: "image", src: safe, alt });
          else pushText(out, alt);
          i = closeParen + 1;
          continue;
        }
      }
    }

    // Link
    if (ch === "[") {
      const closeBracket = findClosingBracket(src, i + 1);
      if (closeBracket !== -1 && src[closeBracket + 1] === "(") {
        const closeParen = findClosingParen(src, closeBracket + 2);
        if (closeParen !== -1) {
          const label = src.slice(i + 1, closeBracket);
          const { href, title } = splitDestination(src.slice(closeBracket + 2, closeParen));
          const safe = sanitizeUrl(href);
          flush();
          const children = parseInline(label);
          if (safe) out.push({ type: "link", href: safe, title, children });
          else out.push(...children);
          i = closeParen + 1;
          continue;
        }
      }
    }

    // Strong / emphasis with * or _
    if (ch === "*" || ch === "_") {
      const double = next === ch;
      const marker = double ? ch + ch : ch;
      const start = i + marker.length;
      // `_` emphasis must not sit inside a word (snake_case stays literal).
      const prev = src[i - 1] ?? "";
      const intraword = ch === "_" && /\w/.test(prev);
      if (!intraword && src[start] && !/\s/.test(src[start] ?? "")) {
        let close = src.indexOf(marker, start);
        while (close !== -1 && /\s/.test(src[close - 1] ?? "")) close = src.indexOf(marker, close + 1);
        if (close !== -1 && close > start) {
          flush();
          const children = parseInline(src.slice(start, close));
          out.push(double ? { type: "strong", children } : { type: "em", children });
          i = close + marker.length;
          continue;
        }
      }
    }

    // Raw HTML is text: nothing special to do, the renderer escapes it.
    buffer += ch;
    i += 1;
  }
  flush();
  return out;
}

/* ------------------------------------------------------------------ */
/* Block parser                                                         */
/* ------------------------------------------------------------------ */

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^(```|~~~)\s*([\w+-]*)\s*$/;
const HR = /^(?:-{3,}|\*{3,}|_{3,})\s*$/;
const UL_ITEM = /^\s{0,3}[-*+]\s+(.*)$/;
const OL_ITEM = /^\s{0,3}(\d{1,9})[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;

export function parseMarkdown(source: string): BlockNode[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: BlockNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1] ?? "```";
      const lang = fence[2] || null;
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? "").startsWith(marker)) {
        body.push(lines[i] ?? "");
        i += 1;
      }
      i += 1; // closing fence (or EOF)
      blocks.push({ type: "code", lang, text: body.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = Math.min(6, Math.max(1, (heading[1] ?? "#").length)) as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ type: "heading", level, children: parseInline(heading[2] ?? "") });
      i += 1;
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i] ?? "")) {
        inner.push(QUOTE.exec(lines[i] ?? "")?.[1] ?? "");
        i += 1;
      }
      blocks.push({ type: "quote", children: parseMarkdown(inner.join("\n")) });
      continue;
    }

    const ul = UL_ITEM.exec(line);
    const ol = OL_ITEM.exec(line);
    if (ul || ol) {
      const ordered = Boolean(ol);
      const start = ol ? Number(ol[1]) : 1;
      const items: string[] = [];
      while (i < lines.length) {
        const current = lines[i] ?? "";
        const item = ordered ? OL_ITEM.exec(current) : UL_ITEM.exec(current);
        if (item) {
          items.push((ordered ? item[2] : item[1]) ?? "");
          i += 1;
          continue;
        }
        // Lazy continuation: indented text belongs to the previous item.
        if (/^\s{2,}\S/.test(current) && items.length > 0) {
          items[items.length - 1] = `${items[items.length - 1] ?? ""}\n${current.trim()}`;
          i += 1;
          continue;
        }
        break;
      }
      blocks.push({ type: "list", ordered, start: Number.isFinite(start) ? start : 1, items: items.map(parseInline) });
      continue;
    }

    // Paragraph: until a blank line or the start of another block.
    const para: string[] = [];
    while (i < lines.length) {
      const current = lines[i] ?? "";
      if (current.trim() === "") break;
      if (para.length > 0 && (HEADING.test(current) || FENCE.test(current) || HR.test(current) || UL_ITEM.test(current) || OL_ITEM.test(current) || QUOTE.test(current))) break;
      para.push(current);
      i += 1;
    }
    blocks.push({ type: "paragraph", children: parseInline(para.join("\n")) });
  }
  return blocks;
}

/* ------------------------------------------------------------------ */
/* HTML serialiser (escaped; used by tests and plain previews)          */
/* ------------------------------------------------------------------ */

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function inlineToHtml(nodes: readonly InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
          return escapeHtml(node.text);
        case "code":
          return `<code>${escapeHtml(node.text)}</code>`;
        case "strong":
          return `<strong>${inlineToHtml(node.children)}</strong>`;
        case "em":
          return `<em>${inlineToHtml(node.children)}</em>`;
        case "link": {
          const external = /^https?:/i.test(node.href);
          const title = node.title ? ` title="${escapeHtml(node.title)}"` : "";
          const rel = external ? ` target="_blank" rel="noopener noreferrer"` : "";
          return `<a href="${escapeHtml(node.href)}"${title}${rel}>${inlineToHtml(node.children)}</a>`;
        }
        case "image":
          return `<img src="${escapeHtml(node.src)}" alt="${escapeHtml(node.alt)}" loading="lazy">`;
        case "br":
          return "<br>";
      }
    })
    .join("");
}

function blockToHtml(block: BlockNode): string {
  switch (block.type) {
    case "heading":
      return `<h${block.level}>${inlineToHtml(block.children)}</h${block.level}>`;
    case "paragraph":
      return `<p>${inlineToHtml(block.children)}</p>`;
    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      const start = block.ordered && block.start !== 1 ? ` start="${block.start}"` : "";
      return `<${tag}${start}>${block.items.map((item) => `<li>${inlineToHtml(item)}</li>`).join("")}</${tag}>`;
    }
    case "code": {
      const lang = block.lang ? ` class="language-${escapeHtml(block.lang)}"` : "";
      return `<pre><code${lang}>${escapeHtml(block.text)}</code></pre>`;
    }
    case "quote":
      return `<blockquote>${block.children.map(blockToHtml).join("")}</blockquote>`;
    case "hr":
      return "<hr>";
  }
}

/** Markdown → escaped HTML string. Never emits raw HTML from the source. */
export function renderMarkdownToHtml(source: string): string {
  return parseMarkdown(source).map(blockToHtml).join("");
}

/** Plain-text excerpt (first ~`max` characters of the paragraphs). */
export function markdownExcerpt(source: string, max = 160): string {
  const text = parseMarkdown(source)
    .filter((block) => block.type === "paragraph" || block.type === "heading")
    .map((block) => (block.type === "paragraph" || block.type === "heading" ? block.children.map(inlinePlain).join("") : ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function inlinePlain(node: InlineNode): string {
  switch (node.type) {
    case "text":
    case "code":
      return node.text;
    case "strong":
    case "em":
    case "link":
      return node.children.map(inlinePlain).join("");
    case "image":
      return node.alt;
    case "br":
      return " ";
  }
}

/** Rough reading time at 200 words per minute. */
export function readingMinutes(source: string): number {
  const words = source.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}
