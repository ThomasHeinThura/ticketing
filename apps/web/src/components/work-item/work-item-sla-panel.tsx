import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client } from "@taskdesk/libs";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Progress,
  ProgressIndicator,
  ProgressLabel,
  ProgressTrack,
  ProgressValue,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import getWorkItemSla from "@/fetchers/work-item/get-work-item-sla";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { formatDateTime } from "@/lib/format";
import { HttpError } from "@/lib/http-error";

type Operation = "pause" | "resume";

export default function WorkItemSlaPanel({
  keyValue,
  workspaceId,
}: {
  keyValue: string;
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { canUpdateTasks, isCheckingPermissions } =
    useWorkspacePermission(workspaceId);
  const queryKey = ["work-items", "sla", keyValue] as const;
  const sla = useQuery({
    queryKey,
    queryFn: () => getWorkItemSla(keyValue),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const mutation = useMutation({
    mutationFn: async (operation: Operation) => {
      const route = client["work-items"][":key"].sla[operation];
      const response = await route.$post({ param: { key: keyValue } });
      if (!response.ok) {
        throw new HttpError(response.status, "Failed to change SLA pause");
      }
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  if (sla.isPending) {
    return (
      <section aria-busy="true" data-testid="work-item-sla-loading">
        {t("workItems:sla.loading")}
      </section>
    );
  }

  if (sla.isError) {
    return (
      <Alert variant="warning" data-testid="work-item-sla-error">
        <AlertTitle>{t("workItems:sla.errorTitle")}</AlertTitle>
        <AlertDescription>
          <p>{t("workItems:sla.errorDescription")}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void sla.refetch()}
          >
            {t("workItems:sla.retry")}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const hasRunningMetric = sla.data.metrics.some(
    (metric) =>
      metric.state !== "none" &&
      metric.state !== "met" &&
      metric.state !== "missed",
  );
  const hasManualPause = sla.data.metrics.some(
    (metric) => metric.pause?.reason === "manual",
  );
  const hasAnyPause = sla.data.metrics.some((metric) => metric.pause !== null);

  return (
    <section
      className="flex flex-col gap-3"
      aria-labelledby="work-item-sla-heading"
      data-testid="work-item-sla"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="work-item-sla-heading" className="font-medium text-lg">
          {t("workItems:sla.heading")}
        </h2>
        {!isCheckingPermissions &&
          canUpdateTasks() &&
          (hasManualPause || (!hasAnyPause && hasRunningMetric)) && (
            <Button
              variant="outline"
              size="sm"
              disabled={mutation.isPending}
              onClick={() =>
                mutation.mutate(hasManualPause ? "resume" : "pause")
              }
            >
              {mutation.isPending
                ? t("workItems:sla.saving")
                : hasManualPause
                  ? t("workItems:sla.resume")
                  : t("workItems:sla.pause")}
            </Button>
          )}
      </div>

      {mutation.isError && (
        <Alert variant="warning" data-testid="work-item-sla-mutation-error">
          <AlertTitle>{t("workItems:sla.changeErrorTitle")}</AlertTitle>
          <AlertDescription>
            {t("workItems:sla.changeErrorDescription")}
          </AlertDescription>
        </Alert>
      )}

      {sla.data.calendarName && (
        <p
          className="text-muted-foreground text-sm"
          data-testid="work-item-sla-calendar"
        >
          {t("workItems:sla.calendar", { name: sla.data.calendarName })}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {sla.data.metrics.map((metric) => (
          <article
            key={metric.metric}
            className="flex flex-col gap-2 rounded-md border p-3"
            data-testid={`work-item-sla-${metric.metric}`}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-medium">
                {t(`workItems:sla.metrics.${metric.metric}`)}
              </h3>
              <Badge
                variant={metric.state === "breached" ? "error" : "outline"}
              >
                {t(`workItems:sla.states.${metric.state}`)}
              </Badge>
            </div>
            {metric.state !== "none" && (
              <Progress value={Math.min(100, metric.consumedPct)}>
                <ProgressLabel>{t("workItems:sla.consumed")}</ProgressLabel>
                <ProgressValue />
                <ProgressTrack>
                  <ProgressIndicator />
                </ProgressTrack>
              </Progress>
            )}
            <p className="text-muted-foreground text-sm">
              {metric.pause
                ? t("workItems:sla.pausedSince", {
                    date: formatDateTime(metric.pause.startedAt),
                    reason: t(
                      `workItems:sla.pauseReasons.${metric.pause.reason}`,
                    ),
                  })
                : metric.dueAt
                  ? t("workItems:sla.dueAt", {
                      date: formatDateTime(metric.dueAt),
                      remaining: metric.remainingMinutes ?? 0,
                    })
                  : metric.state === "none"
                    ? t("workItems:sla.notConfigured")
                    : null}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
