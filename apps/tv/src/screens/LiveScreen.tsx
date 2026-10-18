import { LiveScreen as SharedLive } from "@reclinarr/native-ui";
import { Chrome } from "../components/Chrome";
import { PageHeading } from "../components/PageHeading";
import { useScreenNav } from "../useScreenNav";

export function LiveScreen({ username }: { username: string }) {
  const nav = useScreenNav();
  return (
    <Chrome username={username}>
      <SharedLive nav={nav} header={<PageHeading title="Live TV" />} focusMode="tv" />
    </Chrome>
  );
}
