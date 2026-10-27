import { useMemo, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { parseMarkdown, type BlockNode, type InlineNode } from "./markdown";

/* ------------------------------------------------------------------ */
/* Renderer (React elements only — never dangerouslySetInnerHTML)        */
/* ------------------------------------------------------------------ */

function renderInline(nodes: readonly InlineNode[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (node.type) {
      case "text":
        return node.text;
      case "code":
        return (
          <code key={key} className="rounded-xs bg-navy-50 px-1 py-0.5 font-mono text-[0.85em] text-navy-950">
            {node.text}
          </code>
        );
      case "strong":
        return <strong key={key}>{renderInline(node.children, key)}</strong>;
      case "em":
        return <em key={key}>{renderInline(node.children, key)}</em>;
      case "link": {
        const external = /^https?:/i.test(node.href);
        return (
          <a
            key={key}
            href={node.href}
            title={node.title ?? undefined}
            target={external ? "_blank" : undefined}
            rel={external ? "noopener noreferrer" : undefined}
            className="text-navy-700 underline underline-offset-2 hover:text-navy-950"
          >
            {renderInline(node.children, key)}
          </a>
        );
      }
      case "image":
        return (
          <img
            key={key}
            src={node.src}
            alt={node.alt}
            loading="lazy"
            className="my-2 max-h-96 max-w-full rounded-md border border-border"
          />
        );
      case "br":
        return <br key={key} />;
    }
  });
}

const HEADING_CLASS: Readonly<Record<1 | 2 | 3 | 4 | 5 | 6, string>> = {
  1: "text-2xl mt-6",
  2: "text-xl mt-5",
  3: "text-lg mt-4",
  4: "text-md mt-3",
  5: "text-base mt-3",
  6: "text-sm mt-3 uppercase tracking-wide",
};

function renderBlock(block: BlockNode, key: string): ReactNode {
  switch (block.type) {
    case "heading": {
      const Tag = `h${block.level}` as const;
      return (
        <Tag key={key} className={cn("font-display font-bold text-navy-950 first:mt-0", HEADING_CLASS[block.level])}>
          {renderInline(block.children, key)}
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p key={key} className="leading-relaxed">
          {renderInline(block.children, key)}
        </p>
      );
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag
          key={key}
          start={block.ordered && block.start !== 1 ? block.start : undefined}
          className={cn("space-y-1 pl-6", block.ordered ? "list-decimal" : "list-disc")}
        >
          {block.items.map((item, index) => (
            <li key={`${key}-${index}`}>{renderInline(item, `${key}-${index}`)}</li>
          ))}
        </Tag>
      );
    }
    case "code":
      return (
        <pre
          key={key}
          className="overflow-x-auto rounded-md border border-border bg-navy-950 p-3 font-mono text-xs leading-5 text-navy-50 scrollbar-thin"
          data-lang={block.lang ?? undefined}
        >
          <code>{block.text}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote
          key={key}
          className="border-l-4 border-gold bg-gold-light/40 px-3 py-2 text-ink-muted [&>p]:leading-relaxed"
        >
          {block.children.map((child, index) => renderBlock(child, `${key}-${index}`))}
        </blockquote>
      );
    case "hr":
      return <hr key={key} className="my-4 border-border" />;
  }
}

export interface MarkdownProps {
  source: string;
  className?: string;
  /** Text shown when the source is empty. */
  empty?: ReactNode;
}

/** Renders markdown through the safe parser as React elements. */
export function Markdown({
  source,
  className,
  empty = <span className="text-ink-subtle">Nothing to preview yet.</span>,
}: MarkdownProps) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  if (blocks.length === 0) return <div className={cn("text-sm", className)}>{empty}</div>;
  return (
    <div className={cn("space-y-3 text-sm text-ink", className)} data-testid="markdown-preview">
      {blocks.map((block, index) => renderBlock(block, `b${index}`))}
    </div>
  );
}
