import { useInfiniteQuery } from "@tanstack/react-query";
import { DropdownMenuItem } from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  TaskCrumbOptionsPresentation,
  TaskCrumbPresentation,
} from "@/components/common/header/task-crumb-presentation";
import getWorkItems from "@/fetchers/work-item/get-work-items";
import { HttpError } from "@/lib/http-error";
import { isValidWorkItemKeyParam } from "@/lib/work-item-list-search";

type Props = {
  itemKey: string;
  workspaceId: string;
  projectId: string;
  onSelect: (key: string) => void;
};

/** Current project's reachable canonical items; no legacy task identities or shadow copies. */
export default function WorkItemCrumbSelect(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <TaskCrumbPresentation
      label={props.itemKey}
      open={open}
      onOpenChange={setOpen}
    >
      <WorkItemCrumbOptions
        key={`${props.workspaceId}:${props.projectId}:${props.itemKey}`}
        {...props}
        onSelect={(key) => {
          props.onSelect(key);
          setOpen(false);
        }}
      />
    </TaskCrumbPresentation>
  );
}

function WorkItemCrumbOptions({
  itemKey,
  workspaceId,
  projectId,
  onSelect,
}: Props) {
  const { t } = useTranslation();
  const query = useInfiniteQuery({
    queryKey: ["work-items", "crumb", workspaceId, projectId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      getWorkItems(projectId, "key", "asc", { cursor: pageParam }),
    getNextPageParam: (last, _pages, _param, params) =>
      last.hasMore && last.nextCursor && !params.includes(last.nextCursor)
        ? last.nextCursor
        : undefined,
    refetchOnMount: "always",
    staleTime: 0,
    retry: false,
  });
  const accessLost =
    query.error instanceof HttpError && [403, 404].includes(query.error.status);
  const ready =
    query.isFetchedAfterMount &&
    (!query.isError || query.isFetchNextPageError) &&
    !accessLost;
  const rows = ready
    ? (query.data?.pages.flatMap((page) => page.items) ?? [])
    : [];
  const valid = rows.filter(
    (row) =>
      row.projectId === projectId &&
      row.workspaceId === workspaceId &&
      isValidWorkItemKeyParam(row.key) &&
      !row.unavailableFields.includes("key") &&
      !row.unavailableFields.includes("title"),
  );
  const unique = [...new Map(valid.map((row) => [row.key, row])).values()];
  const partial =
    ready &&
    (valid.length !== rows.length ||
      query.data?.pages.some((page) => page.hasPartialFailure));
  const last = query.data?.pages.at(-1);
  const brokenCursor =
    ready &&
    last?.hasMore &&
    (!last.nextCursor || query.data?.pageParams.includes(last.nextCursor));
  return (
    <TaskCrumbOptionsPresentation
      options={unique.map((row) => ({
        value: row.key,
        label: `${row.key} ${row.title}`,
        disabled: row.key === itemKey,
      }))}
      onSelect={(key) => {
        if (unique.some((row) => row.key === key && key !== itemKey))
          onSelect(key);
      }}
      empty={ready && !query.isError && !partial}
    >
      {!query.isFetchedAfterMount ? (
        <DropdownMenuItem disabled>
          {t("workItems:list.loading")}
        </DropdownMenuItem>
      ) : null}
      {partial ? (
        <DropdownMenuItem disabled>
          {t("workItems:list.partialNoticeTitle")}
        </DropdownMenuItem>
      ) : null}
      {query.isError || brokenCursor ? (
        <DropdownMenuItem disabled>
          {t("workItems:list.errorTitle")}
        </DropdownMenuItem>
      ) : null}
      {query.isError && !accessLost ? (
        <DropdownMenuItem
          closeOnClick={false}
          onClick={(event) => {
            event.preventDefault();
            if (query.isFetchNextPageError) void query.fetchNextPage();
            else void query.refetch();
          }}
        >
          {t("common:actions.retry")}
        </DropdownMenuItem>
      ) : null}
      {query.hasNextPage && !query.isError ? (
        <DropdownMenuItem
          closeOnClick={false}
          disabled={query.isFetchingNextPage}
          onClick={(event) => {
            event.preventDefault();
            void query.fetchNextPage();
          }}
        >
          {t(
            query.isFetchingNextPage
              ? "workItems:list.loadingMore"
              : "workItems:list.loadMore",
          )}
        </DropdownMenuItem>
      ) : null}
    </TaskCrumbOptionsPresentation>
  );
}
