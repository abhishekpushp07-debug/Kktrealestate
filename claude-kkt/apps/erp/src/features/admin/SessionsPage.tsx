import { useQuery } from "@tanstack/react-query";
import { Laptop, LogOut, MonitorSmartphone, Smartphone, Tablet, type LucideIcon } from "lucide-react";
import { useState } from "react";
import type { SessionRow } from "@kkt/contracts";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/ui";
import { api, type ApiClientError, type ListEnvelope } from "@/lib/api";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useMutationWithToast } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { SESSIONS_PATH } from "./adminApi";

export interface DeviceInfo {
  label: string;
  icon: LucideIcon;
}

/** Rough device label from a user-agent string ("Chrome on Windows"). */
export function describeDevice(userAgent: string | null): DeviceInfo {
  if (!userAgent) return { label: "Unknown device", icon: MonitorSmartphone };
  const ua = userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  if (/iPad/.test(ua)) return { label: `${browser} on iPad`, icon: Tablet };
  if (/iPhone/.test(ua)) return { label: `${browser} on iPhone`, icon: Smartphone };
  if (/Android/.test(ua)) return { label: `${browser} on Android`, icon: /Mobile/.test(ua) ? Smartphone : Tablet };
  if (/Windows/.test(ua)) return { label: `${browser} on Windows`, icon: Laptop };
  if (/Mac OS X/.test(ua)) return { label: `${browser} on macOS`, icon: Laptop };
  if (/Linux/.test(ua)) return { label: `${browser} on Linux`, icon: Laptop };
  return { label: browser, icon: MonitorSmartphone };
}

function normaliseSessions(raw: ListEnvelope<SessionRow> | SessionRow[]): SessionRow[] {
  return Array.isArray(raw) ? raw : raw.items;
}

/** `/sessions` — every signed-in device of the current account, with revoke. */
export default function SessionsPage() {
  const query = useQuery<ListEnvelope<SessionRow> | SessionRow[], ApiClientError, SessionRow[]>({
    queryKey: [SESSIONS_PATH],
    queryFn: ({ signal }) => api.get<ListEnvelope<SessionRow> | SessionRow[]>(SESSIONS_PATH, { signal }),
    select: normaliseSessions,
  });
  const [revoking, setRevoking] = useState<SessionRow | null>(null);
  const [revokeAll, setRevokeAll] = useState(false);

  const revoke = useMutationWithToast<void, SessionRow>({
    mutationFn: (session) => api.delete<void>(`${SESSIONS_PATH}/${session.id}`),
    successMessage: "Device signed out",
    invalidate: [[SESSIONS_PATH]],
  });
  const revokeOthers = useMutationWithToast<void, void>({
    mutationFn: () => api.delete<void>(SESSIONS_PATH),
    successMessage: "All other devices signed out",
    invalidate: [[SESSIONS_PATH]],
  });

  const sessions = [...(query.data ?? [])].sort((a, b) => Number(b.is_current) - Number(a.is_current) || Date.parse(b.last_used_at ?? b.created_at) - Date.parse(a.last_used_at ?? a.created_at));
  const others = sessions.filter((session) => !session.is_current);

  return (
    <>
      <PageHeader
        title="Devices & sessions"
        description="Every device holding a refresh token for your account. Signing a device out revokes its whole token family."
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "Account" }, { label: "Devices & sessions" }]}
        actions={
          <Button variant="danger-outline" leftIcon={LogOut} disabled={others.length === 0} onClick={() => setRevokeAll(true)} data-testid="sessions-revoke-others-btn">
            Sign out other devices
          </Button>
        }
      />
      <Card className="overflow-hidden">
        {query.isPending && (
          <ul className="divide-y divide-border">
            {Array.from({ length: 3 }, (_, index) => (
              <li key={index} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="size-9 rounded-md" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </li>
            ))}
          </ul>
        )}
        {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />}
        {query.data && sessions.length === 0 && <EmptyState compact icon={MonitorSmartphone} title="No active sessions" description="Sign in again to see this device listed." />}
        {sessions.length > 0 && (
          <ul className="divide-y divide-border" data-testid="sessions-list">
            {sessions.map((session) => {
              const device = describeDevice(session.user_agent);
              const Icon = device.icon;
              return (
                <li key={session.id} className={cn("flex flex-wrap items-center gap-3 px-4 py-3", session.is_current && "bg-gold-light/40")} data-testid={`session-${session.id}`}>
                  <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-md", session.is_current ? "bg-navy-950 text-gold" : "bg-navy-50 text-navy-700")}>
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-navy-950">{device.label}</span>
                      {session.is_current && <Badge variant="gold">This device</Badge>}
                    </div>
                    <p className="money truncate text-xs text-ink-subtle" title={session.user_agent ?? undefined}>
                      {session.ip ?? "IP unknown"} · signed in {formatDateTime(session.created_at)} · last active {session.last_used_at ? formatRelative(session.last_used_at) : "—"} · expires {formatDateTime(session.expires_at)}
                    </p>
                  </div>
                  {!session.is_current && (
                    <Button variant="outline" size="sm" leftIcon={LogOut} onClick={() => setRevoking(session)} data-testid={`session-revoke-${session.id}`}>
                      Sign out
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Sign out this device?"
        description={revoking ? `${describeDevice(revoking.user_agent).label} (${revoking.ip ?? "IP unknown"}) will need to sign in again.` : undefined}
        confirmLabel="Sign out"
        variant="destructive"
        onConfirm={async () => {
          if (revoking) await revoke.mutateAsync(revoking);
        }}
      />
      <ConfirmDialog
        open={revokeAll}
        onOpenChange={setRevokeAll}
        title="Sign out all other devices?"
        description={`${others.length} other device${others.length === 1 ? "" : "s"} will be signed out. This device stays signed in.`}
        confirmLabel="Sign out others"
        variant="destructive"
        onConfirm={() => revokeOthers.mutateAsync()}
      />
    </>
  );
}
