import { useState, type ReactNode } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import type { KeyValueStorage } from "@reclinarr/client";
import { BrandLogo } from "../BrandLogo.js";
import { Button } from "../Button.js";
import { fieldStyles } from "../fieldStyles.js";
import { attachClient, clearSession, probeServer, saveServerUrl } from "../session.js";
import { colors } from "../theme.js";
import type { ScreenNav } from "./types.js";

export function ServerScreen({
  nav,
  storage,
  canCancel = false,
  paddingTop = 56,
  paddingBottom = 24,
  wrapper,
}: {
  nav: Pick<ScreenNav, "resetToLogin" | "goBack">;
  storage: KeyValueStorage;
  canCancel?: boolean;
  paddingTop?: number;
  paddingBottom?: number;
  wrapper?: (children: ReactNode) => ReactNode;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await probeServer(url);
      await clearSession(storage);
      const origin = await saveServerUrl(storage, url);
      attachClient(storage, origin);
      nav.resetToLogin?.();
    } catch (err) {
      setError((err as Error).message || "Could not reach Reclinarr");
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <View style={[styles.page, { paddingTop, paddingBottom }]}>
      <BrandLogo size={36} style={{ marginBottom: 20 }} />
      <Text style={styles.title}>Connect to your server</Text>
      <Text style={styles.copy}>
        Enter the Reclinarr address on your LAN, for example 192.168.1.10:8787
      </Text>
      <TextInput
        style={fieldStyles.input}
        value={url}
        onChangeText={setUrl}
        placeholder="http://192.168.1.10:8787"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        autoFocus
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button
        label={busy ? "Connecting…" : "Continue"}
        style={styles.action}
        onPress={() => void connect()}
        disabled={busy}
      />
      {canCancel ? (
        <>
          <View style={{ height: 12 }} />
          <Button label="Cancel" variant="ghost" style={styles.action} onPress={() => nav.goBack?.()} />
        </>
      ) : null}
    </View>
  );

  return <>{wrapper ? wrapper(body) : body}</>;
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 24,
    justifyContent: "center",
  },
  title: { color: colors.text, fontSize: 26, fontWeight: "700", marginBottom: 10 },
  copy: { color: colors.muted, fontSize: 15, marginBottom: 20, lineHeight: 21 },
  action: { alignSelf: "stretch" },
  error: { color: colors.danger, marginBottom: 14, fontSize: 14 },
});
