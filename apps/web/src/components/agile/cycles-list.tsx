import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
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
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import {
  FeatureDisabledError,
  getCycles,
  type Velocity,
} from "@/fetchers/agile";
import { getDefaultAgentTerm } from "@/lib/i18n/agent-translation";
import {
  CYCLE_STATUS_VARIANT,
  formatCalendarDate,
  formatScopeAmount,
} from "./agile-format";
import { CycleFormDialog } from "./cycle-form-dialog";
import { CycleSummaryLine } from "./cycle-summary-line";
import { FeatureOff } from "./feature-off";

/** `CY-9`: the mean of the last three completed cycles, or "insufficient data". Never one cycle. */
export function VelocityText({ velocity }: { velocity: Velocity }) {
  const { t } = useTranslation("agile");
  if (velocity.status === "insufficient_data")
    return (
      <span data-testid="velocity-insufficient">
        {velocity.reason === "late_snapshot"
          ? t("cycles.velocity.lateSnapshot")
          : t("cycles.velocity.insufficient")}
      </span>
    );
  return (
    <span data-testid="velocity-value">
      {t("cycles.velocity.value", {
        value: formatScopeAmount(velocity.value, velocity.unit),
        unit: t(`units.${velocity.unit}`),
      })}
    </span>
  );
}

/**
 * The cycles list of a project (`CY-1`, `CY-3`, `CY-7`, `CY-9`): status badge (derived by the
 * server), dates, scope summary, velocity, and a create dialog for planners. Hidden behind
 * `feature.cycles`, which is off by default.
 */
export function CyclesList({ projectKey }: { projectKey: string }) {
  const { t, i18n } = useTranslation("agile");
  const [creating, setCreating] = useState(false);
  const query = useQuery({
    queryKey: ["agile", "cycles", projectKey],
    queryFn: () => getCycles(projectKey),
    retry: (count, error) =>
      !(error instanceof FeatureDisabledError) && count < 2,
  });

  if (query.error instanceof FeatureDisabledError)
    return <FeatureOff feature="cycles" />;
  if (query.isLoading)
    return (
      <div
        className="mx-auto flex max-w-4xl flex-col gap-3 p-4"
        role="status"
        aria-label={t("common.loading")}
      >
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  if (query.isError || !query.data)
    return (
      <div className="mx-auto max-w-4xl p-4">
        <Alert variant="error">
          <AlertDescription>{t("cycles.loadFailed")}</AlertDescription>
        </Alert>
      </div>
    );

  const { data: cycles, meta } = query.data;
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4">
      <PageTitle title={t("cycles.pageTitle")} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1
            className="font-semibold text-lg"
            title={getDefaultAgentTerm(i18n, "cycle", 2)}
          >
            {t("cycles.title")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t("cycles.velocity.label")}:{" "}
            <VelocityText velocity={meta.velocity} />
          </p>
        </div>
        {meta.canManage ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            {t("cycles.create")}
          </Button>
        ) : null}
      </div>
      {cycles.length === 0 ? (
        <Empty data-testid="cycles-empty">
          <EmptyHeader>
            <EmptyTitle>{t("cycles.emptyTitle")}</EmptyTitle>
            <EmptyDescription>{t("cycles.emptyDescription")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {cycles.map((cycle) => (
            <li key={cycle.id}>
              <Card>
                <CardHeader>
                  <CardTitle className="flex min-w-0 flex-wrap items-center gap-2">
                    <Link
                      to="/agent/projects/$projectKey/cycles/$cycleId"
                      params={{ projectKey, cycleId: cycle.id }}
                      className="truncate hover:underline"
                    >
                      {cycle.name}
                    </Link>
                    <Badge variant={CYCLE_STATUS_VARIANT[cycle.status]}>
                      {t(`cycles.status.${cycle.status}`)}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 pt-0">
                  <p className="text-muted-foreground text-xs">
                    {formatCalendarDate(cycle.startDate, i18n.language)}
                    {" – "}
                    {formatCalendarDate(cycle.endDate, i18n.language)}
                  </p>
                  {cycle.summary.total.count === 0 ? (
                    <p className="text-muted-foreground text-xs">
                      {t("cycles.noScope")}
                    </p>
                  ) : (
                    <>
                      <CycleSummaryLine summary={cycle.summary} />
                      {cycle.summary.unestimated.count > 0 &&
                      cycle.summary.unit !== "count" ? (
                        <p className="text-muted-foreground text-xs">
                          {t("summary.unestimated", {
                            count: cycle.summary.unestimated.count,
                            percent: Math.round(
                              cycle.summary.unestimated.share * 100,
                            ),
                          })}
                        </p>
                      ) : null}
                    </>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {creating ? (
        <CycleFormDialog
          projectKey={projectKey}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </div>
  );
}
