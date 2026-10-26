import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

type StepId = "code" | "jellyfin" | "seerr" | "dispatcharr" | "bazarr" | "review";
type OptionalId = "seerr" | "dispatcharr" | "bazarr";

type Values = {
  setupCode: string;
  JELLYFIN_URL: string;
  SEERR_URL: string;
  SEERR_API_KEY: string;
  DISPATCHARR_URL: string;
  DISPATCHARR_API_KEY: string;
  DISPATCHARR_USERNAME: string;
  DISPATCHARR_PASSWORD: string;
  BAZARR_URL: string;
  BAZARR_API_KEY: string;
};

const EMPTY: Values = {
  setupCode: "",
  JELLYFIN_URL: "",
  SEERR_URL: "",
  SEERR_API_KEY: "",
  DISPATCHARR_URL: "",
  DISPATCHARR_API_KEY: "",
  DISPATCHARR_USERNAME: "",
  DISPATCHARR_PASSWORD: "",
  BAZARR_URL: "",
  BAZARR_API_KEY: "",
};

const STEPS: { id: StepId; label: string; skippable: boolean }[] = [
  { id: "code", label: "Code", skippable: false },
  { id: "jellyfin", label: "Jellyfin", skippable: false },
  { id: "seerr", label: "Seerr", skippable: true },
  { id: "dispatcharr", label: "Dispatcharr", skippable: true },
  { id: "bazarr", label: "Bazarr", skippable: true },
  { id: "review", label: "Save", skippable: false },
];

const OPTIONAL_FIELDS: Record<OptionalId, (keyof Values)[]> = {
  seerr: ["SEERR_URL", "SEERR_API_KEY"],
  dispatcharr: ["DISPATCHARR_URL", "DISPATCHARR_API_KEY", "DISPATCHARR_USERNAME", "DISPATCHARR_PASSWORD"],
  bazarr: ["BAZARR_URL", "BAZARR_API_KEY"],
};

type Notice = { tone: "ok" | "bad"; text: string };

const RELOAD_TIMEOUT_MS = 30_000;

export function SetupWizard() {
  const [stepIndex, setStepIndex] = useState(0);
  const [values, setValues] = useState<Values>(EMPTY);
  const [skipped, setSkipped] = useState<Record<OptionalId, boolean>>({
    seerr: false,
    dispatcharr: false,
    bazarr: false,
  });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [shareMetrics, setShareMetrics] = useState(true);
  const step = STEPS[stepIndex] ?? STEPS[0];

  // The server reloads itself after saving; reopen the app once it reports setup complete.
  useEffect(() => {
    if (!saved) return;
    let cancelled = false;
    void (async () => {
      const deadline = Date.now() + RELOAD_TIMEOUT_MS;
      while (!cancelled && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        try {
          const status = (await fetch("/api/setup/status").then((r) => r.json())) as { setupRequired?: boolean };
          if (status.setupRequired === false) {
            window.location.reload();
            return;
          }
        } catch {
          // Unreachable while the server is between shutdown and restart.
        }
      }
      if (!cancelled) {
        setNotice({ tone: "bad", text: "The server did not come back. Check the API log, then refresh this page." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [saved]);

  const setField = (key: keyof Values, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setNotice(null);
  };

  const go = (next: number) => {
    setNotice(null);
    setStepIndex(next);
  };

  const skip = () => {
    if (step.id !== "seerr" && step.id !== "dispatcharr" && step.id !== "bazarr") return;
    const id = step.id;
    setValues((current) => {
      const next = { ...current };
      for (const key of OPTIONAL_FIELDS[id]) next[key] = "";
      return next;
    });
    setSkipped((current) => ({ ...current, [id]: true }));
    go(stepIndex + 1);
  };

  const test = async () => {
    const problem = testProblem(step.id, values);
    if (problem) {
      setNotice({ tone: "bad", text: problem });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const { response, result } = await postJson("/api/setup/test", testBody(step.id, values));
      if (response.status === 403) {
        setNotice({ tone: "bad", text: "Setup code is incorrect." });
        return;
      }
      if (!response.ok) {
        setNotice({ tone: "bad", text: result.error ?? "Could not test this connection." });
        return;
      }
      setNotice({ tone: result.ok ? "ok" : "bad", text: result.message ?? (result.ok ? "Connected." : "Could not connect.") });
    } catch {
      setNotice({ tone: "bad", text: "Could not reach the Reclinarr server." });
    } finally {
      setBusy(false);
    }
  };

  const continueStep = async () => {
    if (step.id === "review") {
      await save();
      return;
    }
    if (step.id === "code") {
      const problem = testProblem("code", values);
      if (problem) {
        setNotice({ tone: "bad", text: problem });
        return;
      }
      setBusy(true);
      setNotice(null);
      try {
        const { response, result } = await postJson("/api/setup/test", testBody("code", values));
        if (response.status === 403 || result.ok === false) {
          setNotice({ tone: "bad", text: response.status === 403 ? "Setup code is incorrect." : (result.message ?? "Setup code is incorrect.") });
          return;
        }
        if (!response.ok) {
          setNotice({ tone: "bad", text: result.error ?? "Could not check the setup code." });
          return;
        }
      } catch {
        setNotice({ tone: "bad", text: "Could not reach the Reclinarr server." });
        return;
      } finally {
        setBusy(false);
      }
      go(stepIndex + 1);
      return;
    }
    const problem = continueProblem(step.id, values);
    if (problem) {
      setNotice({ tone: "bad", text: problem });
      return;
    }
    if (step.id === "seerr" || step.id === "dispatcharr" || step.id === "bazarr") {
      setSkipped((current) => ({ ...current, [step.id]: false }));
    }
    go(stepIndex + 1);
  };

  const save = async () => {
    const problem = invalidUrl(values.JELLYFIN_URL, "Jellyfin");
    if (problem || !values.setupCode.trim()) {
      setNotice({ tone: "bad", text: problem ?? "Enter the setup code from the API log." });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const { response, result } = await postJson("/api/setup", saveBody(values, skipped, shareMetrics));
      if (!response.ok) {
        setNotice({ tone: "bad", text: result.error ?? "Could not save setup." });
        return;
      }
      setSaved(true);
    } catch {
      setNotice({ tone: "bad", text: "Could not reach the Reclinarr server." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <View style={styles.progress} accessibilityRole="progressbar">
          {STEPS.map((item, index) => (
            <View key={item.id} style={[styles.bar, index <= stepIndex ? styles.barOn : null]} />
          ))}
        </View>
        <Text style={styles.kicker}>Step {stepIndex + 1} of {STEPS.length}</Text>
        {saved ? (
          <>
            <Text style={styles.title}>Settings saved</Text>
            <Text style={styles.body}>Connecting to your services…</Text>
            {notice ? <Text style={notice.tone === "ok" ? styles.ok : styles.bad}>{notice.text}</Text> : null}
          </>
        ) : (
          <>
            <View style={styles.titleRow}>
              <Text style={styles.title}>{titleFor(step.id)}</Text>
              {step.skippable ? <Text style={styles.badge}>Optional</Text> : null}
              {step.id === "jellyfin" ? <Text style={styles.badge}>Required</Text> : null}
            </View>
            <Text style={styles.body}>{bodyFor(step.id)}</Text>
            <StepFields
              step={step.id}
              values={values}
              skipped={skipped}
              onChange={setField}
              shareMetrics={shareMetrics}
              onShareMetricsChange={setShareMetrics}
            />
            {notice ? <Text style={notice.tone === "ok" ? styles.ok : styles.bad}>{notice.text}</Text> : null}
            <View style={styles.actions}>
              {stepIndex > 0 ? (
                <Pressable accessibilityRole="button" onPress={() => go(stepIndex - 1)} disabled={busy} style={[styles.secondary, busy && styles.disabled]}>
                  <Text style={styles.secondaryText}>Back</Text>
                </Pressable>
              ) : <View />}
              <View style={styles.actionGroup}>
                {step.skippable ? (
                  <Pressable accessibilityRole="button" onPress={skip} disabled={busy} style={[styles.secondary, busy && styles.disabled]}>
                    <Text style={styles.secondaryText}>Skip</Text>
                  </Pressable>
                ) : null}
                {step.id !== "review" ? (
                  <Pressable accessibilityRole="button" onPress={() => void test()} disabled={busy} style={[styles.secondary, busy && styles.disabled]}>
                    <Text style={styles.secondaryText}>{busy ? "Testing…" : "Test"}</Text>
                  </Pressable>
                ) : null}
                <Pressable accessibilityRole="button" onPress={() => void continueStep()} disabled={busy} style={[styles.primary, busy && styles.disabled]}>
                  <Text style={styles.primaryText}>{step.id === "review" ? (busy ? "Saving…" : "Save setup") : "Continue"}</Text>
                </Pressable>
              </View>
            </View>
          </>
        )}
      </View>
    </ScrollView>
  );
}

function StepFields({
  step,
  values,
  skipped,
  onChange,
  shareMetrics,
  onShareMetricsChange,
}: {
  step: StepId;
  values: Values;
  skipped: Record<OptionalId, boolean>;
  onChange: (key: keyof Values, value: string) => void;
  shareMetrics: boolean;
  onShareMetricsChange: (value: boolean) => void;
}) {
  if (step === "code") {
    return <Field label="Setup code" placeholder="From the API log" value={values.setupCode} onChangeText={(value) => onChange("setupCode", value)} />;
  }
  if (step === "jellyfin") {
    return <Field label="Jellyfin address" placeholder="http://jellyfin:8096" value={values.JELLYFIN_URL} onChangeText={(value) => onChange("JELLYFIN_URL", value)} />;
  }
  if (step === "seerr") {
    return (
      <>
        <Field label="Seerr address" placeholder="http://seerr:5055" value={values.SEERR_URL} onChangeText={(value) => onChange("SEERR_URL", value)} />
        <Field label="Seerr API key" placeholder="API key" value={values.SEERR_API_KEY} onChangeText={(value) => onChange("SEERR_API_KEY", value)} secret />
      </>
    );
  }
  if (step === "dispatcharr") {
    return (
      <>
        <Field label="Dispatcharr address" placeholder="http://dispatcharr:9191" value={values.DISPATCHARR_URL} onChangeText={(value) => onChange("DISPATCHARR_URL", value)} />
        <Field label="API key" placeholder="API key" value={values.DISPATCHARR_API_KEY} onChangeText={(value) => onChange("DISPATCHARR_API_KEY", value)} secret />
        <Text style={styles.hint}>Or sign in with a username and password.</Text>
        <Field label="Username" placeholder="Username" value={values.DISPATCHARR_USERNAME} onChangeText={(value) => onChange("DISPATCHARR_USERNAME", value)} />
        <Field label="Password" placeholder="Password" value={values.DISPATCHARR_PASSWORD} onChangeText={(value) => onChange("DISPATCHARR_PASSWORD", value)} secret />
      </>
    );
  }
  if (step === "bazarr") {
    return (
      <>
        <Field label="Bazarr address" placeholder="http://bazarr:6767" value={values.BAZARR_URL} onChangeText={(value) => onChange("BAZARR_URL", value)} />
        <Field label="Bazarr API key" placeholder="API key" value={values.BAZARR_API_KEY} onChangeText={(value) => onChange("BAZARR_API_KEY", value)} secret />
      </>
    );
  }
  return (
    <View style={styles.review}>
      <ReviewRow label="Jellyfin" value={values.JELLYFIN_URL.trim()} />
      <ReviewRow label="Seerr" value={skipped.seerr ? "Skipped" : values.SEERR_URL.trim()} />
      <ReviewRow label="Dispatcharr" value={skipped.dispatcharr ? "Skipped" : values.DISPATCHARR_URL.trim()} />
      <ReviewRow label="Bazarr" value={skipped.bazarr ? "Skipped" : values.BAZARR_URL.trim()} />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: shareMetrics }}
        onPress={() => onShareMetricsChange(!shareMetrics)}
        style={styles.consent}
      >
        <View style={[styles.checkbox, shareMetrics && styles.checkboxOn]}>
          {shareMetrics ? <Text style={styles.checkmark}>✓</Text> : null}
        </View>
        <View style={styles.consentText}>
          <Text style={styles.consentTitle}>Share anonymous usage metrics</Text>
          <Text style={styles.hint}>
            Helps improve Reclinarr. Sends feature usage, timings, app version, and platform to
            PostHog's EU service; never titles, searches, or account details. Each person can still
            decline on their own device.
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

function Field({
  label,
  placeholder,
  value,
  onChangeText,
  secret,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (value: string) => void;
  secret?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#777"
        secureTextEntry={secret}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
    </View>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.reviewRow}>
      <Text style={styles.reviewLabel}>{label}</Text>
      <Text style={styles.reviewValue}>{value || "Not set"}</Text>
    </View>
  );
}

function titleFor(step: StepId): string {
  switch (step) {
    case "code": return "Set up Reclinarr";
    case "jellyfin": return "Connect Jellyfin";
    case "seerr": return "Connect Seerr";
    case "dispatcharr": return "Connect Dispatcharr";
    case "bazarr": return "Connect Bazarr";
    case "review": return "Ready to save";
  }
}

function bodyFor(step: StepId): string {
  switch (step) {
    case "code":
      return "Enter the setup code printed in the API log. It confirms you can see this server.";
    case "jellyfin":
      return "Jellyfin plays your library. Test the address, then continue.";
    case "seerr":
      return "Seerr adds discovery and requests. Test it, or skip and add it later.";
    case "dispatcharr":
      return "Dispatcharr adds live TV and IPTV video. Test it, or skip and add it later.";
    case "bazarr":
      return "Bazarr serves subtitles. Test it, or skip and add it later.";
    case "review":
      return "These settings are stored in a private file on this server.";
  }
}

function invalidUrl(value: string, label: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return `Enter the ${label} address.`;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return `${label} address must start with http:// or https://.`;
    }
  } catch {
    return `${label} address must start with http:// or https://.`;
  }
  return null;
}

function testProblem(step: StepId, values: Values): string | null {
  if (step === "code") return values.setupCode.trim() ? null : "Enter the setup code from the API log.";
  if (step === "jellyfin") return invalidUrl(values.JELLYFIN_URL, "Jellyfin");
  if (step === "seerr") return invalidUrl(values.SEERR_URL, "Seerr");
  if (step === "dispatcharr") {
    const url = invalidUrl(values.DISPATCHARR_URL, "Dispatcharr");
    if (url) return url;
    const hasKey = values.DISPATCHARR_API_KEY.trim().length > 0;
    const hasLogin = values.DISPATCHARR_USERNAME.trim().length > 0 && values.DISPATCHARR_PASSWORD.length > 0;
    if (!hasKey && !hasLogin) return "Add an API key, or a username and password.";
    return null;
  }
  if (step === "bazarr") {
    const url = invalidUrl(values.BAZARR_URL, "Bazarr");
    if (url) return url;
    if (!values.BAZARR_API_KEY.trim()) return "Enter the Bazarr API key.";
    return null;
  }
  return null;
}

function continueProblem(step: StepId, values: Values): string | null {
  const problem = testProblem(step, values);
  if (problem) return problem;
  if (step === "seerr" && !values.SEERR_API_KEY.trim()) return "Enter the Seerr API key, or skip this step.";
  return null;
}

function testBody(step: StepId, values: Values): Record<string, string> {
  const setupCode = values.setupCode.trim();
  switch (step) {
    case "code":
      return { service: "code", setupCode };
    case "jellyfin":
      return { service: "jellyfin", setupCode, JELLYFIN_URL: values.JELLYFIN_URL.trim() };
    case "seerr":
      return { service: "seerr", setupCode, SEERR_URL: values.SEERR_URL.trim(), SEERR_API_KEY: values.SEERR_API_KEY.trim() };
    case "dispatcharr":
      return {
        service: "dispatcharr",
        setupCode,
        DISPATCHARR_URL: values.DISPATCHARR_URL.trim(),
        DISPATCHARR_API_KEY: values.DISPATCHARR_API_KEY.trim(),
        DISPATCHARR_USERNAME: values.DISPATCHARR_USERNAME.trim(),
        DISPATCHARR_PASSWORD: values.DISPATCHARR_PASSWORD,
      };
    case "bazarr":
      return { service: "bazarr", setupCode, BAZARR_URL: values.BAZARR_URL.trim(), BAZARR_API_KEY: values.BAZARR_API_KEY.trim() };
    case "review":
      return { service: "code", setupCode };
  }
}

function saveBody(values: Values, skipped: Record<OptionalId, boolean>, shareMetrics: boolean): Record<string, string> {
  return {
    setupCode: values.setupCode.trim(),
    JELLYFIN_URL: values.JELLYFIN_URL.trim(),
    SEERR_URL: skipped.seerr ? "" : values.SEERR_URL.trim(),
    SEERR_API_KEY: skipped.seerr ? "" : values.SEERR_API_KEY.trim(),
    DISPATCHARR_URL: skipped.dispatcharr ? "" : values.DISPATCHARR_URL.trim(),
    DISPATCHARR_API_KEY: skipped.dispatcharr ? "" : values.DISPATCHARR_API_KEY.trim(),
    DISPATCHARR_USERNAME: skipped.dispatcharr ? "" : values.DISPATCHARR_USERNAME.trim(),
    DISPATCHARR_PASSWORD: skipped.dispatcharr ? "" : values.DISPATCHARR_PASSWORD,
    BAZARR_URL: skipped.bazarr ? "" : values.BAZARR_URL.trim(),
    BAZARR_API_KEY: skipped.bazarr ? "" : values.BAZARR_API_KEY.trim(),
    RECLINARR_TELEMETRY_DISABLED: shareMetrics ? "false" : "true",
  };
}

async function postJson(path: string, body: Record<string, string>): Promise<{
  response: Response;
  result: { ok?: boolean; message?: string; error?: string };
}> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let result: { ok?: boolean; message?: string; error?: string } = {};
  if (text) {
    try {
      result = JSON.parse(text) as typeof result;
    } catch {
      result = { error: "Unexpected server response." };
    }
  }
  return { response, result };
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, justifyContent: "center", padding: 28, backgroundColor: "#090909" },
  card: { width: "100%", maxWidth: 520, alignSelf: "center", gap: 14 },
  progress: { flexDirection: "row", gap: 6 },
  bar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: "#2a2a2a" },
  barOn: { backgroundColor: "#d72130" },
  kicker: { color: "#888", fontSize: 13, fontWeight: "600" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  title: { color: "white", fontSize: 32, fontWeight: "700" },
  badge: { color: "#bbb", fontSize: 12, fontWeight: "700", backgroundColor: "#1b1b1b", borderRadius: 99, overflow: "hidden", paddingHorizontal: 10, paddingVertical: 4 },
  body: { color: "#aaa", fontSize: 15, lineHeight: 22 },
  field: { gap: 6 },
  label: { color: "#ddd", fontSize: 13, fontWeight: "600" },
  input: { color: "white", backgroundColor: "#1b1b1b", borderWidth: 1, borderColor: "#333", borderRadius: 8, padding: 13 },
  hint: { color: "#888", fontSize: 13 },
  ok: { color: "#9ddeaf", lineHeight: 21 },
  bad: { color: "#ffb4a8", lineHeight: 21 },
  actions: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" },
  actionGroup: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  primary: { backgroundColor: "#d72130", borderRadius: 8, paddingHorizontal: 18, paddingVertical: 14 },
  primaryText: { color: "white", fontWeight: "700" },
  secondary: { borderRadius: 8, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1, borderColor: "#333" },
  secondaryText: { color: "white", fontWeight: "600" },
  disabled: { opacity: 0.45 },
  review: { gap: 10 },
  reviewRow: { gap: 2 },
  reviewLabel: { color: "#888", fontSize: 12, fontWeight: "700" },
  reviewValue: { color: "white", fontSize: 15 },
  consent: { flexDirection: "row", gap: 12, alignItems: "flex-start", marginTop: 8 },
  checkbox: { width: 22, height: 22, borderRadius: 5, borderWidth: 1, borderColor: "#555", alignItems: "center", justifyContent: "center", marginTop: 1 },
  checkboxOn: { backgroundColor: "#d72130", borderColor: "#d72130" },
  checkmark: { color: "white", fontSize: 14, fontWeight: "700" },
  consentText: { flex: 1, gap: 4 },
  consentTitle: { color: "white", fontSize: 15, fontWeight: "600" },
});
