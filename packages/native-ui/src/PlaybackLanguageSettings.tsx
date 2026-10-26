import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { getClient, trackFeature } from "@reclinarr/client";
import { normalizeSubtitleLanguage } from "@reclinarr/shared";
import { isTvFocused } from "./focus.js";
import { colors } from "./theme.js";

const LANGUAGES: Array<{ code: string; label: string }> = [
  { code: "en", label: "English" },
  { code: "it", label: "Italian" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "nl", label: "Dutch" },
  { code: "pl", label: "Polish" },
  { code: "sv", label: "Swedish" },
  { code: "no", label: "Norwegian" },
  { code: "da", label: "Danish" },
  { code: "fi", label: "Finnish" },
  { code: "ru", label: "Russian" },
  { code: "uk", label: "Ukrainian" },
  { code: "tr", label: "Turkish" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
];

function optionsFor(selected: string | null): Array<{ code: string; label: string }> {
  if (!selected || LANGUAGES.some((language) => language.code === selected)) return LANGUAGES;
  return [...LANGUAGES, { code: selected, label: selected.toUpperCase() }];
}

export function PlaybackLanguageSettings() {
  const [ready, setReady] = useState(false);
  const [audio, setAudio] = useState<string | null>(null);
  const [subtitles, setSubtitles] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getClient()
      .syncPreferences()
      .then((prefs) => {
        if (cancelled) return;
        setAudio(prefs.audioLanguage);
        setSubtitles(
          prefs.subtitles.mode === "on"
            ? normalizeSubtitleLanguage(prefs.subtitles.language) || null
            : null,
        );
        setReady(true);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function chooseAudio(next: string | null) {
    const previous = audio;
    setAudio(next);
    setError(null);
    try {
      await getClient().updatePreferences({ audioLanguage: next });
      trackFeature("audio_language_change");
    } catch (err) {
      setAudio(previous);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function chooseSubtitles(next: string | null) {
    const previous = subtitles;
    setSubtitles(next);
    setError(null);
    try {
      await getClient().updatePreferences({
        subtitles: next ? { mode: "on", language: next } : { mode: "off" },
      });
      trackFeature("subtitle_change");
    } catch (err) {
      setSubtitles(previous);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (error && !ready) return <Text style={styles.error}>Couldn't load language settings: {error}</Text>;
  if (!ready) return null;

  return (
    <View style={styles.wrap}>
      {error ? <Text style={styles.error}>Couldn't save: {error}</Text> : null}
      <View style={styles.setting}>
        <Text style={styles.title}>Preferred audio</Text>
        <Text style={styles.copy}>
          Plays this language when the title has it. Otherwise the default track is used.
        </Text>
        <View style={styles.choices}>
          <Choice label="Default" selected={audio == null} onPress={() => void chooseAudio(null)} />
          {optionsFor(audio).map((language) => (
            <Choice
              key={language.code}
              label={language.label}
              selected={audio === language.code}
              onPress={() => void chooseAudio(language.code)}
            />
          ))}
        </View>
      </View>
      <View style={styles.setting}>
        <Text style={styles.title}>Subtitles</Text>
        <Text style={styles.copy}>Shown automatically when a matching track is available.</Text>
        <View style={styles.choices}>
          <Choice
            label="Off"
            selected={subtitles == null}
            onPress={() => void chooseSubtitles(null)}
          />
          {optionsFor(subtitles).map((language) => (
            <Choice
              key={language.code}
              label={language.label}
              selected={subtitles === language.code}
              onPress={() => void chooseSubtitles(language.code)}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={(state) => [
        styles.chip,
        selected ? styles.chipSelected : null,
        isTvFocused(state) ? styles.chipFocused : null,
      ]}
    >
      <Text style={[styles.chipText, selected ? styles.chipTextSelected : null]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", columnGap: 40, rowGap: 8 },
  setting: { gap: 10, paddingVertical: 12, flexGrow: 1, flexBasis: 340 },
  title: { color: colors.text, fontSize: 16, fontWeight: "700" },
  copy: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  error: { color: "#e87c03", fontSize: 14, lineHeight: 20, width: "100%" },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: colors.bg2,
  },
  chipSelected: { backgroundColor: colors.accent },
  chipFocused: { borderColor: colors.text },
  chipText: { color: colors.text, fontSize: 14, fontWeight: "700" },
  chipTextSelected: { color: colors.text },
});
