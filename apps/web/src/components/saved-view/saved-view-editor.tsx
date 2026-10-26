import {
  Button,
  Card,
  CardContent,
  Input,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@taskdesk/ui";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { SavedViewAudienceFields } from "@/components/saved-view/saved-view-audience-fields";
import type {
  SavedViewVisibility,
  ShareableViewTeam,
} from "@/fetchers/saved-views";
import { useCustomFields } from "@/hooks/queries/custom-field/use-custom-fields";
import {
  isWorkItemSearchSortField,
  WORK_ITEM_SEARCH_COLUMNS,
  WORK_ITEM_SEARCH_SORT_FIELDS,
  type WorkItemFilterMode,
  type WorkItemSearchColumn,
  type WorkItemSearchSortField,
  type WorkItemSort,
  type WorkItemSortDirection,
} from "@/lib/routes";

// The same filter editor the work list uses (`SV-11`): one AST, two renderings.
const WorkItemFilterEditor = lazy(
  () => import("@/components/work-item/work-item-filter-editor"),
);

/** The columns shown when a view stored none, in the list's own default order. */
export const DEFAULT_SAVED_VIEW_COLUMNS: WorkItemSearchColumn[] = [
  "key",
  "title",
  "priority",
  "dueDate",
  "state",
  "assignee",
];

/**
 * The saved-view editor: name, audience and -- unless the stored query is one this screen
 * cannot run -- the query itself (sort, filter, columns). A view whose query or layout is not
 * supported here can still be renamed and re-shared; its stored query is never rewritten.
 */
export function SavedViewEditor({
  name,
  onNameChange,
  visibility,
  teamId,
  onVisibilityChange,
  onTeamChange,
  canShare,
  canManageSettings,
  currentVisibility,
  teams,
  query,
  workspaceId,
}: {
  name: string;
  onNameChange: (name: string) => void;
  visibility: SavedViewVisibility;
  teamId: string;
  onVisibilityChange: (visibility: SavedViewVisibility) => void;
  onTeamChange: (teamId: string) => void;
  canShare: boolean;
  canManageSettings: boolean;
  workspaceId?: string;
  currentVisibility?: SavedViewVisibility;
  teams: {
    data: ShareableViewTeam[] | undefined;
    isLoading: boolean;
    isError: boolean;
  };
  /** Absent when the stored query cannot be edited here. */
  query?: {
    sort: WorkItemSearchSortField;
    dir: WorkItemSortDirection;
    sorts: WorkItemSort[];
    filter: string;
    filterMode: WorkItemFilterMode;
    columns: WorkItemSearchColumn[] | undefined;
    onSortChange: (
      sort: WorkItemSearchSortField,
      dir: WorkItemSortDirection,
    ) => void;
    onSortsChange: (sorts: WorkItemSort[]) => void;
    onFilterModeChange: (mode: WorkItemFilterMode) => void;
    onFilterApply: (filter: string) => void;
    onColumnsChange: (columns: WorkItemSearchColumn[]) => void;
  };
}) {
  const { t } = useTranslation("savedViews");
  const customFields = useCustomFields(workspaceId ?? "");
  const selectedColumns = query?.columns ?? WORK_ITEM_SEARCH_COLUMNS;
  const availableSortFields = [
    ...WORK_ITEM_SEARCH_SORT_FIELDS.filter((field) =>
      selectedColumns.includes(field),
    ),
    ...(customFields.data?.data ?? [])
      .filter((field) =>
        selectedColumns.some((column) => column === `cf.${field.key}`),
      )
      .map((field) => `cf.${field.key}` as WorkItemSearchSortField),
  ];
  return (
    <Card>
      <CardContent className="grid gap-4 py-4">
        <Input
          aria-label={t("name")}
          value={name}
          maxLength={200}
          onChange={(event) => onNameChange(event.target.value)}
        />
        <SavedViewAudienceFields
          visibility={visibility}
          teamId={teamId}
          onVisibilityChange={onVisibilityChange}
          onTeamChange={onTeamChange}
          canShare={canShare}
          canManageSettings={canManageSettings}
          currentVisibility={currentVisibility}
          teams={teams}
        />
        {query ? (
          <>
            {query.sorts.map((sort, index) => {
              const fields = [sort.field, ...availableSortFields]
                .filter(isWorkItemSearchSortField)
                .filter(
                  (field) =>
                    !query.sorts.some(
                      (entry, entryIndex) =>
                        entryIndex !== index && entry.field === field,
                    ),
                );
              const fieldLabel = (field: WorkItemSearchSortField) =>
                field.startsWith("cf.")
                  ? (customFields.data?.data.find(
                      (candidate) => `cf.${candidate.key}` === field,
                    )?.name ?? t("sort"))
                  : t(`sortField.${field}`);
              return (
                <div
                  className="flex flex-wrap items-center gap-3"
                  key={sort.field}
                >
                  <Select
                    value={sort.field}
                    items={fields.map((field) => ({
                      value: field,
                      label: fieldLabel(field),
                    }))}
                    onValueChange={(value) => {
                      if (!value) return;
                      query.onSortsChange(
                        query.sorts.map((entry, entryIndex) =>
                          entryIndex === index
                            ? {
                                ...entry,
                                field: value as WorkItemSearchSortField,
                              }
                            : entry,
                        ),
                      );
                    }}
                  >
                    <SelectTrigger aria-label={t("sort")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      {fields.map((field) => (
                        <SelectItem key={field} value={field}>
                          {fieldLabel(field)}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                  <Select
                    value={sort.order}
                    items={[
                      { value: "asc", label: t("direction.asc") },
                      { value: "desc", label: t("direction.desc") },
                    ]}
                    onValueChange={(value) => {
                      if (!value) return;
                      query.onSortsChange(
                        query.sorts.map((entry, entryIndex) =>
                          entryIndex === index
                            ? {
                                ...entry,
                                order: value as WorkItemSortDirection,
                              }
                            : entry,
                        ),
                      );
                    }}
                  >
                    <SelectTrigger aria-label={t("directionLabel")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="asc">{t("direction.asc")}</SelectItem>
                      <SelectItem value="desc">
                        {t("direction.desc")}
                      </SelectItem>
                    </SelectPopup>
                  </Select>
                  {query.sorts.length > 1 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t("removeSort", { priority: index + 1 })}
                      onClick={() =>
                        query.onSortsChange(
                          query.sorts.filter(
                            (_, entryIndex) => entryIndex !== index,
                          ),
                        )
                      }
                    >
                      {t("common:actions.remove")}
                    </Button>
                  ) : null}
                </div>
              );
            })}
            {query.sorts.length < 5 ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const available = availableSortFields.find(
                    (field) =>
                      !query.sorts.some((sort) => sort.field === field),
                  );
                  if (available)
                    query.onSortsChange([
                      ...query.sorts,
                      { field: available, order: "asc" },
                    ]);
                }}
                disabled={query.sorts.length >= availableSortFields.length}
              >
                {t("addSort")}
              </Button>
            ) : null}
            <Suspense fallback={null}>
              <WorkItemFilterEditor
                filter={query.filter}
                mode={query.filterMode}
                fallbackSurface="card"
                onModeChange={query.onFilterModeChange}
                onApply={query.onFilterApply}
              />
            </Suspense>
            <fieldset className="grid gap-2">
              <legend className="font-medium text-sm">{t("columns")}</legend>
              <div className="flex flex-wrap gap-2">
                {WORK_ITEM_SEARCH_COLUMNS.map((column) => {
                  const selected = query.columns ?? DEFAULT_SAVED_VIEW_COLUMNS;
                  const pressed = selected.includes(column);
                  return (
                    <Button
                      key={column}
                      type="button"
                      variant={pressed ? "default" : "outline"}
                      aria-pressed={pressed}
                      // A view always shows at least one column.
                      disabled={
                        (pressed && selected.length === 1) ||
                        (!pressed && selected.length >= 100)
                      }
                      onClick={() =>
                        query.onColumnsChange(
                          pressed
                            ? selected.filter((value) => value !== column)
                            : [...selected, column],
                        )
                      }
                    >
                      {t(`columnName.${column}`)}
                    </Button>
                  );
                })}
                {(customFields.data?.data ?? [])
                  .filter(
                    (field) =>
                      !field.deletedAt &&
                      field.visibility.some((row) => row.visible),
                  )
                  .map((field) => {
                    const column = `cf.${field.key}` as WorkItemSearchColumn;
                    const selected =
                      query.columns ?? DEFAULT_SAVED_VIEW_COLUMNS;
                    const pressed = selected.includes(column);
                    return (
                      <Button
                        key={column}
                        type="button"
                        variant={pressed ? "default" : "outline"}
                        aria-pressed={pressed}
                        disabled={
                          (pressed && selected.length === 1) ||
                          (!pressed && selected.length >= 100)
                        }
                        onClick={() =>
                          query.onColumnsChange(
                            pressed
                              ? selected.filter((value) => value !== column)
                              : [...selected, column],
                          )
                        }
                      >
                        {field.name}
                      </Button>
                    );
                  })}
              </div>
            </fieldset>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            {t("queryNotEditable")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
