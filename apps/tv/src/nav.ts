import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { DetailsParams } from "@reclinarr/native-ui";
import type { MediaIdentity, PlaybackSource } from "@reclinarr/shared";

export type LiveChannelRef = {
  uuid: string;
  name: string;
  number?: number;
};

export type PlayParams = {
  source: PlaybackSource;
  title?: string;
  live?: boolean;
  identity?: MediaIdentity;
  channelUuid?: string;
  liveChannels?: LiveChannelRef[];
};

export type RootStackParamList = {
  Boot: undefined;
  Server: { change?: boolean } | undefined;
  Login: undefined;
  Home: undefined;
  Movies: undefined;
  Series: undefined;
  Search: undefined;
  Live: undefined;
  Downloads: undefined;
  Requests: undefined;
  Details: DetailsParams;
  Player: PlayParams;
};

export type Nav = NativeStackNavigationProp<RootStackParamList>;
