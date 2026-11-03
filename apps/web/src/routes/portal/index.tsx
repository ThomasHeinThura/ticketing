import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Frame,
  FramePanel,
  Skeleton,
} from "@taskdesk/ui";
import { CheckCircle2, Clock3, Inbox, TriangleAlert } from "lucide-react";
import {
  type PortalCaseFilterPatch,
  PortalCaseFilters,
} from "@/components/portal/cases/portal-case-filters";
import { PortalCaseTable } from "@/components/portal/cases/portal-case-table";
import { PortalKpiCard } from "@/components/portal/portal-kpi-card";
import { PortalOrientation } from "@/components/portal/portal-orientation";
import { PortalProjectsCards } from "@/components/portal/projects/portal-projects-cards";
import {
  usePortalCases,
  usePortalHome,
} from "@/hooks/queries/portal/use-portal-cases";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import { formatPortalDuration } from "@/lib/portal-duration";
import {
  PORTAL_OUTSTANDING_STATUSES,
  type PortalHomeSearch,
  parsePortalHomeSearch,
  portalProjectSearchMiddlewares,
  routes,
} from "@/lib/routes";

/** Rows of the dashboard's outstanding list; the full list lives on `/requests`. */
// The cases half of "Action required" counts exactly this list (API `portalHomeCounts`).
const NEED_MORE_INFO_LIST = { scope: "all", status: "need_more_info" } as const;
const DASHBOARD_ROWS = 10;
const OUTSTANDING = PORTAL_OUTSTANDING_STATUSES.join(",");

export const Route = createFileRoute("/")({
  validateSearch: parsePortalHomeSearch,
  search: { middlewares: portalProjectSearchMiddlewares },
  component: PortalHome,
});

function PortalHome() {
  const { t, i18n } = usePortalTranslation("portal");
  const { portalUserId } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { project, scope, priority } = search;
  const status = search.status ?? OUTSTANDING;
  const home = usePortalHome(portalUserId, project);
  const caseQuery = {
    scope: scope ?? "mine",
    status,
    ...(priority ? { priority } : {}),
    ...(project ? { project } : {}),
    limit: DASHBOARD_ROWS,
  } as const;
  const cases = usePortalCases(portalUserId, caseQuery);
  const update = (patch: PortalCaseFilterPatch) =>
    void navigate({
      search: (previous: PortalHomeSearch) => ({ ...previous, ...patch }),
      replace: true,
    });
  const figures = home.data;
  const listSearch = {
    ...(scope ? { scope } : {}),
    status,
    ...(priority ? { priority } : {}),
  };

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-semibold text-xl">{t("home.dashboardTitle")}</h1>
          <p className="text-muted-foreground text-sm">
            {t("home.dashboardDescription")}
          </p>
        </div>
        <Button render={<Link to={routes.portalCatalogue.path} />}>
          {t("requests.newRequest")}
        </Button>
      </header>
      <PortalOrientation portalUserId={portalUserId} />

      <section aria-label={t("home.dashboardTitle")}>
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
            />
            <PortalKpiCard
              label={t("cases.kpi.outstanding")}
              value={figures.outstanding}
              hint={t("cases.kpi.outstandingHint")}
              icon={Inbox}
              tone="info"
              to={routes.portalRequests.path}
              search={{ scope: "all", status: OUTSTANDING }}
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

      <PortalProjectsCards projectKey={project} />

      <section
        className="flex flex-col gap-3"
        aria-labelledby="portal-outstanding-heading"
      >
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2
              id="portal-outstanding-heading"
              className="font-semibold text-base"
            >
              {t("cases.outstandingTitle")}
            </h2>
            <p className="text-muted-foreground text-sm">
              {t("cases.outstandingDescription")}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            render={
              <Link to={routes.portalRequests.path} search={listSearch} />
            }
          >
            {t("cases.viewAll")}
          </Button>
        </div>
        <PortalCaseFilters
          filters={search}
          statuses={PORTAL_OUTSTANDING_STATUSES}
          onChange={update}
        />
        {cases.isError ? (
          <Alert variant="error">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              <span>{t("cases.loadFailed")}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void cases.refetch()}
              >
                {t("common:actions.retry")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : !cases.data ? (
          <Skeleton className="h-40 w-full rounded-xl" />
        ) : cases.data.cases.length === 0 ? (
          <Frame>
            <FramePanel className="p-8">
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{t("cases.emptyTitle")}</EmptyTitle>
                  <EmptyDescription>
                    {t("cases.emptyDescription")}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </FramePanel>
          </Frame>
        ) : (
          <>
            <PortalCaseTable
              cases={cases.data.cases}
              caption={t("cases.outstandingTitle")}
            />
            {cases.data.meta.total > cases.data.cases.length ? (
              <p className="text-muted-foreground text-xs">
                {t("cases.summary", {
                  shown: cases.data.cases.length,
                  total: cases.data.meta.total,
                })}
              </p>
            ) : null}
          </>
        )}
      </section>
    </main>
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
}: {
  cases: number;
  approvals: number;
  total: number;
}) {
  const { t } = usePortalTranslation("portal");
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
              search={NEED_MORE_INFO_LIST}
              className="underline-offset-4 hover:underline focus-visible:underline"
            >
              {casesText}
            </Link>
            {" · "}
            <Link
              to={routes.portalApprovals.path}
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
        ? { to: routes.portalApprovals.path }
        : { to: routes.portalRequests.path, search: NEED_MORE_INFO_LIST })}
    />
  );
}
