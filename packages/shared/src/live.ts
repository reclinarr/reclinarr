import { z } from "zod";

export const LiveChannelGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  channelCount: z.number().optional(),
});
export type LiveChannelGroup = z.infer<typeof LiveChannelGroupSchema>;

const SUPERSCRIPT = "\\u00B2\\u00B3\\u00B9\\u02B0-\\u02FF\\u1D2C-\\u1D6A\\u1D9B-\\u1DBF\\u2070-\\u209F";
const SUPERSCRIPT_RUN = new RegExp(`[${SUPERSCRIPT}]+(?:/[${SUPERSCRIPT}]+)*`, "gu");
const QUALITY_TAG = /^(?:raw|sd|hd|fhd|uhd|4k|\d+fps)(?:\/(?:raw|sd|hd|fhd|uhd|4k|\d+fps))*$/i;
/** NFKC leaves some modifier letters as small capitals (ᶦ → ɪ); read those as plain letters. */
const SMALL_CAPITALS: Record<string, string> = {
  ᴀ: "a", ʙ: "b", ᴄ: "c", ᴅ: "d", ᴇ: "e", ꜰ: "f", ɢ: "g", ʜ: "h", ɪ: "i", ᴊ: "j", ᴋ: "k",
  ʟ: "l", ᴍ: "m", ɴ: "n", ᴏ: "o", ᴘ: "p", ʀ: "r", ꜱ: "s", ᴛ: "t", ᴜ: "u", ᴠ: "v", ᴡ: "w",
  ʏ: "y", ᴢ: "z",
};

/**
 * IPTV group names come decorated, e.g. "US| AT&T ᴿᴬᵂ ⁶⁰ᶠᵖˢ". For display, drop superscript
 * quality tags and "|" separators, and spell out any other superscript ("ᶜᶦᵗʸ" → "city")
 * so groups that differ only there stay distinguishable.
 */
export function displayGroupName(name: string): string {
  const tidy = name
    .replace(/️/g, "")
    .replace(SUPERSCRIPT_RUN, (run) => {
      const plain = [...run.normalize("NFKC")].map((ch) => SMALL_CAPITALS[ch] ?? ch).join("");
      return QUALITY_TAG.test(plain) ? " " : ` ${plain} `;
    })
    .replace(/\s*\|\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return tidy || name.trim();
}

export const LiveChannelSchema = z.object({
  id: z.string(),
  uuid: z.string(),
  name: z.string(),
  number: z.number().optional(),
  logoUrl: z.string().optional(),
  groupId: z.string().optional(),
  groupName: z.string().optional(),
  tvgId: z.string().optional(),
  favourite: z.boolean().optional(),
});
export type LiveChannel = z.infer<typeof LiveChannelSchema>;

export const EpgProgrammeSchema = z.object({
  id: z.string().optional(),
  channelId: z.string(),
  channelUuid: z.string().optional(),
  title: z.string(),
  description: z.string().optional(),
  startsAt: z.string(),
  endsAt: z.string(),
  isLive: z.boolean().optional(),
});
export type EpgProgramme = z.infer<typeof EpgProgrammeSchema>;

export const LiveNowNextSchema = z.object({
  channelUuid: z.string(),
  now: EpgProgrammeSchema.nullable().optional(),
  next: EpgProgrammeSchema.nullable().optional(),
});
export type LiveNowNext = z.infer<typeof LiveNowNextSchema>;
