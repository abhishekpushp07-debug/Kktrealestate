import { Download, KeyRound, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import type { PortalBulkCredential, PortalBulkEnableResponse } from "@kkt/contracts";
import { Button, SimpleDialog, Skeleton } from "@/components/ui";
import { api, describeError, saveBlob } from "@/lib/api";
import { toCsv } from "@/lib/csv";
import { formatNumber, formatPhone, todayIST } from "@/lib/format";
import { useMutationWithToast } from "@/lib/queries";
import { Notice } from "@/features/inventory/components";
import { CUSTOMERS_PATH } from "./api";

const BULK_PATH = `${CUSTOMERS_PATH}/portal/bulk-enable`;

/** The one-time credentials as a CSV (customer code, name, phone, temporary password). */
export function credentialsCsv(rows: readonly PortalBulkCredential[]): string {
  return toCsv(
    ["customer_code", "full_name", "phone", "temporary_password"],
    rows.map((row) => [row.customer_code, row.full_name, row.phone, row.temporary_password || row.temp_password]),
  );
}

/** Summary line of a finished bulk enable (failed > 0 → re-run hint). */
export function bulkEnableSummary(
  result: Pick<PortalBulkEnableResponse, "enabled" | "already_enabled" | "failed">,
): string {
  const parts = [
    `Portal enabled for ${formatNumber(result.enabled)} ${result.enabled === 1 ? "customer" : "customers"}`,
  ];
  if (result.already_enabled) parts.push(`${formatNumber(result.already_enabled)} already had access`);
  if (result.failed) parts.push(`${formatNumber(result.failed)} not enabled`);
  return parts.join(" · ");
}

/**
 * Bulk portal enable (customer.portal_manage): a dry run counts the buyers, the real call returns each new login's temporary password
 * exactly once. The dialog keeps them on screen until it is closed and offers them as a CSV; nothing is stored in the browser.
 */
export function BulkPortalEnableDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [preview, setPreview] = useState<PortalBulkEnableResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [result, setResult] = useState<PortalBulkEnableResponse | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [warnClose, setWarnClose] = useState(false);

  // Mounted with a `key` that changes when it opens, so every opening starts from a fresh dry run.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api.post<PortalBulkEnableResponse>(BULK_PATH, { dry_run: true }).then(
      (response) => !cancelled && setPreview(response),
      (error: unknown) => !cancelled && setPreviewError(describeError(error)),
    );
    return () => {
      cancelled = true;
    };
  }, [open]);

  const enable = useMutationWithToast<PortalBulkEnableResponse, void>({
    mutationFn: () => api.post<PortalBulkEnableResponse>(BULK_PATH, { dry_run: false }),
    successMessage: (response) => bulkEnableSummary(response),
    invalidate: [[CUSTOMERS_PATH]],
    onSuccess: (response) => setResult(response),
  });

  const download = () => {
    if (!result) return;
    saveBlob(
      new Blob([credentialsCsv(result.credentials)], { type: "text/csv;charset=utf-8" }),
      `portal-credentials-${todayIST()}.csv`,
    );
    setDownloaded(true);
  };

  const unsaved = Boolean(result && result.credentials.length > 0 && !downloaded);
  /** Closing with passwords nobody downloaded needs a second click (they cannot be fetched again). */
  const requestClose = () => {
    if (enable.isPending) return;
    if (unsaved && !warnClose) {
      setWarnClose(true);
      return;
    }
    onOpenChange(false);
  };

  return (
    <SimpleDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : requestClose())}
      title={result ? "Portal logins created" : "Enable portal access for every buyer?"}
      description={
        result
          ? "These temporary passwords are shown only now. Download the CSV and share each password with its buyer; they must change it at first sign-in."
          : "Every customer with an active booking and no portal login gets one, with a temporary password."
      }
      size={result ? "lg" : "sm"}
      footer={
        result ? (
          <>
            {result.credentials.length > 0 && (
              <Button variant="gold" leftIcon={Download} onClick={download} data-testid="bulk-credentials-csv">
                Download CSV
              </Button>
            )}
            <Button
              variant={warnClose && unsaved ? "danger-outline" : "outline"}
              onClick={requestClose}
              data-testid="bulk-credentials-close"
            >
              {warnClose && unsaved ? "Discard passwords" : "Done"}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={requestClose} disabled={enable.isPending}>
              Cancel
            </Button>
            <Button
              leftIcon={UsersRound}
              loading={enable.isPending}
              disabled={!preview || preview.enabled === 0}
              onClick={() => enable.mutate()}
              data-testid="bulk-enable-confirm"
            >
              {preview ? `Enable for ${formatNumber(preview.enabled)}` : "Enable"}
            </Button>
          </>
        )
      }
    >
      {!result && (
        <div className="space-y-2 text-sm">
          {!preview && !previewError && <Skeleton className="h-10" />}
          {previewError && <Notice tone="danger">{previewError}</Notice>}
          {preview && (
            <p data-testid="bulk-enable-preview">
              {preview.enabled === 0
                ? "Every buyer with an active booking already has portal access."
                : `${formatNumber(preview.enabled)} ${preview.enabled === 1 ? "buyer gets" : "buyers get"} a portal login.`}
              {preview.already_enabled ? ` ${formatNumber(preview.already_enabled)} already have one.` : ""}
            </p>
          )}
        </div>
      )}
      {result && (
        <div className="space-y-3" data-testid="bulk-credentials">
          {warnClose && unsaved && (
            <Notice tone="danger" data-testid="bulk-credentials-unsaved">
              You haven't downloaded the passwords. They cannot be shown again: download the CSV, or press “Discard
              passwords”.
            </Notice>
          )}
          {(result.failed ?? 0) > 0 && (
            <Notice tone="warning" data-testid="bulk-enable-failed">
              {formatNumber(result.failed ?? 0)} {result.failed === 1 ? "customer was" : "customers were"} not enabled;
              run bulk enable again for them.
            </Notice>
          )}
          {result.credentials.length === 0 ? (
            <Notice tone="info">No new logins were created.</Notice>
          ) : (
            <>
              <Notice tone="warning">
                <KeyRound className="mr-1 inline size-4 align-text-bottom" aria-hidden="true" />
                Shown once. Closing this dialog discards the passwords; a lost one can be reset from the customer's
                page.
              </Notice>
              <div
                className="max-h-80 overflow-auto rounded-md border border-border"
                role="region"
                aria-label="New portal logins"
                tabIndex={0}
              >
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface text-left text-xs text-ink-muted">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Customer</th>
                      <th className="px-3 py-2 font-semibold">Phone (login)</th>
                      <th className="px-3 py-2 font-semibold">Temporary password</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {result.credentials.map((row) => (
                      <tr key={row.customer_id}>
                        <td className="px-3 py-1.5">
                          <span className="block font-medium">{row.full_name}</span>
                          <span className="block font-mono text-2xs text-ink-subtle">{row.customer_code}</span>
                        </td>
                        <td className="money px-3 py-1.5">{formatPhone(row.phone)}</td>
                        <td className="px-3 py-1.5 font-mono">{row.temporary_password || row.temp_password}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </SimpleDialog>
  );
}
