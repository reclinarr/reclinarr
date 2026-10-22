import { describe, expect, it } from "vitest";
import {
  chooseLiveVideoEncoder,
  libx264Encoder,
  liveVideoEncoder,
  parseFfmpegEncoderList,
  parseHwAccelMode,
  type LiveVideoEncoder,
} from "./ffmpeg-video-encoder.js";

const LISTING = `
Encoders:
 V..... a64multi               Multicolor charset for Commodore 64 (codec a64_multi)
 V....D libx264                libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 V....D h264_nvenc             NVIDIA NVENC H.264 encoder (codec h264)
 V....D h264_qsv               H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (Intel Quick Sync Video acceleration) (codec h264)
 V....D h264_vaapi             H.264/AVC (VAAPI) (codec h264)
 V....D h264_videotoolbox      VideoToolbox H.264 Encoder (codec h264)
`;

function smokeFor(ids: string[]) {
  return async (encoder: LiveVideoEncoder) => ids.includes(encoder.id);
}

describe("parseHwAccelMode", () => {
  it("accepts the documented modes", () => {
    expect(parseHwAccelMode(undefined)).toBe("auto");
    expect(parseHwAccelMode("off")).toBe("off");
    expect(parseHwAccelMode("CPU")).toBe("off");
    expect(parseHwAccelMode("vaapi")).toBe("vaapi");
  });
});

describe("parseFfmpegEncoderList", () => {
  it("reads encoder names from ffmpeg -encoders", () => {
    const names = parseFfmpegEncoderList(LISTING);
    expect(names.has("libx264")).toBe(true);
    expect(names.has("h264_videotoolbox")).toBe(true);
    expect(names.has("h264_vaapi")).toBe(true);
    expect(names.has("Encoders:")).toBe(false);
  });
});

describe("chooseLiveVideoEncoder", () => {
  const encoders = parseFfmpegEncoderList(LISTING);

  it("stays on libx264 when hardware is disabled", async () => {
    const chosen = await chooseLiveVideoEncoder({
      mode: "off",
      hlsTime: 2,
      encoders,
      platform: "darwin",
      renderDevice: "/dev/dri/renderD128",
      nvidia: true,
      smoke: smokeFor(["h264_videotoolbox", "h264_nvenc", "h264_vaapi", "h264_qsv"]),
    });
    expect(chosen.id).toBe("libx264");
  });

  it("uses VideoToolbox on macOS when the probe encode works", async () => {
    const chosen = await chooseLiveVideoEncoder({
      mode: "auto",
      hlsTime: 2,
      encoders,
      platform: "darwin",
      renderDevice: null,
      nvidia: false,
      smoke: smokeFor(["h264_videotoolbox"]),
    });
    expect(chosen).toEqual(liveVideoEncoder("videotoolbox", 2));
  });

  it("prefers NVENC over VAAPI when both probes succeed", async () => {
    const chosen = await chooseLiveVideoEncoder({
      mode: "auto",
      hlsTime: 2,
      encoders,
      platform: "linux",
      renderDevice: "/dev/dri/renderD128",
      nvidia: true,
      smoke: smokeFor(["h264_nvenc", "h264_vaapi"]),
    });
    expect(chosen.id).toBe("h264_nvenc");
  });

  it("uses VAAPI when a render node is visible", async () => {
    const chosen = await chooseLiveVideoEncoder({
      mode: "auto",
      hlsTime: 2,
      encoders,
      platform: "linux",
      renderDevice: "/dev/dri/renderD128",
      nvidia: false,
      smoke: smokeFor(["h264_vaapi"]),
    });
    expect(chosen.beforeInput).toEqual(["-vaapi_device", "/dev/dri/renderD128"]);
    expect(chosen.videoArgs).toContain("h264_vaapi");
  });

  it("falls back to libx264 when the probe encode fails", async () => {
    const chosen = await chooseLiveVideoEncoder({
      mode: "auto",
      hlsTime: 2,
      encoders,
      platform: "darwin",
      renderDevice: null,
      nvidia: false,
      smoke: async () => false,
    });
    expect(chosen).toEqual(libx264Encoder(2));
  });

  it("does not probe VideoToolbox on Linux", async () => {
    let smoked = false;
    const chosen = await chooseLiveVideoEncoder({
      mode: "videotoolbox",
      hlsTime: 2,
      encoders,
      platform: "linux",
      renderDevice: null,
      nvidia: false,
      smoke: async () => {
        smoked = true;
        return true;
      },
    });
    expect(smoked).toBe(false);
    expect(chosen.id).toBe("libx264");
  });
});
