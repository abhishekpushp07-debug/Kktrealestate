// Lightweight toast: call toast.success("…") anywhere; <ToastHost/> is mounted once in the root layout.
import { useEffect, useRef, useState } from "react";
import { Animated, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";

import { fonts, makeStyles, radius, useTheme } from "@/src/theme";

type Kind = "success" | "error" | "info";
type Item = { id: number; kind: Kind; text: string };
let listener: ((i: Item) => void) | null = null;
let seq = 0;

const emit = (kind: Kind, text: string) => listener?.({ id: ++seq, kind, text });
export const toast = {
  success: (t: string) => emit("success", t),
  error: (t: string) => emit("error", t),
  info: (t: string) => emit("info", t),
};

export function ToastHost() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [item, setItem] = useState<Item | null>(null);
  const [anim] = useState(() => new Animated.Value(0));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    listener = (i) => {
      setItem(i);
      if (timer.current) clearTimeout(timer.current);
      Animated.spring(anim, { toValue: 1, useNativeDriver: false, friction: 8 }).start();
      timer.current = setTimeout(() => {
        Animated.timing(anim, { toValue: 0, duration: 200, useNativeDriver: false }).start(() => setItem(null));
      }, 3200);
    };
    return () => {
      listener = null;
    };
  }, [anim]);

  if (!item) return null;
  const icon = item.kind === "success" ? "check-circle" : item.kind === "error" ? "alert-circle" : "info";
  const tint = item.kind === "success" ? colors.success : item.kind === "error" ? colors.error : colors.gold;
  return (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top + 10 }]}>
      <Animated.View
        testID="toast"
        style={[styles.toast, { opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }] }]}
      >
        <Feather name={icon} size={18} color={tint} />
        <Text style={styles.text} testID={`toast-${item.kind}`}>
          {item.text}
        </Text>
      </Animated.View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { position: "absolute", left: 0, right: 0, alignItems: "center", zIndex: 1000, paddingHorizontal: 16 },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: c.surfaceInverse,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: radius.md,
    maxWidth: 480,
    width: "100%",
  },
  text: { color: c.onSurfaceInverse, fontFamily: fonts.semibold, fontSize: 14, flex: 1 },
}));
