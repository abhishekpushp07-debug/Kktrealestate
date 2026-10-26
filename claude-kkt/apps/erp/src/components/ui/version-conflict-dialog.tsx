import { History, RefreshCw } from "lucide-react";
import { AlertDialog } from "radix-ui";
import { useState } from "react";
import { formatDateTime } from "@/lib/format";
import { useVersionConflict, conflictStore } from "@/lib/conflict-store";
import { Button } from "./button";

export interface VersionConflictDialogProps {
  open: boolean;
  entityLabel?: string;
  changedBy: string | null;
  changedAt?: string | null;
  currentVersion?: number | null;
  onReload: () => void | Promise<unknown>;
  onDismiss: () => void;
}

/** Shown on 409 VERSION_CONFLICT: who changed the record and a reload action. */
export function VersionConflictDialog({
  open,
  entityLabel = "This record",
  changedBy,
  changedAt,
  currentVersion,
  onReload,
  onDismiss,
}: VersionConflictDialogProps) {
  const [reloading, setReloading] = useState(false);
  const reload = async () => {
    setReloading(true);
    try {
      await onReload();
      onDismiss();
    } finally {
      setReloading(false);
    }
  };
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => !next && !reloading && onDismiss()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[60] bg-navy-950/55 data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-[60] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border border-border bg-card shadow-pop outline-none data-[state=open]:animate-zoom-in data-[state=closed]:animate-zoom-out sm:max-w-md">
          <div className="flex gap-3 px-5 pt-5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-warning-bg text-warning-fg">
              <History className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 space-y-1">
              <AlertDialog.Title className="font-display text-lg font-bold text-navy-950">
                {entityLabel} was changed by someone else
              </AlertDialog.Title>
              <AlertDialog.Description className="text-sm text-ink-muted">
                {changedBy ? <strong className="font-semibold text-ink">{changedBy}</strong> : "Another user"} saved a
                newer version
                {changedAt ? ` on ${formatDateTime(changedAt, { zone: true })}` : ""}
                {currentVersion ? ` (now v${currentVersion})` : ""}. Your edits were not saved. Reload to see the latest
                data, then re-apply your changes.
              </AlertDialog.Description>
            </div>
          </div>
          <div className="mt-5 flex flex-col-reverse gap-2 border-t border-border bg-surface/60 px-5 py-3 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild>
              <Button variant="outline" disabled={reloading}>
                Keep editing
              </Button>
            </AlertDialog.Cancel>
            <Button leftIcon={RefreshCw} loading={reloading} onClick={() => void reload()}>
              Reload latest
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

/** Mount once (app.tsx): renders the dialog for conflicts raised by useMutationWithToast. */
export function VersionConflictHost() {
  const conflict = useVersionConflict();
  return (
    <VersionConflictDialog
      open={conflict !== null}
      entityLabel={conflict?.entityLabel}
      changedBy={conflict?.changedBy ?? null}
      changedAt={conflict?.changedAt ?? null}
      currentVersion={conflict?.currentVersion ?? null}
      onReload={() => conflict?.onReload()}
      onDismiss={() => conflictStore.dismiss()}
    />
  );
}
