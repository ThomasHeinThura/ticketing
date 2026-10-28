import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import type { ServiceCalendarUsage } from "@/fetchers/service-calendar";
import { useRequestServiceCalendarDeletion } from "@/hooks/mutations/service-calendar/use-request-service-calendar-deletion";
import type { useServiceCalendarUsage } from "@/hooks/queries/service-calendar/use-service-calendar-usage";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import { toast } from "@/lib/toast";

type UsageQuery = ReturnType<typeof useServiceCalendarUsage>;

export function usageIsInUse(counts: ServiceCalendarUsage["counts"]): boolean {
  return (
    counts.projects > 0 ||
    counts.slaPolicyVersions > 0 ||
    counts.currentSlaPolicies > 0 ||
    counts.workItems > 0
  );
}

export function CalendarUsageCounts({
  counts,
}: {
  counts: ServiceCalendarUsage["counts"];
}) {
  const { t } = useTranslation("serviceCalendars");
  const rows: Array<[string, number]> = [
    [t("usage.projects"), counts.projects],
    [t("usage.currentSlaPolicies"), counts.currentSlaPolicies],
    [t("usage.slaPolicyVersions"), counts.slaPolicyVersions],
    [t("usage.workItems"), counts.workItems],
  ];
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-right font-medium tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CalendarUsageCard({
  calendarId,
  usage,
  canManage,
}: {
  calendarId: string;
  usage: UsageQuery;
  canManage: boolean;
}) {
  const { t } = useTranslation("serviceCalendars");
  const openPendingAction = useOpenPendingAction();
  const requestDeletion = useRequestServiceCalendarDeletion();
  const counts = usage.data?.counts;
  const inUse = counts ? usageIsInUse(counts) : true;

  async function submitDeletionRequest() {
    try {
      const pending = await requestDeletion.mutateAsync(calendarId);
      // The approval opens in place as the one confirm dialog.
      await openPendingAction(pending);
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("usage.deleteError"),
      );
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("usage.title")}</CardTitle>
        <CardDescription>{t("usage.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {usage.isLoading ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t("usage.loading")}
          </p>
        ) : usage.isError || !counts ? (
          <div role="alert" className="space-y-2 text-sm">
            <p>{t("usage.loadError")}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void usage.refetch()}
            >
              {t("usage.retry")}
            </Button>
          </div>
        ) : (
          <>
            <CalendarUsageCounts counts={counts} />
            <p className="text-xs text-muted-foreground">
              {inUse ? t("usage.inUse") : t("usage.unused")}
            </p>
          </>
        )}
        {canManage ? (
          <>
            <Button
              type="button"
              variant="destructive-outline"
              disabled={inUse || requestDeletion.isPending}
              onClick={() => void submitDeletionRequest()}
            >
              {t("usage.requestDeletion")}
            </Button>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
