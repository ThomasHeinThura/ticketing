import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@taskdesk/ui";
import { GitBranch } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getParentCandidate,
  setWorkItemParent,
} from "@/fetchers/work-item/set-work-item-parent";
import { useGetHierarchyChildren } from "@/hooks/queries/work-item/use-get-hierarchy-children";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { HttpError } from "@/lib/http-error";
import { WorkItemVersionConflictError } from "@/lib/work-item-errors";
import { isWorkItemHierarchyKey } from "@/lib/work-item-hierarchy-search";
import type { WorkItemDetailRow } from "@/types/work-item";
import { useWorkItemFeedback } from "./work-item-feedback";
import {
  currentWorkItemVersion,
  useRefreshWorkItem,
  workItemMutationScope,
  writeWorkItemResponse,
} from "./work-item-save";

export default function WorkItemParentControl({
  item,
  compact,
  onAccessLost,
}: {
  item: WorkItemDetailRow;
  compact: boolean;
  onAccessLost: () => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const { canUpdateTasks } = useWorkspacePermission(
    item.workspaceId,
    item.projectId,
  );
  const hierarchy = useGetHierarchyChildren(item.key);
  const first = hierarchy.isError ? undefined : hierarchy.data?.pages[0];
  const parent = first?.ancestors.at(-1);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const { reportConflict, clearConflict, announce } = useWorkItemFeedback();
  const refresh = useRefreshWorkItem(item);
  const key = draft.trim();
  const validKey = isWorkItemHierarchyKey(key) && key !== item.key;
  const candidate = useQuery({
    queryKey: [
      "work-items",
      "parent-candidate",
      item.workspaceId,
      item.projectId,
      key,
    ],
    queryFn: ({ signal }) => getParentCandidate(key, signal),
    enabled: open && canUpdateTasks() && validKey,
    retry: false,
  });
  const reachableCandidate = candidate.isError ? undefined : candidate.data;
  const eligible = reachableCandidate?.projectId === item.projectId;
  useEffect(() => {
    if (
      hierarchy.error instanceof HttpError &&
      [403, 404].includes(hierarchy.error.status)
    )
      onAccessLost();
  }, [hierarchy.error, onAccessLost]);
  const mutation = useMutation({
    scope: workItemMutationScope(item.key),
    mutationFn: (parentKey: string | null) =>
      setWorkItemParent({
        key: item.key,
        version: currentWorkItemVersion(client, item),
        parentKey,
      }),
    onSuccess: async (response) => {
      writeWorkItemResponse(client, item.key, response, {
        parentId: response.parentId,
      });
      clearConflict();
      announce(t("workItems:parent.saved"));
      setOpen(false);
      await Promise.all([
        refresh(),
        client.invalidateQueries({ queryKey: ["work-items", "hierarchy"] }),
      ]);
    },
    onError: (failure) => {
      if (failure instanceof WorkItemVersionConflictError) {
        reportConflict();
        setError(t("workItems:parent.conflict"));
        void refresh();
      } else if (failure instanceof HttpError && failure.status === 404) {
        // Either end may have disappeared; check the subject rather than hiding
        // a still-reachable item because the proposed parent was removed.
        setError(t("workItems:parent.unavailable"));
        void Promise.all([refresh(), hierarchy.refetch(), candidate.refetch()]);
      } else {
        setError(
          failure instanceof HttpError
            ? failure.message
            : t("workItems:parent.failed"),
        );
      }
    },
  });
  const trigger = (
    <Button
      variant="ghost"
      className={cn(
        "justify-start h-7 px-1.5 gap-1.5",
        !compact && "lg:w-full",
      )}
      disabled={!first || !canUpdateTasks() || mutation.isPending}
      aria-label={t("workItems:parent.label")}
    >
      <GitBranch className="size-4" />
      <span className="truncate">
        {!first
          ? t(
              hierarchy.isError
                ? "workItems:parent.unavailable"
                : "workItems:parent.loading",
            )
          : (parent?.key ?? t("workItems:parent.none"))}
      </span>
    </Button>
  );
  if (!canUpdateTasks()) return trigger;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (mutation.isPending) return;
        setOpen(next);
        if (next) {
          setDraft(parent?.key ?? "");
          setError("");
        }
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (validKey && eligible && !mutation.isPending)
              mutation.mutate(key);
          }}
        >
          <Input
            aria-label={t("workItems:parent.key")}
            placeholder={t("workItems:parent.key")}
            value={draft}
            maxLength={64}
            disabled={mutation.isPending}
            onChange={(event) => {
              setDraft(event.target.value);
              setError("");
            }}
          />
          {validKey && candidate.isFetching ? (
            <p role="status" className="text-xs text-muted-foreground">
              {t("workItems:parent.loading")}
            </p>
          ) : null}
          {validKey && eligible && reachableCandidate ? (
            <p className="text-sm text-foreground">
              {reachableCandidate.key} · {reachableCandidate.title}
            </p>
          ) : null}
          {draft &&
          (!validKey ||
            candidate.isError ||
            (reachableCandidate && !eligible)) ? (
            <p role="alert" className="text-xs text-muted-foreground">
              {t("workItems:parent.unavailable")}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-xs text-muted-foreground">
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            size="sm"
            disabled={
              !validKey ||
              !eligible ||
              candidate.isFetching ||
              mutation.isPending
            }
          >
            {t("workItems:parent.set")}
          </Button>
          {parent ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate(null)}
            >
              {t("workItems:parent.remove")}
            </Button>
          ) : null}
        </form>
      </PopoverContent>
    </Popover>
  );
}
