import type { Media } from "@reclinarr/shared";
import { PosterCard as SharedPosterCard } from "@reclinarr/native-ui";
import { useMobileLayout } from "../layout";

export function PosterCard({ media, onPress }: { media: Media; onPress: () => void }) {
  const layout = useMobileLayout();
  return <SharedPosterCard media={media} layout={layout} onPress={onPress} />;
}
