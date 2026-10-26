import type { DetailsParams } from "@reclinarr/native-ui";
import type { MediaIdentity, PlaybackSource } from "@reclinarr/shared";

export type LiveChannelRef = {
  uuid: string;
  name: string;
  number?: number;
};

export type PlayParams = {
  /** Present when navigating in-app; omitted on reload and re-resolved from identity/channel. */
  source?: PlaybackSource;
  title?: string;
  live?: boolean;
  identity?: MediaIdentity;
  channelUuid?: string;
  liveChannels?: LiveChannelRef[];
  /** From `?p=` on reload — seconds into the title. */
  resumeSeconds?: number;
};

export type RootStackParamList = {
  Boot: undefined;
  Login: undefined;
  Setup: undefined;
  Home: undefined;
  Movies: undefined;
  Series: undefined;
  Search: { q?: string } | undefined;
  Live: undefined;
  Downloads: undefined;
  Requests: undefined;
  Details: DetailsParams;
  Player: PlayParams;
  Settings: undefined;
};
