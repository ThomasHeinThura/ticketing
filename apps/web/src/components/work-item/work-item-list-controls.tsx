import { Button } from "@taskdesk/ui";
import { saveAs } from "file-saver";
import { ArrowLeft, ArrowRight, Download } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { exportWorkItems } from "@/fetchers/work-item/export-work-items";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { HttpError } from "@/lib/http-error";
import {
  WORK_ITEM_SEARCH_COLUMNS,
  type WorkItemFilterMode,
  type WorkItemSearchColumn,
  type WorkItemSortDirection,
  type WorkItemSortField,
} from "@/lib/routes";
import { workItemSearchErrorMessage } from "@/lib/work-item-search-error";

const WorkItemFilterEditor = lazy(
  () => import("@/components/work-item/work-item-filter-editor"),
);

const DEFAULT_TABLE_COLUMNS: readonly WorkItemSearchColumn[] = [
  "key",
  "title",
  "priority",
  "dueDate",
  "state",
  "assignee",
];

const COLUMN_LABEL_KEYS: Record<WorkItemSearchColumn, string> = {
  key: "workItems:list.columnKey",
  title: "workItems:list.columnTitle",
  state: "workItems:list.columnState",
  assignee: "workItems:list.columnAssignee",
  priority: "workItems:list.columnPriority",
  dueDate: "workItems:list.columnDueDate",
};

/**
 * The structured filter, column selection (`VW-19`) and CSV export (`D1` / `AU-14`) controls
 * of the work route (`SV-11`, `VW-1`).
 */
export default function WorkItemListControls({
  filter,
  mode,
  workItemsError,
  autoFocus = false,
  onClose,
  onModeChange,
  onApply,
  columns,
  onColumnsChange,
  workspaceId,
  projectSlug,
  sort = "key",
  dir = "asc",
}: {
  filter: string;
  mode: WorkItemFilterMode;
  workItemsError?: unknown;
  /** Move focus into the editor once it has loaded (the user just opened it). */
  autoFocus?: boolean;
  /** Escape in the editor closes it. */
  onClose?: () => void;
  onModeChange: (mode: WorkItemFilterMode) => void;
  onApply: (filter: string) => void;
  columns?: WorkItemSearchColumn[];
  onColumnsChange?: (columns: WorkItemSearchColumn[] | undefined) => void;
  workspaceId?: string;
  projectSlug?: string;
  sort?: WorkItemSortField;
  dir?: WorkItemSortDirection;
}) {
  const { t } = useTranslation();
  const { canExportTasks, isCheckingPermissions } = useWorkspacePermission();
  const canExport =
    !isCheckingPermissions &&
    canExportTasks() &&
    Boolean(workspaceId && projectSlug);
  const [exportPending, setExportPending] = useState(false);
  const [exportError, setExportError] = useState<string>();

  // The server's own wording (and its field names) stay out of the UI: each refusal the
  // endpoint documents maps to one translated message.
  const apiError =
    workItemsError instanceof HttpError
      ? workItemSearchErrorMessage(workItemsError.status, t)
      : undefined;

  const selectedColumns: WorkItemSearchColumn[] = columns?.length
    ? columns
    : [...DEFAULT_TABLE_COLUMNS];

  const handleToggleColumn = (column: WorkItemSearchColumn) => {
    if (!onColumnsChange) return;
    const pressed = selectedColumns.includes(column);
    if (pressed && selectedColumns.length === 1) return;
    const next = pressed
      ? selectedColumns.filter((value) => value !== column)
      : [...selectedColumns, column];
    onColumnsChange(next);
  };

  const handleMoveColumn = (index: number, delta: -1 | 1) => {
    if (!onColumnsChange) return;
    const targetIndex = index + delta;
    if (targetIndex < 0 || targetIndex >= selectedColumns.length) return;
    const next = [...selectedColumns];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(targetIndex, 0, moved);
    onColumnsChange(next);
  };

  const handleExport = async () => {
    if (!workspaceId || !projectSlug || exportPending) return;
    setExportPending(true);
    setExportError(undefined);
    try {
      const csv = await exportWorkItems({
        workspaceId,
        projectSlug,
        filter: filter.trim() || undefined,
        sort,
        dir,
        columns,
      });
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      saveAs(blob, `${projectSlug.toLowerCase()}-work-items.csv`);
    } catch (error) {
      if (error instanceof HttpError && error.status === 422) {
        setExportError(t("workItems:list.exportLimitExceeded"));
      } else if (error instanceof HttpError && error.status === 429) {
        setExportError(t("workItems:list.exportRateLimited"));
      } else {
        setExportError(t("workItems:list.exportFailed"));
      }
    } finally {
      setExportPending(false);
    }
  };

  return (
    <div className="grid gap-3">
      <Suspense
        fallback={
          <div
            className="h-12 rounded-md border bg-muted/30"
            role="status"
            aria-busy="true"
            aria-live="polite"
            data-testid="work-item-filter-loading"
          >
            <span className="sr-only">{t("workItems:filter.loading")}</span>
          </div>
        }
      >
        <WorkItemFilterEditor
          filter={filter}
          mode={mode}
          apiError={apiError}
          autoFocus={autoFocus}
          onClose={onClose}
          onModeChange={onModeChange}
          onApply={onApply}
        />
      </Suspense>
      {onColumnsChange ? (
        <fieldset
          className="grid gap-2 rounded-md border border-border p-3"
          data-testid="work-item-column-controls"
        >
          <legend className="px-1 font-medium text-sm">
            {t("workItems:list.columnsLabel")}
          </legend>
          <div className="flex flex-wrap items-center gap-2">
            {WORK_ITEM_SEARCH_COLUMNS.map((column) => {
              const pressed = selectedColumns.includes(column);
              const index = selectedColumns.indexOf(column);
              const label = t(COLUMN_LABEL_KEYS[column]);
              return (
                <div key={column} className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={pressed ? "secondary" : "outline"}
                    aria-pressed={pressed}
                    disabled={pressed && selectedColumns.length === 1}
                    onClick={() => handleToggleColumn(column)}
                  >
                    {label}
                  </Button>
                  {pressed && selectedColumns.length > 1 ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={t("workItems:list.moveColumnLeft", {
                          column: label,
                        })}
                        disabled={index <= 0}
                        onClick={() => handleMoveColumn(index, -1)}
                      >
                        <ArrowLeft />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={t("workItems:list.moveColumnRight", {
                          column: label,
                        })}
                        disabled={index === selectedColumns.length - 1}
                        onClick={() => handleMoveColumn(index, 1)}
                      >
                        <ArrowRight />
                      </Button>
                    </>
                  ) : null}
                </div>
              );
            })}
            {columns?.length ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onColumnsChange(undefined)}
              >
                {t("workItems:list.resetColumns")}
              </Button>
            ) : null}
          </div>
        </fieldset>
      ) : null}
      {canExport ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={exportPending}
            data-testid="work-item-export-csv"
            onClick={() => void handleExport()}
          >
            <Download />
            {exportPending
              ? t("workItems:list.exportingCsv")
              : t("workItems:list.exportCsv")}
          </Button>
          {exportError ? (
            <p
              className="text-destructive text-sm"
              role="alert"
              data-testid="work-item-export-error"
            >
              {exportError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
