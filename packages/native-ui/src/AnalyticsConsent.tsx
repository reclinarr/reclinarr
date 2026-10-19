import { useEffect, useState, type ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { getClient } from "@reclinarr/client";
import { colors } from "./theme.js";

export function AnalyticsConsentGate({ userId, screen, children, active = true }: { userId: string; screen: string; children: ReactNode; active?: boolean }) {
  const [prompt, setPrompt] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const client = getClient();
    void (async () => {
      const available = await client.analyticsStatus();
      const consent = await client.activateAnalytics(userId);
      if (!cancelled) {
        setPrompt(available && consent === null);
        setReady(true);
        if (available && consent === true) {
          client.trackTelemetry("client.screen_view", {
            screen,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, screen, userId]);

  async function choose(enabled: boolean) {
    await getClient().setAnalyticsConsent(userId, enabled);
    setPrompt(false);
  }

  return (
    <>
      {children}
      {ready ? (
        <Modal visible={prompt} transparent animationType="fade" onRequestClose={() => undefined}>
          <View style={styles.scrim}>
            <View style={styles.dialog}>
              <Text style={styles.title}>Help improve Reclinarr?</Text>
              <Text style={styles.copy}>
                Share pseudonymous performance and feature usage metrics with the Reclinarr team. We
                collect operation names, timings, app version, and platform. We never send account
                identifiers, titles, searches, or media identifiers. We use a random identifier to
                group your opted-in metrics. You can change this any time from the account menu or
                Profile settings.
              </Text>
              <Text style={styles.copy}>Metrics are sent to PostHog’s EU service.</Text>
              <View style={styles.actions}>
                <ConsentButton label="No thanks" onPress={() => void choose(false)} secondary />
                <ConsentButton label="Share pseudonymous metrics" onPress={() => void choose(true)} />
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

export function AnalyticsConsentSettings({ userId }: { userId: string }) {
  const [available, setAvailable] = useState(false);
  const [consent, setConsent] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const client = getClient();
    void Promise.all([client.analyticsStatus(), client.analyticsConsent(userId)]).then(
      ([enabled, choice]) => {
        if (!cancelled) {
          setAvailable(enabled);
          setConsent(choice);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function update(next: boolean) {
    setBusy(true);
    await getClient().setAnalyticsConsent(userId, next);
    setConsent(next);
    setBusy(false);
  }

  return (
    <View style={styles.setting}>
      <Text style={styles.settingTitle}>Usage metrics</Text>
      <Text style={styles.settingCopy}>
        {available
          ? consent === true
            ? "Enabled. Performance and feature usage metrics are shared."
            : "Disabled. No usage metrics are shared."
          : "Metrics are not configured for this server."}
      </Text>
      {available ? (
        <ConsentButton
          label={busy ? "Saving…" : consent ? "Turn off metrics" : "Share pseudonymous metrics"}
          onPress={() => void update(!consent)}
          disabled={busy}
          secondary={!consent}
        />
      ) : null}
    </View>
  );
}

function ConsentButton({
  label,
  onPress,
  disabled = false,
  secondary = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ focused, pressed }) => [
        styles.button,
        secondary ? styles.buttonSecondary : null,
        focused ? styles.buttonFocused : null,
        pressed ? styles.buttonPressed : null,
        disabled ? styles.buttonDisabled : null,
      ]}
    >
      {({ focused }) => (
        <Text style={[styles.buttonText, secondary ? styles.buttonTextSecondary : null, focused ? styles.buttonTextFocused : null]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24, backgroundColor: "rgba(0,0,0,0.76)" },
  dialog: { width: "100%", maxWidth: 560, padding: 26, gap: 16, borderRadius: 12, backgroundColor: colors.bg2 },
  title: { color: colors.text, fontSize: 24, fontWeight: "800" },
  copy: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  actions: { flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap", gap: 10, marginTop: 4 },
  setting: { gap: 10, paddingVertical: 18 },
  settingTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  settingCopy: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  button: { minHeight: 46, justifyContent: "center", alignItems: "center", paddingHorizontal: 16, borderRadius: 7, backgroundColor: colors.accent },
  buttonSecondary: { backgroundColor: colors.bg },
  buttonFocused: { borderWidth: 2, borderColor: colors.text },
  buttonPressed: { opacity: 0.82 },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  buttonTextSecondary: { color: colors.text },
  buttonTextFocused: { textDecorationLine: "underline" },
});
