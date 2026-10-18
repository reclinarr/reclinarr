import { RequestsScreen as SharedRequests } from "@reclinarr/native-ui";
import { Chrome } from "../components/Chrome";
import { PageHeading } from "../components/PageHeading";
import { useScreenNav } from "../useScreenNav";

export function RequestsScreen({ username }: { username: string }) {
  const nav = useScreenNav();
  return (
    <Chrome username={username}>
      <SharedRequests nav={nav} header={<PageHeading title="Requests" />} focusMode="tv" />
    </Chrome>
  );
}
