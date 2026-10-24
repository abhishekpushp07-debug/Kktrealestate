import { ScrollView, View } from "react-native";

import { haptic } from "@/src/haptics";
import { fonts, makeStyles, radius } from "@/src/theme";
import { Press } from "./primitives";
import { T } from "./text";

// Horizontally scrolling pill tabs (segmented control / filter chips).
export function Pills<K extends string>({
  items,
  value,
  onChange,
  testIDPrefix,
}: {
  items: { key: K; label: string; count?: number }[];
  value: K;
  onChange: (k: K) => void;
  testIDPrefix: string;
}) {
  const s = useStyles();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row} testID={`${testIDPrefix}-tabs`}>
      {items.map((it) => {
        const on = it.key === value;
        return (
          <Press
            key={it.key}
            haptics={false}
            testID={`${testIDPrefix}-${it.key}`}
            onPress={() => {
              haptic.select();
              onChange(it.key);
            }}
            style={[s.pill, on && s.pillOn]}
          >
            <T style={[s.text, on && s.textOn]}>
              {it.label}
              {it.count ? ` · ${it.count}` : ""}
            </T>
          </Press>
        );
      })}
      <View style={{ width: 4 }} />
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  row: { gap: 8, paddingVertical: 2 },
  pill: { minHeight: 42, paddingHorizontal: 16, borderRadius: radius.pill, backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border, justifyContent: "center" },
  pillOn: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  text: { fontFamily: fonts.semibold, fontSize: 13, color: c.onSurfaceTertiary },
  textOn: { color: c.onBrandPrimary },
}));
