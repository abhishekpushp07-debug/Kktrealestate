import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { haptics } from "@/lib/haptics";
import { T } from "./Text";
import { colors, radius } from "./theme";

export interface Segment<K extends string> {
  key: K;
  label: string;
  count?: number;
}

export function SegmentedControl<K extends string>({ segments, value, onChange, scroll }: { segments: ReadonlyArray<Segment<K>>; value: K; onChange: (k: K) => void; scroll?: boolean }): React.JSX.Element {
  const items = segments.map((s) => {
    const active = s.key === value;
    return (
      <Pressable
        key={s.key}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        onPress={() => {
          if (!active) {
            haptics.select();
            onChange(s.key);
          }
        }}
        style={({ pressed }) => [styles.seg, active ? styles.active : null, scroll ? null : { flex: 1 }, pressed ? { opacity: 0.85 } : null]}
      >
        <T variant="caption" color={active ? colors.navy : colors.inkMuted} style={{ fontSize: 13 }} numberOfLines={1}>
          {s.label}
          {typeof s.count === "number" && s.count > 0 ? ` · ${s.count}` : ""}
        </T>
      </Pressable>
    );
  });
  if (scroll) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.track}>
        {items}
      </ScrollView>
    );
  }
  return <View style={styles.track}>{items}</View>;
}

const styles = StyleSheet.create({
  track: { flexDirection: "row", backgroundColor: colors.navy100, borderRadius: radius.pill, padding: 2, gap: 2 },
  seg: { minHeight: 44, paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  active: { backgroundColor: colors.surface, boxShadow: "0 1px 4px rgba(11,31,58,0.12)" },
});
