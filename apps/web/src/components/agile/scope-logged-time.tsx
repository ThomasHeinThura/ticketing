import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Badge, Skeleton } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { getTimeSummary } from "@/fetchers/time-tracking";
import { useTimeTrackingFeatures } from "@/hooks/queries/time-tracking/use-time-tracking";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { formatMinutes } from "@/lib/time-minutes";

type Scope =
  | { cycleId: string; moduleId?: never }
  | { moduleId: string; cycleId?: never };

/** TC-7: show persisted scope roll-up when the time API is available to this caller. */
export function ScopeLoggedTime({
  workspaceId,
  projectId,
  scope,
}: {
  workspaceId?: string;
  projectId?: string;
  scope: Scope;
}) {
  const { t } = useTranslation();
  const features = useTimeTrackingFeatures(projectId);
  const { canLogTime, isCheckingPermissions } = useWorkspacePermission(
    workspaceId,
    projectId,
  );
  const scopeKind = "cycleId" in scope ? "cycle" : "module";
  const scopeId = "cycleId" in scope ? scope.cycleId : scope.moduleId;
  const enabled = Boolean(
    workspaceId &&
      projectId &&
      scopeId &&
      features.time &&
      !features.isLoading &&
      !isCheckingPermissions &&
      canLogTime(),
  );
  const summary = useQuery({
    queryKey: [
      "time-tracking",
      "summary",
      workspaceId ?? "",
      projectId ?? "",
      scopeKind,
      scopeId,
    ],
    queryFn: () =>
      getTimeSummary({
        workspaceId: workspaceId as string,
        ...(scopeKind === "cycle"
          ? { cycleId: scopeId }
          : { moduleId: scopeId }),
      }),
    enabled,
    retry: 1,
  });

  if (!enabled) return null;
  if (summary.isLoading) return <Skeleton className="h-14 w-48" />;
  if (summary.isError || !summary.data)
    return (
      <Alert variant="error">
        <AlertDescription>
          {t("timeTracking:section.loadError")}
        </AlertDescription>
      </Alert>
    );

  return (
    <div
      className="flex w-fit items-center gap-2 rounded-md border px-3 py-2 text-sm"
      data-testid={`${scopeKind}-logged-time`}
    >
      <span className="font-medium">{t("timeTracking:section.total")}</span>
      <Badge variant="outline" className="tabular-nums">
        {formatMinutes(summary.data.totalMinutes)}
      </Badge>
    </div>
  );
}
