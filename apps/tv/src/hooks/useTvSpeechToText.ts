import { useCallback, useEffect, useRef, useState } from "react";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";

export type TvSpeechStatus = "idle" | "listening" | "error";

type Options = {
  /** Called for interim and final transcripts so the search field can update live. */
  onTranscript: (text: string) => void;
  lang?: string;
};

export function useTvSpeechToText({ onTranscript, lang = "en-US" }: Options) {
  const [status, setStatus] = useState<TvSpeechStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  useSpeechRecognitionEvent("start", () => {
    setStatus("listening");
    setError(null);
  });

  useSpeechRecognitionEvent("end", () => {
    setStatus((s) => (s === "listening" ? "idle" : s));
  });

  useSpeechRecognitionEvent("result", (event) => {
    const text = event.results[0]?.transcript?.trim();
    if (!text) return;
    onTranscriptRef.current(text);
    if (event.isFinal) {
      setStatus("idle");
    }
  });

  useSpeechRecognitionEvent("error", (event) => {
    if (event.error === "aborted" || event.error === "no-speech" || event.error === "speech-timeout") {
      setStatus("idle");
      setError(null);
      return;
    }
    setStatus("error");
    setError(event.message || event.error);
  });

  useEffect(() => {
    return () => {
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        // ignore teardown errors
      }
    };
  }, []);

  const stop = useCallback(() => {
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      // ignore
    }
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    setError(null);
    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!result.granted) {
      setStatus("error");
      setError("Microphone permission is required for voice search.");
      return;
    }
    try {
      ExpoSpeechRecognitionModule.start({
        lang,
        interimResults: true,
        continuous: false,
      });
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Could not start voice search.");
    }
  }, [lang]);

  const toggle = useCallback(() => {
    if (status === "listening") {
      stop();
      return;
    }
    void start();
  }, [start, status, stop]);

  return {
    status,
    listening: status === "listening",
    error,
    start,
    stop,
    toggle,
  };
}
