import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@taskdesk/ui";
import { ChevronDown, ChevronUp, Columns3, Download } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import WorkItemFilterBar from "@/components/work-item/work-item-filter-bar";
import { downloadWorkItemsCsv } from "@/fetchers/work-item/export-work-items";
import { useCustomFields } from "@/hooks/queries/custom-field/use-custom-fields";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { HttpError } from "@/lib/http-error";
import {
  type NativeWorkItemSearchColumn,
  WORK_ITEM_SEARCH_COLUMNS,
  type WorkItemFilterMode,
  type WorkItemSearchColumn,
  type WorkItemSortDirection,
  type WorkItemSortField,
} from "@/lib/routes";
import { workItemSearchErrorMessage } from "@/lib/work-item-search-error";

const DEFAULT_TABLE_COLUMNS: readonly WorkItemSearchColumn[] = [
  "key",
  "title",
  "priority",
  "dueDate",
  "state",
  "assignee",
];

const COLUMN_LABEL_KEYS: Record<NativeWorkItemSearchColumn, string> = {
  key: "workItems:list.columnKey",
  title: "workItems:list.columnTitle",
  state: "workItems:list.columnState",
  assignee: "workItems:list.columnAssignee",
  priority: "workItems:list.columnPriority",
  dueDate: "workItems:list.columnDueDate",
};

/**
 * The filter chip bar, column selection (`VW-19`) and CSV export (`D1` / `AU-14`) controls
 * of the work route in one toolbar row (`SV-11`, `VW-1`).
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
  onApply: (filter: string, options?: { replace?: boolean }) => void;
  columns?: WorkItemSearchColumn[];
  onColumnsChange?: (columns: WorkItemSearchColumn[] | undefined) => void;
  workspaceId?: string;
  projectSlug?: string;
  sort?: WorkItemSortField;
  dir?: WorkItemSortDirection;
}) {
  const { t } = useTranslation();
  const { canExportTasks, isCheckingPermissions } = useWorkspacePermission();
  const customFieldsQuery = useCustomFields(
    onColumnsChange ? (workspaceId ?? "") : "",
  );
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
    if (!pressed && selectedColumns.length >= 100) return;
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
      await downloadWorkItemsCsv({
        workspaceId,
        projectSlug,
        filter: filter.trim() || undefined,
        sort,
        dir,
        columns,
      });
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

  const customColumns = (customFieldsQuery.data?.data ?? [])
    .filter(
      (field) =>
        !field.deletedAt && field.visibility.some((row) => row.visible),
    )
    .map((field) => ({
      column: `cf.${field.key}` as WorkItemSearchColumn,
      label: field.name,
    }));
  const labels = new Map<WorkItemSearchColumn, string>([
    ...WORK_ITEM_SEARCH_COLUMNS.map(
      (column) => [column, t(COLUMN_LABEL_KEYS[column])] as const,
    ),
    ...customColumns.map(({ column, label }) => [column, label] as const),
  ]);
  // Visible columns first, in their order, then the hidden ones.
  const columnRows = [
    ...selectedColumns,
    ...[...labels.keys()].filter((column) => !selectedColumns.includes(column)),
  ];

  return (
    <div className="grid min-w-0 max-w-full gap-1">
      <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
        <WorkItemFilterBar
          filter={filter}
          mode={mode}
          apiError={apiError}
          autoFocus={autoFocus}
          onClose={onClose}
          onModeChange={onModeChange}
          onApply={onApply}
        />
        {onColumnsChange ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="shrink-0"
              >
                <Columns3 />
                {t("workItems:list.columnsLabel")}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-72 max-w-[calc(100vw-2rem)] p-1"
              aria-label={t("workItems:list.columnsLabel")}
              data-testid="work-item-column-controls"
            >
              <ul className="m-0 grid max-h-80 list-none gap-0.5 overflow-y-auto p-0">
                {columnRows.map((column) => {
                  const index = selectedColumns.indexOf(column);
                  const pressed = index >= 0;
                  const label = labels.get(column) ?? column;
                  return (
                    <li key={column} className="flex items-center gap-1 px-1">
                      <Label className="flex min-w-0 flex-1 items-center gap-2 py-1 text-sm">
                        <Checkbox
                          checked={pressed}
                          disabled={
                            (pressed && selectedColumns.length === 1) ||
                            (!pressed && selectedColumns.length >= 100)
                          }
                          onCheckedChange={() => handleToggleColumn(column)}
                        />
                        <span className="truncate">{label}</span>
                      </Label>
                      {pressed ? (
                        <>
                          <Button
                            type="button"
                            size="icon-xs"
                            variant="ghost"
                            aria-label={t("workItems:list.moveColumnUp", {
                              column: label,
                            })}
                            disabled={index === 0}
                            onClick={() => handleMoveColumn(index, -1)}
                          >
                            <ChevronUp />
                          </Button>
                          <Button
                            type="button"
                            size="icon-xs"
                            variant="ghost"
                            aria-label={t("workItems:list.moveColumnDown", {
                              column: label,
                            })}
                            disabled={index === selectedColumns.length - 1}
                            onClick={() => handleMoveColumn(index, 1)}
                          >
                            <ChevronDown />
                          </Button>
                        </>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {columns?.length ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="mt-1 w-full justify-start"
                  onClick={() => onColumnsChange(undefined)}
                >
                  {t("workItems:list.resetColumns")}
                </Button>
              ) : null}
            </PopoverContent>
          </Popover>
        ) : null}
        {canExport ? (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="shrink-0"
            disabled={exportPending}
            data-testid="work-item-export-csv"
            onClick={() => void handleExport()}
          >
            <Download />
            {exportPending
              ? t("workItems:list.exportingCsv")
              : t("workItems:list.exportCsv")}
          </Button>
        ) : null}
      </div>
      {exportError ? (
        <Alert
          variant="error"
          role="alert"
          data-testid="work-item-export-error"
        >
          <AlertDescription>{exportError}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
