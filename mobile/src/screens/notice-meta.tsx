import { View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { fmtDate } from "@/src/format";
import { useTheme } from "@/src/theme";
import { Chip } from "@/src/ui/primitives";
import { T } from "@/src/ui/text";

export type Notice = { id: string; title: string; body: string; project_names?: string[]; publish_at?: string; expires_at?: string | null; pinned?: boolean; read?: boolean };

export function NoticeMeta({ n }: { n: Notice }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {n.pinned ? <Feather name="bookmark" size={12} color={colors.gold} /> : null}
      <T v="label" tone="muted">
        {n.project_names?.length ? n.project_names.join(", ") : "All projects"} · {fmtDate(n.publish_at)}
        {n.expires_at ? ` · till ${fmtDate(n.expires_at)}` : ""}
      </T>
      {!n.read ? <Chip label="New" tone="gold" testID={`notice-new-${n.id}`} /> : null}
    </View>
  );
}

