import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useUnreadCount } from "@/api/queries";
import { useAuth } from "@/auth/AuthProvider";
import { Badge } from "@/ui/Chip";
import { Card } from "@/ui/Card";
import { Avatar, ListRow } from "@/ui/ListRow";
import { useDocumentTitle, Screen, Section } from "@/ui/Screen";
import { ConfirmDialog } from "@/ui/Sheet";
import { T } from "@/ui/Text";
import { colors, space } from "@/ui/theme";
import { TabHeader } from "./shared";

export function MoreScreen(): React.JSX.Element {
  useDocumentTitle("More");
  const router = useRouter();
  const { user, logout } = useAuth();
  const unread = useUnreadCount().data?.count ?? 0;
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <View style={{ flex: 1, backgroundColor: colors.ivory }}>
      <TabHeader title="More" />
      <Screen>
        <Card onPress={() => router.navigate("/more/profile")}>
          <View style={styles.profile}>
            <Avatar name={user?.full_name ?? "?"} size={52} />
            <View style={{ flex: 1 }}>
              <T variant="h3">{user?.full_name ?? ""}</T>
              <T variant="small" color={colors.inkMuted}>
                {user?.customer_code ?? ""} · {user?.phone ?? ""}
              </T>
              <T variant="caption" color={colors.navy} style={{ marginTop: 4 }}>
                View & edit profile
              </T>
            </View>
          </View>
        </Card>
        <Section title="Services">
          <Card padded={false}>
            <ListRow
              icon="document"
              title="Documents"
              subtitle="Statement, allotment letter, shared files"
              onPress={() => router.navigate("/more/documents")}
            />
            <ListRow
              icon="request"
              title="Requests"
              subtitle="Raise and track service requests"
              onPress={() => router.navigate("/more/requests")}
            />
            <ListRow
              icon="notice"
              title="Notices"
              subtitle="Announcements for your project"
              onPress={() => router.navigate("/more/notices")}
            />
            <ListRow
              icon="bell"
              title="Notifications"
              right={<Badge count={unread} />}
              onPress={() => router.navigate("/more/notifications")}
              last
            />
          </Card>
        </Section>
        <Section title="Account">
          <Card padded={false}>
            <ListRow
              icon="bank"
              title="Bank details"
              subtitle="For Account-bucket transfers"
              onPress={() => router.navigate("/more/bank-details")}
            />
            <ListRow icon="lock" title="Change password" onPress={() => router.navigate("/more/password")} />
            <ListRow
              icon="devices"
              title="Devices & sessions"
              subtitle="See where you're signed in"
              onPress={() => router.navigate("/more/sessions")}
            />
            <ListRow icon="logout" title="Sign out" destructive chevron={false} onPress={() => setConfirm(true)} last />
          </Card>
        </Section>
        <T variant="caption" color={colors.inkSubtle} align="center">
          KKT Customer Portal · v2.0
        </T>
      </Screen>
      <ConfirmDialog
        visible={confirm}
        title="Sign out?"
        body="You'll need your phone number and password to sign back in."
        confirmLabel="Sign out"
        destructive
        loading={busy}
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          setBusy(true);
          void logout().finally(() => setBusy(false));
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({ profile: { flexDirection: "row", alignItems: "center", gap: space.md } });
