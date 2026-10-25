import { Columns2, Eye, PenLine } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";
import { Button, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";
import { parseMarkdown, readingMinutes, type BlockNode, type InlineNode } from "./markdown";

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
          <a key={key} href={node.href} title={node.title ?? undefined} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined} className="text-navy-700 underline underline-offset-2 hover:text-navy-950">
            {renderInline(node.children, key)}
          </a>
        );
      }
      case "image":
        return <img key={key} src={node.src} alt={node.alt} loading="lazy" className="my-2 max-h-96 max-w-full rounded-md border border-border" />;
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
        <Tag key={key} start={block.ordered && block.start !== 1 ? block.start : undefined} className={cn("space-y-1 pl-6", block.ordered ? "list-decimal" : "list-disc")}>
          {block.items.map((item, index) => (
            <li key={`${key}-${index}`}>{renderInline(item, `${key}-${index}`)}</li>
          ))}
        </Tag>
      );
    }
    case "code":
      return (
        <pre key={key} className="overflow-x-auto rounded-md border border-border bg-navy-950 p-3 font-mono text-xs leading-5 text-navy-50 scrollbar-thin" data-lang={block.lang ?? undefined}>
          <code>{block.text}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote key={key} className="border-l-4 border-gold bg-gold-light/40 px-3 py-2 text-ink-muted [&>p]:leading-relaxed">
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
export function Markdown({ source, className, empty = <span className="text-ink-subtle">Nothing to preview yet.</span> }: MarkdownProps) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  if (blocks.length === 0) return <div className={cn("text-sm", className)}>{empty}</div>;
  return (
    <div className={cn("space-y-3 text-sm text-ink", className)} data-testid="markdown-preview">
      {blocks.map((block, index) => renderBlock(block, `b${index}`))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Editor with split preview                                            */
/* ------------------------------------------------------------------ */

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  rows?: number;
  placeholder?: string;
  maxLength?: number;
  /** Start in split mode on lg+ (default true). */
  split?: boolean;
  className?: string;
  "data-testid"?: string;
}

type EditorMode = "write" | "preview" | "split";

const TOOLBAR: ReadonlyArray<{ label: string; before: string; after: string; block?: boolean }> = [
  { label: "H2", before: "## ", after: "", block: true },
  { label: "B", before: "**", after: "**" },
  { label: "I", before: "*", after: "*" },
  { label: "Link", before: "[", after: "](https://)" },
  { label: "List", before: "- ", after: "", block: true },
  { label: "Quote", before: "> ", after: "", block: true },
  { label: "Code", before: "`", after: "`" },
];

/** Textarea + live preview (write / preview / split) with a tiny formatting toolbar. */
export function MarkdownEditor({ value, onChange, id, invalid, disabled, rows = 14, placeholder = "Write in Markdown…", maxLength = 100_000, split = true, className, ...rest }: MarkdownEditorProps) {
  const generatedId = useId();
  const textareaId = id ?? generatedId;
  const [mode, setMode] = useState<EditorMode>(split ? "split" : "write");
  const words = value.trim() ? value.trim().split(/\s+/).length : 0;

  const wrap = (before: string, after: string, block: boolean | undefined) => {
    const textarea = document.getElementById(textareaId);
    if (!(textarea instanceof HTMLTextAreaElement)) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.slice(start, end);
    let next: string;
    let cursor: number;
    if (block) {
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      next = `${value.slice(0, lineStart)}${before}${value.slice(lineStart)}`;
      cursor = end + before.length;
    } else {
      next = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`;
      cursor = selected ? end + before.length + after.length : start + before.length;
    }
    onChange(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(cursor, cursor);
    });
  };

  const showWrite = mode !== "preview";
  const showPreview = mode !== "write";

  return (
    <div className={cn("overflow-hidden rounded-md border bg-card", invalid ? "border-danger" : "border-border-strong", className)} data-testid={rest["data-testid"]}>
      <div className="flex flex-wrap items-center gap-1 border-b border-border bg-surface px-2 py-1">
        <div className="flex items-center gap-0.5" role="toolbar" aria-label="Formatting">
          {TOOLBAR.map((tool) => (
            <Button key={tool.label} type="button" size="xs" variant="ghost" disabled={disabled} onClick={() => wrap(tool.before, tool.after, tool.block)} className={cn("min-w-7 px-1.5", tool.label === "B" && "font-bold", tool.label === "I" && "italic")} aria-label={tool.label}>
              {tool.label}
            </Button>
          ))}
        </div>
        <span className="money ml-auto hidden text-2xs text-ink-subtle sm:inline">
          {words} words · {readingMinutes(value)} min read
        </span>
        <div className="flex items-center gap-0.5" role="tablist" aria-label="Editor mode">
          <Button type="button" size="xs" variant={mode === "write" ? "primary" : "ghost"} leftIcon={PenLine} onClick={() => setMode("write")} aria-pressed={mode === "write"}>
            Write
          </Button>
          <Button type="button" size="xs" variant={mode === "preview" ? "primary" : "ghost"} leftIcon={Eye} onClick={() => setMode("preview")} aria-pressed={mode === "preview"}>
            Preview
          </Button>
          <Button type="button" size="xs" variant={mode === "split" ? "primary" : "ghost"} leftIcon={Columns2} onClick={() => setMode("split")} aria-pressed={mode === "split"} className="hidden lg:inline-flex">
            Split
          </Button>
        </div>
      </div>
      <div className={cn("grid", showWrite && showPreview && "lg:grid-cols-2")}>
        {showWrite && (
          <Textarea
            id={textareaId}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            rows={rows}
            maxLength={maxLength}
            placeholder={placeholder}
            disabled={disabled}
            invalid={invalid}
            spellCheck
            className={cn("rounded-none border-0 font-mono text-xs leading-5 focus-visible:ring-0", showPreview && "lg:border-r lg:border-border")}
            aria-label="Markdown source"
          />
        )}
        {showPreview && (
          <div className={cn("max-h-[32rem] overflow-y-auto p-4 scrollbar-thin", showWrite && "hidden lg:block")} aria-live="polite">
            <Markdown source={value} />
          </div>
        )}
        {showPreview && showWrite && (
          <div className="border-t border-border p-4 lg:hidden">
            <Markdown source={value} />
          </div>
        )}
      </div>
    </div>
  );
}
