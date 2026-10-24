import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  ToggleGroup,
  ToggleGroupItem,
} from "@taskdesk/ui";
import { LayoutDashboard, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import type { ReportCatalogueEntry } from "@/fetchers/report";
import { getSavedViews } from "@/fetchers/saved-views";
import { useReport, useReportCatalogue } from "@/hooks/queries/report";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import {
  REPORT_CATEGORIES,
  type ReportsIndexSearch,
} from "@/lib/report-search";
import { routes } from "@/lib/routes";
import { savedViewKeys } from "@/lib/saved-view-keys";
import { ReportError } from "./report-detail";
import { metricText } from "./report-format";

/** The headline numbers: four reports, each a link to its own screen. */
const KPIS = [
  { report: "sla_attainment", metric: "attainment" },
  { report: "throughput", metric: "completed" },
  { report: "at_risk_now", metric: "at_risk" },
  { report: "ageing", metric: "over_30" },
] as const;

function Kpi({
  workspaceId,
  report,
  metric,
}: {
  workspaceId: string;
  report: string;
  metric: string;
}) {
  const { t } = useTranslation();
  const result = useReport(workspaceId, report, {});
  const found = result.data?.metrics.find((entry) => entry.key === metric);
  return (
    <Link
      to={routes.reportDetail.path}
      params={{ key: report }}
      className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card>
        <CardContent className="space-y-1 p-4">
          <p className="text-muted-foreground text-sm">
            {t(`reports:metrics.${metric}`, {
              defaultValue: found?.label ?? metric,
            })}
          </p>
          {result.isLoading ? (
            <Skeleton className="h-8 w-20" />
          ) : found ? (
            <p className="font-semibold text-2xl tabular-nums">
              {result.data?.empty && found.value === 0
                ? "—"
                : metricText(found, t)}
            </p>
          ) : (
            <p className="text-muted-foreground text-2xl">—</p>
          )}
          <p className="text-muted-foreground text-xs">
            {result.data
              ? result.data.scope.kind === "all"
                ? t("reports:context.scopeAll", {
                    count: result.data.scope.projectCount,
                  })
                : t("reports:context.scopeReach", {
                    count: result.data.scope.projectCount,
                  })
              : t(`reports:catalogue.${report}.title`)}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}

function ReportCard({ entry }: { entry: ReportCatalogueEntry }) {
  const { t } = useTranslation();
  const title = t(`reports:catalogue.${entry.key}.title`, {
    defaultValue: entry.title,
  });
  const body = (
    <Card className={entry.available ? undefined : "opacity-70"}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          {title}
          {entry.live ? (
            <Badge variant="outline">{t("reports:badges.live")}</Badge>
          ) : null}
          {entry.available ? null : (
            <Badge variant="secondary">{t("reports:badges.featureOff")}</Badge>
          )}
        </CardTitle>
        <CardDescription>
          {t(`reports:catalogue.${entry.key}.description`, {
            defaultValue: "",
          })}
        </CardDescription>
      </CardHeader>
    </Card>
  );
  return entry.available ? (
    <Link
      to={routes.reportDetail.path}
      params={{ key: entry.key }}
      className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {body}
    </Link>
  ) : (
    body
  );
}

/**
 * `docs/screens.md` "Reports index": a directory, not a dashboard. Category chips, a KPI strip, the
 * fixed reports of tier 1, and the saved table and chart reports of tiers 2 and 3.
 */
export function ReportsIndex({
  search,
  onSearchChange,
}: {
  search: ReportsIndexSearch;
  onSearchChange: (next: ReportsIndexSearch) => void;
}) {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const { user } = useAuth();
  const workspaceId = workspace?.id ?? "";
  const catalogue = useReportCatalogue(workspaceId);
  const views = useQuery({
    queryKey: savedViewKeys.list(workspaceId, user?.id),
    queryFn: () => getSavedViews(workspaceId),
    enabled: Boolean(workspaceId && catalogue.data),
  });
  const saved = (views.data ?? []).filter(
    (view) => view.layout === "table" || view.layout === "chart",
  );
  const category = search.category;
  const categories = REPORT_CATEGORIES.filter((candidate) =>
    catalogue.data?.data.some((entry) => entry.category === candidate),
  );
  return (
    <>
      <PageTitle title={t("reports:index.title")} />
      <div className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="font-semibold text-2xl">
              {t("reports:index.title")}
            </h1>
            <p className="max-w-2xl text-muted-foreground text-sm">
              {t("reports:index.description")}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              render={<Link to={routes.agentDashboard.path} />}
            >
              <LayoutDashboard aria-hidden="true" />
              {t("reports:index.dashboards")}
            </Button>
            <Button render={<Link to={routes.reportBuilder.path} />}>
              <Plus aria-hidden="true" />
              {t("reports:index.newCustom")}
            </Button>
          </div>
        </div>
        {catalogue.isLoading || !workspace ? (
          <Skeleton className="h-40 w-full" />
        ) : catalogue.isError || !catalogue.data ? (
          <ReportError error={catalogue.error} />
        ) : (
          <>
            <section aria-label={t("reports:index.kpis")}>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {KPIS.map((kpi) => (
                  <Kpi
                    key={kpi.report}
                    workspaceId={workspaceId}
                    report={kpi.report}
                    metric={kpi.metric}
                  />
                ))}
              </div>
            </section>
            <ToggleGroup
              aria-label={t("reports:index.categories")}
              value={[category ?? "all"]}
              onValueChange={(values) => {
                const next = values[values.length - 1];
                if (!next) return;
                onSearchChange(
                  next === "all"
                    ? {}
                    : {
                        category: REPORT_CATEGORIES.find(
                          (candidate) => candidate === next,
                        ),
                      },
                );
              }}
              className="flex-wrap"
            >
              <ToggleGroupItem value="all">
                {t("reports:categories.all")}
              </ToggleGroupItem>
              {categories.map((candidate) => (
                <ToggleGroupItem key={candidate} value={candidate}>
                  {t(`reports:categories.${candidate}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {categories
              .filter((candidate) => !category || candidate === category)
              .map((candidate) => (
                <section
                  key={candidate}
                  className="space-y-3"
                  aria-label={t(`reports:categories.${candidate}`)}
                >
                  <h2 className="font-medium text-lg">
                    {t(`reports:categories.${candidate}`)}
                  </h2>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {catalogue.data?.data
                      .filter((entry) => entry.category === candidate)
                      .map((entry) => (
                        <ReportCard key={entry.key} entry={entry} />
                      ))}
                  </div>
                </section>
              ))}
            <section
              className="space-y-3"
              aria-label={t("reports:index.saved")}
            >
              <div className="space-y-1">
                <h2 className="font-medium text-lg">
                  {t("reports:index.saved")}
                </h2>
                <p className="text-muted-foreground text-sm">
                  {t("reports:index.savedDescription")}
                </p>
              </div>
              {views.isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : saved.length === 0 ? (
                <Alert variant="info">
                  <AlertDescription>
                    {t("reports:index.savedEmpty")}
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {saved.map((view) => (
                    <Link
                      key={view.id}
                      to={
                        view.layout === "chart"
                          ? routes.reportBuilder.path
                          : routes.savedView.path
                      }
                      {...(view.layout === "chart"
                        ? { search: { view: view.id } }
                        : { params: { id: view.id } })}
                      className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center justify-between gap-2 text-base">
                            {view.name}
                            <Badge variant="outline">
                              {t(`reports:tiers.${view.layout}`)}
                            </Badge>
                          </CardTitle>
                        </CardHeader>
                      </Card>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}
