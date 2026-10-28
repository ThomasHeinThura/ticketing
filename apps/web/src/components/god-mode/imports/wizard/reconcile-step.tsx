import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Frame,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import {
  type EngineRun,
  getImportLosses,
  getImportReconciliation,
  recomputeImportReconciliation,
} from "@/fetchers/god-mode/imports";
import { useIdempotencyKey } from "./use-idempotency-key";
import { wizardKeys } from "./wizard-keys";

/**
 * Optional source-versus-target counts from the reconciliation API (another lane). The step
 * renders them when supplied and works from run statistics and the loss report without them.
 */
export type ReconciliationSummary = {
  rows: { key: string; label: string; source: number; target: number }[];
};

const COUNTERS = ["created", "updated", "skipped", "rejected"] as const;

/** Step 6: counts compared, anything lost or unmapped listed. */
export function ReconcileStep({
  run,
  reconciliation: supplied,
}: {
  run: EngineRun;
  reconciliation?: ReconciliationSummary;
}) {
  const { t } = useTranslation("godModeImports");
  const queryClient = useQueryClient();
  const recomputeKey = useIdempotencyKey();
  const stored = useQuery({
    queryKey: wizardKeys.reconciliation(run.id),
    queryFn: () => getImportReconciliation(run.id),
    retry: false,
  });
  const recompute = useMutation({
    mutationFn: () =>
      recomputeImportReconciliation(
        run.id,
        recomputeKey.keyFor(`recompute:${run.id}:${run.version}`),
      ),
    onSuccess: (result) => {
      recomputeKey.reset();
      queryClient.setQueryData(wizardKeys.reconciliation(run.id), result);
    },
  });
  const reconciliation: ReconciliationSummary | undefined =
    supplied ??
    (stored.data?.reconciliation
      ? { rows: stored.data.reconciliation.rows }
      : undefined);
  const losses = useInfiniteQuery({
    queryKey: wizardKeys.losses(run.id),
    queryFn: ({ pageParam }) =>
      getImportLosses(run.id, { cursor: pageParam, limit: 100 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const done = COUNTERS.reduce((sum, key) => sum + (run.stats[key] ?? 0), 0);
  const total = run.dryRun?.total;
  const pages = losses.data?.pages ?? [];
  const summary = pages[0]?.summary ?? [];
  const rows = pages.flatMap((page) => page.losses);
  const lossTotal = summary.reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="min-w-0 space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("wizard.reconcile.counts")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {COUNTERS.map((key) => (
              <div key={key} className="rounded-md border p-3">
                <dt className="text-muted-foreground text-xs">
                  {t(`counts.${key}`)}
                </dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">
                  {run.stats[key] ?? 0}
                </dd>
              </div>
            ))}
            <div className="rounded-md border p-3">
              <dt className="text-muted-foreground text-xs">
                {t("wizard.reconcile.expected")}
              </dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">
                {total ?? "—"}
              </dd>
            </div>
          </dl>
          {total !== undefined && done !== total ? (
            <Alert variant="warning">
              <AlertDescription>
                {t("wizard.reconcile.mismatch", { done, total })}
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">
            {t("wizard.reconcile.sourceVsTarget")}
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            disabled={recompute.isPending}
            onClick={() => recompute.mutate()}
          >
            {t("wizard.reconcile.recompute")}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {recompute.isError || stored.isError ? (
            <Alert variant="error">
              <AlertDescription>{t("wizard.reconcile.error")}</AlertDescription>
            </Alert>
          ) : null}
          {!reconciliation && !stored.isPending ? (
            <p className="text-muted-foreground text-sm">
              {t("wizard.reconcile.notComputed")}
            </p>
          ) : null}
          {reconciliation ? (
            <Frame className="overflow-x-auto">
              <Table className="min-w-[480px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("wizard.reconcile.item")}</TableHead>
                    <TableHead className="text-right">
                      {t("wizard.reconcile.source")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("wizard.reconcile.target")}
                    </TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reconciliation.rows.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell className="font-medium">{row.label}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.source}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.target}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            row.source === row.target ? "success" : "warning"
                          }
                        >
                          {row.source === row.target
                            ? t("wizard.reconcile.match")
                            : t("wizard.reconcile.differs")}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Frame>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("wizard.losses.title")}
            {lossTotal > 0 ? (
              <span className="text-muted-foreground ml-2 text-xs font-normal">
                {t("wizard.reconcile.lossTotal", { count: lossTotal })}
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {losses.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : losses.isError ? (
            <Alert variant="error">
              <AlertTitle>{t("wizard.losses.errorTitle")}</AlertTitle>
              <AlertDescription className="flex items-center justify-between gap-3">
                <span>{t("wizard.losses.errorDescription")}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void losses.refetch()}
                >
                  {t("retry")}
                </Button>
              </AlertDescription>
            </Alert>
          ) : summary.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("wizard.losses.none")}
            </p>
          ) : (
            <>
              <Frame className="overflow-x-auto">
                <Table className="min-w-[560px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("wizard.dryRun.sourceType")}</TableHead>
                      <TableHead>{t("wizard.losses.code")}</TableHead>
                      <TableHead>{t("wizard.losses.detail")}</TableHead>
                      <TableHead className="text-right">
                        {t("wizard.losses.count")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.map((row) => (
                      <TableRow
                        key={`${row.sourceType}:${row.code}:${row.detailCode}`}
                      >
                        <TableCell className="break-all">
                          {row.sourceType}
                        </TableCell>
                        <TableCell>
                          {t(`wizard.lossCodes.${row.code}`, {
                            defaultValue: row.code,
                          })}
                        </TableCell>
                        <TableCell className="break-all">
                          {row.detailCode || "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.count}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Frame>
              <Frame className="overflow-x-auto">
                <Table className="min-w-[560px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("wizard.losses.record")}</TableHead>
                      <TableHead>{t("wizard.losses.code")}</TableHead>
                      <TableHead>{t("wizard.losses.sourceUrl")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="break-all">
                          {row.sourceType} · {row.sourceId}
                        </TableCell>
                        <TableCell>
                          {t(`wizard.lossCodes.${row.code}`, {
                            defaultValue: row.code,
                          })}
                        </TableCell>
                        <TableCell className="max-w-64 break-all text-xs">
                          {row.sourceUrl ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Frame>
              {losses.hasNextPage ? (
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    disabled={losses.isFetchingNextPage}
                    onClick={() => void losses.fetchNextPage()}
                  >
                    {t("nextPage")}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
