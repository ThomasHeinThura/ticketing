import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Skeleton,
  useDelayedPending,
} from "@taskdesk/ui";
import { Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PickerPopover } from "@/components/common/picker-popover";
import PageTitle from "@/components/page-title";
import {
  useDashboard,
  useDashboards,
  useReportCatalogue,
} from "@/hooks/queries/report";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import type { DashboardSearch } from "@/lib/report-search";
import { routes } from "@/lib/routes";
import {
  DashboardGrid,
  gridItemStyle,
  readingOrder,
  useWideGrid,
} from "./dashboard-grid";
import { LiveWidgetCard } from "./dashboard-widget-live";
import { ReportError } from "./report-detail";
import { ReportsFeatureGate } from "./reports-feature-gate";

/**
 * `docs/screens.md` "Dashboard": the viewer's dashboards and the workspace's, a grid of widgets
 * (`RP-13`). A new person lands on the default dashboard, not an empty grid (`RP-16`).
 */
export function DashboardView(props: {
  search: DashboardSearch;
  onSearchChange: (next: DashboardSearch) => void;
}) {
  const { t } = useTranslation();
  return (
    <ReportsFeatureGate title={t("reports:dashboard.title")}>
      <DashboardViewScreen {...props} />
    </ReportsFeatureGate>
  );
}

// Rendered once `feature.reports` is on, or its read failed and the APIs answer (the gate).
function DashboardViewScreen({
  search,
  onSearchChange,
}: {
  search: DashboardSearch;
  onSearchChange: (next: DashboardSearch) => void;
}) {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";
  const dashboards = useDashboards(workspaceId);
  const list = dashboards.data?.data ?? [];
  const chosen =
    list.find((entry) => entry.id === search.id) ??
    list.find((entry) => entry.isDefault) ??
    list[0];
  const dashboard = useDashboard(workspaceId, chosen?.id ?? "");
  const dashboardsPlaceholder = useDelayedPending(
    dashboards.isLoading || !workspace,
  );
  const dashboardPlaceholder = useDelayedPending(dashboard.isLoading);
  const catalogue = useReportCatalogue(workspaceId);
  const { wide, measureRef } = useWideGrid();
  return (
    <>
      <PageTitle title={t("reports:dashboard.title")} />
      <div className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="font-semibold text-2xl">
              {t("reports:dashboard.title")}
            </h1>
            <p className="max-w-2xl text-muted-foreground text-sm">
              {t("reports:dashboard.description")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {list.length > 0 ? (
              <PickerPopover
                value={chosen?.id ?? ""}
                onChange={(id) => id && onSearchChange({ id })}
                ariaLabel={t("reports:dashboard.choose")}
                className="w-56"
                options={list.map((entry) => ({
                  value: entry.id,
                  label: `${entry.name}${
                    entry.scope === "workspace"
                      ? ` (${t("reports:dashboard.workspaceScope")})`
                      : ""
                  }`,
                }))}
              />
            ) : null}
            <Button
              variant="outline"
              render={
                <Link
                  to={routes.agentDashboardEdit.path}
                  search={chosen ? { id: chosen.id } : {}}
                />
              }
            >
              <Pencil aria-hidden="true" />
              {chosen?.canEdit
                ? t("reports:dashboard.edit")
                : t("reports:dashboard.manage")}
            </Button>
          </div>
        </div>
        {!dashboards.isError &&
        (dashboards.isLoading || !workspace || dashboardsPlaceholder) ? (
          <Skeleton
            className="h-48 w-full"
            style={{ visibility: dashboardsPlaceholder ? "visible" : "hidden" }}
          />
        ) : dashboards.isError ? (
          <ReportError error={dashboards.error} />
        ) : !chosen ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t("reports:dashboard.noneTitle")}</EmptyTitle>
              <EmptyDescription>
                {t("reports:dashboard.noneDescription")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : !dashboard.isError &&
          (dashboard.isLoading || dashboardPlaceholder) ? (
          <Skeleton
            className="h-48 w-full"
            style={{ visibility: dashboardPlaceholder ? "visible" : "hidden" }}
          />
        ) : dashboard.isError || !dashboard.data ? (
          <ReportError error={dashboard.error} />
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <span>{dashboard.data.name}</span>
              <Badge variant="outline">
                {dashboard.data.scope === "workspace"
                  ? t("reports:dashboard.workspaceScope")
                  : t("reports:dashboard.personalScope")}
              </Badge>
            </div>
            {dashboard.data.widgets.length === 0 ? (
              <Alert variant="info">
                <AlertDescription>
                  {t("reports:dashboard.emptyGrid")}
                </AlertDescription>
              </Alert>
            ) : (
              <DashboardGrid
                wide={wide}
                measureRef={measureRef}
                data-testid="dashboard-grid"
              >
                {readingOrder(dashboard.data.widgets).map((widget) => (
                  <div
                    key={widget.id}
                    style={gridItemStyle(widget, wide)}
                    className="min-w-0"
                  >
                    <LiveWidgetCard
                      workspaceId={workspaceId}
                      dashboardId={dashboard.data.id}
                      version={dashboard.data.version}
                      widget={widget}
                      canExport={catalogue.data?.meta.canExport === true}
                    />
                  </div>
                ))}
              </DashboardGrid>
            )}
          </div>
        )}
      </div>
    </>
  );
}
