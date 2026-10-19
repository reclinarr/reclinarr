import "./src/global.css";
import { registerRootComponent } from "expo";
import { App } from "./App";
import { tryGetClient } from "@reclinarr/client";

if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    tryGetClient()?.captureException(event.error ?? new Error(event.message));
  });
  window.addEventListener("unhandledrejection", (event) => {
    tryGetClient()?.captureException(event.reason);
  });
}

registerRootComponent(App);
