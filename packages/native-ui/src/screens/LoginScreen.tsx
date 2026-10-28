import { useEffect, useState, type ReactNode } from "react";
import { Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getClient,
  getOrCreateDeviceId,
  login,
  me,
  type KeyValueStorage,
} from "@reclinarr/client";
import { BrandLogo } from "../BrandLogo.js";
import { Button } from "../Button.js";
import { fieldStyles } from "../fieldStyles.js";
import { colors } from "../theme.js";
import { webGradient } from "../webStyle.js";
import { SERVER_URL_KEY } from "../session.js";
import type { Appearance, ScreenNav } from "./types.js";

export function LoginScreen({
  nav,
  storage,
  deviceName,
  paddingTop = 56,
  paddingBottom = 24,
  wrapper,
  appearance = "native",
  ensureApi,
}: {
  nav: Pick<ScreenNav, "openServer" | "resetToMain">;
  storage: KeyValueStorage;
  deviceName: string;
  paddingTop?: number;
  paddingBottom?: number;
  wrapper?: (children: ReactNode) => ReactNode;
  appearance?: Appearance;
  /** Re-attach API client before sign-in (mobile Metro reload). */
  ensureApi?: () => Promise<string | null>;
}) {
  const qc = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [serverUrl, setServerUrl] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const fromEnsure = ensureApi ? await ensureApi().catch(() => null) : null;
      if (fromEnsure) {
        setServerUrl(fromEnsure);
        return;
      }
      setServerUrl(await storage.getItem(SERVER_URL_KEY));
    })();
  }, [ensureApi, storage]);

  const mutation = useMutation({
    mutationFn: async () => {
      const url = ensureApi ? await ensureApi() : serverUrl;
      // Web uses same-origin (empty base). Native needs an explicit API URL.
      if (appearance !== "web" && (url == null || !String(url).trim())) {
        throw new Error("No server configured. Tap Change server and enter http://<mac-ip>:8787");
      }
      if (url != null) setServerUrl(url);
      try {
        getClient();
      } catch (err) {
        throw new Error((err as Error).message, { cause: err });
      }
      if (!username.trim() || !password) {
        throw new Error("Enter your Jellyfin username and password");
      }
      const where = appearance === "web" ? "this site" : url || "server";
      try {
        await login({
          username: username.trim(),
          password,
          deviceId: await getOrCreateDeviceId(storage),
          deviceName,
        });
      } catch (err) {
        throw new Error(`Sign-in failed (${where}): ${(err as Error).message}`, { cause: err });
      }
      try {
        return await me();
      } catch (err) {
        throw new Error(`Signed in but session check failed (${where}): ${(err as Error).message}`, { cause: err });
      }
    },
    onSuccess: async (session) => {
      await qc.cancelQueries();
      qc.clear();
      qc.setQueryData(["me"], session);
      nav.resetToMain?.();
    },
  });

  const signIn = () => {
    if (!mutation.isPending) mutation.mutate();
  };

  if (appearance === "web") {
    const webBody = (
      <View style={styles.webPage}>
        <View
          style={[
            StyleSheet.absoluteFill,
            { pointerEvents: "none" },
            webGradient(
              "linear-gradient(rgba(0,0,0,0.55), rgba(0,0,0,0.82)), radial-gradient(900px 520px at 15% 10%, rgba(229,9,20,0.35), transparent 55%), linear-gradient(135deg, #1b0a0c 0%, #141414 45%, #0b1020 100%)",
            ),
          ]}
        />
        <BrandLogo size={40} style={{ position: "absolute", top: 28, left: 48 }} />
        <View style={styles.webForm}>
          <Text style={styles.webTitle}>Sign In</Text>
          <Text style={styles.webCopy}>Your media. One stream. Use your Jellyfin account.</Text>
          {mutation.isError ? <Text style={styles.error}>{(mutation.error as Error).message}</Text> : null}
          <TextInput
            style={[fieldStyles.input, styles.webInput]}
            value={username}
            onChangeText={setUsername}
            placeholder="Email or username"
            placeholderTextColor="#8c8c8c"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            returnKeyType="go"
            onSubmitEditing={signIn}
          />
          <TextInput
            style={[fieldStyles.input, styles.webInput]}
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor="#8c8c8c"
            secureTextEntry
            returnKeyType="go"
            onSubmitEditing={signIn}
          />
          <Button
            label={mutation.isPending ? "Signing in…" : "Sign In"}
            variant="accent"
            style={styles.action}
            onPress={signIn}
            disabled={mutation.isPending}
          />
        </View>
      </View>
    );
    return <>{wrapper ? wrapper(webBody) : webBody}</>;
  }

  const body = (
    <View style={[styles.page, { paddingTop, paddingBottom }]}>
      <BrandLogo size={36} style={{ marginBottom: 20 }} />
      <Text style={styles.title}>Sign In</Text>
      <Text style={styles.copy}>Your media. One stream. Use your Jellyfin account.</Text>
      {serverUrl ? <Text style={styles.serverHint}>API: {serverUrl}</Text> : null}
      {mutation.isError ? <Text style={styles.error}>{(mutation.error as Error).message}</Text> : null}
      <TextInput
        style={fieldStyles.input}
        value={username}
        onChangeText={setUsername}
        placeholder="Username"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
      />
      <TextInput
        style={fieldStyles.input}
        value={password}
        onChangeText={setPassword}
        placeholder="Password"
        placeholderTextColor={colors.muted}
        secureTextEntry
      />
      <Button
        label={mutation.isPending ? "Signing in…" : "Sign In"}
        style={styles.action}
        onPress={() => mutation.mutate()}
        disabled={mutation.isPending}
      />
      <View style={{ height: 12 }} />
      <Button
        label="Change server"
        variant="ghost"
        style={styles.action}
        onPress={() => nav.openServer?.({ change: true })}
      />
    </View>
  );

  return <>{wrapper ? wrapper(body) : body}</>;
}

export const loginKeyboardBehavior = Platform.OS === "ios" ? ("padding" as const) : undefined;

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 24,
    justifyContent: "center",
  },
  title: { color: colors.text, fontSize: 26, fontWeight: "700", marginBottom: 10 },
  copy: { color: colors.muted, fontSize: 15, marginBottom: 12, lineHeight: 21 },
  serverHint: { color: colors.muted, fontSize: 12, marginBottom: 16, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  action: { alignSelf: "stretch" },
  error: { color: colors.danger, marginBottom: 12, fontSize: 14 },
  webPage: { flex: 1, backgroundColor: "#141414", justifyContent: "center", alignItems: "center" },
  webForm: { width: "100%", maxWidth: 450, paddingHorizontal: 24, zIndex: 1 },
  webTitle: { color: "#fff", fontSize: 32, fontWeight: "700", marginBottom: 12 },
  webCopy: { color: "#b3b3b3", fontSize: 16, lineHeight: 22, marginBottom: 24 },
  webInput: { backgroundColor: "#333", borderRadius: 4, marginBottom: 16 },
});
