import RealtimeUnavailableNotice from "@/components/common/realtime-unavailable-notice";
import { useProjectWebSocket } from "@/hooks/use-project-websocket";

export default function LegacyProjectRealtime({
  projectId,
}: {
  projectId: string;
}) {
  const { status } = useProjectWebSocket(projectId);
  return <RealtimeUnavailableNotice status={status} />;
}
