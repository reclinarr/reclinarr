import { DownloadsScreen as SharedDownloads } from "@reclinarr/native-ui";
import { Chrome } from "../components/Chrome";
import { PageHeading } from "../components/PageHeading";
import { useScreenNav } from "../useScreenNav";

export function DownloadsScreen({ username }: { username: string }) {
  const nav = useScreenNav();
  return (
    <Chrome username={username}>
      <SharedDownloads nav={nav} header={<PageHeading title="Downloads" />} focusMode="tv" />
    </Chrome>
  );
}
