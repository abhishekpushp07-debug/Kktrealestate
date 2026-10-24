// Image that only starts loading once it scrolls near the viewport.
// Web: IntersectionObserver on the underlying DOM node. Native: expo-image
// already defers decoding and recycles, so it renders immediately.
import { useEffect, useRef, useState } from "react";
import { Platform, View, type StyleProp, type ViewStyle } from "react-native";
import { Image } from "expo-image";

const canObserve = Platform.OS === "web" && typeof IntersectionObserver !== "undefined";

export function LazyImage({ uri, style, recyclingKey, testID }: { uri: string; style?: StyleProp<ViewStyle>; recyclingKey?: string; testID?: string }) {
  const ref = useRef<any>(null);
  const [visible, setVisible] = useState(!canObserve);
  useEffect(() => {
    if (visible || !canObserve) return;
    const node = ref.current as unknown as Element | null;
    if (!node) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [visible]);
  return (
    <View ref={ref} style={style} testID={testID}>
      {visible ? <Image source={{ uri }} style={{ width: "100%", height: "100%" }} contentFit="cover" transition={250} recyclingKey={recyclingKey} cachePolicy="memory-disk" /> : null}
    </View>
  );
}
