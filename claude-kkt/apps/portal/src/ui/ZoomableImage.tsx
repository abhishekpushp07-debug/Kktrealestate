// Pinch / pan / double-tap zoomable image (gesture-handler v3 hooks + reanimated).
// `controls` exposes zoom in/out/reset for pointer devices (web) where pinch is awkward.
import { Image } from "expo-image";
import { forwardRef, useImperativeHandle } from "react";
import { StyleSheet, View } from "react-native";
import { GestureDetector, useExclusiveGestures, usePanGesture, usePinchGesture, useSimultaneousGestures, useTapGesture } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

export interface ZoomableHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
}

const MIN = 1;
const MAX = 5;

export const ZoomableImage = forwardRef<ZoomableHandle, { uri: string; onSwipe?: (dir: -1 | 1) => void; onSingleTap?: () => void }>(function ZoomableImage({ uri, onSwipe, onSingleTap }, ref) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  const swipe = (d: -1 | 1) => onSwipe?.(d);
  const singleTap = () => onSingleTap?.();

  const setScale = (next: number) => {
    "worklet";
    const clamped = Math.max(MIN, Math.min(MAX, next));
    scale.value = withTiming(clamped);
    savedScale.value = clamped;
    if (clamped === MIN) {
      tx.value = withTiming(0);
      ty.value = withTiming(0);
      savedX.value = 0;
      savedY.value = 0;
    }
  };

  useImperativeHandle(ref, () => ({
    zoomIn: () => setScale(savedScale.value * 1.5),
    zoomOut: () => setScale(savedScale.value / 1.5),
    reset: () => setScale(1),
  }));

  const pinch = usePinchGesture({
    onUpdate: (e) => {
      "worklet";
      scale.value = Math.max(MIN, Math.min(MAX, savedScale.value * e.scale));
    },
    onDeactivate: () => {
      "worklet";
      savedScale.value = scale.value;
      if (scale.value <= 1.01) {
        scale.value = withTiming(1);
        savedScale.value = 1;
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedX.value = 0;
        savedY.value = 0;
      }
    },
  });

  const pan = usePanGesture({
    onUpdate: (e) => {
      "worklet";
      if (scale.value > 1) {
        tx.value = savedX.value + e.translationX;
        ty.value = savedY.value + e.translationY;
      }
    },
    onDeactivate: (e) => {
      "worklet";
      if (scale.value > 1) {
        savedX.value = tx.value;
        savedY.value = ty.value;
      } else if (Math.abs(e.translationX) > 60 && Math.abs(e.translationY) < 80) {
        scheduleOnRN(swipe, e.translationX < 0 ? 1 : -1);
      }
    },
  });

  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    onActivate: () => {
      "worklet";
      setScale(scale.value > 1 ? 1 : 2.5);
    },
  });

  const tap = useTapGesture({
    numberOfTaps: 1,
    onActivate: () => {
      "worklet";
      scheduleOnRN(singleTap);
    },
  });

  const gesture = useExclusiveGestures(doubleTap, useSimultaneousGestures(pinch, pan), tap);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.fill, style]}>
        <Image source={{ uri }} style={styles.fill} contentFit="contain" transition={200} accessibilityIgnoresInvertColors />
      </Animated.View>
    </GestureDetector>
  );
});

export function ZoomableBox({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <View style={styles.fill}>{children}</View>;
}

const styles = StyleSheet.create({ fill: { width: "100%", height: "100%" } });
