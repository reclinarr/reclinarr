import type { Media } from "@reclinarr/shared";
import { openMedia as open } from "@reclinarr/native-ui";
import type { Nav } from "./nav";

export function openMedia(navigation: Nav, media: Media) {
  open(navigation, media);
}
