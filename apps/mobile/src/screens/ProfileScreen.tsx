import { StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import { logout, me } from "@reclinarr/client";
import { Button } from "../components/Button";
import { ScreenHeader } from "../components/ScreenHeader";
import { clearSession } from "../session";
import { colors } from "../theme";
import type { Nav } from "../nav";
import { AnalyticsConsentSettings } from "@reclinarr/native-ui";

export function ProfileScreen() {
  const navigation = useNavigation<Nav>();
  const qc = useQueryClient();
  const session = useQuery({ queryKey: ["me"], queryFn: () => me() });
  const username = session.data?.user.username ?? "";

  const signOut = useMutation({
    mutationFn: async () => {
      try {
        await logout();
      } catch {
        /* ignore */
      }
      await clearSession();
    },
    onSuccess: async () => {
      await qc.clear();
      navigation.reset({ index: 0, routes: [{ name: "Login" }] });
    },
  });

  return (
    <View style={styles.page}>
      <ScreenHeader title="Profile" showBack />
      <View style={styles.body}>
        <Text style={styles.name}>{username || "Signed in"}</Text>
        <Text style={styles.copy}>Downloads, requests, and server settings.</Text>
        {session.data?.user.id ? <AnalyticsConsentSettings userId={session.data.user.id} /> : null}
        <Button label="Downloads" variant="ghost" onPress={() => navigation.navigate("Downloads")} />
        <View style={{ height: 10 }} />
        <Button label="Requests" variant="ghost" onPress={() => navigation.navigate("Requests")} />
        <View style={{ height: 10 }} />
        <Button
          label="Change server"
          variant="ghost"
          onPress={() => navigation.navigate("Server", { change: true })}
        />
        <View style={{ height: 24 }} />
        <Button
          label={signOut.isPending ? "Signing out…" : "Sign out"}
          variant="danger"
          onPress={() => signOut.mutate()}
          disabled={signOut.isPending}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  body: { paddingHorizontal: 20, paddingTop: 12, gap: 4 },
  name: { color: colors.text, fontSize: 22, fontWeight: "800", marginBottom: 6 },
  copy: { color: colors.muted, fontSize: 14, marginBottom: 20 },
});
