import { useNavigate } from "@tanstack/react-router";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ServiceCalendarUsage } from "@/fetchers/service-calendar";
import { useRequestServiceCalendarDeletion } from "@/hooks/mutations/service-calendar/use-request-service-calendar-deletion";
import type { useServiceCalendarUsage } from "@/hooks/queries/service-calendar/use-service-calendar-usage";
import { routes } from "@/lib/routes";
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
  const navigate = useNavigate();
  const requestDeletion = useRequestServiceCalendarDeletion();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const counts = usage.data?.counts;
  const inUse = counts ? usageIsInUse(counts) : true;

  async function submitDeletionRequest() {
    try {
      const pending = await requestDeletion.mutateAsync(calendarId);
      setConfirmOpen(false);
      toast.info(t("usage.deleteRequested"));
      await navigate({
        to: routes.pendingAction.path,
        params: { id: pending.pendingActionId },
      });
    } catch (error) {
      setConfirmOpen(false);
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
              onClick={() => setConfirmOpen(true)}
            >
              {t("usage.requestDeletion")}
            </Button>
            <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <AlertDialogPopup>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("usage.confirmTitle")}</AlertDialogTitle>
                  <AlertDialogDescription className="text-foreground">
                    {t("usage.confirmDescription")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogClose
                    render={
                      <Button type="button" variant="outline">
                        {t("usage.cancel")}
                      </Button>
                    }
                  />
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={requestDeletion.isPending}
                    onClick={() => void submitDeletionRequest()}
                  >
                    {t("usage.confirmRequest")}
                  </Button>
                </AlertDialogFooter>
              </AlertDialogPopup>
            </AlertDialog>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
