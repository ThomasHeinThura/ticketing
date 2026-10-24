import { Button } from "@taskdesk/ui";
import { Download } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type DashboardWidget, exportWidget } from "@/fetchers/report";
import { DashboardWidgetCard } from "./dashboard-widget";
import { WidgetDrillDialog } from "./report-drill";
import { useExportAction } from "./report-export";

/**
 * A widget on a dashboard that is being viewed: the card plus what only a viewer needs, an export
 * (`RP-10`, only with `report:export`) and the drill-down behind its rows (`RP-12`). The layout
 * editor renders the bare card instead, so neither competes with dragging.
 */
export function LiveWidgetCard({
  workspaceId,
  dashboardId,
  version,
  widget,
  canExport,
}: {
  workspaceId: string;
  dashboardId: string;
  version: number;
  widget: DashboardWidget;
  canExport: boolean;
}) {
  const { t } = useTranslation();
  const exporting = useExportAction(() => exportWidget(dashboardId, widget.id));
  const [drilling, setDrilling] = useState<string | null>(null);
  return (
    <>
      <DashboardWidgetCard
        workspaceId={workspaceId}
        dashboardId={dashboardId}
        version={version}
        widget={widget}
        onDrill={setDrilling}
        footer={exporting.panel}
        headerAction={
          canExport
            ? (title) => (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t("reports:dashboard.exportWidget", { title })}
                  disabled={exporting.pending}
                  onClick={exporting.run}
                >
                  <Download aria-hidden="true" />
                </Button>
              )
            : undefined
        }
      />
      {drilling ? (
        <WidgetDrillDialog
          workspaceId={workspaceId}
          dashboardId={dashboardId}
          widgetId={widget.id}
          handle={drilling}
          onClose={() => setDrilling(null)}
        />
      ) : null}
    </>
  );
}
