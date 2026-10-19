import { StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { me } from "@reclinarr/client";
import { AnalyticsConsentSettings, colors } from "@reclinarr/native-ui";
import { Chrome } from "../components/Chrome";
import { PageHeading } from "../components/PageHeading";
import { useTvLayout } from "../layout";

export function SettingsScreen({ username }: { username: string }) {
  const layout = useTvLayout();
  const session = useQuery({ queryKey: ["me"], queryFn: () => me() });

  return (
    <Chrome username={username}>
      <PageHeading title="Settings" />
      <View style={[styles.content, { paddingHorizontal: layout.pageX }]}>
        <View style={styles.card}>
          {session.data?.user.id ? (
            <AnalyticsConsentSettings userId={session.data.user.id} />
          ) : null}
        </View>
      </View>
    </Chrome>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 12 },
  card: {
    maxWidth: 640,
    padding: 24,
    borderRadius: 12,
    backgroundColor: colors.bg1,
  },
});
