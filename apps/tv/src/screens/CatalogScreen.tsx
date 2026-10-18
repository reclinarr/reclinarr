import { CatalogScreen as SharedCatalog } from "@reclinarr/native-ui";
import { Chrome } from "../components/Chrome";
import { TvTextInput } from "../components/TvTextInput";
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
    <Chrome username={username}>
      <SharedCatalog
        layout={layout}
        nav={nav}
        mediaType={mediaType}
        focusMode="tv"
        appearance="web"
        pageTitle={title}
        searchInput={({ value, onChangeText }) => (
          <TvTextInput
            style={{
              color: "#fff",
              backgroundColor: "rgba(255,255,255,0.12)",
              borderRadius: 999,
              paddingHorizontal: 16,
              paddingVertical: 8,
              minWidth: 140,
              fontSize: 16,
            }}
            value={value}
            onChangeText={onChangeText}
            placeholder="Genres"
            placeholderTextColor="rgba(255,255,255,0.85)"
            autoCapitalize="none"
            autoCorrect={false}
          />
        )}
      />
    </Chrome>
  );
}
