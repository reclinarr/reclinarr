import { DownloadsScreen as SharedDownloads } from "@reclinarr/native-ui";
import { ScreenHeader } from "../components/ScreenHeader";
import { useScreenNav } from "../useScreenNav";

export function DownloadsScreen({ username }: { username: string }) {
  const nav = useScreenNav();
  return (
    <SharedDownloads nav={nav} header={<ScreenHeader username={username} title="Downloads" showBack />} />
  );
}
