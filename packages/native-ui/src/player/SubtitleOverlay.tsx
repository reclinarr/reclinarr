import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { getClient, playbackMediaUrl } from "@reclinarr/client";
import { parseSubtitleCues, type SubtitleCue, type SubtitleTrack } from "@reclinarr/shared";

export function SubtitleOverlay({ track, position, sessionId }: {
  track?: SubtitleTrack;
  position: number;
  sessionId: string;
}) {
  const [loaded, setLoaded] = useState<{ url: string; cues: SubtitleCue[] } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const url = track?.url ? playbackMediaUrl(track.url, getClient().baseUrl, sessionId) : "";
  useEffect(() => {
    if (!url) return;
    const abort = new AbortController();
    void fetch(url, { signal: abort.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Subtitles could not be loaded");
      const cues = parseSubtitleCues(await response.text());
      if (!abort.signal.aborted) {
        setLoaded({ url, cues });
        setFailed(null);
      }
    }).catch(() => {
      if (!abort.signal.aborted) setFailed(url);
    });
    return () => abort.abort();
  }, [url]);
  const text = loaded?.url === url ? loaded.cues
    .filter((cue) => cue.start <= position && cue.end > position)
    .map((cue) => cue.text).join("\n") : "";
  if (!url || (!text && failed !== url)) return null;
  return (
    <View pointerEvents="none" style={styles.overlay}>
      <Text style={styles.text}>{failed === url ? "Subtitles could not be loaded" : text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: "absolute", left: "8%", right: "8%", bottom: "12%", alignItems: "center" },
  text: { color: "#fff", backgroundColor: "rgba(0,0,0,0.7)", paddingHorizontal: 8, paddingVertical: 4, fontSize: 22, textAlign: "center", fontWeight: "600" },
});
