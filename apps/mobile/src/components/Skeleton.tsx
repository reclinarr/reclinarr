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
import { useMobileLayout } from "../layout";

export { SkeletonBlock };

export function CatalogSkeleton({ cards = 6 }: { cards?: number }) {
  const layout = useMobileLayout();
  return <SharedCatalog layout={layout} cards={cards} />;
}

export function RailSkeleton({ rails = 3, cards = 5 }: { rails?: number; cards?: number }) {
  const layout = useMobileLayout();
  return <SharedRail layout={layout} rails={rails} cards={cards} />;
}

export function HomeSkeleton() {
  const layout = useMobileLayout();
  return <SharedHome layout={layout} rails={2} cards={4} />;
}

export function DetailsSkeleton() {
  return <SharedDetails backdropH={200} />;
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
