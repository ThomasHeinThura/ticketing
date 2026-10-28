import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Skeleton,
} from "@taskdesk/ui";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  discoverImportRun,
  type EngineRun,
  getImportMapping,
  type ImportDiscovery,
  ImportReasonError,
  MAPPING_DOMAINS,
} from "@/fetchers/god-mode/imports";
import { SetupJobProgress } from "./setup-job-progress";
import { useIdempotencyKey } from "./use-idempotency-key";
import { wizardKeys } from "./wizard-keys";

function domainSummary(discovery: ImportDiscovery) {
  return MAPPING_DOMAINS.map((domain) => {
    const facets = discovery.facets.filter((facet) => facet.domain === domain);
    return {
      domain,
      values: facets.length,
      records: facets.reduce((sum, facet) => sum + facet.count, 0),
    };
  }).filter((row) => row.values > 0);
}

/** Step 2: connect to the source, discover what it holds and show how big the job is. */
export function DiscoverStep({
  run,
  onDiscovered,
}: {
  run: EngineRun;
  onDiscovered: () => void;
}) {
  const { t } = useTranslation("godModeImports");
  const client = useQueryClient();
  const key = useIdempotencyKey();
  const mapping = useQuery({
    queryKey: wizardKeys.mapping(run.id),
    queryFn: () => getImportMapping(run.id),
    enabled: run.phase !== "created",
    retry: false,
  });
  const discover = useMutation({
    mutationFn: () =>
      discoverImportRun(run.id, key.keyFor(`discover:${run.version}`)),
    onSuccess: () => {
      key.reset();
      // Discovery runs on the server: the engine query (polled while the step runs) shows its
      // progress, and the mapping is read again once it completes.
      void client.invalidateQueries({ queryKey: wizardKeys.engine(run.id) });
    },
  });
  const job = run.job?.kind === "discover" ? run.job : null;
  const running = job?.status === "running";
  const doneAt = job?.status === "completed" ? job.updatedAt : null;
  useEffect(() => {
    if (!doneAt) return;
    void client.invalidateQueries({ queryKey: wizardKeys.mapping(run.id) });
    void client.invalidateQueries({ queryKey: wizardKeys.dryRun(run.id) });
  }, [client, doneAt, run.id]);
  // A run paused mid-execution may come back here to recover (a fresh dry run and approval); a
  // running or completed one may not.
  const locked =
    (run.phase === "executing" && run.state !== "paused") ||
    run.phase === "completed";
  const discovery = mapping.data?.discovery ?? null;

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground max-w-2xl text-sm">
          {t("wizard.discover.description")}
        </p>
        <Button
          disabled={discover.isPending || running || locked}
          onClick={() => discover.mutate()}
        >
          {discovery ? t("wizard.discover.rerun") : t("wizard.discover.run")}
        </Button>
      </div>

      {running && job ? (
        <SetupJobProgress
          job={job}
          continuing={discover.isPending}
          onContinue={() => discover.mutate()}
        />
      ) : null}

      {discover.isError ||
      (job?.status === "failed" && job.failure !== null) ? (
        <Alert variant="error">
          <AlertTitle>{t("wizard.discover.errorTitle")}</AlertTitle>
          <AlertDescription>
            {job?.status === "failed" && job.failure !== null
              ? t(`wizard.setupFailures.${job.failure}`, {
                  defaultValue: t(`wizard.connect.reasons.${job.failure}`, {
                    defaultValue: t("wizard.discover.errorDescription"),
                  }),
                })
              : discover.error instanceof ImportReasonError
                ? t(`wizard.connect.reasons.${discover.error.reason}`, {
                    defaultValue: t("wizard.discover.errorDescription"),
                  })
                : t("wizard.discover.errorDescription")}
          </AlertDescription>
        </Alert>
      ) : null}

      {running ? null : mapping.isPending && run.phase !== "created" ? (
        <Skeleton className="h-40 w-full" />
      ) : discovery ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("wizard.discover.found")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-md border p-3">
                  <dt className="text-muted-foreground text-xs">
                    {t("wizard.discover.totalRecords")}
                  </dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums">
                    {discovery.totalRecords}
                  </dd>
                </div>
                {Object.entries(discovery.counts).map(([type, count]) => (
                  <div key={type} className="rounded-md border p-3">
                    <dt className="text-muted-foreground break-all text-xs">
                      {type}
                    </dt>
                    <dd className="mt-1 text-lg font-semibold tabular-nums">
                      {count}
                    </dd>
                  </div>
                ))}
              </dl>
              {Object.entries(discovery.unreadable ?? {}).length > 0 ? (
                <Alert variant="warning">
                  <AlertTitle>
                    {t("wizard.discover.unreadableTitle")}
                  </AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc space-y-1 pl-5">
                      {Object.entries(discovery.unreadable ?? {}).map(
                        ([code, count]) => (
                          <li key={code}>
                            {t(`wizard.unreadable.${code}`, {
                              defaultValue: code,
                              total: count,
                            })}
                          </li>
                        ),
                      )}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}
              <ul className="flex flex-wrap gap-2">
                {domainSummary(discovery).map((row) => (
                  <li key={row.domain}>
                    <Badge variant="outline">
                      {t(`wizard.domains.${row.domain}`)}: {row.values}
                      {" · "}
                      {t("wizard.discover.records", { count: row.records })}
                    </Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <div className="flex justify-end">
            <Button onClick={onDiscovered}>
              {t("wizard.discover.continue")}
            </Button>
          </div>
        </>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("wizard.discover.emptyTitle")}</EmptyTitle>
            <EmptyDescription>
              {t("wizard.discover.emptyDescription")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}
