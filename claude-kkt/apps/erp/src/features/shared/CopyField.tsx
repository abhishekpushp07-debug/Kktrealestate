import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

export interface CopyFieldProps {
  value: string;
  label?: string;
  /** Monospace, larger text (temporary passwords, secrets). */
  secret?: boolean;
  className?: string;
}

/** Read-only value with a copy-to-clipboard button. */
export function CopyField({ value, label = "Copy", secret = false, className }: CopyFieldProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const handle = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(handle);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      toast.error("Could not copy. Select the text and copy it manually.");
    }
  };

  return (
    <div className={cn("flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2", className)}>
      <code
        className={cn(
          "min-w-0 flex-1 select-all break-all",
          secret ? "font-mono text-base font-semibold tracking-wide text-navy-950" : "font-mono text-xs text-ink",
        )}
      >
        {value}
      </code>
      <Button
        variant="outline"
        size="sm"
        leftIcon={copied ? Check : Copy}
        onClick={() => void copy()}
        data-testid="copy-field-btn"
      >
        {copied ? "Copied" : label}
      </Button>
    </div>
  );
}
