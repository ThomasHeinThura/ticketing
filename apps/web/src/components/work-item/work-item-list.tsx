import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Info,
  ListTodo,
  TriangleAlert,
} from "lucide-react";
import {
  type FocusEvent,
  lazy,
  type MouseEvent,
  memo,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { ActionTooltip } from "@/components/common/action-tooltip";
import useRestoreWorkItem from "@/hooks/mutations/work-item/use-restore-work-item";
import { useProjectViewPreferenceWithSave } from "@/hooks/use-project-view-preference-with-save";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { formatValue } from "@/lib/custom-field";
import { formatDateShort } from "@/lib/format";
import { getPriorityIcon } from "@/lib/priority";
import {
  type NativeWorkItemSearchColumn,
  routes,
  toggleWorkItemSortDirection,
  type WorkItemSearchColumn,
  type WorkItemSort,
  type WorkItemSortDirection,
  type WorkItemSortField,
} from "@/lib/routes";
import { toast } from "@/lib/toast";
import {
  assigneeDisplayText,
  resolveAssigneeDisplay,
} from "@/lib/work-item-assignee-display";
import {
  parseTableColumnWidths,
  type TableColumnWidths,
} from "@/lib/work-item-column-widths";
import type {
  WorkItemCustomFieldColumn,
  WorkItemCustomFieldPerson,
  WorkItemField,
  WorkItemRow,
} from "@/types/work-item";
import loadWorkItemTable from "./load-work-item-table";
import { WorkItemBlockedBadge } from "./work-item-blocked-badge";
import WorkItemColumnResizeHandle from "./work-item-column-resize-handle";
import WorkItemListLoading from "./work-item-list-loading";

const SelectionCheckbox = lazy(() => import("./selection-checkbox"));
// biome-ignore format: the contrast gate reads the lazy loader binding from a one-line `lazy(loader)`
const VirtualizedWorkItemTable = lazy(loadWorkItemTable) as unknown as typeof import("./work-item-table").default;
const WorkItemInlineFields = lazy(() => import("./work-item-inline-fields"));

type WorkItemInlineControls = {
  stateControl: ReactNode;
  priorityControl: ReactNode;
  assigneeControl: ReactNode;
  titleControl: ReactNode;
  titleEditor: ReactNode;
  dueDateControl: ReactNode;
  customFieldControls: Record<string, ReactNode>;
};

export type WorkItemListProps = {
  /** Present only for a project-scoped table; other list surfaces resize locally. */
  projectId?: string;
  workItems: WorkItemRow[] | undefined;
  /** Precomputed by the validated fetcher so rendering does not rescan every row. */
  hasPartialFailure: boolean;
  isLoading: boolean;
  isError: boolean;
  sort: WorkItemSortField;
  dir: WorkItemSortDirection;
  sorts?: WorkItemSort[];
  onSortChange: (sort: WorkItemSortField, dir: WorkItemSortDirection) => void;
  onSortsChange?: (sorts: WorkItemSort[]) => void;
  onRetry: () => void;
  /**
   * The chosen columns in display order (`columns` in the URL / saved query, `VW-19`).
   * Absent means every column in the default order, so an unconfigured list is unchanged.
   */
  columns?: WorkItemSearchColumn[];
  customFieldColumns?: WorkItemCustomFieldColumn[];
  customFieldPeople?: WorkItemCustomFieldPerson[];
  /** A structured filter is applied, so an empty result means "no match", not "no items". */
  isFiltered?: boolean;
  /** Overrides the empty-state copy where the project-scoped default is wrong (cross-project pages). */
  emptyTitle?: string;
  emptyDescription?: string;
  /** More matching pages exist; the list offers to load them. */
  hasMore?: boolean;
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
  isLoadMoreError?: boolean;
  isCursorChanged?: boolean;
  onRestartFromFirstPage?: () => void;
  isPlaceholderData?: boolean;
  /** Keys currently selected for a bulk action (`VW-3`). */
  selectedKeys?: string[];
  onSelectionChange?: (key: string, checked: boolean) => void;
  onSelectAll?: (checked: boolean) => void;
  /** The strict `assignTasks` capability. Selection controls are not rendered without it. */
  canBulkAssign?: boolean;
  onOpenItem?: (key: string) => void;
};

type ResizeProps = {
  columnWidths: TableColumnWidths;
  resizeEnabled: boolean;
  isSavingWidths?: boolean;
  widthSaveError?: boolean;
  onColumnWidthPreview: (column: WorkItemSearchColumn, width: number) => void;
  onColumnWidthCommit: (
    column: WorkItemSearchColumn,
    width: number,
    originalWidth: number,
  ) => void | Promise<void>;
  onColumnWidthCancel: (
    column: WorkItemSearchColumn,
    originalWidth: number,
  ) => void;
};

function LocalResizeController(props: WorkItemListProps) {
  const [columnWidths, setColumnWidths] = useState<TableColumnWidths>({});
  const [previewWidths, setPreviewWidths] = useState<TableColumnWidths>();
  const currentWidths = previewWidths ?? columnWidths;
  const onColumnWidthPreview = useCallback(
    (column: WorkItemSearchColumn, width: number) =>
      setPreviewWidths((previous) => ({
        ...(previous ?? columnWidths),
        [column]: width,
      })),
    [columnWidths],
  );
  const onColumnWidthCommit = useCallback(
    (column: WorkItemSearchColumn, width: number) => {
      setColumnWidths((previous) => ({
        ...(previewWidths ?? previous),
        [column]: width,
      }));
      setPreviewWidths(undefined);
    },
    [previewWidths],
  );
  const onColumnWidthCancel = useCallback(
    () => setPreviewWidths(undefined),
    [],
  );
  return (
    <WorkItemListPresentation
      {...props}
      columnWidths={currentWidths}
      resizeEnabled
      onColumnWidthPreview={onColumnWidthPreview}
      onColumnWidthCommit={onColumnWidthCommit}
      onColumnWidthCancel={onColumnWidthCancel}
    />
  );
}

function ProjectResizeController(
  props: WorkItemListProps & { projectId: string },
) {
  const preference = useProjectViewPreferenceWithSave({
    projectId: props.projectId,
    name: "columnWidths",
    parse: parseTableColumnWidths,
  });
  const [columnWidths, setColumnWidths] = useState<TableColumnWidths>({});
  const [previewWidths, setPreviewWidths] = useState<TableColumnWidths>();
  const [isSavingWidths, setIsSavingWidths] = useState(false);
  const [widthSaveError, setWidthSaveError] = useState(false);
  const isSavingRef = useRef(false);

  useEffect(() => {
    if (preference.settled && !isSavingRef.current)
      setColumnWidths(preference.value ?? {});
  }, [preference.settled, preference.value]);

  const onColumnWidthPreview = useCallback(
    (column: WorkItemSearchColumn, width: number) => {
      setPreviewWidths((previous) => ({
        ...(previous ?? columnWidths),
        [column]: width,
      }));
    },
    [columnWidths],
  );
  const onColumnWidthCommit = useCallback(
    async (column: WorkItemSearchColumn, width: number) => {
      const previous = columnWidths;
      const next = { ...previous, [column]: width };
      setIsSavingWidths(true);
      setWidthSaveError(false);
      isSavingRef.current = true;
      try {
        await preference.setAsync(next);
        setColumnWidths(next);
      } catch {
        setColumnWidths(previous);
        setWidthSaveError(true);
      } finally {
        isSavingRef.current = false;
        setPreviewWidths(undefined);
        setIsSavingWidths(false);
      }
    },
    [columnWidths, preference],
  );
  const onColumnWidthCancel = useCallback(
    () => setPreviewWidths(undefined),
    [],
  );

  return (
    <WorkItemListPresentation
      {...props}
      columnWidths={previewWidths ?? columnWidths}
      resizeEnabled={preference.settled && !isSavingWidths}
      isSavingWidths={isSavingWidths}
      widthSaveError={widthSaveError}
      onColumnWidthPreview={onColumnWidthPreview}
      onColumnWidthCommit={onColumnWidthCommit}
      onColumnWidthCancel={onColumnWidthCancel}
    />
  );
}

function WorkItemList(props: WorkItemListProps) {
  return props.projectId ? (
    <ProjectResizeController
      key={props.projectId}
      {...props}
      projectId={props.projectId}
    />
  ) : (
    <LocalResizeController {...props} />
  );
}

const DEFAULT_COLUMNS: WorkItemSearchColumn[] = [
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

/** Native columns map to API fields; custom columns use their selected `cf.<key>` field. */
const SORTABLE_COLUMNS: Partial<
  Record<WorkItemSearchColumn, WorkItemSortField>
> = {
  key: "key",
  title: "title",
  state: "state",
  assignee: "assignee",
  priority: "priority",
  dueDate: "dueDate",
};

const COLUMN_WIDTH_FACTORS: Record<NativeWorkItemSearchColumn, number> = {
  key: 0.11,
  title: 0.32,
  priority: 0.12,
  dueDate: 0.13,
  state: 0.15,
  assignee: 0.17,
};

const CUSTOM_COLUMN_WIDTH_FACTOR = 0.16;

/** Narrowest width that keeps a header label and its sort icon readable. */
const COLUMN_MIN_WIDTHS: Record<NativeWorkItemSearchColumn, number> = {
  key: 104,
  title: 280,
  priority: 120,
  dueDate: 128,
  state: 132,
  assignee: 152,
};
const CUSTOM_COLUMN_MIN_WIDTH = 144;

function columnMinWidth(column: WorkItemSearchColumn): number {
  return column.startsWith("cf.")
    ? CUSTOM_COLUMN_MIN_WIDTH
    : COLUMN_MIN_WIDTHS[column as NativeWorkItemSearchColumn];
}

function columnWidthFactor(column: WorkItemSearchColumn): number {
  return column.startsWith("cf.")
    ? CUSTOM_COLUMN_WIDTH_FACTOR
    : COLUMN_WIDTH_FACTORS[column as NativeWorkItemSearchColumn];
}

/**
 * The Assignee column's three cases (`work-item-list.tsx`'s own file comment has the
 * full rationale for why the middle case is "(inactive)", not the Partial mechanism's
 * "Unavailable"):
 * - no `assigneeId` -> Unassigned.
 * - `assigneeId` set but no resolvable `assigneeName` -> "(inactive)"
 *   (`work-items.md`'s own wording for "Assignee leaves").
 * - both present -> the resolved name.
 */
function assigneeLabel(
  item: Pick<
    WorkItemRow,
    "assigneeId" | "assigneeName" | "assigneeActive" | "assigneeOnProject"
  >,
  labels: { unassigned: string; inactive: string; notOnProject: string },
): string {
  // `AS-8`: "Jane Smith (inactive)" / "(no longer on this project)" from the response's
  // person facts, through the domain's `resolveAssigneeDisplayStatus`.
  return assigneeDisplayText(resolveAssigneeDisplay(item), labels);
}

const FIELD_LABEL_KEYS: Record<WorkItemField, string> = {
  key: "workItems:list.columnKey",
  title: "workItems:list.columnTitle",
  priority: "workItems:list.columnPriority",
  dueDate: "workItems:list.columnDueDate",
  stateName: "workItems:list.columnState",
  assigneeName: "workItems:list.columnAssignee",
};

/** Renders a field marked unavailable by `parseWorkItemRow` -- a visible "Unavailable"
 * badge plus a field-specific accessible label, e.g. "Title unavailable". */
function UnavailableField({
  field,
  t,
}: {
  field: WorkItemField;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  return (
    <Badge
      variant="outline"
      aria-label={t("workItems:list.unavailableFieldLabel", {
        field: t(FIELD_LABEL_KEYS[field]),
      })}
    >
      {t("workItems:list.unavailable")}
    </Badge>
  );
}

/**
 * The project work-item list (`docs/02-design/screen-inventory.md` "Work — list",
 * `/agent/projects/{key}/work?layout=list`). Read-only per this slice's scope.
 *
 * **State** and **Assignee** show the resolved `stateName`/`assigneeName` (#310 added
 * both to the list API's response, closing the "raw foreign key, no resolved value" gap
 * this comment used to flag). Three distinct cases for Assignee, per
 * `work-items.md`'s own "Assignee leaves" edge case ("Assignment retained and shown as
 * "(inactive)". Not silently unassigned"):
 * - `assigneeId` null -> "Unassigned".
 * - `assigneeId` set, `assigneeName` present -> the resolved display name.
 * - `assigneeId` set, `assigneeName` null (the assignee has no linked login, or --
 *   `work-items.md`'s own wording -- has since left) -> "(inactive)", NOT the Partial
 *   mechanism's "Unavailable" badge below: a person record with no resolvable name is a
 *   normal, well-typed API response (`response.ts`'s own comment), not malformed wire
 *   data, so it is not one of `parseWorkItemRow`'s validated fields.
 *
 * **Partial state** (G6 / design-principles.md principle 7): a row can arrive with one
 * or more of its displayed fields failing validation at the fetcher boundary
 * (`types/work-item/index.ts`'s `parseWorkItemRow` -- see its comment for why this,
 * not a mocked partial-batch response, is this screen's real partial case). Such a row
 * still renders -- its valid fields as usual, its invalid fields as an "Unavailable"
 * badge with a field-specific accessible label -- and a non-blocking notice above the
 * table says some items couldn't be fully loaded. This never falls back to the error
 * state: the request succeeded, so `isError` stays false regardless of row-level
 * validation failures.
 *
 * `key` is one of the validated fields: every row link below navigates using `item.key`,
 * so an invalid key renders as "Unavailable" with no link in BOTH the Key cell and the
 * Title cell (Title's own link uses the same key), rather than trusting it and producing
 * a broken or misleading navigation target.
 */
function WorkItemListPresentation({
  projectId,
  workItems,
  hasPartialFailure,
  isLoading,
  isError,
  isPlaceholderData = false,
  sort,
  dir,
  sorts,
  onSortChange,
  onSortsChange,
  onRetry,
  columns = DEFAULT_COLUMNS,
  customFieldColumns = [],
  customFieldPeople = [],
  isFiltered = false,
  emptyTitle,
  emptyDescription,
  hasMore = false,
  onLoadMore,
  isLoadingMore = false,
  isLoadMoreError = false,
  isCursorChanged = false,
  onRestartFromFirstPage,
  selectedKeys = [],
  onSelectionChange = () => {},
  onSelectAll = () => {},
  canBulkAssign = false,
  onOpenItem,
  columnWidths,
  resizeEnabled,
  isSavingWidths = false,
  widthSaveError = false,
  onColumnWidthPreview,
  onColumnWidthCommit,
  onColumnWidthCancel,
}: WorkItemListProps & ResizeProps) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { t } = useTranslation();
  const [fullTableHost, setFullTableHost] = useState<HTMLDivElement | null>(
    null,
  );
  const [fullTableViewportWidth, setFullTableViewportWidth] = useState(960);
  useLayoutEffect(() => {
    if (!fullTableHost) return;
    const updateWidth = () => {
      const measured = fullTableHost.clientWidth;
      if (measured > 0)
        setFullTableViewportWidth((current) =>
          current === measured ? current : measured,
        );
    };
    updateWidth();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateWidth);
    observer.observe(fullTableHost);
    return () => observer.disconnect();
  }, [fullTableHost]);
  const firstItem = workItems?.[0];
  const permission = useWorkspacePermission(
    firstItem?.workspaceId,
    firstItem?.projectId,
  );
  const restoreMutation = useRestoreWorkItem();
  const noPriorityLabel = t("workItems:list.noPriority");
  const columnWidthFactors = useMemo(
    () => columns.map(columnWidthFactor),
    [columns],
  );
  const noDueDateLabel = t("workItems:list.noDueDate");
  const assigneeLabels = useMemo(
    () => ({
      unassigned: t("workItems:list.unassigned"),
      inactive: t("workItems:list.assigneeInactive"),
      notOnProject: t("workItems:list.assigneeNotOnProject"),
    }),
    [t],
  );
  const priorityLabels = useMemo(
    () =>
      new Map([
        ["low", t("workItems:list.priority.low", "low")],
        ["medium", t("workItems:list.priority.medium", "medium")],
        ["high", t("workItems:list.priority.high", "high")],
        ["urgent", t("workItems:list.priority.urgent", "urgent")],
      ]),
    [t],
  );

  const getPriorityLabel = useCallback(
    (priority: string | null) => {
      if (!priority) return noPriorityLabel;
      return (
        priorityLabels.get(priority) ??
        t(`workItems:list.priority.${priority}`, priority)
      );
    },
    [noPriorityLabel, priorityLabels, t],
  );

  function handleHeaderClick(
    field: WorkItemSortField,
    event: Pick<MouseEvent, "shiftKey" | "ctrlKey" | "metaKey">,
  ) {
    const modified = event.shiftKey || event.ctrlKey || event.metaKey;
    if (!onSortsChange) {
      if (field === sort) onSortChange(field, toggleWorkItemSortDirection(dir));
      else onSortChange(field, "asc");
      return;
    }
    const current = sorts?.length ? sorts : [{ field: sort, order: dir }];
    if (!modified) {
      const primary = current[0];
      onSortsChange([
        {
          field,
          order:
            primary?.field === field
              ? toggleWorkItemSortDirection(primary.order)
              : "asc",
        },
      ]);
      return;
    }
    const index = current.findIndex((entry) => entry.field === field);
    if (index >= 0) {
      onSortsChange(
        current.map((entry, entryIndex) =>
          entryIndex === index
            ? { ...entry, order: toggleWorkItemSortDirection(entry.order) }
            : entry,
        ),
      );
      return;
    }
    onSortsChange([...current.slice(0, 4), { field, order: "asc" }]);
  }

  function prefetchDetail(key: string) {
    void router
      .preloadRoute({
        to: routes.workItemDetail.path,
        params: { key },
      })
      .catch(() => {});
    void import("@/components/work-item/load-work-item-detail")
      .then(({ default: loadWorkItemDetail }) => loadWorkItemDetail())
      .catch(() => {});
    void queryClient.prefetchQuery({
      queryKey: ["work-items", "detail", key],
      queryFn: async () => {
        const { default: getWorkItem } = await import(
          "@/fetchers/work-item/get-work-item"
        );
        return getWorkItem(key);
      },
      staleTime: 5_000,
    });
  }

  function navigateToDetail(
    event: Pick<
      MouseEvent<Element>,
      | "defaultPrevented"
      | "button"
      | "metaKey"
      | "ctrlKey"
      | "shiftKey"
      | "altKey"
      | "preventDefault"
    >,
    key: string,
  ) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    event.preventDefault();
    if (onOpenItem) {
      onOpenItem(key);
      return;
    }
    void router.navigate({
      to: routes.workItemDetail.path,
      params: { key },
    });
  }

  function getDetailLink(target: EventTarget | null) {
    if (!(target instanceof Element)) return null;
    return target.closest<HTMLAnchorElement>("a[data-work-item-key]");
  }

  function handleListMouseOver(event: MouseEvent<HTMLDivElement>) {
    const anchor = getDetailLink(event.target);
    if (!anchor) return;
    if (
      event.relatedTarget instanceof Node &&
      anchor.contains(event.relatedTarget)
    ) {
      return;
    }
    const key = anchor.dataset.workItemKey;
    if (key) prefetchDetail(key);
  }

  function handleListFocus(event: FocusEvent<HTMLDivElement>) {
    const anchor = getDetailLink(event.target);
    if (!anchor) return;
    anchor.closest("tr")?.scrollIntoView({ block: "nearest" });
    const key = anchor.dataset.workItemKey;
    if (key) prefetchDetail(key);
  }

  function handleListClick(event: MouseEvent<HTMLDivElement>) {
    const anchor = getDetailLink(event.target);
    const key = anchor?.dataset.workItemKey;
    if (anchor && key) navigateToDetail(event, key);
  }

  if (isError) {
    return (
      <div className="bg-background">
        <Alert
          variant="error"
          data-testid="work-item-list-error"
          data-primary-content-ready="true"
        >
          <TriangleAlert />
          <AlertTitle>{t("workItems:list.errorTitle")}</AlertTitle>
          <AlertDescription>
            <p>{t("workItems:list.errorDescription")}</p>
            <Button variant="outline" size="sm" onClick={onRetry}>
              {t("workItems:list.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isLoading) {
    return <WorkItemListLoading />;
  }

  if (!workItems || workItems.length === 0) {
    return (
      <Empty
        data-testid="work-item-list-empty"
        data-primary-content-ready="true"
      >
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ListTodo />
          </EmptyMedia>
          <EmptyTitle>
            {emptyTitle ??
              (isFiltered
                ? t("workItems:list.emptyFilteredTitle")
                : t("workItems:list.emptyTitle"))}
          </EmptyTitle>
          <EmptyDescription>
            {emptyDescription ??
              (isFiltered
                ? t("workItems:list.emptyFilteredDescription")
                : t("workItems:list.emptyDescription"))}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent />
      </Empty>
    );
  }

  const hasDeletedRows = workItems.some((item) => Boolean(item.deletedAt));
  const fullTableFixedWidth =
    (canBulkAssign ? 40 : 0) + (hasDeletedRows ? 96 : 0);
  const fullTableColumnSpace = Math.max(
    1,
    fullTableViewportWidth - fullTableFixedWidth,
  );
  const columnFactorTotal =
    columns.reduce((total, column) => total + columnWidthFactor(column), 0) ||
    1;
  const fullTableColumnWidths = columns.map(
    (column) =>
      columnWidths[column] ??
      Math.max(
        columnMinWidth(column),
        (fullTableColumnSpace * columnWidthFactor(column)) / columnFactorTotal,
      ),
  );
  const titleColumnIndex = columns.indexOf("title");
  const compactTitle =
    titleColumnIndex >= 0 &&
    (fullTableColumnWidths[titleColumnIndex] ?? 96) < 96;
  const fullTableMinWidth =
    fullTableFixedWidth +
    fullTableColumnWidths.reduce((total, width) => total + width, 0);
  const selectableKeys = workItems
    .filter(
      (item) =>
        !item.deletedAt &&
        !item.archivedAt &&
        !item.unavailableFields.includes("key"),
    )
    .map((item) => item.key);

  const renderHeader = (column: WorkItemSearchColumn) => {
    const customField = column.startsWith("cf.")
      ? customFieldColumns.find((field) => field.key === column.slice(3))
      : undefined;
    const sortField = column.startsWith("cf.")
      ? customField
        ? column
        : undefined
      : SORTABLE_COLUMNS[column];
    const currentSorts = sorts?.length ? sorts : [{ field: sort, order: dir }];
    const sortIndex = sortField
      ? currentSorts.findIndex((entry) => entry.field === sortField)
      : -1;
    const sortOrder = sortIndex >= 0 ? currentSorts[sortIndex].order : "asc";
    const label = column.startsWith("cf.")
      ? (customField?.name ??
        t("workItems:list.columnUnavailable", "Unavailable"))
      : t(COLUMN_LABEL_KEYS[column as NativeWorkItemSearchColumn]);
    return sortField ? (
      <ActionTooltip label={label}>
        <Button
          variant="ghost"
          size="sm"
          className="-mx-2 h-auto min-w-0 max-w-full gap-1 overflow-hidden px-2 py-1 font-medium text-muted-foreground"
          aria-label={t("workItems:list.sortColumnAria", {
            column: label,
            direction: t(
              sortOrder === "asc"
                ? "tasks:sort.ascending"
                : "tasks:sort.descending",
            ),
            priority: sortIndex < 0 ? "none" : sortIndex + 1,
          })}
          onClick={(event) => handleHeaderClick(sortField, event)}
        >
          <span className="min-w-0 truncate">{label}</span>
          <span className="shrink-0">
            <SortIcon
              active={sortIndex >= 0}
              dir={sortOrder}
              priority={sortIndex > 0 ? sortIndex + 1 : undefined}
            />
          </span>
        </Button>
      </ActionTooltip>
    ) : (
      <span className="block min-w-0 truncate" title={label}>
        {label}
      </span>
    );
  };

  const renderResizeHandle = (column: WorkItemSearchColumn, width?: number) => (
    <WorkItemColumnResizeHandle
      label={t("workItems:list.resizeColumn", {
        column: column.startsWith("cf.")
          ? (customFieldColumns.find((field) => field.key === column.slice(3))
              ?.name ?? t("workItems:list.columnUnavailable", "Unavailable"))
          : t(COLUMN_LABEL_KEYS[column as NativeWorkItemSearchColumn]),
      })}
      scopeKey={projectId}
      currentWidth={width}
      disabled={!resizeEnabled}
      onPreview={(nextWidth) => onColumnWidthPreview(column, nextWidth)}
      onCommit={(nextWidth, originalWidth) =>
        onColumnWidthCommit(column, nextWidth, originalWidth)
      }
      onCancel={(originalWidth) => onColumnWidthCancel(column, originalWidth)}
    />
  );

  const renderFullHeader = (column: WorkItemSearchColumn) => (
    <div className="flex min-w-0 items-center justify-between gap-1">
      <div className="min-w-0 flex-1">{renderHeader(column)}</div>
      {renderResizeHandle(column, columnWidths[column])}
    </div>
  );

  const headerAttributes = (column: WorkItemSearchColumn) => {
    const customField = column.startsWith("cf.")
      ? customFieldColumns.find((field) => field.key === column.slice(3))
      : undefined;
    const sortField = column.startsWith("cf.")
      ? customField
        ? column
        : undefined
      : SORTABLE_COLUMNS[column];
    const currentSorts = sorts?.length ? sorts : [{ field: sort, order: dir }];
    const sortIndex = sortField
      ? currentSorts.findIndex((entry) => entry.field === sortField)
      : -1;
    const sortOrder = sortIndex >= 0 ? currentSorts[sortIndex].order : "asc";
    return {
      "aria-sort": sortField
        ? sortAriaValue(sortIndex >= 0, sortOrder)
        : undefined,
    } as const;
  };

  const renderCell = (
    item: WorkItemRow,
    column: WorkItemSearchColumn,
    controls?: WorkItemInlineControls,
  ) => {
    if (column.startsWith("cf.")) {
      const key = column.slice(3);
      const field = customFieldColumns.find(
        (candidate) => candidate.key === key,
      );
      if (!field) return null;
      const values = item.customFieldValues;
      if (!values || !Object.hasOwn(values, key)) return null;
      const value = values[key];
      const control = controls?.customFieldControls?.[key];
      const personNames = new Map(
        customFieldPeople
          .filter((person) => person.projectId === item.projectId)
          .map((person) => [person.personId, person.name])
          .filter((entry): entry is [string, string] => entry[1] !== null),
      );
      const displayValue =
        value === null || value === undefined
          ? t("workItems:list.customFieldNotSet")
          : field.format === "user"
            ? (personNames.get(String(value)) ??
              t("workItems:list.customFieldPersonUnavailable"))
            : field.format === "multi_user" && Array.isArray(value)
              ? value
                  .map(
                    (personId) =>
                      personNames.get(String(personId)) ??
                      t("workItems:list.customFieldPersonUnavailable"),
                  )
                  .join(", ")
              : formatValue(field, value);
      return (
        <div className="work-item-list-cell-content flex min-w-0 max-w-full items-center">
          {control ?? (
            <span className="min-w-0 max-w-full truncate" title={displayValue}>
              {displayValue}
            </span>
          )}
        </div>
      );
    }
    const detailHref =
      item.unavailableFields.includes("key") ||
      item.deletedAt ||
      item.archivedAt
        ? undefined
        : routes.workItemDetail.build({ key: item.key });
    switch (column) {
      case "key":
        return (
          <div className="work-item-list-cell-content">
            {item.unavailableFields.includes("key") ? (
              <UnavailableField field="key" t={t} />
            ) : detailHref ? (
              <a
                href={detailHref}
                data-work-item-key={item.key}
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                {item.key}
              </a>
            ) : (
              <span className="font-medium">{item.key}</span>
            )}
            {item.deletedAt ? (
              <Badge variant="outline">
                {t("workItems:list.deleted", { defaultValue: "Deleted" })}
              </Badge>
            ) : item.archivedAt ? (
              <Badge variant="outline">
                {t("workItems:list.archived", { defaultValue: "Archived" })}
              </Badge>
            ) : null}
          </div>
        );
      case "title":
        return (
          <div
            className={
              compactTitle
                ? "work-item-list-cell-content flex min-h-16 min-w-0 flex-col items-start gap-1 pointer-coarse:min-h-18 pointer-coarse:gap-2"
                : "work-item-list-cell-content flex min-w-0 items-center gap-1 pointer-coarse:gap-2"
            }
          >
            {controls?.titleEditor ?? (
              <>
                <span
                  className={
                    compactTitle
                      ? "w-full min-w-0 truncate"
                      : "min-w-0 truncate"
                  }
                >
                  {item.unavailableFields.includes("title") ? (
                    <UnavailableField field="title" t={t} />
                  ) : !detailHref ? (
                    <span title={item.title}>{item.title}</span>
                  ) : (
                    <ActionTooltip label={item.title}>
                      <a
                        href={detailHref}
                        data-work-item-key={item.key}
                        className="inline-block min-h-6 min-w-6 max-w-full truncate align-middle leading-6 hover:underline"
                      >
                        {item.title}
                      </a>
                    </ActionTooltip>
                  )}
                </span>
                {controls?.titleControl}
              </>
            )}
          </div>
        );
      case "priority":
        return (
          <div className="work-item-list-cell-content">
            {item.unavailableFields.includes("priority") ? (
              <UnavailableField field="priority" t={t} />
            ) : controls?.priorityControl ? (
              controls.priorityControl
            ) : (
              <span className="inline-flex items-center gap-1.5">
                {getPriorityIcon(item.priority ?? "no-priority")}
                {getPriorityLabel(item.priority)}
              </span>
            )}
          </div>
        );
      case "dueDate":
        return item.unavailableFields.includes("dueDate") ? (
          <UnavailableField field="dueDate" t={t} />
        ) : controls?.dueDateControl ? (
          controls.dueDateControl
        ) : item.dueDate ? (
          formatDateShort(item.dueDate)
        ) : (
          noDueDateLabel
        );
      case "state":
        return item.unavailableFields.includes("stateName") ? (
          <UnavailableField field="stateName" t={t} />
        ) : controls?.stateControl ? (
          <span className="flex flex-wrap items-center gap-1">
            {controls.stateControl}
            <WorkItemBlockedBadge
              blockedByOpenCount={item.blockedByOpenCount}
            />
          </span>
        ) : (
          <span className="flex flex-wrap items-center gap-1">
            <Badge variant="outline">{item.stateName}</Badge>
            <WorkItemBlockedBadge
              blockedByOpenCount={item.blockedByOpenCount}
            />
          </span>
        );
      case "assignee":
        return item.unavailableFields.includes("assigneeName") ? (
          <UnavailableField field="assigneeName" t={t} />
        ) : controls?.assigneeControl ? (
          controls.assigneeControl
        ) : (
          assigneeLabel(item, assigneeLabels)
        );
    }
  };

  const hasInlineEditableColumn = columns.some(
    (column) =>
      ["state", "assignee", "priority", "title", "dueDate"].includes(column) ||
      (column.startsWith("cf.") &&
        customFieldColumns.some((field) => field.key === column.slice(3))),
  );
  const renderInlineRow = (
    item: WorkItemRow,
    renderRow: (controls?: WorkItemInlineControls) => ReactNode,
  ) => {
    if (!hasInlineEditableColumn) return renderRow();
    return (
      <Suspense key={item.id} fallback={renderRow()}>
        <WorkItemInlineFields
          item={item}
          disabled={Boolean(isPlaceholderData)}
          presentation="table"
          compactTitle={compactTitle}
          customFieldColumns={customFieldColumns.filter((field) =>
            columns.includes(`cf.${field.key}` as WorkItemSearchColumn),
          )}
          customFieldPeople={customFieldPeople}
        >
          {(controls) => renderRow(controls)}
        </WorkItemInlineFields>
      </Suspense>
    );
  };

  const renderLeadingHeader = () =>
    canBulkAssign ? (
      <Suspense fallback={null}>
        <SelectionCheckbox
          aria-label={t("workItems:bulk.selectAll")}
          checked={selectableKeys.every((key) => selectedKeys.includes(key))}
          disabled={selectableKeys.length === 0}
          onCheckedChange={(checked) => onSelectAll(Boolean(checked))}
        />
      </Suspense>
    ) : null;

  const renderLeadingCell = (item: WorkItemRow) =>
    canBulkAssign ? (
      <Suspense fallback={null}>
        <SelectionCheckbox
          aria-label={t("workItems:bulk.selectItem", { key: item.key })}
          checked={selectedKeys.includes(item.key)}
          disabled={
            Boolean(item.deletedAt || item.archivedAt) ||
            item.unavailableFields.includes("key")
          }
          onCheckedChange={(checked) => onSelectionChange(item.key, checked)}
        />
      </Suspense>
    ) : null;

  const renderTrailingHeader = () =>
    hasDeletedRows
      ? t("workItems:list.actions", { defaultValue: "Actions" })
      : null;

  const renderTrailingCell = (item: WorkItemRow) =>
    hasDeletedRows && item.deletedAt && permission.canUpdateTasks() ? (
      <Button
        size="sm"
        variant="outline"
        disabled={restoreMutation.isPending}
        onClick={() =>
          void restoreMutation
            .mutateAsync({
              key: item.key,
              version: item.version,
              projectId: item.projectId,
            })
            .then(() =>
              toast.success(
                t("workItems:list.restoreSuccess", {
                  defaultValue: "Work item restored",
                }),
              ),
            )
            .catch(() =>
              toast.error(
                t("workItems:list.restoreFailed", {
                  defaultValue: "Unable to restore work item",
                }),
              ),
            )
        }
      >
        {t("workItems:list.restore", { defaultValue: "Restore" })}
      </Button>
    ) : null;

  const renderFullTable = (withInlineFields = true) => (
    <div ref={setFullTableHost} className="min-w-0">
      <Table
        data-testid="work-item-list-populated"
        data-primary-content-ready="true"
        className="table-fixed bg-background"
        style={{ minWidth: fullTableMinWidth }}
        onMouseOver={handleListMouseOver}
        onFocusCapture={handleListFocus}
        onClickCapture={handleListClick}
      >
        <colgroup>
          {canBulkAssign && <col className="w-10" />}
          {columns.map((column, index) => {
            const width = fullTableColumnWidths[index];
            return <col key={column} style={{ width }} />;
          })}
          {hasDeletedRows ? <col className="w-24" /> : null}
        </colgroup>
        <TableHeader>
          <TableRow>
            {canBulkAssign ? (
              <TableHead>{renderLeadingHeader()}</TableHead>
            ) : null}
            {columns.map((column, index) => (
              <TableHead
                key={column}
                {...headerAttributes(column)}
                style={{ width: fullTableColumnWidths[index] }}
              >
                {renderFullHeader(column)}
              </TableHead>
            ))}
            {hasDeletedRows ? (
              <TableHead>{renderTrailingHeader()}</TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {workItems.map((item) => {
            const renderRow = (controls?: WorkItemInlineControls) => (
              <TableRow key={item.id}>
                {canBulkAssign ? (
                  <TableCell>{renderLeadingCell(item)}</TableCell>
                ) : null}
                {columns.map((column, index) => (
                  <TableCell
                    key={column}
                    style={{ width: fullTableColumnWidths[index] }}
                    className={
                      column === "title"
                        ? "max-w-xs truncate whitespace-nowrap"
                        : undefined
                    }
                  >
                    {renderCell(item, column, controls)}
                  </TableCell>
                ))}
                {hasDeletedRows ? (
                  <TableCell>{renderTrailingCell(item)}</TableCell>
                ) : null}
              </TableRow>
            );
            return withInlineFields
              ? renderInlineRow(item, renderRow)
              : renderRow();
          })}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      {hasPartialFailure && (
        <div className="bg-background">
          <Alert variant="warning" data-testid="work-item-list-partial-notice">
            <Info />
            <AlertTitle>{t("workItems:list.partialNoticeTitle")}</AlertTitle>
            <AlertDescription>
              <p>{t("workItems:list.partialNoticeDescription")}</p>
            </AlertDescription>
          </Alert>
        </div>
      )}
      {isSavingWidths ? (
        <Alert
          variant="warning"
          role="status"
          data-testid="work-item-column-width-saving"
        >
          <AlertDescription>
            {t("workItems:list.resizingWidths")}
          </AlertDescription>
        </Alert>
      ) : null}
      {widthSaveError ? (
        <Alert
          variant="error"
          role="alert"
          data-testid="work-item-column-width-error"
        >
          <AlertDescription>
            {t("workItems:list.widthSaveFailed")}
          </AlertDescription>
        </Alert>
      ) : null}
      {workItems.length > 100 ? (
        <Suspense fallback={renderFullTable(false)}>
          <VirtualizedWorkItemTable<
            WorkItemRow,
            WorkItemSearchColumn,
            WorkItemInlineControls
          >
            rows={workItems}
            columns={columns}
            getRowId={(item) => item.id}
            columnWidthFactors={columnWidthFactors}
            columnMinWidths={columns.map(columnMinWidth)}
            columnWidths={columnWidths}
            renderResizeHandle={(column, width) =>
              renderResizeHandle(column, width)
            }
            renderHeader={renderHeader}
            headerAttributes={headerAttributes}
            renderCell={renderCell}
            renderRow={(item, renderRow) => renderInlineRow(item, renderRow)}
            leadingWidth={canBulkAssign ? 40 : 0}
            trailingWidth={hasDeletedRows ? 96 : 0}
            renderLeadingHeader={
              canBulkAssign ? renderLeadingHeader : undefined
            }
            renderLeadingCell={canBulkAssign ? renderLeadingCell : undefined}
            renderTrailingHeader={
              hasDeletedRows ? renderTrailingHeader : undefined
            }
            renderTrailingCell={hasDeletedRows ? renderTrailingCell : undefined}
            className="table-fixed bg-background"
            // Every virtual row is as tall as a row with its inline controls, from its first
            // frame: rows mount with plain values, the controls (the title's icon button is the
            // tallest, `size="icon"`) arrive after. `box-content` keeps the density padding.
            bodyCellClassName="box-content h-9 sm:h-8"
            testId="work-item-list-populated"
            onMouseOver={handleListMouseOver}
            onFocusCapture={handleListFocus}
            onClickCapture={handleListClick}
          />
        </Suspense>
      ) : (
        renderFullTable()
      )}
      {isLoadMoreError ? (
        <Alert
          variant="error"
          role="alert"
          data-testid="work-item-list-page-error"
        >
          <AlertDescription>
            {isCursorChanged
              ? t("workItems:list.cursorChanged")
              : t("workItems:list.errorDescription")}
            {isCursorChanged ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onRestartFromFirstPage}
              >
                {t("workItems:list.reload")}
              </Button>
            ) : !hasMore ? (
              <Button variant="outline" size="sm" onClick={onRetry}>
                {t("workItems:list.retry")}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {hasMore && onLoadMore && !isCursorChanged ? (
        <div className="flex justify-center bg-background">
          <Button
            variant="outline"
            size="sm"
            disabled={isLoadingMore}
            onClick={onLoadMore}
            data-testid="work-item-list-load-more"
          >
            {isLoadingMore
              ? t("workItems:list.loadingMore")
              : t(
                  isLoadMoreError
                    ? "workItems:list.retry"
                    : "workItems:list.loadMore",
                )}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function sortAriaValue(
  active: boolean,
  dir: WorkItemSortDirection,
): "ascending" | "descending" | "none" {
  if (!active) return "none";
  return dir === "asc" ? "ascending" : "descending";
}

function SortIcon({
  active,
  dir,
  priority,
}: {
  active: boolean;
  dir: WorkItemSortDirection;
  priority?: number;
}) {
  if (!active) {
    return <ArrowUpDown className="h-3 w-3 opacity-50" aria-hidden="true" />;
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5">
      {dir === "asc" ? (
        <ArrowUp className="h-3 w-3" aria-hidden="true" />
      ) : (
        <ArrowDown className="h-3 w-3" aria-hidden="true" />
      )}
      {priority ? (
        <span className="text-[10px] leading-none" aria-hidden="true">
          {priority}
        </span>
      ) : null}
    </span>
  );
}

export default memo(WorkItemList);
