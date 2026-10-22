import { Pressable, StyleSheet, Text, View } from "react-native";
import { isTvFocused, SearchScreen as SharedSearch } from "@reclinarr/native-ui";
import { Chrome } from "../components/Chrome";
import { MicIcon } from "../components/MicIcon";
import { TvTextInput } from "../components/TvTextInput";
import { useTvSpeechToText } from "../hooks/useTvSpeechToText";
import { useTvLayout } from "../layout";
import { useScreenNav } from "../useScreenNav";

function TvVoiceSearchInput({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (v: string) => void;
}) {
  const speech = useTvSpeechToText({ onTranscript: onChangeText });
  const statusText = speech.listening ? "Listening…" : speech.error;

  return (
    <View style={styles.row}>
      <View style={styles.field}>
        <TvTextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={speech.listening ? "Listening…" : "Search movies and series"}
          placeholderTextColor="#b3b3b3"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={speech.listening ? "Stop voice search" : "Voice search"}
        onPress={speech.toggle}
        style={(state) => [
          styles.mic,
          speech.listening && styles.micListening,
          isTvFocused(state) && styles.micFocused,
        ]}
      >
        <MicIcon color={speech.listening ? "#111" : "#fff"} size={22} />
      </Pressable>
      {statusText ? (
        <Text style={[styles.status, speech.error ? styles.statusError : null]} numberOfLines={1}>
          {statusText}
        </Text>
      ) : null}
    </View>
  );
}

export function SearchScreen({ username }: { username: string }) {
  const layout = useTvLayout();
  const nav = useScreenNav();
  return (
    <Chrome username={username}>
      <SharedSearch
        layout={layout}
        nav={nav}
        focusMode="tv"
        appearance="web"
        searchInput={({ value, onChangeText }) => (
          <TvVoiceSearchInput value={value} onChangeText={onChangeText} />
        )}
      />
    </Chrome>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  field: {
    flex: 1,
    minWidth: 280,
  },
  input: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    color: "#fff",
    fontSize: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 4,
    marginBottom: 0,
  },
  mic: {
    width: 48,
    height: 48,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  micFocused: {
    borderColor: "#fff",
    backgroundColor: "rgba(255,255,255,0.22)",
    transform: [{ scale: 1.06 }],
  },
  micListening: {
    backgroundColor: "#fff",
    borderColor: "#fff",
  },
  status: {
    color: "#b3b3b3",
    fontSize: 14,
    width: "100%",
    marginTop: 2,
  },
  statusError: {
    color: "#ff6b6b",
  },
});
