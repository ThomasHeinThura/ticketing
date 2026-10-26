import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@taskdesk/ui";
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import WorkItemList from "@/components/work-item/work-item-list";
import { postWorkItemSearch } from "@/fetchers/work-item/search-work-items";
import useGetMyApprovals from "@/hooks/queries/approval/use-get-my-approvals";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { formatDateMedium } from "@/lib/format";
import type { AgentMyWorkLens } from "@/lib/routes";
import type {
  WorkItemSortDirection,
  WorkItemSortField,
} from "@/lib/work-item-list-search";

const WorkItemSidePane = lazy(
  () => import("@/components/work-item/work-item-side-pane"),
);

const LENS_FILTER = {
  assigned: { field: "assignee", op: "eq", value: "@me" },
  watching: { field: "watcher", op: "contains", value: "@me" },
} as const;

/**
 * `/agent/my-work`: the work items assigned to or watched by the viewer across every
 * project they can reach (`POST /api/work-items/search` with `@me`), shown in kaneo's work
 * list, plus the approvals addressed to them (`GET /api/me/approvals`).
 */
export default function MyWork({
  lens,
  item,
  onLensChange,
  onItemChange,
}: {
  lens: AgentMyWorkLens;
  item: string | undefined;
  onLensChange: (lens: AgentMyWorkLens) => void;
  onItemChange: (item: string | undefined) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="sr-only">{t("navigation:sidebar.myWork")}</h1>
      <Tabs
        value={lens}
        onValueChange={(value) => onLensChange(value as AgentMyWorkLens)}
      >
        <TabsList className="bg-sidebar gap-2">
          <TabsTrigger value="assigned">
            {t("navigation:myWork.assigned")}
          </TabsTrigger>
          <TabsTrigger value="watching">
            {t("navigation:myWork.watching")}
          </TabsTrigger>
          <TabsTrigger value="approvals">
            {t("navigation:myWork.approvals")}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {lens === "approvals" ? <MyApprovals /> : <MyWorkItems lens={lens} />}
      {item ? (
        <Suspense fallback={null}>
          <WorkItemSidePane
            itemKey={item}
            onClose={() => onItemChange(undefined)}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

function MyWorkItems({ lens }: { lens: "assigned" | "watching" }) {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const [sort, setSort] = useState<WorkItemSortField>("dueDate");
  const [dir, setDir] = useState<WorkItemSortDirection>("asc");
  const sortField = sort === "position" ? "key" : sort;
  const results = useInfiniteQuery({
    queryKey: ["my-work", workspace?.id, lens, sortField, dir],
    enabled: !!workspace?.id,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      postWorkItemSearch({
        workspaceId: workspace?.id as string,
        filter: LENS_FILTER[lens],
        sort: [{ field: sortField, order: dir }],
        cursor: pageParam,
      }),
    getNextPageParam: (last) =>
      last.hasMore ? (last.nextCursor ?? undefined) : undefined,
  });
  const items = results.data?.pages.flatMap((page) => page.items);
  return (
    <WorkItemList
      workItems={items}
      hasPartialFailure={
        results.data?.pages.some((page) => page.hasPartialFailure) ?? false
      }
      isLoading={results.isLoading || !workspace}
      isError={results.isError}
      isFiltered
      emptyTitle={t(`navigation:myWork.empty.${lens}Title`)}
      emptyDescription={t(`navigation:myWork.empty.${lens}Description`)}
      sort={sort}
      dir={dir}
      onSortChange={(nextSort, nextDir) => {
        setSort(nextSort);
        setDir(nextDir);
      }}
      onRetry={() => void results.refetch()}
      hasMore={results.hasNextPage}
      onLoadMore={() => void results.fetchNextPage()}
      isLoadingMore={results.isFetchingNextPage}
    />
  );
}

function MyApprovals() {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useGetMyApprovals();
  if (isLoading) {
    return (
      <p className="text-muted-foreground text-sm" role="status">
        {t("common:empty.loading")}
      </p>
    );
  }
  if (isError) {
    return (
      <div className="flex items-center gap-3 text-sm" role="alert">
        <span>{t("navigation:myWork.approvalsError")}</span>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          {t("common:actions.retry")}
        </Button>
      </div>
    );
  }
  const approvals = data?.approvals ?? [];
  if (approvals.length === 0) {
    return (
      <p className="rounded-lg border border-border py-12 text-center text-muted-foreground text-sm">
        {t("navigation:myWork.approvalsEmpty")}
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("navigation:myWork.columnItem")}</TableHead>
          <TableHead>{t("navigation:myWork.columnKind")}</TableHead>
          <TableHead>{t("navigation:myWork.columnRequestedBy")}</TableHead>
          <TableHead>{t("navigation:myWork.columnExpires")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {approvals.map((approval) => (
          <TableRow key={approval.id}>
            <TableCell>
              <Link
                to="/agent/work-items/$key"
                params={{ key: approval.workItemKey }}
                className="font-medium hover:underline"
              >
                {approval.workItemKey} · {approval.workItemTitle}
              </Link>
            </TableCell>
            <TableCell>
              <Badge variant="outline">
                {approval.kind === "cab"
                  ? t("navigation:myWork.kindCab")
                  : t("navigation:myWork.kindCustomer")}
              </Badge>
            </TableCell>
            <TableCell>{approval.requester.displayName ?? "—"}</TableCell>
            <TableCell>{formatDateMedium(approval.expiresAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
