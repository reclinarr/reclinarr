import { LiveScreen as SharedLive } from "@reclinarr/native-ui";
import { ScreenHeader } from "../components/ScreenHeader";
import { useScreenNav } from "../useScreenNav";

export function LiveScreen({ username }: { username: string }) {
  const nav = useScreenNav();
  return (
    <SharedLive nav={nav} header={<ScreenHeader username={username} title="Live TV" />} />
  );
}
