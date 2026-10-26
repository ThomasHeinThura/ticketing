import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Frame,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type ImportRun,
  type ImportRunState,
  listImportRuns,
} from "@/fetchers/god-mode/imports";
import getWorkspaces from "@/fetchers/workspace/get-workspaces";
import { formatDateTime } from "@/lib/format";
import { HttpError } from "@/lib/http-error";
import { ImportRunCreateDialog } from "./import-run-create-dialog";

function stateVariant(state: ImportRunState) {
  if (state === "completed") return "success" as const;
  if (state === "failed") return "error" as const;
  if (state === "running" || state === "queued") return "warning" as const;
  return "outline" as const;
}

export function ImportRunsPanel({
  workspaceId,
  onWorkspaceChange,
  onOpenRun,
}: {
  workspaceId?: string;
  onWorkspaceChange: (workspaceId: string) => void;
  onOpenRun: (runId: string, workspaceId: string) => void;
}) {
  const { t } = useTranslation("godModeImports");
  const [createOpen, setCreateOpen] = useState(false);
  const workspaces = useQuery({
    queryKey: ["god-mode", "imports", "workspaces"],
    queryFn: getWorkspaces,
    retry: false,
  });
  const availableWorkspaces = workspaces.data ?? [];
  const selectedWorkspaceId =
    (availableWorkspaces.some((workspace) => workspace.id === workspaceId)
      ? workspaceId
      : availableWorkspaces[0]?.id) ?? "";
  useEffect(() => {
    if (selectedWorkspaceId && selectedWorkspaceId !== workspaceId) {
      onWorkspaceChange(selectedWorkspaceId);
    }
  }, [onWorkspaceChange, selectedWorkspaceId, workspaceId]);

  const runs = useInfiniteQuery({
    queryKey: ["god-mode", "imports", selectedWorkspaceId],
    queryFn: ({ pageParam }) =>
      listImportRuns({
        workspaceId: selectedWorkspaceId,
        cursor: pageParam,
        limit: 50,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: Boolean(selectedWorkspaceId),
    retry: false,
  });

  if (workspaces.isPending) return <Skeleton className="h-72 w-full" />;
  if (workspaces.error instanceof HttpError && workspaces.error.status === 403)
    return (
      <Alert variant="info">
        <AlertTitle>{t("forbiddenTitle")}</AlertTitle>
        <AlertDescription>{t("forbiddenDescription")}</AlertDescription>
      </Alert>
    );
  if (workspaces.isError)
    return (
      <Alert variant="error">
        <AlertTitle>{t("loadErrorTitle")}</AlertTitle>
        <AlertDescription>{t("loadErrorDescription")}</AlertDescription>
      </Alert>
    );

  const entries = runs.data?.pages.flatMap((page) => page.runs) ?? [];
  return (
    <div className="min-w-0 space-y-4">
      <h2 className="text-lg font-semibold">{t("historyTitle")}</h2>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-56 space-y-2">
          <Label htmlFor="imports-workspace">{t("workspace")}</Label>
          <Select
            value={selectedWorkspaceId}
            onValueChange={(value) => {
              if (value && availableWorkspaces.some(({ id }) => id === value))
                onWorkspaceChange(value);
            }}
          >
            <SelectTrigger id="imports-workspace">
              <SelectValue placeholder={t("selectWorkspace")} />
            </SelectTrigger>
            <SelectContent>
              {availableWorkspaces.map((workspace) => (
                <SelectItem key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!selectedWorkspaceId || runs.isFetching}
            onClick={() => void runs.refetch()}
          >
            {t("refresh")}
          </Button>
          <Button
            size="sm"
            disabled={availableWorkspaces.length === 0}
            onClick={() => setCreateOpen(true)}
          >
            {t("createAction")}
          </Button>
        </div>
      </div>

      {availableWorkspaces.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("noWorkspaces")}</EmptyTitle>
            <EmptyDescription>{t("noWorkspacesDescription")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : runs.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : runs.isError ? (
        <Alert variant="error">
          <AlertTitle>{t("loadErrorTitle")}</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{t("loadErrorDescription")}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void runs.refetch()}
            >
              {t("retry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : entries.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("empty")}</EmptyTitle>
            <EmptyDescription>{t("emptyDescription")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Frame className="min-w-0 overflow-x-auto">
          <Table className="min-w-[780px]">
            <TableHeader>
              <TableRow>
                <TableHead>{t("sourceRef")}</TableHead>
                <TableHead>{t("state")}</TableHead>
                <TableHead>{t("stats")}</TableHead>
                <TableHead>{t("lastCommittedChunk")}</TableHead>
                <TableHead>{t("updatedAt")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((run) => (
                <RunRow
                  key={run.id}
                  run={run}
                  onOpen={() => onOpenRun(run.id, selectedWorkspaceId)}
                />
              ))}
            </TableBody>
          </Table>
        </Frame>
      )}

      {runs.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            disabled={runs.isFetchingNextPage}
            onClick={() => void runs.fetchNextPage()}
          >
            {t("nextPage")}
          </Button>
        </div>
      ) : null}
      {createOpen ? (
        <ImportRunCreateDialog
          workspaces={availableWorkspaces.map(({ id, name }) => ({ id, name }))}
          onClose={() => setCreateOpen(false)}
          onCreated={(run) => {
            setCreateOpen(false);
            onOpenRun(run.id, run.workspaceId);
          }}
        />
      ) : null}
    </div>
  );
}

function RunRow({ run, onOpen }: { run: ImportRun; onOpen: () => void }) {
  const { t } = useTranslation("godModeImports");
  const summary = [
    ["created", run.stats.created],
    ["updated", run.stats.updated],
    ["skipped", run.stats.skipped],
    ["rejected", run.stats.rejected],
  ] as const;
  return (
    <TableRow>
      <TableCell className="max-w-64 break-all">
        <span className="font-medium">{run.sourceRef}</span>
        <p className="text-muted-foreground mt-1 text-xs">{run.id}</p>
      </TableCell>
      <TableCell>
        <Badge variant={stateVariant(run.state)}>
          {t(`states.${run.state}`)}
        </Badge>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {summary.map(([key, value]) => (
            <span key={key}>
              {t(key)}: {value ?? 0}
            </span>
          ))}
        </div>
      </TableCell>
      <TableCell>
        {run.lastCommittedChunk < 0 ? "—" : run.lastCommittedChunk}
      </TableCell>
      <TableCell>{formatDateTime(run.updatedAt)}</TableCell>
      <TableCell>
        <Button size="sm" variant="outline" onClick={onOpen}>
          {t("openRun")}
        </Button>
      </TableCell>
    </TableRow>
  );
}
