import { Button } from "@taskdesk/ui";
import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { downloadWorkItemsCsv } from "@/fetchers/work-item/export-work-items";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";
import type { Project } from "@/types/project";

type TasksImportExportProps = {
  project: Pick<Project, "workspaceId" | "slug">;
};

/**
 * A-16: export the project's real work items through the audited work-item export
 * (`work_item:export`). The legacy task export read an empty table and always gave 0 items.
 *
 * The legacy JSON import (`POST /api/task/import`) is no longer offered here: it wrote rows into
 * the legacy `task` table, which nothing projects into `work_item`, so an import reported success
 * while no work item appeared. It returns when an import exists on the work-item create path.
 */
export function TasksImportExport({ project }: TasksImportExportProps) {
  const { t } = useTranslation();
  const [isExporting, setIsExporting] = useState(false);
  const { canExportTasks } = useWorkspacePermission();

  const handleExport = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      toast.loading(t("settings:tasksImportExport.exporting"));
      await downloadWorkItemsCsv({
        workspaceId: project.workspaceId,
        projectSlug: project.slug,
        sort: "key",
        dir: "asc",
      });

      toast.dismiss();
      toast.success(t("settings:tasksImportExport.exportSuccess"));
    } catch (error) {
      toast.dismiss();
      toast.error(
        error instanceof HttpError && error.status === 422
          ? t("workItems:list.exportLimitExceeded")
          : error instanceof HttpError && error.status === 429
            ? t("workItems:list.exportRateLimited")
            : t("settings:tasksImportExport.exportError"),
      );
    } finally {
      setIsExporting(false);
    }
  };

  if (!canExportTasks()) return null;

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleExport}
        disabled={isExporting}
      >
        {isExporting ? <Loader2 className="animate-spin" /> : <Download />}
        {t("settings:tasksImportExport.exportTasks")}
      </Button>
    </div>
  );
}
