import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@taskdesk/ui";
import { Filter } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Layout from "@/components/common/layout";
import { IntakeQueuePanel } from "@/components/intake/queue-panel";
import { IntakeQueuePicker } from "@/components/intake/queue-picker";
import { SubmissionDetailSheet } from "@/components/intake/submission-detail-sheet";
import {
  type StaffSubmissionQueueRow,
  SubmissionQueueTable,
} from "@/components/intake/submission-queue-table";
import {
  TriageFilterChips,
  TriageFilterMenu,
} from "@/components/intake/triage-filter-menu";
import PageTitle from "@/components/page-title";
import { getRequestTypes, getSubmissions } from "@/fetchers/intake";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import {
  matchesIntakeFilters,
  serverClockNow,
  splitIntakeFilters,
} from "@/lib/intake-queue";
import {
  type IntakeQueueSearch,
  parseIntakeSearch,
  routes,
} from "@/lib/routes";
import { savedViewQueryDocument } from "@/lib/saved-view-query";

export const Route = createFileRoute("/_layout/_authenticated/agent/triage")({
  validateSearch: parseIntakeSearch,
  component: IntakeRoute,
});

function IntakeRoute() {
  const { t } = useTranslation("intake");
  const workspace = useActiveWorkspace();
  const permissions = useWorkspacePermission(workspace.data?.id);
  const {
    state,
    ref,
    cursor,
    requestType,
    assignee,
    age,
    queue: queuePair,
    workItemFilter,
    workItemSorts,
    workItemColumns,
    workItemFilterMode,
  } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const filters = { requestType, assignee, age };
  // Filters and the selected submission live in the URL; a change keeps the rest.
  const searchWith = (patch: Partial<IntakeQueueSearch>) => ({
    state,
    queue: queuePair,
    workItemFilter,
    workItemSorts,
    workItemColumns,
    workItemFilterMode,
    ref,
    cursor,
    ...filters,
    ...patch,
  });
  const workItemDefinition = useMemo(() => {
    if (
      workItemFilter === undefined &&
      workItemSorts === undefined &&
      workItemColumns === undefined
    )
      return { query: undefined, invalid: false };
    try {
      return {
        query: savedViewQueryDocument({
          filter: workItemFilter,
          sorts: workItemSorts,
          columns: workItemColumns,
        }),
        invalid: false,
      };
    } catch {
      return { query: undefined, invalid: true };
    }
  }, [workItemFilter, workItemSorts, workItemColumns]);
  // The filter's request type options: every published type, not only those on this page.
  const requestTypeList = useQuery({
    queryKey: ["request-types", workspace.data?.id],
    queryFn: () => getRequestTypes(workspace.data?.id ?? ""),
    enabled: Boolean(workspace.data?.id),
  });
  const requestTypeRefs = (
    requestTypeList.data as unknown as
      | { requestTypes?: Array<{ id: string; key?: string; name: string }> }
      | undefined
  )?.requestTypes;
  // `IQ-21`: the server filters by request type key, assignee and age, so a shared URL shows
  // the same queue on any page. Only a filter with no server parameter narrows client-side.
  const { server, residual, pending } = splitIntakeFilters(
    filters,
    requestTypeList.isLoading ? undefined : (requestTypeRefs ?? []),
  );
  // Ages advance between refetches on the server's clock (see `serverClockNow`).
  const [browserTick, setBrowserTick] = useState(() => Date.now());
  useEffect(() => {
    const handle = window.setInterval(() => setBrowserTick(Date.now()), 60_000);
    return () => window.clearInterval(handle);
  }, []);
  const queue = useQuery({
    queryKey: ["intake", workspace.data?.id, state, cursor, server],
    queryFn: () =>
      getSubmissions(workspace.data?.id ?? "", state, cursor, server),
    enabled: Boolean(workspace.data?.id) && !pending && !queuePair,
  });
  const rows = (queue.data?.submissions ?? []) as StaffSubmissionQueueRow[];
  const requestTypeOptions = (
    requestTypeRefs ??
    Array.from(
      new Map(
        rows.map((row) => [row.requestType.id, row.requestType]),
      ).values(),
    )
  ).map((type) => ({ id: type.id, name: type.name }));
  const queueNow = serverClockNow(
    queue.data?.serverNow,
    queue.dataUpdatedAt,
    browserTick,
  );
  const visibleRows = rows.filter((row) =>
    matchesIntakeFilters(row, residual, queueNow),
  );
  const hasFilters = Boolean(requestType || assignee || age);
  const changeFilters = (patch: Record<string, string | undefined>) =>
    void navigate({ search: searchWith({ ...patch, cursor: undefined }) });
  return (
    <div className="flex h-full w-full min-w-0 flex-col">
      <PageTitle title={t("title")} />
      <Layout.Header className="items-center justify-between">
        <h1 className="px-2 font-medium text-sm">{t("title")}</h1>
        <div className="flex items-center gap-1">
          <TriageFilterMenu
            filters={filters}
            requestTypes={requestTypeOptions}
            onChange={changeFilters}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="xs" aria-label={t("statusFilter")}>
                <Filter className="size-3" />
                {t("status", { defaultValue: "Status" })}
                {state
                  ? `: ${t(`states.${state}`, { defaultValue: state })}`
                  : ""}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {[
                "new",
                "clarifying",
                "accepted",
                "declined",
                "duplicate",
                "withdrawn",
              ].map((value) => (
                <DropdownMenuCheckboxItem
                  key={value}
                  checked={state === value}
                  onCheckedChange={() =>
                    void navigate({
                      search: searchWith({
                        state: value as typeof state,
                        cursor: undefined,
                      }),
                    })
                  }
                >
                  {t(`states.${value}`, { defaultValue: value })}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Layout.Header>
      <Layout.Content className="overflow-y-auto">
        <p className="sr-only">{t("description")}</p>
        <TriageFilterChips
          filters={filters}
          requestTypes={requestTypeOptions}
          onChange={changeFilters}
        />
        {workspace.data?.id && (
          <IntakeQueuePicker
            workspaceId={workspace.data.id}
            queueId={queuePair}
            canCreate={
              permissions.canTriageIntake() &&
              !workItemDefinition.invalid &&
              !pending &&
              !residual.requestType
            }
            canShare={permissions.canShareSavedViews()}
            currentSubmissionQuery={
              state || requestType || assignee || age
                ? {
                    entity: "submission",
                    filter: { ...(state ? { state } : {}), ...server },
                  }
                : undefined
            }
            currentWorkItemQuery={workItemDefinition.query}
            onSelect={(id) =>
              void navigate({
                search: { queue: id, ...(id ? {} : { state: "new" as const }) },
              })
            }
          />
        )}
        {!workspace.data?.id && <p role="status">{t("selectWorkspace")}</p>}
        {queuePair && pending ? (
          <p role="status">{t("loading")}</p>
        ) : queuePair && residual.requestType ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t("filters.noMatch")}</EmptyTitle>
              <EmptyDescription>{t("filters.noMatchHint")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : queuePair && workspace.data?.id ? (
          <IntakeQueuePanel
            workspaceId={workspace.data.id}
            queueId={queuePair}
            state={state}
            requestTypeKey={server.requestTypeKey}
            assignee={assignee}
            olderThanDays={server.olderThanDays}
            workItemQuery={{
              filter: workItemFilter,
              sorts: workItemSorts,
              columns: workItemColumns,
              filterMode: workItemFilterMode,
            }}
            onWorkItemQueryChange={(change) =>
              void navigate({
                search: searchWith({
                  ...("filter" in change
                    ? { workItemFilter: change.filter }
                    : {}),
                  ...("sorts" in change ? { workItemSorts: change.sorts } : {}),
                  ...("columns" in change
                    ? { workItemColumns: change.columns }
                    : {}),
                  ...("filterMode" in change
                    ? { workItemFilterMode: change.filterMode }
                    : {}),
                }),
              })
            }
            selectedRef={ref}
            onOpenSubmission={(nextRef) =>
              void navigate({ search: searchWith({ ref: nextRef }) })
            }
            onOpenWorkItem={(key) =>
              void navigate({ to: routes.workItemDetail.path, params: { key } })
            }
          />
        ) : queue.isError ? (
          <Alert variant="error" role="alert">
            <AlertDescription>{t("actionError")}</AlertDescription>
            <Button variant="outline" onClick={() => void queue.refetch()}>
              {t("retry", { defaultValue: "Retry" })}
            </Button>
          </Alert>
        ) : queue.isLoading || pending ? (
          <p role="status">{t("loading")}</p>
        ) : visibleRows.length === 0 && hasFilters ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>
                {t("filters.noMatch", {
                  defaultValue: "No submissions match the filters",
                })}
              </EmptyTitle>
              <EmptyDescription>
                {t("filters.noMatchHint", {
                  defaultValue:
                    "No submission in this state matches every filter. Remove one to see more.",
                })}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : rows.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t("noState", { state })}</EmptyTitle>
              <EmptyDescription>{t("newRequests")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <SubmissionQueueTable
            rows={visibleRows}
            now={queueNow}
            selectedRef={ref}
            onOpenSubmission={(nextRef) =>
              void navigate({ search: searchWith({ ref: nextRef }) })
            }
          />
        )}
        {!queuePair && queue.data?.page?.hasMore && (
          <Button
            variant="outline"
            onClick={() =>
              void navigate({
                search: searchWith({
                  cursor: queue.data?.page.nextCursor ?? undefined,
                }),
              })
            }
          >
            {t("nextPage", { defaultValue: "Next page" })}
          </Button>
        )}
      </Layout.Content>
      {/* One sheet for the plain queue and saved queues: both select through `?ref=`. */}
      <SubmissionDetailSheet
        submissionRef={ref}
        workspaceId={workspace.data?.id}
        rowSummary={(nextRef) =>
          rows.find((row) => row.ref === nextRef)?.summary
        }
        onClose={() =>
          void navigate({ search: searchWith({ ref: undefined }) })
        }
        onOpenWorkItem={(key) =>
          void navigate({ to: routes.workItemDetail.path, params: { key } })
        }
      />
    </div>
  );
}
