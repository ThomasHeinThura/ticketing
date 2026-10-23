import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button } from "@taskdesk/ui";
import { Maximize2, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { TaskDetailsSheetFrame } from "@/components/task/task-details-sheet";
import loadWorkItemDetail from "@/components/work-item/load-work-item-detail";
import type { ActivityFilter } from "@/components/work-item/work-item-activity";
import WorkItemDetailLoading from "@/components/work-item/work-item-detail-loading";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useGetWorkItem from "@/hooks/queries/work-item/use-get-work-item";
import { HttpError } from "@/lib/http-error";
import { routes } from "@/lib/routes";
import WorkItemActions from "./work-item-actions";

const WorkItemDetail = lazy(loadWorkItemDetail);

/**
 * `docs/02-design/screen-inventory.md` "Work item — side pane" (`VW-4`, `?item={key}` on a
 * list, board, backlog, or saved view). Renders the work item's full detail view inside a
 * side pane without leaving the surrounding view.
 */
export default function WorkItemSidePane({
  itemKey,
  onClose,
}: {
  itemKey?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <TaskDetailsSheetFrame
      itemId={itemKey}
      onClose={onClose}
      ariaLabel={t("workItems:sidePane.ariaLabel", { key: itemKey ?? "" })}
    >
      {(visibleItemKey) => (
        <WorkItemSidePaneBody
          key={visibleItemKey}
          itemKey={visibleItemKey}
          onClose={onClose}
        />
      )}
    </TaskDetailsSheetFrame>
  );
}

function WorkItemSidePaneBody({
  itemKey,
  onClose,
}: {
  itemKey: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [activityFilter, setActivityFilter] =
    useState<ActivityFilter>("everything");
  const [accessLostKey, setAccessLostKey] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const onAccessLost = useCallback(() => {
    setAccessLostKey(itemKey);
    for (const scope of ["detail", "transitions", "activity", "hierarchy"]) {
      queryClient.removeQueries({ queryKey: ["work-items", scope, itemKey] });
    }
  }, [itemKey, queryClient]);

  useEffect(() => {
    setAccessLostKey((current) => (current === itemKey ? current : null));
  }, [itemKey]);

  const {
    data: cachedItem,
    isLoading,
    isError,
    error,
    refetch,
  } = useGetWorkItem({ key: itemKey });

  const isNotFound =
    accessLostKey === itemKey ||
    (error instanceof HttpError && error.status === 404);
  const item = isNotFound ? undefined : cachedItem;

  return (
    <div
      data-testid="work-item-side-pane"
      className="flex flex-1 min-h-0 flex-col overflow-hidden"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-border border-b bg-background px-4 py-2.5">
        <span className="font-medium text-muted-foreground text-sm">
          {itemKey}
        </span>
        <div className="flex items-center gap-1">
          {item ? (
            <WorkItemActions
              item={item}
              onAccessLost={onAccessLost}
              variant="delete"
            />
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="text-foreground"
            render={
              <Link
                to={routes.workItemDetail.path}
                params={{ key: itemKey }}
                aria-label={t("workItems:sidePane.openFullPage")}
              />
            }
          >
            <Maximize2 className="size-4" aria-hidden="true" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onClose}
            className="text-foreground"
            aria-label={t("workItems:sidePane.close", {
              defaultValue: "Close side pane",
            })}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Suspense fallback={<WorkItemDetailLoading />}>
          {item ? (
            <SidePaneDetailWithProject
              item={item}
              workItemKey={itemKey}
              activityFilter={activityFilter}
              onActivityFilterChange={setActivityFilter}
              isError={isError}
              onRetry={refetch}
              onAccessLost={onAccessLost}
            />
          ) : !isNotFound && !isError ? (
            <WorkItemDetailLoading />
          ) : (
            <WorkItemDetail
              variant="pane"
              item={undefined}
              workItemKey={itemKey}
              activityFilter={activityFilter}
              onActivityFilterChange={setActivityFilter}
              project={undefined}
              isLoading={isLoading}
              isNotFound={isNotFound}
              isError={isError && !isNotFound}
              onRetry={refetch}
              onAccessLost={onAccessLost}
            />
          )}
        </Suspense>
      </div>
    </div>
  );
}

function SidePaneDetailWithProject({
  item,
  workItemKey,
  activityFilter,
  onActivityFilterChange,
  isError,
  onRetry,
  onAccessLost,
}: {
  item: NonNullable<ReturnType<typeof useGetWorkItem>["data"]>;
  workItemKey: string;
  activityFilter: ActivityFilter;
  onActivityFilterChange: (filter: ActivityFilter) => void;
  isError: boolean;
  onRetry: () => void;
  onAccessLost: () => void;
}) {
  const { data: projects } = useGetProjects({ workspaceId: item.workspaceId });
  const project = projects?.find(
    (candidate) => candidate.id === item.projectId,
  );

  return (
    <WorkItemDetail
      variant="pane"
      item={item}
      workItemKey={workItemKey}
      activityFilter={activityFilter}
      onActivityFilterChange={onActivityFilterChange}
      project={project ? { name: project.name, slug: project.slug } : undefined}
      isLoading={false}
      isNotFound={false}
      isError={isError}
      onRetry={onRetry}
      onAccessLost={onAccessLost}
    />
  );
}
