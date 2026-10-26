import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Platform, StyleSheet, View } from "react-native";

const NATIVE_DRIVER = Platform.OS !== "web";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptics } from "@/lib/haptics";
import { Icon } from "./Icon";
import { T } from "./Text";
import { colors, radius, shadow, space } from "./theme";
import { alertRegion, announce, statusRegion } from "./a11y";

type ToastTone = "success" | "error" | "info";
interface ToastMsg {
  id: number;
  text: string;
  tone: ToastTone;
}

interface ToastApi {
  show: (text: string, tone?: ToastTone) => void;
  success: (text: string) => void;
  error: (text: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [toast, setToast] = useState<ToastMsg | null>(null);
  const counter = useRef(0);
  const show = useCallback((text: string, tone: ToastTone = "info") => {
    counter.current += 1;
    setToast({ id: counter.current, text, tone });
    if (tone === "success") haptics.success();
    if (tone === "error") haptics.error();
  }, []);
  const api = useMemo<ToastApi>(
    () => ({ show, success: (t) => show(t, "success"), error: (t) => show(t, "error") }),
    [show],
  );
  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastHost toast={toast} onDone={() => setToast(null)} />
    </ToastContext.Provider>
  );
}

function ToastHost({ toast, onDone }: { toast: ToastMsg | null; onDone: () => void }): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const [opacity] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!toast) return;
    announce(toast.text);
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: NATIVE_DRIVER }).start();
    const t = setTimeout(
      () => Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: NATIVE_DRIVER }).start(onDone),
      3200,
    );
    return () => clearTimeout(t);
  }, [toast, opacity, onDone]);
  if (!toast) return null;
  const bg = toast.tone === "success" ? colors.success : toast.tone === "error" ? colors.danger : colors.navy;
  return (
    <View pointerEvents="none" style={[styles.host, { top: Math.max(insets.top, Platform.OS === "web" ? 16 : 8) + 8 }]}>
      <Animated.View
        style={[styles.toast, shadow.raised, { backgroundColor: bg, opacity }]}
        {...(toast.tone === "error" ? alertRegion : statusRegion)}
      >
        <Icon
          name={toast.tone === "success" ? "check" : toast.tone === "error" ? "warning" : "info"}
          size={18}
          color={colors.onNavy}
        />
        <T variant="small" color={colors.onNavy} style={{ flex: 1 }}>
          {toast.text}
        </T>
      </Animated.View>
    </View>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const styles = StyleSheet.create({
  host: { position: "absolute", left: 0, right: 0, alignItems: "center", paddingHorizontal: space.lg, zIndex: 100 },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: 12,
    borderRadius: radius.pill,
    maxWidth: 480,
    width: "100%",
  },
});
