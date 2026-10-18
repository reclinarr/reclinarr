import "react-native";
import type { ComponentType, ReactNode } from "react";
import type { ViewProps } from "react-native";

declare module "react-native" {
  export function useTVEventHandler(handler: (evt: { eventType: string } | undefined) => void): void;

  interface PressableStateCallbackType {
    focused?: boolean;
  }

  export type TVFocusGuideViewProps = ViewProps & {
    enabled?: boolean;
    autoFocus?: boolean;
    trapFocusUp?: boolean;
    trapFocusDown?: boolean;
    trapFocusLeft?: boolean;
    trapFocusRight?: boolean;
    focusable?: boolean;
    children?: ReactNode;
  };

  export const TVFocusGuideView: ComponentType<TVFocusGuideViewProps>;
}
