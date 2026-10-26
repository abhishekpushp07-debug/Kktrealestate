import { TriangleAlert } from "lucide-react";
import { AlertDialog } from "radix-ui";
import { useId, useState, type ReactNode } from "react";
import { describeError } from "@/lib/api";
import { cn, useOnChange } from "@/lib/utils";
import { Button } from "./button";
import { Textarea } from "./input";
import { Label } from "./label";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** destructive = red confirm button and warning icon. */
  variant?: "default" | "destructive";
  /** Ask for a mandatory reason (reversals, cancellations, deactivations). */
  requireReason?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  reasonMinLength?: number;
  /** Return a promise to keep the dialog open with a spinner until it settles. */
  onConfirm: (reason?: string) => void | Promise<unknown>;
  children?: ReactNode;
}

/** Accessible confirmation (Radix AlertDialog) with optional destructive styling and reason textarea. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  requireReason = false,
  reasonLabel = "Reason",
  reasonPlaceholder = "Why is this being done? (recorded in the audit log)",
  reasonMinLength = 3,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasonId = useId();

  useOnChange(open, (isOpen) => {
    if (isOpen) return;
    setReason("");
    setBusy(false);
    setError(null);
  });

  const reasonValid = !requireReason || reason.trim().length >= reasonMinLength;

  const confirm = async () => {
    if (!reasonValid) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(requireReason ? reason.trim() : undefined);
      onOpenChange(false);
    } catch (cause) {
      setError(describeError(cause));
      setBusy(false);
    }
  };

  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-navy-950/55 data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-pop outline-none data-[state=open]:animate-zoom-in data-[state=closed]:animate-zoom-out sm:max-w-md">
          <div className="flex gap-3 px-5 pt-5">
            {variant === "destructive" && (
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-danger-bg text-danger-fg">
                <TriangleAlert className="size-5" aria-hidden="true" />
              </span>
            )}
            <div className="min-w-0 flex-1 space-y-1">
              <AlertDialog.Title className="font-display text-lg font-bold text-navy-950">{title}</AlertDialog.Title>
              {description ? (
                <AlertDialog.Description className="text-sm text-ink-muted">{description}</AlertDialog.Description>
              ) : (
                <AlertDialog.Description className="sr-only">{title}</AlertDialog.Description>
              )}
            </div>
          </div>
          {(children || requireReason || error) && (
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {children}
              {requireReason && (
                <div className="flex flex-col gap-1">
                  <Label htmlFor={reasonId} required>
                    {reasonLabel}
                  </Label>
                  <Textarea
                    id={reasonId}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder={reasonPlaceholder}
                    autoFocus
                    rows={3}
                    maxLength={500}
                    aria-describedby={`${reasonId}-hint`}
                  />
                  <p id={`${reasonId}-hint`} className="text-xs text-ink-subtle">
                    At least {reasonMinLength} characters.
                  </p>
                </div>
              )}
              {error && (
                <p
                  role="alert"
                  className="rounded-md border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger-fg"
                >
                  {error}
                </p>
              )}
            </div>
          )}
          <div
            className={cn(
              "flex flex-col-reverse gap-2 border-t border-border bg-surface/60 px-5 py-3 sm:flex-row sm:justify-end",
              !children && !requireReason && !error && "mt-4",
            )}
          >
            <AlertDialog.Cancel asChild>
              <Button variant="outline" disabled={busy}>
                {cancelLabel}
              </Button>
            </AlertDialog.Cancel>
            <Button
              variant={variant === "destructive" ? "danger" : "primary"}
              loading={busy}
              disabled={!reasonValid}
              onClick={() => void confirm()}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
