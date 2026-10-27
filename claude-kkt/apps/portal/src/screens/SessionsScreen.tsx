import { useState } from "react";
import { StyleSheet, View } from "react-native";
import type { PortalSessionRow } from "@kkt/contracts";
import { errorMessage } from "@/api/client";
import { queryClient, useRevokeOtherSessions, useRevokeSession, useSessions } from "@/api/queries";
import { useAuth } from "@/auth/AuthProvider";
import { formatDateTime, formatRelative } from "@/lib/format";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Chip } from "@/ui/Chip";
import { Icon } from "@/ui/Icon";
import { Header, Screen } from "@/ui/Screen";
import { ConfirmDialog } from "@/ui/Sheet";
import { SkeletonRows } from "@/ui/Skeleton";
import { EmptyState, ErrorState, Notice } from "@/ui/States";
import { T } from "@/ui/Text";
import { useToast } from "@/ui/Toast";
import { colors, radius, space } from "@/ui/theme";

function describe(ua: string | null): string {
  if (!ua) return "Unknown device";
  if (/KKT|Expo|okhttp|CFNetwork|Darwin/i.test(ua) && !/Mozilla/i.test(ua))
    return /iPhone|iOS|Darwin|CFNetwork/i.test(ua) ? "iPhone app" : "Android app";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Mac OS/.test(ua)
      ? "macOS"
      : /Android/.test(ua)
        ? "Android"
        : /iPhone|iPad/.test(ua)
          ? "iOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} on ${os}` : browser;
}

export function SessionsScreen(): React.JSX.Element {
  const q = useSessions();
  const toast = useToast();
  const { logout } = useAuth();
  const revoke = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const [confirmAll, setConfirmAll] = useState(false);
  const rows = q.data ?? [];
  const others = rows.filter((s) => !s.is_current);
  return (
    <View style={{ flex: 1, backgroundColor: colors.ivory }}>
      <Header title="Devices & sessions" subtitle="Where your account is signed in" back />
      <Screen onRefresh={() => queryClient.invalidateQueries({ queryKey: ["sessions"] })}>
        {!q.data ? (
          q.isError ? (
            <ErrorState error={q.error} onRetry={() => void q.refetch()} />
          ) : (
            <SkeletonRows rows={3} />
          )
        ) : rows.length === 0 ? (
          <EmptyState icon="devices" title="No sessions listed" />
        ) : (
          <Card padded={false}>
            {rows.map((s, i) => (
              <SessionRow
                key={s.id}
                s={s}
                last={i === rows.length - 1}
                onRevoke={() =>
                  revoke.mutate(s.id, {
                    onSuccess: () => toast.success("Signed out on that device"),
                    onError: (e) => toast.error(errorMessage(e)),
                  })
                }
                busy={revoke.isPending && revoke.variables === s.id}
              />
            ))}
          </Card>
        )}
        {others.length ? (
          <Notice
            tone="warning"
            title="Don't recognise a device?"
            body="Sign out everywhere else, then change your password."
          >
            <Button
              title="Sign out all other devices"
              variant="danger"
              size="sm"
              style={{ marginTop: space.sm }}
              onPress={() => setConfirmAll(true)}
            />
          </Notice>
        ) : null}
        <Button
          title="Sign out everywhere (including here)"
          variant="outline"
          icon="logout"
          onPress={() => void logout({ allDevices: true })}
        />
      </Screen>
      <ConfirmDialog
        visible={confirmAll}
        title="Sign out other devices?"
        body="Every other phone and browser will need to sign in again."
        confirmLabel="Sign them out"
        destructive
        loading={revokeOthers.isPending}
        onClose={() => setConfirmAll(false)}
        onConfirm={() =>
          revokeOthers.mutate(undefined, {
            onSuccess: () => {
              setConfirmAll(false);
              toast.success("Other devices signed out");
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </View>
  );
}

function SessionRow({
  s,
  last,
  onRevoke,
  busy,
}: {
  s: PortalSessionRow;
  last: boolean;
  onRevoke: () => void;
  busy: boolean;
}): React.JSX.Element {
  return (
    <View style={[styles.row, last ? null : styles.border]}>
      <View style={styles.iconWrap}>
        <Icon name="devices" size={18} color={colors.navy} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <T variant="bodyStrong">{describe(s.user_agent)}</T>
          {s.is_current ? <Chip label="This device" tone="success" small /> : null}
        </View>
        <T variant="caption" color={colors.inkMuted}>
          {s.ip ? `${s.ip} · ` : ""}
          {s.last_used_at ? `active ${formatRelative(s.last_used_at)}` : `signed in ${formatDateTime(s.created_at)}`}
        </T>
      </View>
      {!s.is_current ? <Button title="Sign out" variant="ghost" size="sm" loading={busy} onPress={onRevoke} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md },
  border: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.navy50,
    alignItems: "center",
    justifyContent: "center",
  },
});
