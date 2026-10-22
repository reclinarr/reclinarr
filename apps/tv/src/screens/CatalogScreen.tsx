import { CatalogScreen as SharedCatalog } from "@reclinarr/native-ui";
import { Chrome } from "../components/Chrome";
import { useTvLayout } from "../layout";
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
  const layout = useTvLayout();
  const nav = useScreenNav();
  return (
    <Chrome username={username} contentFocus>
      <SharedCatalog
        layout={layout}
        nav={nav}
        mediaType={mediaType}
        focusMode="tv"
        appearance="web"
        pageTitle={title}
      />
    </Chrome>
  );
}
