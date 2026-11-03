import { describe, expect, it } from "vitest";
import { displayGroupName } from "./live.js";

describe("displayGroupName", () => {
  it.each([
    ["US| AT&T ᴿᴬᵂ ⁶⁰ᶠᵖˢ", "US AT&T"],
    ["UK| GENERAL ᴴᴰ/ᴿᴬᵂ", "UK GENERAL"],
    ["UK| SKY SPORT+ PPV ᴿᴬᵂ", "UK SKY SPORT+ PPV"],
    ["US| ️HULU NETWORK ᴿᴬᵂ ⁶⁰ᶠᵖˢ", "US HULU NETWORK"],
    ["US| 24/7 MOVIES/ACTORS ᴿᴬᵂ ⁶⁰ᶠᵖˢ", "US 24/7 MOVIES/ACTORS"],
    ["IT| GENERALE HD/4K", "IT GENERALE HD/4K"],
    ["Default Group", "Default Group"],
  ])("%s → %s", (raw, shown) => {
    expect(displayGroupName(raw)).toBe(shown);
  });

  it("keeps superscript words that tell groups apart", () => {
    expect(displayGroupName("US| TV ᶜᶦᵗʸ ᴿᴬᵂ ⁶⁰ᶠᵖˢ")).toBe("US TV city");
    expect(displayGroupName("US| TV ᴿᴬᵂ ⁶⁰ᶠᵖˢ")).toBe("US TV");
  });

  it("falls back to the raw name when nothing readable is left", () => {
    expect(displayGroupName("ᴿᴬᵂ")).toBe("ᴿᴬᵂ");
  });
});
