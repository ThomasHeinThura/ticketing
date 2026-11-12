import { Link } from "@tanstack/react-router";
import { Alert, AlertDescription, Button, Skeleton } from "@taskdesk/ui";
import { CheckCircle2, Clock3, Inbox, TriangleAlert } from "lucide-react";
import { PortalKpiCard } from "@/components/portal/portal-kpi-card";
import { usePortalHome } from "@/hooks/queries/portal/use-portal-cases";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import { formatPortalDuration } from "@/lib/portal-duration";
import { PORTAL_OUTSTANDING_STATUSES, routes } from "@/lib/routes";

const OUTSTANDING = PORTAL_OUTSTANDING_STATUSES.join(",");

/** `?project=KEY` for a link, only when the figures are scoped to a project. */
function scoped(project: string | undefined) {
  return project ? { project } : {};
}

/**
 * The dashboard's four figures from `GET /api/portal/home` (S4b): Action required, Outstanding,
 * Closed in the last 30 days and the average first response (D4, hidden when there is none).
 * With `project` every figure, and every list a figure opens, is scoped to that project, so
 * Project Details (U-11) shows the same numbers as the dashboard filtered to it. Each link names
 * the project itself: Project Details carries its key in the path, not in `?project=`.
 */
export function PortalHomeKpis({
  portalUserId,
  project,
  label,
  prefetched = false,
}: {
  portalUserId: string;
  project?: string;
  /** The section's accessible name. */
  label: string;
  prefetched?: boolean;
}) {
  const { t, i18n } = usePortalTranslation("portal");
  const home = usePortalHome(portalUserId, project, prefetched);
  const figures = home.data;

  return (
    <section aria-label={label}>
      {home.isError ? (
        <Alert variant="error">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{t("cases.kpi.loadFailed")}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void home.refetch()}
            >
              {t("common:actions.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : !figures ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-22 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ActionRequiredCard
            cases={figures.actionRequired.cases}
            approvals={figures.actionRequired.approvals}
            total={figures.actionRequired.total}
            project={project}
          />
          <PortalKpiCard
            label={t("cases.kpi.outstanding")}
            value={figures.outstanding}
            hint={t("cases.kpi.outstandingHint")}
            icon={Inbox}
            tone="info"
            to={routes.portalRequests.path}
            search={{ scope: "all", status: OUTSTANDING, ...scoped(project) }}
          />
          <PortalKpiCard
            label={t("cases.kpi.closed")}
            value={figures.closedLast30Days}
            hint={t("cases.kpi.closedHint")}
            icon={CheckCircle2}
            tone="success"
          />
          {figures.averageFirstResponse ? (
            <PortalKpiCard
              label={t("cases.kpi.averageResponse")}
              value={formatPortalDuration(
                figures.averageFirstResponse.seconds,
                i18n?.resolvedLanguage || i18n?.language,
              )}
              hint={t("cases.kpi.averageResponseHint")}
              icon={Clock3}
            />
          ) : null}
        </div>
      )}
    </section>
  );
}

/**
 * "Action required": readable cases that need more information plus approvals addressed to
 * the caller. Each figure links to the list it counts; when both are non-zero the card is not a
 * link (links cannot nest) and each half of the hint links to its own list.
 */
function ActionRequiredCard({
  cases,
  approvals,
  total,
  project,
}: {
  cases: number;
  approvals: number;
  total: number;
  project: string | undefined;
}) {
  const { t } = usePortalTranslation("portal");
  // The cases half counts exactly this list (API `portalHomeCounts`).
  const needMoreInfoList = {
    scope: "all",
    status: "need_more_info",
    ...scoped(project),
  };
  // Unscoped, the approvals link names no search, so a `?project=` in the URL is kept as is.
  const approvalsList = project ? { project } : undefined;
  const casesText = t("cases.kpi.actionRequiredCases", { cases });
  const approvalsText = t("cases.kpi.actionRequiredApprovals", { approvals });
  const shared = {
    label: t("cases.kpi.actionRequired"),
    value: total,
    icon: TriangleAlert,
    tone: total > 0 ? ("warning" as const) : ("neutral" as const),
  };
  if (cases > 0 && approvals > 0)
    return (
      <PortalKpiCard
        {...shared}
        hint={
          <>
            <Link
              to={routes.portalRequests.path}
              search={needMoreInfoList}
              className="underline-offset-4 hover:underline focus-visible:underline"
            >
              {casesText}
            </Link>
            {" · "}
            <Link
              to={routes.portalApprovals.path}
              search={approvalsList}
              className="underline-offset-4 hover:underline focus-visible:underline"
            >
              {approvalsText}
            </Link>
          </>
        }
      />
    );
  return (
    <PortalKpiCard
      {...shared}
      hint={`${casesText} · ${approvalsText}`}
      {...(cases === 0 && approvals > 0
        ? { to: routes.portalApprovals.path, search: approvalsList }
        : { to: routes.portalRequests.path, search: needMoreInfoList })}
    />
  );
}
