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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@taskdesk/ui";
import { Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
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

/**
 * `docs/screens.md` "Dashboard": the viewer's dashboards and the workspace's, a grid of widgets
 * (`RP-13`). A new person lands on the default dashboard, not an empty grid (`RP-16`).
 */
export function DashboardView({
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
  const catalogue = useReportCatalogue(workspaceId);
  const wide = useWideGrid();
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
              <Select
                value={chosen?.id ?? ""}
                onValueChange={(id) => id && onSearchChange({ id })}
              >
                <SelectTrigger
                  aria-label={t("reports:dashboard.choose")}
                  className="w-56"
                >
                  <SelectValue>{chosen?.name ?? ""}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {list.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.name}
                      {entry.scope === "workspace"
                        ? ` (${t("reports:dashboard.workspaceScope")})`
                        : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
        {dashboards.isLoading || !workspace ? (
          <Skeleton className="h-48 w-full" />
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
        ) : dashboard.isLoading ? (
          <Skeleton className="h-48 w-full" />
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
              <DashboardGrid wide={wide} data-testid="dashboard-grid">
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
