import { useEffect, useState } from "react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { HomeScreen as SharedHome, catalogQuery } from "@reclinarr/native-ui";
import { Chrome } from "../components/Chrome";
import { useTvLayout } from "../layout";
import { useScreenNav } from "../useScreenNav";

export function HomeScreen({ username }: { username: string }) {
  const layout = useTvLayout();
  const nav = useScreenNav();
  const [scrolled, setScrolled] = useState(false);
  const queryClient = useQueryClient();
  const homeFetching = useIsFetching({ queryKey: ["home"] });
  // Warm the Movies and Series tabs once Home has loaded, so their first visit renders from cache.
  useEffect(() => {
    if (homeFetching > 0 || !queryClient.getQueryData(["home"])) return;
    void queryClient.prefetchQuery(catalogQuery("movie"));
    void queryClient.prefetchQuery(catalogQuery("tv"));
  }, [homeFetching, queryClient]);
  return (
    <Chrome username={username} overlay scrolled={scrolled} contentFocus>
      <SharedHome
        layout={layout}
        nav={nav}
        focusMode="tv"
        appearance="web"
        onScrollOffset={(y) => setScrolled(y > 24)}
      />
    </Chrome>
  );
}
