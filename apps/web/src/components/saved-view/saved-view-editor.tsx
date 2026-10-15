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
import {
  WORK_ITEM_SEARCH_COLUMNS,
  WORK_ITEM_SEARCH_SORT_FIELDS,
  type WorkItemFilterMode,
  type WorkItemSearchColumn,
  type WorkItemSearchSortField,
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
}: {
  name: string;
  onNameChange: (name: string) => void;
  visibility: SavedViewVisibility;
  teamId: string;
  onVisibilityChange: (visibility: SavedViewVisibility) => void;
  onTeamChange: (teamId: string) => void;
  canShare: boolean;
  canManageSettings: boolean;
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
    filter: string;
    filterMode: WorkItemFilterMode;
    columns: WorkItemSearchColumn[] | undefined;
    onSortChange: (
      sort: WorkItemSearchSortField,
      dir: WorkItemSortDirection,
    ) => void;
    onFilterModeChange: (mode: WorkItemFilterMode) => void;
    onFilterApply: (filter: string) => void;
    onColumnsChange: (columns: WorkItemSearchColumn[]) => void;
  };
}) {
  const { t } = useTranslation("savedViews");
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
            <div className="flex flex-wrap gap-3">
              <Select
                value={query.sort}
                items={WORK_ITEM_SEARCH_SORT_FIELDS.map((field) => ({
                  value: field,
                  label: t(`sortField.${field}`),
                }))}
                onValueChange={(value) =>
                  value &&
                  query.onSortChange(
                    value as WorkItemSearchSortField,
                    query.dir,
                  )
                }
              >
                <SelectTrigger aria-label={t("sort")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {WORK_ITEM_SEARCH_SORT_FIELDS.map((field) => (
                    <SelectItem key={field} value={field}>
                      {t(`sortField.${field}`)}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <Select
                value={query.dir}
                items={[
                  { value: "asc", label: t("direction.asc") },
                  { value: "desc", label: t("direction.desc") },
                ]}
                onValueChange={(value) =>
                  value &&
                  query.onSortChange(query.sort, value as WorkItemSortDirection)
                }
              >
                <SelectTrigger aria-label={t("directionLabel")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="asc">{t("direction.asc")}</SelectItem>
                  <SelectItem value="desc">{t("direction.desc")}</SelectItem>
                </SelectPopup>
              </Select>
            </div>
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
                      disabled={pressed && selected.length === 1}
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
