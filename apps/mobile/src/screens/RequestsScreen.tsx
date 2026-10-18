import { RequestsScreen as SharedRequests } from "@reclinarr/native-ui";
import { ScreenHeader } from "../components/ScreenHeader";
import { useScreenNav } from "../useScreenNav";

export function RequestsScreen({ username }: { username: string }) {
  const nav = useScreenNav();
  return (
    <SharedRequests nav={nav} header={<ScreenHeader username={username} title="Requests" showBack />} />
  );
}
