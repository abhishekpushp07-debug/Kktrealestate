// Pinch / double-tap zoomable image (gesture-handler v3 hooks + reanimated).
// Horizontal swipe while not zoomed calls onSwipe(-1 | 1) for galleries.
import { StyleSheet } from "react-native";
import { Image } from "expo-image";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { GestureDetector, useExclusiveGestures, usePanGesture, usePinchGesture, useSimultaneousGestures, useTapGesture } from "react-native-gesture-handler";
import { scheduleOnRN } from "react-native-worklets";

export function ZoomableImage({ uri, onSwipe, testID }: { uri: string; onSwipe?: (dir: -1 | 1) => void; testID?: string }) {
  const scale = useSharedValue(1);
  const saved = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);

  const swipe = (d: -1 | 1) => onSwipe?.(d);

  const pinch = usePinchGesture({
    onUpdate: (e: any) => {
      "worklet";
      scale.value = Math.max(1, Math.min(5, saved.value * e.scale));
    },
    onDeactivate: () => {
      "worklet";
      saved.value = scale.value;
      if (scale.value <= 1.01) {
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        sx.value = 0;
        sy.value = 0;
      }
    },
  });

  const pan = usePanGesture({
    onUpdate: (e: any) => {
      "worklet";
      if (scale.value > 1) {
        tx.value = sx.value + e.translationX;
        ty.value = sy.value + e.translationY;
      }
    },
    onDeactivate: (e: any) => {
      "worklet";
      if (scale.value > 1) {
        sx.value = tx.value;
        sy.value = ty.value;
      } else if (Math.abs(e.translationX) > 60) {
        scheduleOnRN(swipe, e.translationX < 0 ? 1 : -1);
      }
    },
  });

  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    onActivate: () => {
      "worklet";
      const next = scale.value > 1 ? 1 : 2.5;
      scale.value = withTiming(next);
      saved.value = next;
      if (next === 1) {
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        sx.value = 0;
        sy.value = 0;
      }
    },
  });

  const gesture = useExclusiveGestures(doubleTap, useSimultaneousGestures(pinch, pan));

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.fill, style]} testID={testID}>
        <Image source={{ uri }} style={styles.fill} contentFit="contain" transition={200} />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { width: "100%", height: "100%" },
});
