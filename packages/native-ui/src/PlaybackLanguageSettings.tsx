import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  loadAudioLanguagePref,
  loadSubtitlePref,
  saveAudioLanguagePref,
  saveSubtitleOff,
  saveSubtitlePref,
  type KeyValueStorage,
} from "@reclinarr/client";
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

export function PlaybackLanguageSettings({ storage }: { storage: KeyValueStorage }) {
  const [ready, setReady] = useState(false);
  const [audio, setAudio] = useState<string | null>(null);
  const [subtitles, setSubtitles] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadAudioLanguagePref(storage), loadSubtitlePref(storage)]).then(
      ([audioPref, subtitlePref]) => {
        if (cancelled) return;
        setAudio(audioPref);
        setSubtitles(
          subtitlePref.mode === "on"
            ? normalizeSubtitleLanguage(subtitlePref.language) || null
            : null,
        );
        setReady(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [storage]);

  async function chooseAudio(next: string | null) {
    setAudio(next);
    await saveAudioLanguagePref(next, storage);
  }

  async function chooseSubtitles(next: string | null) {
    setSubtitles(next);
    if (!next) {
      await saveSubtitleOff(storage);
      return;
    }
    await saveSubtitlePref({ mode: "on", language: next }, storage);
  }

  if (!ready) return null;

  return (
    <View style={styles.wrap}>
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
  wrap: { gap: 8 },
  setting: { gap: 10, paddingVertical: 12 },
  title: { color: colors.text, fontSize: 16, fontWeight: "700" },
  copy: { color: colors.muted, fontSize: 14, lineHeight: 20 },
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
  chipTextSelected: { color: "#141414" },
});
