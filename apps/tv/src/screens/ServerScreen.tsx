import { BrandLogo } from "@reclinarr/native-ui";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Focusable } from "../components/Focusable";
import { TvTextInput } from "../components/TvTextInput";
import { attachClient, clearSession, probeServer, saveServerUrl } from "../session";
import { colors } from "../theme";
import type { Nav } from "../nav";

export function ServerScreen() {
  const navigation = useNavigation<Nav>();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await probeServer(url);
    await clearSession();
      const origin = await saveServerUrl(url);
      attachClient(origin);
      navigation.reset({ index: 0, routes: [{ name: "Login" }] });
    } catch (err) {
      setError((err as Error).message || "Could not reach Reclinarr");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.page}>
      <BrandLogo size={38} style={{ marginBottom: 24 }} />
      <Text style={styles.title}>Connect to your server</Text>
      <Text style={styles.copy}>Enter your Reclinarr server address</Text>
      <TvTextInput
        style={styles.input}
        value={url}
        onChangeText={setUrl}
        placeholder="https://reclinarr.example.com"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Focusable label={busy ? "Connecting…" : "Continue"} onPress={() => void connect()} hasTVPreferredFocus />
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#000",
    padding: 64,
    justifyContent: "center",
    maxWidth: 720,
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
