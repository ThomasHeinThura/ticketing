import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@taskdesk/ui";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SubmissionQueueTable } from "@/components/intake/submission-queue-table";
import WorkItemList from "@/components/work-item/work-item-list";
import {
  getIntakeQueue,
  type IntakeQueue,
  runIntakeQueue,
} from "@/fetchers/intake-queues";
import { getDefaultAgentTerm } from "@/lib/i18n/agent-translation";
import {
  isWorkItemSearchColumn,
  isWorkItemSearchSortField,
  type WorkItemFilterMode,
  type WorkItemSearchColumn,
  type WorkItemSort,
  type WorkItemSortDirection,
  type WorkItemSortField,
} from "@/lib/routes";
import {
  printWorkItemFilterText,
  type WorkItemFilter,
} from "@/lib/work-item-filter";
import { parseWorkItemRow, type WorkItemRow } from "@/types/work-item";

const WorkItemListControls = lazy(
  () => import("@/components/work-item/work-item-list-controls"),
);

export type IntakeQueueWorkItemQuery = {
  sorts?: WorkItemSort[];
  columns?: WorkItemSearchColumn[];
  filter?: string;
  filterMode?: WorkItemFilterMode;
};

type QueueWorkItemQuery = {
  entity?: unknown;
  filter?: unknown;
  sort?: unknown;
  columns?: unknown;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function queueWorkItemQuery(
  queue: IntakeQueue | undefined,
): QueueWorkItemQuery {
  return record(queue?.workItemView.query) as QueueWorkItemQuery;
}

function currentSort(
  queue: IntakeQueue | undefined,
  override?: WorkItemSort[],
): WorkItemSort[] {
  if (override?.length) return override;
  const raw = queueWorkItemQuery(queue).sort;
  if (!Array.isArray(raw)) return [{ field: "key", order: "asc" }];
  const sorts: WorkItemSort[] = [];
  for (const value of raw) {
    const item = record(value);
    if (!isWorkItemSearchSortField(item.field)) continue;
    if (item.direction === "asc")
      sorts.push({ field: item.field, order: "asc" });
    else if (item.direction === "desc")
      sorts.push({ field: item.field, order: "desc" });
  }
  return sorts.length ? sorts : [{ field: "key", order: "asc" }];
}

function currentColumns(
  queue: IntakeQueue | undefined,
  override?: WorkItemSearchColumn[],
): WorkItemSearchColumn[] | undefined {
  if (override?.length) return override;
  const columns = queueWorkItemQuery(queue).columns;
  if (!Array.isArray(columns)) return undefined;
  const valid = columns.filter(isWorkItemSearchColumn);
  return valid.length === columns.length ? valid : undefined;
}

function parseRows(rows: readonly unknown[] | undefined): WorkItemRow[] {
  if (!rows) return [];
  return rows.map((row) =>
    parseWorkItemRow(row as Parameters<typeof parseWorkItemRow>[0]),
  );
}

/**
 * Runs both persisted entities under the caller's current permissions. The submission table
 * is the same Kaneo staff table used by the ordinary triage queue; work items use the existing
 * Kaneo list component. Each side owns its cursor and empty/error state.
 */
export function IntakeQueuePanel({
  workspaceId,
  queueId,
  state,
  requestTypeKey,
  assignee,
  olderThanDays,
  workItemFilter,
  workItemQuery,
  onWorkItemQueryChange,
  selectedRef,
  onOpenSubmission,
  onOpenWorkItem,
}: {
  workspaceId: string;
  queueId: string;
  state?: string;
  requestTypeKey?: string;
  assignee?: "claimed" | "unclaimed";
  olderThanDays?: number;
  workItemFilter?: string;
  workItemQuery?: IntakeQueueWorkItemQuery;
  onWorkItemQueryChange: (change: Partial<IntakeQueueWorkItemQuery>) => void;
  selectedRef?: string;
  onOpenSubmission: (ref: string) => void;
  onOpenWorkItem: (key: string) => void;
}) {
  const { t, i18n } = useTranslation("intake");
  const submissionContext = JSON.stringify([
    workspaceId,
    queueId,
    state,
    requestTypeKey,
    assignee,
    olderThanDays,
  ]);
  const workItemContext = JSON.stringify([
    workspaceId,
    queueId,
    workItemFilter,
    workItemQuery?.filter,
    workItemQuery?.sorts,
    workItemQuery?.columns,
  ]);
  const [submissionPage, setSubmissionPage] = useState<{
    context: string;
    cursor?: string;
  }>({ context: submissionContext });
  const [workItemPage, setWorkItemPage] = useState<{
    context: string;
    cursor?: string;
  }>({ context: workItemContext });
  const submissionCursor =
    submissionPage.context === submissionContext
      ? submissionPage.cursor
      : undefined;
  const workItemCursor =
    workItemPage.context === workItemContext ? workItemPage.cursor : undefined;
  const setSubmissionCursor = (cursor: string | undefined) =>
    setSubmissionPage({ context: submissionContext, cursor });
  const setWorkItemCursor = (cursor: string | undefined) =>
    setWorkItemPage({ context: workItemContext, cursor });
  const [filterControlsOpen, setFilterControlsOpen] = useState(false);
  useEffect(() => {
    setSubmissionPage({ context: submissionContext });
  }, [submissionContext]);
  useEffect(() => {
    setWorkItemPage({ context: workItemContext });
  }, [workItemContext]);

  const queue = useQuery({
    queryKey: ["intake", "queue", workspaceId, queueId],
    queryFn: () => getIntakeQueue({ workspaceId, id: queueId }),
    enabled: Boolean(workspaceId && queueId),
  });
  const results = useQuery({
    queryKey: [
      "intake",
      "queue-run",
      workspaceId,
      queueId,
      state,
      requestTypeKey,
      assignee,
      olderThanDays,
      workItemFilter,
      workItemQuery?.filter,
      workItemQuery?.sorts,
      workItemQuery?.columns,
      submissionCursor,
      workItemCursor,
    ],
    queryFn: () =>
      runIntakeQueue({
        workspaceId,
        id: queueId,
        limit: 50,
        submissionCursor,
        workItemCursor,
        state,
        requestTypeKey,
        assignee,
        olderThanDays,
        workItemFilter: workItemQuery?.filter ?? workItemFilter,
        workItemSorts: workItemQuery?.sorts,
        workItemColumns: workItemQuery?.columns,
      }),
    enabled: Boolean(workspaceId && queueId && queue.isSuccess),
  });
  const workItemRows = useMemo(
    () => parseRows(results.data?.workItems.data),
    [results.data?.workItems.data],
  );
  const sorts = currentSort(queue.data, workItemQuery?.sorts);
  const columns = currentColumns(queue.data, workItemQuery?.columns);
  const storedFilter = record(queueWorkItemQuery(queue.data).filter);
  let storedFilterText = "";
  if (Object.keys(storedFilter).length) {
    try {
      storedFilterText = printWorkItemFilterText(
        storedFilter as WorkItemFilter,
      );
    } catch {
      storedFilterText = "";
    }
  }
  const filter = workItemQuery?.filter ?? workItemFilter ?? storedFilterText;
  const filterMode = workItemQuery?.filterMode ?? "visual";
  const changeSorts = (next: WorkItemSort[]) =>
    onWorkItemQueryChange({ sorts: next });
  const changeColumns = (next: WorkItemSearchColumn[] | undefined) =>
    onWorkItemQueryChange({ columns: next });

  if (queue.isError || results.isError) {
    return (
      <Alert variant="error" role="alert">
        <AlertDescription>{t("queue.loadFailed")}</AlertDescription>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (queue.isError) void queue.refetch();
            if (results.isError) void results.refetch();
          }}
        >
          {t("queue.retry")}
        </Button>
      </Alert>
    );
  }

  if (queue.isLoading || results.isLoading || !queue.data || !results.data) {
    return <p role="status">{t("queue.loading")}</p>;
  }

  const submissions = results.data.submissions;
  const workItems = results.data.workItems;
  const storedSubmissionFilter = record(
    record(queue.data.submissionView.query).filter,
  );
  const hasSubmissionFilter = Boolean(
    state ||
      requestTypeKey ||
      assignee ||
      olderThanDays !== undefined ||
      Object.keys(storedSubmissionFilter).length,
  );
  const inheritedState =
    typeof storedSubmissionFilter.state === "string"
      ? storedSubmissionFilter.state
      : undefined;
  const hasWorkItemFilter = Boolean(
    workItemFilter || queueWorkItemQuery(queue.data).filter,
  );

  return (
    <div
      className="flex min-w-0 flex-col gap-6"
      data-testid="intake-queue-panel"
    >
      <section
        className="flex min-w-0 flex-col gap-3"
        aria-labelledby="intake-queue-submissions-heading"
      >
        <h2
          id="intake-queue-submissions-heading"
          className="text-base font-semibold"
          title={getDefaultAgentTerm(i18n, "submission", 2)}
        >
          {t("queue.submissions")}
        </h2>
        {state === undefined && inheritedState && (
          <p
            className="text-sm text-muted-foreground"
            data-testid="intake-queue-saved-state"
          >
            {t("queue.savedState", { state: inheritedState })}
          </p>
        )}
        {submissions.submissions.length ? (
          <SubmissionQueueTable
            rows={submissions.submissions}
            selectedRef={selectedRef}
            onOpenSubmission={onOpenSubmission}
          />
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t("queue.noSubmissions")}</EmptyTitle>
              <EmptyDescription>
                {hasSubmissionFilter
                  ? t("queue.noSubmissionsFiltered")
                  : t("queue.noSubmissionsHint")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {submissions.page.hasMore && submissions.page.nextCursor && (
          <Button
            variant="outline"
            className="self-start"
            onClick={() =>
              setSubmissionCursor(submissions.page.nextCursor ?? undefined)
            }
          >
            {t("queue.moreSubmissions")}
          </Button>
        )}
      </section>

      <section
        className="flex min-w-0 flex-col gap-3 border-t pt-4"
        aria-labelledby="intake-queue-work-items-heading"
      >
        <h2
          id="intake-queue-work-items-heading"
          className="text-base font-semibold"
        >
          {t("queue.workItems")}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-expanded={filterControlsOpen}
            aria-controls="intake-queue-work-item-controls"
            onClick={() => setFilterControlsOpen((open) => !open)}
          >
            {t("common:actions.filter")}
          </Button>
        </div>
        {filterControlsOpen && (
          <div id="intake-queue-work-item-controls">
            <Suspense fallback={<p role="status">{t("queue.loading")}</p>}>
              <WorkItemListControls
                filter={filter}
                mode={filterMode}
                onModeChange={(mode) =>
                  onWorkItemQueryChange({ filterMode: mode })
                }
                onApply={(nextFilter) =>
                  onWorkItemQueryChange({ filter: nextFilter })
                }
                columns={columns}
                onColumnsChange={changeColumns}
                workspaceId={workspaceId}
                sort={sorts[0]?.field}
                dir={sorts[0]?.order}
              />
            </Suspense>
          </div>
        )}
        <WorkItemList
          workItems={workItemRows}
          hasPartialFailure={workItemRows.some(
            (item) => item.unavailableFields.length > 0,
          )}
          isLoading={false}
          isError={false}
          sort={sorts[0]?.field ?? "key"}
          dir={sorts[0]?.order ?? "asc"}
          sorts={sorts}
          onSortChange={(sort: WorkItemSortField, dir: WorkItemSortDirection) =>
            changeSorts([{ field: sort, order: dir }])
          }
          onSortsChange={(next) => {
            if (next.length) changeSorts(next);
          }}
          onRetry={() => void results.refetch()}
          columns={columns}
          customFieldColumns={workItems.customFieldColumns}
          customFieldPeople={workItems.customFieldPeople}
          isFiltered={Boolean(filter || hasWorkItemFilter)}
          hasMore={workItems.page.hasMore}
          onLoadMore={() =>
            setWorkItemCursor(workItems.page.nextCursor ?? undefined)
          }
          onOpenItem={onOpenWorkItem}
        />
      </section>
    </div>
  );
}
