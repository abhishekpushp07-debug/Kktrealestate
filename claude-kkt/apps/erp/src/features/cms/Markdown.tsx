import { Columns2, Eye, PenLine } from "lucide-react";
import { useId, useState } from "react";
import { Button, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";
import { Markdown } from "./MarkdownView";
import { readingMinutes } from "./markdown";

export { Markdown, type MarkdownProps } from "./MarkdownView";

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
export function MarkdownEditor({
  value,
  onChange,
  id,
  invalid,
  disabled,
  rows = 14,
  placeholder = "Write in Markdown…",
  maxLength = 100_000,
  split = true,
  className,
  ...rest
}: MarkdownEditorProps) {
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
    <div
      className={cn(
        "overflow-hidden rounded-md border bg-card",
        invalid ? "border-danger" : "border-border-strong",
        className,
      )}
      data-testid={rest["data-testid"]}
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-border bg-surface px-2 py-1">
        <div className="flex items-center gap-0.5" role="toolbar" aria-label="Formatting">
          {TOOLBAR.map((tool) => (
            <Button
              key={tool.label}
              type="button"
              size="xs"
              variant="ghost"
              disabled={disabled}
              onClick={() => wrap(tool.before, tool.after, tool.block)}
              className={cn("min-w-7 px-1.5", tool.label === "B" && "font-bold", tool.label === "I" && "italic")}
              aria-label={tool.label}
            >
              {tool.label}
            </Button>
          ))}
        </div>
        <span className="money ml-auto hidden text-2xs text-ink-subtle sm:inline">
          {words} words · {readingMinutes(value)} min read
        </span>
        <div className="flex items-center gap-0.5" role="group" aria-label="Editor mode">
          <Button
            type="button"
            size="xs"
            variant={mode === "write" ? "primary" : "ghost"}
            leftIcon={PenLine}
            onClick={() => setMode("write")}
            aria-pressed={mode === "write"}
          >
            Write
          </Button>
          <Button
            type="button"
            size="xs"
            variant={mode === "preview" ? "primary" : "ghost"}
            leftIcon={Eye}
            onClick={() => setMode("preview")}
            aria-pressed={mode === "preview"}
          >
            Preview
          </Button>
          <Button
            type="button"
            size="xs"
            variant={mode === "split" ? "primary" : "ghost"}
            leftIcon={Columns2}
            onClick={() => setMode("split")}
            aria-pressed={mode === "split"}
            className="hidden lg:inline-flex"
          >
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
            className={cn(
              "rounded-none border-0 font-mono text-xs leading-5 focus-visible:ring-0",
              showPreview && "lg:border-r lg:border-border",
            )}
            aria-label="Markdown source"
          />
        )}
        {showPreview && (
          <div
            className={cn("max-h-[32rem] overflow-y-auto p-4 scrollbar-thin", showWrite && "hidden lg:block")}
            aria-live="polite"
          >
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
