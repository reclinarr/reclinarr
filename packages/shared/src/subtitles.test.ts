import { describe, expect, it } from "vitest";
import { normalizeSubtitleLanguage, parseSubtitleCues, toWebVtt } from "./subtitles.js";

describe("parseSubtitleCues", () => {
  it("parses srt timestamps and skips the cue number", () => {
    const cues = parseSubtitleCues(
      "1\n00:00:01,000 --> 00:00:04,000\nHello\n\n2\n00:00:05,500 --> 00:00:08,000\nWorld\n",
    );
    expect(cues).toEqual([
      { start: 1, end: 4, text: "Hello" },
      { start: 5.5, end: 8, text: "World" },
    ]);
  });

  it("parses webvtt and strips tags", () => {
    const cues = parseSubtitleCues(
      "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<i>Hi</i>\nthere\n",
    );
    expect(cues).toEqual([{ start: 1, end: 2, text: "Hi\nthere" }]);
  });

  it("parses ass dialogue", () => {
    const cues = parseSubtitleCues(
      "[Script Info]\nScriptType: v4.00+\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:01:02.00,0:01:05.50,Default,,0,0,0,,{\\i1}Hello\\Nthere\n",
    );
    expect(cues).toEqual([{ start: 62, end: 65.5, text: "Hello\nthere" }]);
  });

  it("round-trips to webvtt", () => {
    const vtt = toWebVtt("1\n00:01:02,250 --> 00:01:03,000\nLine\n");
    expect(vtt.startsWith("WEBVTT")).toBe(true);
    expect(parseSubtitleCues(vtt)).toEqual([{ start: 62.25, end: 63, text: "Line" }]);
  });
});

describe("normalizeSubtitleLanguage", () => {
  it("maps english codes together", () => {
    expect(normalizeSubtitleLanguage("eng")).toBe("en");
    expect(normalizeSubtitleLanguage("en-US")).toBe("en");
    expect(normalizeSubtitleLanguage("und")).toBe("");
  });
});
