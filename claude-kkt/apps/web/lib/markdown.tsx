/**
 * A small, safe Markdown renderer. It produces React elements directly — no HTML strings,
 * no dangerouslySetInnerHTML — so author content can never inject markup or scripts.
 *
 * Supported: ATX headings, paragraphs, soft line breaks, unordered/ordered lists, blockquotes,
 * fenced code blocks, horizontal rules, images, links (http/https/mailto/tel/relative only),
 * bold, italic and inline code. Anything else renders as plain text.
 */
import type { ReactNode } from "react";

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "code"; lang: string | null; code: string }
  | { kind: "hr" }
  | { kind: "image"; alt: string; url: string };

const SAFE_URL = /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#|\.\/|\.\.\/)/i;

export function safeHref(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed || /[\s<>"']/.test(trimmed)) return null;
  return SAFE_URL.test(trimmed) ? trimmed : null;
}

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  const flushParagraph = (buffer: string[]) => {
    if (buffer.length) blocks.push({ kind: "paragraph", text: buffer.join("\n") });
    buffer.length = 0;
  };

  const paragraph: string[] = [];

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (trimmed === "") {
      flushParagraph(paragraph);
      i += 1;
      continue;
    }

    const fence = /^```\s*([\w-]+)?\s*$/.exec(trimmed);
    if (fence) {
      flushParagraph(paragraph);
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test((lines[i] ?? "").trim())) {
        code.push(lines[i] ?? "");
        i += 1;
      }
      i += 1; // closing fence
      blocks.push({ kind: "code", lang: fence[1] ?? null, code: code.join("\n") });
      continue;
    }

    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(trimmed);
    if (heading) {
      flushParagraph(paragraph);
      blocks.push({ kind: "heading", level: (heading[1] ?? "#").length, text: heading[2] ?? "" });
      i += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph(paragraph);
      blocks.push({ kind: "hr" });
      i += 1;
      continue;
    }

    const imageOnly = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/.exec(trimmed);
    if (imageOnly) {
      flushParagraph(paragraph);
      blocks.push({ kind: "image", alt: imageOnly[1] ?? "", url: imageOnly[2] ?? "" });
      i += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      flushParagraph(paragraph);
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i] ?? "")) {
        quote.push((lines[i] ?? "").replace(/^\s*>\s?/, ""));
        i += 1;
      }
      blocks.push({ kind: "quote", text: quote.join("\n") });
      continue;
    }

    const unordered = /^[-*+]\s+/.test(trimmed);
    const ordered = /^\d{1,3}[.)]\s+/.test(trimmed);
    if (unordered || ordered) {
      flushParagraph(paragraph);
      const items: string[] = [];
      const matcher = ordered ? /^\s*\d{1,3}[.)]\s+/ : /^\s*[-*+]\s+/;
      while (i < lines.length) {
        const current = lines[i] ?? "";
        if (matcher.test(current)) {
          items.push(current.replace(matcher, "").trim());
          i += 1;
        } else if (current.trim() !== "" && /^\s{2,}/.test(current) && items.length) {
          // continuation line of the previous item
          items[items.length - 1] = `${items[items.length - 1]} ${current.trim()}`;
          i += 1;
        } else {
          break;
        }
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    paragraph.push(trimmed);
    i += 1;
  }
  flushParagraph(paragraph);
  return blocks;
}

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

const INLINE_TOKEN =
  /(`[^`\n]+`)|(!\[[^\]]*\]\([^)\s]+(?:\s+"[^"]*")?\))|(\[[^\]]+\]\([^)\s]+(?:\s+"[^"]*")?\))|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\n)/;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = text;
  let index = 0;

  while (rest.length) {
    const match = INLINE_TOKEN.exec(rest);
    if (!match || match.index === undefined) {
      nodes.push(rest);
      break;
    }
    if (match.index > 0) nodes.push(rest.slice(0, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${index++}`;

    if (match[1]) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (match[2]) {
      const m = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/.exec(token);
      const href = m ? safeHref(m[2] ?? "") : null;
      if (href)
        nodes.push(<img key={key} src={href} alt={m?.[1] ?? ""} title={m?.[3]} loading="lazy" decoding="async" />);
      else nodes.push(m?.[1] ?? token);
    } else if (match[3]) {
      const m = /^\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/.exec(token);
      const href = m ? safeHref(m[2] ?? "") : null;
      const label = m?.[1] ?? token;
      if (href) {
        const external = /^https?:\/\//i.test(href);
        nodes.push(
          <a
            key={key}
            href={href}
            title={m?.[3]}
            {...(external ? { rel: "noopener noreferrer", target: "_blank" } : {})}
          >
            {renderInline(label, `${key}-l`)}
          </a>,
        );
      } else {
        nodes.push(label);
      }
    } else if (match[4] || match[5]) {
      nodes.push(<strong key={key}>{renderInline(token.slice(2, -2), `${key}-b`)}</strong>);
    } else if (match[6] || match[7]) {
      nodes.push(<em key={key}>{renderInline(token.slice(1, -1), `${key}-i`)}</em>);
    } else if (match[8]) {
      nodes.push(<br key={key} />);
    } else {
      nodes.push(token);
    }
    rest = rest.slice(match.index + token.length);
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface MarkdownProps {
  source: string | null | undefined;
  /** Headings are shifted down so the page keeps a single <h1>. Default 1 (# → h2). */
  shiftHeadings?: number;
  className?: string;
}

const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

export function Markdown({ source, shiftHeadings = 1, className }: MarkdownProps) {
  if (!source) return null;
  const blocks = parseBlocks(source);
  return (
    <div className={className}>
      {blocks.map((block, i) => {
        const key = `b${i}`;
        switch (block.kind) {
          case "heading": {
            const level = Math.min(6, Math.max(1, block.level + shiftHeadings));
            const Tag = HEADING_TAGS[level - 1] ?? "h6";
            return <Tag key={key}>{renderInline(block.text, key)}</Tag>;
          }
          case "paragraph":
            return <p key={key}>{renderInline(block.text, key)}</p>;
          case "list": {
            const items = block.items.map((item, j) => (
              <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>
            ));
            return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
          }
          case "quote":
            return <blockquote key={key}>{renderInline(block.text, key)}</blockquote>;
          case "code":
            return (
              <pre key={key}>
                <code data-lang={block.lang ?? undefined}>{block.code}</code>
              </pre>
            );
          case "hr":
            return <hr key={key} />;
          case "image": {
            const href = safeHref(block.url);
            return href ? (
              <figure key={key}>
                <img src={href} alt={block.alt} loading="lazy" decoding="async" />
                {block.alt ? <figcaption className="mt-2 text-sm text-ink-soft">{block.alt}</figcaption> : null}
              </figure>
            ) : null;
          }
          default:
            return null;
        }
      })}
    </div>
  );
}

/** Plain-text version (first paragraph) for descriptions. */
export function markdownToText(source: string | null | undefined, max = 160): string {
  if (!source) return "";
  const text = source
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
