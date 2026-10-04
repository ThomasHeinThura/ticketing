import { Alert, AlertDescription } from "@taskdesk/ui";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import WorkItemListLoading from "@/components/work-item/work-item-list-loading";
import type { WorkItemsResult } from "@/fetchers/work-item/get-work-items";
import type { WorkItemRealtimeStatus } from "@/hooks/use-native-work-item-realtime";
import type { WorkItemSortDirection, WorkItemSortField } from "@/lib/routes";

const CreateWorkItemDialog = lazy(
  () => import("@/components/work-item/create-work-item-dialog"),
);
const WorkItemListRealtime = lazy(
  () => import("@/components/work-item/work-item-list-realtime"),
);
const WorkItemList = lazy(
  () => import("@/components/work-item/work-item-list"),
);

type WorkItemsPanelProps = {
  project: { id: string; name: string } | undefined;
  workspaceId: string | undefined;
  workItemsResult: WorkItemsResult | undefined;
  isLoading: boolean;
  isError: boolean;
  realtimeProjectId: string | undefined;
  realtimeStatus:
    | { projectId: string; status: WorkItemRealtimeStatus }
    | undefined;
  sort: WorkItemSortField;
  dir: WorkItemSortDirection;
  isCreateOpen: boolean;
  onCloseCreate: () => void;
  onSortChange: (sort: WorkItemSortField, dir: WorkItemSortDirection) => void;
  onRealtimeAvailabilityChange: (
    projectId: string,
    status: WorkItemRealtimeStatus,
  ) => void;
  onRetry: () => void;
  selectedKeys: string[];
  canBulkAssign: boolean;
  onSelectionChange: (key: string, checked: boolean) => void;
  onSelectAll: (checked: boolean) => void;
};

export default function WorkItemsPanel({
  project,
  workspaceId,
  workItemsResult,
  isLoading,
  isError,
  realtimeProjectId,
  realtimeStatus,
  sort,
  dir,
  isCreateOpen,
  onCloseCreate,
  onSortChange,
  onRealtimeAvailabilityChange,
  onRetry,
  selectedKeys,
  canBulkAssign,
  onSelectionChange,
  onSelectAll,
}: WorkItemsPanelProps) {
  const { t } = useTranslation();
  const workItems = workItemsResult?.items;

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
          isLoading={isLoading}
          isError={isError}
          sort={sort}
          dir={dir}
          onSortChange={onSortChange}
          onRetry={onRetry}
          selectedKeys={selectedKeys}
          canBulkAssign={canBulkAssign}
          onSelectionChange={onSelectionChange}
          onSelectAll={onSelectAll}
        />
      </Suspense>
      {project && !isLoading && realtimeProjectId === project.id ? (
        <Suspense fallback={null}>
          <WorkItemListRealtime
            key={project.id}
            projectId={project.id}
            onAvailabilityChange={onRealtimeAvailabilityChange}
          />
        </Suspense>
      ) : null}
      {project && isCreateOpen ? (
        <Suspense fallback={null}>
          <CreateWorkItemDialog
            open
            onClose={onCloseCreate}
            projectId={project.id}
            workspaceId={workspaceId}
          />
        </Suspense>
      ) : null}
    </>
  );
}
