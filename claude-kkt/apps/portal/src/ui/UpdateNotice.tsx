// Non-blocking "please update the app" notice, shown once per session when a response the portal relies on carries `Deprecation`
// (src/api/deprecation.ts). Dismissible; never blocks the screen underneath.
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { currentDeprecation, deprecationMessage, onDeprecation, type DeprecationInfo } from "@/api/deprecation";
import { Button } from "./Button";
import { Notice } from "./States";
import { space } from "./theme";

export function UpdateNotice(): React.JSX.Element | null {
  const [info, setInfo] = useState<DeprecationInfo | null>(() => currentDeprecation());
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => onDeprecation(setInfo), []);
  if (!info || dismissed) return null;
  return (
    <View style={styles.wrap} pointerEvents="box-none" testID="update-notice">
      <Notice tone="info" title="Update available" body={deprecationMessage(info)} icon="refresh" style={styles.notice}>
        <Button
          title="Dismiss"
          variant="ghost"
          size="sm"
          onPress={() => setDismissed(true)}
          style={{ alignSelf: "flex-start" }}
        />
      </Notice>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: space.lg, right: space.lg, bottom: space.xxxl * 2, alignItems: "center" },
  notice: { maxWidth: 520, width: "100%" },
});
