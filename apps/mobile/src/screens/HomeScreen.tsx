import { HomeScreen as SharedHome } from "@reclinarr/native-ui";
import { ScreenHeader } from "../components/ScreenHeader";
import { useMobileLayout } from "../layout";
import { useScreenNav } from "../useScreenNav";

export function HomeScreen({ username }: { username: string }) {
  const layout = useMobileLayout();
  const nav = useScreenNav();
  return (
    <SharedHome
      layout={layout}
      nav={nav}
      header={<ScreenHeader username={username} />}
    />
  );
}
