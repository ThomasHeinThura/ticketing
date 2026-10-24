import { useInfiniteQuery } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Skeleton,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import {
  type Automation,
  type AutomationRun,
  listAutomationRuns,
} from "@/fetchers/automation/automations";
import { formatDateTime } from "@/lib/format";

function stateVariant(
  run: Pick<AutomationRun, "state" | "matched">,
): "success" | "error" | "warning" | "secondary" | "info" {
  switch (run.state) {
    case "done":
      return run.matched === false ? "secondary" : "success";
    case "failed":
      return "error";
    case "abandoned":
      return "warning";
    case "pending":
    case "running":
      return "info";
    default:
      return "secondary";
  }
}

function RunRow({ run }: { run: AutomationRun }) {
  const { t } = useTranslation("automations");
  const actionResults = run.results.filter(
    (result) => typeof result.type === "string",
  );
  return (
    <li className="space-y-2 px-3 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant={stateVariant(run)}>
            {run.state === "done" && run.matched === false
              ? t("runs.notMatched")
              : t(`runs.states.${run.state}`, { defaultValue: run.state })}
          </Badge>
          {run.workItemKey ? (
            <span className="font-mono text-xs">{run.workItemKey}</span>
          ) : null}
          {run.depth > 0 ? (
            <Badge variant="outline">
              {t("runs.depth", { depth: run.depth })}
            </Badge>
          ) : null}
        </div>
        <span className="text-xs text-muted-foreground">
          {formatDateTime(run.triggeredAt)}
        </span>
      </div>
      {actionResults.length > 0 ? (
        <ul className="space-y-1">
          {actionResults.map((result) => (
            <li
              key={`${run.id}:${result.index}`}
              className="flex flex-wrap items-center gap-2 text-xs"
            >
              <Badge variant={result.ok ? "success" : "error"} size="sm">
                {result.ok ? t("runs.ok") : t("runs.failed")}
              </Badge>
              <span>
                {t(`actions.types.${result.type}`, {
                  defaultValue: result.type ?? "",
                })}
              </span>
              {result.error ? (
                <span className="font-mono text-muted-foreground">
                  {result.error}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {run.error && actionResults.length === 0 ? (
        <p className="font-mono text-xs text-muted-foreground">{run.error}</p>
      ) : null}
    </li>
  );
}

/** `AM-8`: run history per rule with per-action outcomes, retained 30 days. */
export function AutomationRunsDialog({
  rule,
  onClose,
}: {
  rule: Automation;
  onClose: () => void;
}) {
  const { t } = useTranslation("automations");
  const query = useInfiniteQuery({
    queryKey: ["automation-runs", rule.id],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listAutomationRuns(rule.id, { before: pageParam, limit: 25 }),
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextBefore ?? undefined) : undefined,
  });
  const rows = query.data?.pages.flatMap((page) => page.data) ?? [];
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-2xl"
        closeLabel={t("common:actions.close")}
      >
        <DialogHeader>
          <DialogTitle>{t("runs.title", { name: rule.name })}</DialogTitle>
          <DialogDescription>{t("runs.description")}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto px-6">
          {query.isLoading ? (
            <div role="status" aria-label={t("runs.loading")}>
              <Skeleton className="h-16 w-full" />
            </div>
          ) : query.isError ? (
            <Alert variant="error">
              <AlertTitle>{t("runs.loadFailed")}</AlertTitle>
              <AlertDescription>
                <Button className="w-fit" onClick={() => void query.refetch()}>
                  {t("list.retry")}
                </Button>
              </AlertDescription>
            </Alert>
          ) : rows.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t("runs.emptyTitle")}</EmptyTitle>
                <EmptyDescription>
                  {t("runs.emptyDescription")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <ul className="divide-y rounded-md border">
                {rows.map((run) => (
                  <RunRow key={run.id} run={run} />
                ))}
              </ul>
              {query.hasNextPage ? (
                <Button
                  variant="outline"
                  disabled={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {t("runs.loadMore")}
                </Button>
              ) : null}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common:actions.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
