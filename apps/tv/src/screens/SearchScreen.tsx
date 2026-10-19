import { SearchScreen as SharedSearch } from "@reclinarr/native-ui";
import { Chrome } from "../components/Chrome";
import { TvTextInput } from "../components/TvTextInput";
import { useTvLayout } from "../layout";
import { useScreenNav } from "../useScreenNav";

export function SearchScreen({ username }: { username: string }) {
  const layout = useTvLayout();
  const nav = useScreenNav();
  return (
    <Chrome username={username}>
      <SharedSearch
        layout={layout}
        nav={nav}
        focusMode="tv"
        appearance="web"
        searchInput={({ value, onChangeText }) => (
          <TvTextInput
            style={{
              backgroundColor: "rgba(255,255,255,0.08)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.35)",
              color: "#fff",
              fontSize: 18,
              paddingHorizontal: 16,
              paddingVertical: 12,
              borderRadius: 4,
              marginBottom: 0,
            }}
            value={value}
            onChangeText={onChangeText}
            placeholder="Search movies and series"
            placeholderTextColor="#b3b3b3"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
          />
        )}
      />
    </Chrome>
  );
}
