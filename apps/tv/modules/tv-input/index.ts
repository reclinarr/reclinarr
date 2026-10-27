import { requireNativeModule } from "expo";

type TvInputModule = {
  setCredentials(serverUrl: string, sessionId: string): void;
  requestSync(): void;
  clearCredentials(): Promise<void>;
};

/** Publishes favourite live channels to the Android TV system guide (TV Input Framework). */
export const TvInput = requireNativeModule<TvInputModule>("ReclinarrTvInput");
