import { Alert, AlertDescription } from "@taskdesk/ui";
import { lazy, memo, Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import WorkItemListLoading from "@/components/work-item/work-item-list-loading";
import type { WorkItemsResult } from "@/fetchers/work-item/get-work-items";
import type { WorkItemRealtimeStatus } from "@/hooks/use-native-work-item-realtime";
import type { WorkItemSortDirection, WorkItemSortField } from "@/lib/routes";

const WorkItemListRealtime = lazy(
  () => import("@/components/work-item/work-item-list-realtime"),
);
const WorkItemList = lazy(
  () => import("@/components/work-item/work-item-list"),
);

type WorkItemsPanelProps = {
  project: { id: string; name: string } | undefined;
  workItemsResult: WorkItemsResult | undefined;
  isLoading: boolean;
  isError: boolean;
  realtimeProjectId: string | undefined;
  realtimeStatus:
    | { projectId: string; status: WorkItemRealtimeStatus }
    | undefined;
  sort: WorkItemSortField;
  dir: WorkItemSortDirection;
  onSortChange: (sort: WorkItemSortField, dir: WorkItemSortDirection) => void;
  onRealtimeAvailabilityChange: (
    projectId: string,
    status: WorkItemRealtimeStatus,
  ) => void;
  onRetry: () => void;
};

function WorkItemsPanel({
  project,
  workItemsResult,
  isLoading,
  isError,
  realtimeProjectId,
  realtimeStatus,
  sort,
  dir,
  onSortChange,
  onRealtimeAvailabilityChange,
  onRetry,
}: WorkItemsPanelProps) {
  const { t } = useTranslation();
  const workItems = workItemsResult?.items;
  const [realtimeReadyProjectId, setRealtimeReadyProjectId] =
    useState<string>();

  useEffect(() => {
    if (isLoading) {
      setRealtimeReadyProjectId(undefined);
      return;
    }

    // Keep the socket and its status updates out of the list's first content
    // paint. The page already renders the primary rows and reports transport
    // status when the connection starts on the next two frames.
    let firstFrame: number | undefined;
    let secondFrame: number | undefined;
    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() =>
        setRealtimeReadyProjectId(project?.id),
      );
    });

    return () => {
      if (firstFrame !== undefined) cancelAnimationFrame(firstFrame);
      if (secondFrame !== undefined) cancelAnimationFrame(secondFrame);
    };
  }, [isLoading, project?.id]);

  return (
    <>
      {project &&
      realtimeStatus?.projectId === project.id &&
      realtimeStatus?.status === "unavailable" ? (
        <Alert
          variant="warning"
          role="status"
          data-testid="realtime-unavailable"
        >
          <AlertDescription>
            {t("workItems:detail.realtimeUnavailable")}
          </AlertDescription>
        </Alert>
      ) : null}
      <Suspense fallback={<WorkItemListLoading />}>
        <WorkItemList
          workItems={workItems}
          hasPartialFailure={workItemsResult?.hasPartialFailure ?? false}
          isLoading={isLoading}
          isError={isError}
          sort={sort}
          dir={dir}
          onSortChange={onSortChange}
          onRetry={onRetry}
        />
      </Suspense>
      {project &&
      realtimeReadyProjectId === project.id &&
      realtimeProjectId === project.id ? (
        <Suspense fallback={null}>
          <WorkItemListRealtime
            key={project.id}
            projectId={project.id}
            onAvailabilityChange={onRealtimeAvailabilityChange}
          />
        </Suspense>
      ) : null}
    </>
  );
}

export default memo(WorkItemsPanel);
