import { registerRootComponent } from "expo";
import { App } from "./App";
import { tryGetClient } from "@reclinarr/client";

const errorUtils = (globalThis as typeof globalThis & { ErrorUtils?: { getGlobalHandler?: () => (error: Error, isFatal?: boolean) => void; setGlobalHandler?: (handler: (error: Error, isFatal?: boolean) => void) => void } }).ErrorUtils;
if (errorUtils?.setGlobalHandler) {
  const previous = errorUtils.getGlobalHandler?.();
  errorUtils.setGlobalHandler((error, isFatal) => {
    tryGetClient()?.captureException(error);
    previous?.(error, isFatal);
  });
}

registerRootComponent(App);
