import RealtimeUnavailableNotice from "@/components/common/realtime-unavailable-notice";
import { useNativeWorkItemRealtime } from "@/hooks/use-native-work-item-realtime";

export default function CanonicalProjectRealtime({
  projectId,
}: {
  projectId: string;
}) {
  const { status } = useNativeWorkItemRealtime(
    projectId ? [`project:${projectId}`] : [],
  );
  return (
    <RealtimeUnavailableNotice
      status={
        status === "available"
          ? "live"
          : status === "unavailable"
            ? "unavailable"
            : "connecting"
      }
    />
  );
}
