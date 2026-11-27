import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Badge,
  Button,
  DelayedSuspense,
  useDelayedPending,
} from "@taskdesk/ui";
import { Maximize2, X } from "lucide-react";
import { lazy, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import loadWorkItemDetail from "@/components/work-item/load-work-item-detail";
import type { ActivityFilter } from "@/components/work-item/work-item-activity";
import WorkItemDetailLoading from "@/components/work-item/work-item-detail-loading";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useGetWorkItem from "@/hooks/queries/work-item/use-get-work-item";
import { HttpError } from "@/lib/http-error";
import { routes } from "@/lib/routes";
import type { WorkItemRow } from "@/types/work-item";
import WorkItemActions from "./work-item-actions";

const WorkItemDetail = lazy(loadWorkItemDetail);

/** Starts the detail view's code ahead of the first open (see `warmWorkItemSidePane`). */
export const warmWorkItemDetail = () => loadWorkItemDetail();

/**
 * What the list already shows for the row (title, status, assignee), so the pane's header is on
 * screen with the sheet's motion while the item loads. It is display only: never the detail
 * query's data, never written to the cache, and gone as soon as the item is refused or missing.
 */
function ListRowHeader({ row }: { row: WorkItemRow }) {
  const missing = row.unavailableFields;
  return (
    <div
      className="flex flex-col gap-2 px-4 pt-4"
      data-testid="work-item-side-pane-list-row"
    >
      {missing.includes("title") ? null : (
        <p className="font-semibold text-foreground text-lg leading-snug">
          {row.title}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-sm">
        {missing.includes("stateName") ? null : (
          <Badge variant="outline">{row.stateName}</Badge>
        )}
        {row.assigneeName && !missing.includes("assigneeName") ? (
          <span>{row.assigneeName}</span>
        ) : null}
      </div>
    </div>
  );
}

export default function WorkItemSidePaneBody({
  itemKey,
  onClose,
  listRow,
}: {
  itemKey: string;
  onClose: () => void;
  /** The list's row for this item, used for the header only while the item loads. */
  listRow?: WorkItemRow;
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
  const placeholderVisible = useDelayedPending(
    !item && !isNotFound && !isError,
  );
  const showListRow = listRow !== undefined && !item && !isNotFound && !isError;

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
        {showListRow ? <ListRowHeader row={listRow} /> : null}
        {!isNotFound && !isError && (!item || placeholderVisible) ? (
          <div
            className={showListRow ? "px-4 pt-3" : undefined}
            style={{ visibility: placeholderVisible ? "visible" : "hidden" }}
          >
            <WorkItemDetailLoading
              visible={placeholderVisible}
              withHeader={!showListRow}
            />
          </div>
        ) : (
          <DelayedSuspense
            immediate={isNotFound || isError}
            fallback={(visible) => <WorkItemDetailLoading visible={visible} />}
          >
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
          </DelayedSuspense>
        )}
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
  const { data: projects, isLoading: isProjectLoading } = useGetProjects({
    workspaceId: item.workspaceId,
  });
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
      project={
        project
          ? {
              name: project.name,
              slug: project.slug,
              organisationId: project.organisationId,
              archivedAt: project.archivedAt,
              deletedAt: project.deletedAt,
            }
          : undefined
      }
      isProjectLoading={isProjectLoading}
      isLoading={false}
      isNotFound={false}
      isError={isError}
      onRetry={onRetry}
      onAccessLost={onAccessLost}
    />
  );
}
