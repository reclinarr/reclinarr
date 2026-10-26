import { ScrollView, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { me } from "@reclinarr/client";
import { AnalyticsConsentSettings, PlaybackLanguageSettings, colors } from "@reclinarr/native-ui";
import { Chrome } from "../components/Chrome";
import { PageHeading } from "../components/PageHeading";
import { useTvLayout } from "../layout";

export function SettingsScreen({ username }: { username: string }) {
  const layout = useTvLayout();
  const session = useQuery({ queryKey: ["me"], queryFn: () => me() });

  return (
    <Chrome username={username}>
      <PageHeading title="Settings" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingHorizontal: layout.pageX }]}
      >
        <View style={styles.card}>
          <PlaybackLanguageSettings />
          {session.data?.user.id ? (
            <AnalyticsConsentSettings userId={session.data.user.id} />
          ) : null}
        </View>
      </ScrollView>
    </Chrome>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingTop: 12, paddingBottom: 48 },
  card: {
    maxWidth: 920,
    padding: 24,
    borderRadius: 12,
    backgroundColor: colors.bg1,
  },
});
