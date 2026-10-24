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
  wrap = true,
}: {
  wrap?: boolean;
  items: { key: K; label: string; count?: number }[];
  value: K;
  onChange: (k: K) => void;
  testIDPrefix: string;
}) {
  const s = useStyles();
  const body = items.map((it) => {
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
      });
  // Wrapping rows by default so nothing is cut off on narrow screens.
  if (wrap)
    return (
      <View style={[s.row, s.wrap]} testID={`${testIDPrefix}-tabs`}>
        {body}
      </View>
    );
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row} testID={`${testIDPrefix}-tabs`}>
      {body}
      <View style={{ width: 4 }} />
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  row: { gap: 8, paddingVertical: 2 },
  wrap: { flexDirection: "row", flexWrap: "wrap" },
  pill: { minHeight: 42, paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border, justifyContent: "center" },
  pillOn: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  text: { fontFamily: fonts.semibold, fontSize: 13.5, lineHeight: 18, color: c.onSurfaceTertiary },
  textOn: { color: c.onBrandPrimary },
}));
