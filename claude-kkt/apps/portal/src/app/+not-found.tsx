import { useRouter } from "expo-router";
import { View } from "react-native";
import { Header, Screen } from "@/ui/Screen";
import { EmptyState } from "@/ui/States";
import { colors } from "@/ui/theme";

export default function NotFound(): React.JSX.Element {
  const router = useRouter();
  return (
    <View style={{ flex: 1, backgroundColor: colors.ivory }}>
      <Header title="Page not found" back />
      <Screen>
        <EmptyState icon="search" title="That page doesn't exist" body="The link may be old or mistyped." action="Go home" onAction={() => router.replace("/")} />
      </Screen>
    </View>
  );
}
