import { useState } from "react";
import { HomeScreen as SharedHome } from "@reclinarr/native-ui";
import { Chrome } from "../components/Chrome";
import { useTvLayout } from "../layout";
import { useScreenNav } from "../useScreenNav";

export function HomeScreen({ username }: { username: string }) {
  const layout = useTvLayout();
  const nav = useScreenNav();
  const [scrolled, setScrolled] = useState(false);
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
