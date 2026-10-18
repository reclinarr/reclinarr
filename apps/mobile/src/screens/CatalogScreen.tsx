import { CatalogScreen as SharedCatalog } from "@reclinarr/native-ui";
import { ScreenHeader } from "../components/ScreenHeader";
import { useMobileLayout } from "../layout";
import { useScreenNav } from "../useScreenNav";

export function CatalogScreen({
  username,
  mediaType,
  title,
}: {
  username: string;
  mediaType: "movie" | "tv";
  title: string;
}) {
  const layout = useMobileLayout();
  const nav = useScreenNav();
  return (
    <SharedCatalog
      layout={layout}
      nav={nav}
      mediaType={mediaType}
      header={<ScreenHeader username={username} title={title} />}
    />
  );
}
