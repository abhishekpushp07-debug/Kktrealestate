import { KeyRound, Link2, LogOut, MessageCircle, Power, ShieldCheck, Smartphone } from "lucide-react";
import { useState } from "react";
import type { CustomerRow, PortalAccessResponse } from "@kkt/contracts";
import { Button, Card, CardContent, CardHeader, CardTitle, ConfirmDialog, KeyValueList, SimpleDialog, Skeleton, StatusChip } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime, formatPhone, formatRelative } from "@/lib/format";
import { useMutationWithToast } from "@/lib/queries";
import { CopyField } from "@/features/shared/CopyField";
import { CUSTOMERS_PATH, crmKeys, portalBaseUrl, usePortalAccess, whatsappLink } from "../api";

interface TempPasswordResponse extends Partial<PortalAccessResponse> {
  temporary_password?: string | null;
}

function tempPasswordOf(response: TempPasswordResponse): string | null {
  return response.temp_password ?? response.temporary_password ?? null;
}

export function PortalAccessCard({ customer, initial }: { customer: CustomerRow; initial: PortalAccessResponse | null }) {
  const { can, company } = useAuth();
  const canManage = can("customer.portal_manage");
  const portal = usePortalAccess(customer.id, initial === null);
  const state = portal.data ?? initial;
  const [tempPassword, setTempPassword] = useState<{ password: string; kind: "enabled" | "reset" } | null>(null);
  const [confirm, setConfirm] = useState<"disable" | "revoke" | "reset" | null>(null);
  const path = `${CUSTOMERS_PATH}/${customer.id}/portal`;
  const invalidate = [crmKeys.portal(customer.id), crmKeys.customer360(customer.id), [CUSTOMERS_PATH]];

  const enable = useMutationWithToast<TempPasswordResponse, void>({
    mutationFn: () => api.post<TempPasswordResponse>(`${path}/enable`, {}),
    successMessage: "Portal access enabled",
    invalidate,
    onSuccess: (response) => {
      const password = tempPasswordOf(response);
      if (password) setTempPassword({ password, kind: "enabled" });
    },
  });
  const reset = useMutationWithToast<TempPasswordResponse, void>({
    mutationFn: () => api.post<TempPasswordResponse>(`${path}/reset-password`, {}),
    successMessage: "Temporary password issued",
    invalidate,
    onSuccess: (response) => {
      const password = tempPasswordOf(response);
      if (password) setTempPassword({ password, kind: "reset" });
    },
  });
  const disable = useMutationWithToast<unknown, void>({ mutationFn: () => api.post(`${path}/disable`, {}), successMessage: "Portal access disabled", invalidate });
  const revoke = useMutationWithToast<unknown, void>({ mutationFn: () => api.post(`${path}/revoke-sessions`, {}), successMessage: "All portal sessions revoked", invalidate });

  const loginUrl = portalBaseUrl(company?.settings, state?.login_url ?? null);
  const shareText = (password: string | null) =>
    [`Hello ${customer.full_name},`, `Your customer portal login for ${company?.name ?? "our projects"}:`, loginUrl ? `Link: ${loginUrl}` : null, `Mobile: ${customer.phone}`, password ? `Temporary password: ${password} (you will be asked to change it on first login)` : null]
      .filter(Boolean)
      .join("\n");

  return (
    <Card data-testid="portal-access-card">
      <CardHeader actions={state ? <StatusChip status={state.is_enabled ? "ENABLED" : "DISABLED"} label={state.is_enabled ? "Enabled" : "Disabled"} size="sm" /> : undefined}>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="size-4 text-navy-700" aria-hidden="true" /> Portal access
        </CardTitle>
        <p className="text-xs text-ink-subtle">Login is the mobile number. Temporary passwords are shown once and must be changed on first login.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {portal.isPending && !initial ? (
          <Skeleton className="h-16" />
        ) : (
          <KeyValueList
            columns={2}
            items={[
              { label: "Login (mobile)", value: <span className="money">{formatPhone(state?.phone ?? customer.phone)}</span> },
              { label: "Last login", value: state?.last_login_at ? <span title={formatDateTime(state.last_login_at, { zone: true })}>{formatRelative(state.last_login_at)}</span> : "Never" },
              { label: "Enabled on", value: state?.enabled_at ? formatDateTime(state.enabled_at) : null },
              { label: "Active sessions", value: state ? String(state.active_sessions) : null, numeric: true },
              { label: "Must change password", value: state?.must_change_password ? "Yes" : "No" },
              { label: "Locked", value: state?.locked_until && Date.parse(state.locked_until) > Date.now() ? `Until ${formatDateTime(state.locked_until)}` : "No" },
            ]}
          />
        )}
        {portal.isError && !initial && <p className="text-xs text-ink-subtle">Portal state unavailable right now.</p>}
        {canManage && (
          <div className="flex flex-wrap gap-2">
            {!state?.is_enabled ? (
              <Button size="sm" leftIcon={Power} loading={enable.isPending} onClick={() => enable.mutate()} data-testid="portal-enable">
                Enable access
              </Button>
            ) : (
              <>
                <Button size="sm" variant="outline" leftIcon={KeyRound} onClick={() => setConfirm("reset")} data-testid="portal-reset">
                  Reset password
                </Button>
                <Button size="sm" variant="outline" leftIcon={LogOut} onClick={() => setConfirm("revoke")} data-testid="portal-revoke">
                  Revoke sessions
                </Button>
                <Button size="sm" variant="danger-outline" leftIcon={Power} onClick={() => setConfirm("disable")} data-testid="portal-disable">
                  Disable
                </Button>
              </>
            )}
            {loginUrl && (
              <Button asChild size="sm" variant="ghost" leftIcon={Link2}>
                <a href={loginUrl} target="_blank" rel="noreferrer noopener">
                  <Link2 aria-hidden="true" /> Open portal
                </a>
              </Button>
            )}
          </div>
        )}
      </CardContent>

      <ConfirmDialog open={confirm === "reset"} onOpenChange={(open) => !open && setConfirm(null)} title="Reset portal password?" description={`${customer.full_name} gets a new temporary password (shown once) and must change it at the next login.`} confirmLabel="Reset password" onConfirm={async () => { await reset.mutateAsync(); }} />
      <ConfirmDialog open={confirm === "revoke"} onOpenChange={(open) => !open && setConfirm(null)} title="Revoke all portal sessions?" description="Every signed-in device is logged out immediately. The password stays valid." confirmLabel="Revoke sessions" variant="destructive" onConfirm={async () => { await revoke.mutateAsync(); }} />
      <ConfirmDialog open={confirm === "disable"} onOpenChange={(open) => !open && setConfirm(null)} title="Disable portal access?" description={`${customer.full_name} can no longer sign in to the portal. Bookings and documents stay intact; you can enable access again later.`} confirmLabel="Disable" variant="destructive" onConfirm={async () => { await disable.mutateAsync(); }} />

      <SimpleDialog
        open={tempPassword !== null}
        onOpenChange={(open) => !open && setTempPassword(null)}
        title={tempPassword?.kind === "reset" ? "New temporary password" : "Portal access enabled"}
        description="Shown only once. Share it with the customer over a channel you trust."
        size="sm"
        footer={<Button onClick={() => setTempPassword(null)} data-testid="portal-temp-done">Done</Button>}
      >
        {tempPassword && (
          <div className="space-y-3">
            <CopyField value={tempPassword.password} secret label="Copy" />
            {loginUrl && <CopyField value={loginUrl} label="Copy link" />}
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm" leftIcon={MessageCircle}>
                <a href={whatsappLink(customer.phone, shareText(tempPassword.password))} target="_blank" rel="noreferrer noopener" data-testid="portal-whatsapp">
                  <MessageCircle aria-hidden="true" /> Share on WhatsApp
                </a>
              </Button>
              {loginUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={Link2}
                  onClick={() => {
                    void navigator.clipboard.writeText(shareText(null)).catch(() => undefined);
                  }}
                >
                  Copy login message
                </Button>
              )}
            </div>
            <p className="flex items-start gap-2 text-xs text-ink-subtle">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              The customer must set a new password on first login; KYC values stay masked in the portal.
            </p>
          </div>
        )}
      </SimpleDialog>
    </Card>
  );
}
