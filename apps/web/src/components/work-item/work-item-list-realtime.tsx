import { useEffect } from "react";
import type { WorkItemRealtimeStatus } from "@/hooks/use-native-work-item-realtime";
import { useNativeWorkItemRealtime } from "@/hooks/use-native-work-item-realtime";

export default function WorkItemListRealtime({
  projectId,
  onAvailabilityChange,
}: {
  projectId: string;
  onAvailabilityChange: (
    projectId: string,
    status: WorkItemRealtimeStatus,
  ) => void;
}) {
  const { status } = useNativeWorkItemRealtime([`project:${projectId}`]);

  useEffect(() => {
    onAvailabilityChange(projectId, status);
  }, [onAvailabilityChange, projectId, status]);

  return null;
}
