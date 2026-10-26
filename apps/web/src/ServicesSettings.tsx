import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminServices,
  saveAdminService,
  testAdminService,
  type ServiceEdit,
  type ServiceTestResult,
  type ServiceView,
} from "@reclinarr/client";
import { colors } from "@reclinarr/native-ui";

const RELOAD_REFRESH_MS = 4_000;

const HINTS: Partial<Record<ServiceView["id"], string>> = {
  jellyfin: "People have to sign in again if this points at a different Jellyfin server.",
  dispatcharr:
    "Use an API key, or a username and password. A saved API key wins, so remove it to use the login.",
};

export function ServicesSettings() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["admin-services"],
    queryFn: adminServices,
    retry: 4,
    retryDelay: 1_500,
  });
  const [editing, setEditing] = useState<ServiceView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (query.isLoading) return null;
  if (query.isError) {
    return <Text style={styles.error}>Couldn't load services: {query.error.message}</Text>;
  }
  if (!query.data?.admin) return null;

  return (
    <>
      <Text style={styles.sectionTitle}>Services</Text>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <View style={styles.cards}>
        {query.data.services.map((service) => {
          const url = service.fields.find((field) => field.kind === "url")?.value;
          return (
            <Pressable
              key={service.id}
              accessibilityRole="button"
              style={styles.card}
              onPress={() => {
                setNotice(null);
                setEditing(service);
              }}
            >
              <View style={styles.cardHead}>
                <Text style={styles.cardTitle}>{service.label}</Text>
                <View style={[styles.dot, service.configured ? styles.dotOn : null]} />
              </View>
              <Text style={styles.cardUrl} numberOfLines={1}>
                {service.configured ? url : "Not configured"}
              </Text>
              <Text style={styles.cardAction}>Edit</Text>
            </Pressable>
          );
        })}
      </View>
      {editing ? (
        <ServiceModal
          key={editing.id}
          service={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setNotice(`${editing.label} saved. Reclinarr is restarting with the new settings.`);
            setTimeout(
              () => void queryClient.invalidateQueries({ queryKey: ["admin-services"] }),
              RELOAD_REFRESH_MS,
            );
          }}
        />
      ) : null}
    </>
  );
}

function ServiceModal({
  service,
  onClose,
  onSaved,
}: {
  service: ServiceView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(service.fields.map((field) => [field.key, field.value ?? ""])),
  );
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [result, setResult] = useState<ServiceTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function buildEdit(): ServiceEdit {
    const edit: ServiceEdit = { values: {}, clear: [...cleared] };
    for (const field of service.fields) {
      if (field.locked) continue;
      const value = values[field.key] ?? "";
      if (field.kind === "secret" && value === "") continue;
      edit.values[field.key] = value;
    }
    return edit;
  }

  async function run(kind: "test" | "save") {
    setBusy(kind);
    setError(null);
    setResult(null);
    try {
      if (kind === "test") setResult(await testAdminService(service.id, buildEdit()));
      else {
        await saveAdminService(service.id, buildEdit());
        onSaved();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  function toggleCleared(key: string) {
    setCleared((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <View style={styles.dialog}>
          <ScrollView contentContainerStyle={styles.dialogBody}>
            <Text style={styles.dialogTitle}>{service.label}</Text>
            {service.fields.map((field) => {
              const isCleared = cleared.has(field.key);
              return (
                <View key={field.key} style={styles.field}>
                  <Text style={styles.label}>{field.label}</Text>
                  <TextInput
                    value={values[field.key] ?? ""}
                    onChangeText={(text) => setValues((prev) => ({ ...prev, [field.key]: text }))}
                    editable={!field.locked && !isCleared}
                    secureTextEntry={field.kind === "secret"}
                    placeholder={
                      field.kind !== "secret"
                        ? field.kind === "url"
                          ? "http://host:port"
                          : ""
                        : isCleared
                          ? "Will be removed"
                          : field.set
                            ? "Saved. Leave blank to keep it"
                            : "Not set"
                    }
                    placeholderTextColor="#777"
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[styles.input, field.locked || isCleared ? styles.inputDisabled : null]}
                  />
                  {field.locked ? (
                    <Text style={styles.hint}>Set by the server environment.</Text>
                  ) : field.kind === "secret" && field.set ? (
                    <Pressable onPress={() => toggleCleared(field.key)}>
                      <Text style={styles.link}>{isCleared ? "Keep the saved value" : "Remove the saved value"}</Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
            {HINTS[service.id] ? <Text style={styles.hint}>{HINTS[service.id]}</Text> : null}
            {result ? (
              <Text style={[styles.result, result.ok ? styles.resultOk : styles.resultBad]}>{result.message}</Text>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Text style={styles.hint}>Saving restarts Reclinarr for a few seconds and interrupts anything playing.</Text>
            <View style={styles.actions}>
              <Pressable style={[styles.btn, styles.btnGhost]} onPress={onClose} disabled={busy !== null}>
                <Text style={styles.btnText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.btn, styles.btnGhost]} onPress={() => void run("test")} disabled={busy !== null}>
                <Text style={styles.btnText}>{busy === "test" ? "Testing…" : "Test connection"}</Text>
              </Pressable>
              <Pressable style={[styles.btn, styles.btnPrimary]} onPress={() => void run("save")} disabled={busy !== null}>
                <Text style={[styles.btnText, styles.btnPrimaryText]}>{busy === "save" ? "Saving…" : "Save"}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginTop: 12,
  },
  cards: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  card: { flexGrow: 1, flexBasis: 240, backgroundColor: colors.bg2, borderRadius: 10, padding: 16, gap: 6 },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#555" },
  dotOn: { backgroundColor: "#46d369" },
  cardUrl: { color: colors.muted, fontSize: 14 },
  cardAction: { color: colors.accent, fontSize: 14, fontWeight: "700", marginTop: 4 },
  notice: { color: colors.muted, fontSize: 14 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center", padding: 16 },
  dialog: { width: "100%", maxWidth: 520, maxHeight: "90%", backgroundColor: colors.bg1, borderRadius: 12 },
  dialogBody: { padding: 24, gap: 14 },
  dialogTitle: { color: colors.text, fontSize: 20, fontWeight: "800" },
  field: { gap: 6 },
  label: { color: "#ddd", fontSize: 13, fontWeight: "600" },
  input: {
    color: "white",
    backgroundColor: "#1b1b1b",
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 8,
    padding: 13,
  },
  inputDisabled: { opacity: 0.5 },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  link: { color: colors.accent, fontSize: 13, fontWeight: "600" },
  result: { fontSize: 14, lineHeight: 20 },
  resultOk: { color: "#46d369" },
  resultBad: { color: colors.danger },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 10, marginTop: 4 },
  btn: { paddingVertical: 12, paddingHorizontal: 18, borderRadius: 8 },
  btnGhost: { backgroundColor: colors.bg2 },
  btnPrimary: { backgroundColor: colors.accent },
  btnText: { color: colors.text, fontWeight: "700", fontSize: 15 },
  btnPrimaryText: { color: "#141414" },
});
