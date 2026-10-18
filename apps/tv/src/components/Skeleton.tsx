import {
  BootSkeleton as SharedBoot,
  CatalogSkeleton as SharedCatalog,
  ChannelListSkeleton as SharedChannels,
  DetailsSkeleton as SharedDetails,
  HomeSkeleton as SharedHome,
  ListSkeleton as SharedList,
  RailSkeleton as SharedRail,
  SkeletonBlock,
} from "@reclinarr/native-ui";
import { useTvLayout } from "../layout";

export { SkeletonBlock };

export function CatalogSkeleton({ cards = 8 }: { cards?: number }) {
  const layout = useTvLayout();
  return <SharedCatalog layout={layout} cards={cards} />;
}

export function RailSkeleton({ rails = 2, cards = 6 }: { rails?: number; cards?: number }) {
  const layout = useTvLayout();
  return <SharedRail layout={layout} rails={rails} cards={cards} />;
}

export function HomeSkeleton() {
  const layout = useTvLayout();
  return <SharedHome layout={layout} rails={2} cards={6} />;
}

export function DetailsSkeleton() {
  return <SharedDetails backdropH={280} />;
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return <SharedList rows={rows} />;
}

export function ChannelListSkeleton({ rows = 8 }: { rows?: number }) {
  return <SharedChannels rows={rows} />;
}

export function BootSkeleton() {
  return <SharedBoot />;
}
