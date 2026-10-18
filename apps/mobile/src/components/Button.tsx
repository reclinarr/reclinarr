import { Button as SharedButton } from "@reclinarr/native-ui";
import type { ComponentProps } from "react";

export function Button(props: ComponentProps<typeof SharedButton>) {
  return <SharedButton {...props} />;
}
