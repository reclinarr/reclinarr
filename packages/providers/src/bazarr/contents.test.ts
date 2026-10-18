import { describe, expect, it } from "vitest";
import { bazarrContentsToWebVtt } from "./provider.js";

describe("bazarr subtitle contents", () => {
  it("turns cue JSON into WebVTT", () => {
    const vtt = bazarrContentsToWebVtt({
      data: [
        {
          index: 1,
          content: "Here you are, sir.",
          start: { total_seconds: 1543, microseconds: 909000 },
          end: { total_seconds: 1546, microseconds: 0 },
        },
      ],
    });
    expect(vtt).toContain("WEBVTT");
    expect(vtt).toContain("00:25:43.909 --> 00:25:46.000");
    expect(vtt).toContain("Here you are, sir.");
  });

  it("passes through raw subtitle text", () => {
    expect(bazarrContentsToWebVtt("1\n00:00:01,000 --> 00:00:02,000\nHi\n")).toContain("Hi");
  });
});
