import { CircleAlert, RefreshCw, SearchX, ShieldAlert } from "lucide-react";
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

/**
 * Error panel for a failed query. 403 and 404 get their own copy and no Retry button (retrying cannot help): a scoped user sees
 * "not found" for records outside their projects (SPEC §2), and a role without the permission sees "no access".
 */
export function ErrorState({ error, title, description, onRetry, retrying, className, compact = false }: ErrorStateProps) {
  const api = isApiClientError(error) ? error : undefined;
  const requestId = api?.requestId;
  const kind = api?.status === 403 ? "forbidden" : api?.status === 404 ? "not-found" : "error";
  const Icon = kind === "forbidden" ? ShieldAlert : kind === "not-found" ? SearchX : CircleAlert;
  const heading = title ?? (kind === "forbidden" ? "You don't have access to this" : kind === "not-found" ? "Not found" : "Something went wrong");
  const fallback = kind === "forbidden" ? "Your role does not include the permission this needs. Ask a Super Admin if you believe you should have it." : kind === "not-found" ? "It may have been removed, or it is outside the projects you can see." : "Please try again.";
  const text = description ?? (kind === "error" && error ? describeError(error) : fallback);
  const canRetry = onRetry && kind === "error";
  return (
    <div role="alert" data-error-kind={kind} className={cn("flex flex-col items-center justify-center text-center", compact ? "px-4 py-8" : "px-4 py-14", className)}>
      <span className={cn("mb-3 flex items-center justify-center rounded-full", kind === "error" ? "bg-danger-bg text-danger-fg" : "bg-navy-50 text-navy-700", compact ? "size-10" : "size-14")}>
        <Icon className={compact ? "size-5" : "size-7"} aria-hidden="true" />
      </span>
      <h3 className={cn("font-display font-bold text-navy-950", compact ? "text-sm" : "text-lg")}>{heading}</h3>
      <p className={cn("mt-1 max-w-md text-ink-subtle", compact ? "text-xs" : "text-sm")}>{text}</p>
      {requestId && <p className="mt-1 font-mono text-2xs text-ink-subtle">Request {requestId}</p>}
      {canRetry && (
        <Button variant="outline" size="sm" className="mt-4" leftIcon={RefreshCw} onClick={onRetry} loading={retrying}>
          Retry
        </Button>
      )}
    </div>
  );
}
