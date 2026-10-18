import type { ReactNode } from "react";
import type { MediaIdentity, PlaybackSource } from "@reclinarr/shared";
import type { NativeLayout } from "../layout.js";
import type { DetailsParams } from "../media-nav.js";

export type LiveChannelRef = {
  uuid: string;
  name: string;
  number?: number;
};

export type PlayNavParams = {
  source: PlaybackSource;
  title?: string;
  live?: boolean;
  identity?: MediaIdentity;
  channelUuid?: string;
  liveChannels?: LiveChannelRef[];
};

export type ScreenNav = {
  openDetails: (params: DetailsParams) => void;
  openPlayer: (params: PlayNavParams) => void;
  goBack?: () => void;
  openServer?: (opts?: { change?: boolean }) => void;
  resetToLogin?: () => void;
  resetToMain?: () => void;
};

export type FocusMode = "touch" | "tv";

/** `web` is the Netflix-style browser presentation. Native apps stay on `native`. */
export type Appearance = "native" | "web";

export type ScreenChromeProps = {
  layout: NativeLayout;
  nav: ScreenNav;
  header?: ReactNode;
  focusMode?: FocusMode;
  appearance?: Appearance;
  /** Scroll offset of the page body, so a fixed header can turn solid. */
  onScrollOffset?: (y: number) => void;
  pageTitle?: string;
};
