import { CircleAlert, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { describeError, isApiClientError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export interface ErrorStateProps {
  error?: unknown;
  title?: ReactNode;
  description?: ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
  compact?: boolean;
}

export function ErrorState({ error, title = "Something went wrong", description, onRetry, retrying, className, compact = false }: ErrorStateProps) {
  const requestId = isApiClientError(error) ? error.requestId : undefined;
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center text-center", compact ? "px-4 py-8" : "px-4 py-14", className)}>
      <span className={cn("mb-3 flex items-center justify-center rounded-full bg-danger-bg text-danger-fg", compact ? "size-10" : "size-14")}>
        <CircleAlert className={compact ? "size-5" : "size-7"} aria-hidden="true" />
      </span>
      <h3 className={cn("font-display font-bold text-navy-950", compact ? "text-sm" : "text-lg")}>{title}</h3>
      <p className={cn("mt-1 max-w-md text-ink-subtle", compact ? "text-xs" : "text-sm")}>{description ?? (error ? describeError(error) : "Please try again.")}</p>
      {requestId && <p className="mt-1 font-mono text-[10px] text-ink-subtle">Request {requestId}</p>}
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" leftIcon={RefreshCw} onClick={onRetry} loading={retrying}>
          Retry
        </Button>
      )}
    </div>
  );
}
