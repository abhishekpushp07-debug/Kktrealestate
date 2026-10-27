// Root error boundary of the portal (audit v3 H4): a render error anywhere below shows a recovery screen instead of a blank app,
// and the error is reported to POST /api/v1/client-errors (contract C2) through src/lib/reporter.ts.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { errorReference } from "@/api/errors";
import { queryClient } from "@/api/queries";
import { reportClientError } from "@/lib/reporter";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { T } from "./Text";
import { colors, radius, space } from "./theme";

interface Props {
  children: ReactNode;
}

interface State {
  error: unknown;
  /** Bumped by "Try again" so the whole tree remounts (providers reload their state). */
  attempt: number;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error ?? new Error("Unknown render error") };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    reportClientError(error, { source: "boundary", componentStack: info.componentStack ?? null });
  }

  private retry = (): void => {
    // The crash may come from data in the query cache (a malformed answer): drop it so the remounted screens fetch afresh.
    void queryClient.resetQueries();
    this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));
  };

  override render(): ReactNode {
    if (this.state.error) return <RecoveryScreen error={this.state.error} onRetry={this.retry} />;
    return (
      <View key={this.state.attempt} style={styles.fill}>
        {this.props.children}
      </View>
    );
  }
}

export function RecoveryScreen({ error, onRetry }: { error: unknown; onRetry: () => void }): React.JSX.Element {
  const ref = errorReference(error);
  return (
    <View style={styles.wrap} role="main">
      <View style={styles.card}>
        <View style={styles.iconRing}>
          <Icon name="warning" size={28} color={colors.danger} />
        </View>
        <T variant="h2" align="center" accessibilityRole="header">
          Something went wrong
        </T>
        <T variant="body" color={colors.inkMuted} align="center" style={{ maxWidth: 360 }}>
          The app hit an unexpected problem and our team has been told. Your bookings and payments are safe. Try again,
          or reload the app.
        </T>
        {ref ? (
          <T variant="caption" color={colors.inkMuted} align="center" selectable>
            {ref}
          </T>
        ) : null}
        <View style={styles.actions}>
          <Button title="Try again" icon="refresh" onPress={onRetry} />
          {Platform.OS === "web" ? (
            <Button
              title="Reload app"
              variant="outline"
              onPress={() => {
                if (typeof window !== "undefined") window.location.assign("/");
              }}
            />
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  wrap: { flex: 1, backgroundColor: colors.ivory, alignItems: "center", justifyContent: "center", padding: space.lg },
  card: {
    width: "100%",
    maxWidth: 480,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.xl,
    gap: space.md,
    alignItems: "center",
  },
  iconRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.dangerBg,
    alignItems: "center",
    justifyContent: "center",
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, justifyContent: "center", marginTop: space.sm },
});
