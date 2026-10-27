import { BrandLogo } from "@reclinarr/native-ui";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import { getOrCreateDeviceId, login } from "@reclinarr/client";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Focusable } from "../components/Focusable";
import { TvTextInput } from "../components/TvTextInput";
import { colors } from "../theme";
import type { Nav } from "../nav";
import { syncTvInput } from "../session";

export function LoginScreen() {
  const navigation = useNavigation<Nav>();
  const qc = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const mutation = useMutation({
    mutationFn: async () =>
      login({
        username,
        password,
        deviceId: await getOrCreateDeviceId(AsyncStorage),
        deviceName: "Reclinarr Google TV",
      }),
    onSuccess: async () => {
      void syncTvInput().catch((err) => console.error("[tv-input] sync failed", err));
      await qc.invalidateQueries({ queryKey: ["me"] });
      navigation.reset({ index: 0, routes: [{ name: "Main" }] });
    },
  });

  return (
    <View style={styles.page}>
      <BrandLogo size={38} style={{ marginBottom: 24 }} />
      <Text style={styles.title}>Sign In</Text>
      <Text style={styles.copy}>Your media. One stream. Use your Jellyfin account.</Text>
      {mutation.isError ? <Text style={styles.error}>{(mutation.error as Error).message}</Text> : null}
      <TvTextInput
        style={styles.input}
        value={username}
        onChangeText={setUsername}
        placeholder="Username"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        hasTVPreferredFocus
      />
      <TvTextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        placeholder="Password"
        placeholderTextColor={colors.muted}
        secureTextEntry
      />
      <Focusable
        label={mutation.isPending ? "Signing in…" : "Sign In"}
        onPress={() => mutation.mutate()}
      />
      <Focusable label="Change server" onPress={() => navigation.navigate("Server", { change: true })} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#000",
    padding: 64,
    justifyContent: "center",
    maxWidth: 640,
  },
  title: { color: colors.text, fontSize: 32, fontWeight: "700", marginBottom: 12 },
  copy: { color: colors.muted, fontSize: 18, marginBottom: 24 },
  input: {
    backgroundColor: colors.bg2,
    color: colors.text,
    fontSize: 20,
    padding: 16,
    borderRadius: 6,
    marginBottom: 16,
  },
  error: { color: colors.danger, marginBottom: 16, fontSize: 16 },
});
