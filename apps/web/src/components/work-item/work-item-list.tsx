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
  type MouseEvent,
  memo,
  useCallback,
  useMemo,
} from "react";
import { useTranslation } from "react-i18next";
import { formatDateShort } from "@/lib/format";
import { getPriorityIcon } from "@/lib/priority";
import {
  routes,
  toggleWorkItemSortDirection,
  type WorkItemSortDirection,
  type WorkItemSortField,
} from "@/lib/routes";
import type { WorkItemField, WorkItemRow } from "@/types/work-item";
import WorkItemListLoading from "./work-item-list-loading";

export type WorkItemListProps = {
  workItems: WorkItemRow[] | undefined;
  /** Precomputed by the validated fetcher so rendering does not rescan every row. */
  hasPartialFailure: boolean;
  isLoading: boolean;
  isError: boolean;
  sort: WorkItemSortField;
  dir: WorkItemSortDirection;
  onSortChange: (sort: WorkItemSortField, dir: WorkItemSortDirection) => void;
  onRetry: () => void;
};

const SORT_COLUMNS: Array<{ field: WorkItemSortField; labelKey: string }> = [
  { field: "key", labelKey: "workItems:list.columnKey" },
  { field: "title", labelKey: "workItems:list.columnTitle" },
  { field: "priority", labelKey: "workItems:list.columnPriority" },
  { field: "dueDate", labelKey: "workItems:list.columnDueDate" },
];

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
  item: Pick<WorkItemRow, "assigneeId" | "assigneeName">,
  labels: { unassigned: string; inactive: string },
): string {
  if (!item.assigneeId) return labels.unassigned;
  if (!item.assigneeName) return labels.inactive;
  return item.assigneeName;
}

const FIELD_LABEL_KEYS: Record<WorkItemField, string> = {
  key: "workItems:list.columnKey",
  title: "workItems:list.columnTitle",
  priority: "workItems:list.columnPriority",
  dueDate: "workItems:list.columnDueDate",
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
function WorkItemList({
  workItems,
  hasPartialFailure,
  isLoading,
  isError,
  sort,
  dir,
  onSortChange,
  onRetry,
}: WorkItemListProps) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { t } = useTranslation();
  const noPriorityLabel = t("workItems:list.noPriority");
  const noDueDateLabel = t("workItems:list.noDueDate");
  const assigneeLabels = useMemo(
    () => ({
      unassigned: t("workItems:list.unassigned"),
      inactive: t("workItems:list.assigneeInactive"),
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

  function handleHeaderClick(field: WorkItemSortField) {
    if (field === sort) {
      onSortChange(field, toggleWorkItemSortDirection(dir));
    } else {
      onSortChange(field, "asc");
    }
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
    const key = getDetailLink(event.target)?.dataset.workItemKey;
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
        <Alert variant="error" data-testid="work-item-list-error">
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
      <Empty data-testid="work-item-list-empty">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ListTodo />
          </EmptyMedia>
          <EmptyTitle>{t("workItems:list.emptyTitle")}</EmptyTitle>
          <EmptyDescription>
            {t("workItems:list.emptyDescription")}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent />
      </Empty>
    );
  }

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
      <Table
        data-testid="work-item-list-populated"
        className="table-fixed bg-background"
        onMouseOver={handleListMouseOver}
        onFocusCapture={handleListFocus}
        onClickCapture={handleListClick}
      >
        <colgroup>
          <col className="w-[11%]" />
          <col className="w-[32%]" />
          <col className="w-[12%]" />
          <col className="w-[13%]" />
          <col className="w-[15%]" />
          <col className="w-[17%]" />
        </colgroup>
        <TableHeader>
          <TableRow>
            {SORT_COLUMNS.map(({ field, labelKey }) => (
              <TableHead
                key={field}
                aria-sort={sortAriaValue(field, sort, dir)}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className="-mx-2 h-auto gap-1 px-2 py-1 font-medium text-muted-foreground"
                  onClick={() => handleHeaderClick(field)}
                >
                  {t(labelKey)}
                  <SortIcon field={field} sort={sort} dir={dir} />
                </Button>
              </TableHead>
            ))}
            <TableHead>{t("workItems:list.columnState")}</TableHead>
            <TableHead>{t("workItems:list.columnAssignee")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {workItems.map((item) => {
            const detailHref = item.unavailableFields.includes("key")
              ? undefined
              : routes.workItemDetail.build({ key: item.key });

            return (
              <TableRow key={item.id}>
                <TableCell>
                  <div className="work-item-list-cell-content">
                    {item.unavailableFields.includes("key") ? (
                      <UnavailableField field="key" t={t} />
                    ) : (
                      <a
                        href={detailHref}
                        data-work-item-key={item.key}
                        className="font-medium text-primary underline-offset-2 hover:underline"
                      >
                        {item.key}
                      </a>
                    )}
                  </div>
                </TableCell>
                <TableCell className="max-w-xs truncate whitespace-nowrap">
                  <div className="work-item-list-cell-content truncate">
                    {item.unavailableFields.includes("title") ? (
                      <UnavailableField field="title" t={t} />
                    ) : item.unavailableFields.includes("key") ? (
                      <span title={item.title}>{item.title}</span>
                    ) : (
                      <a
                        href={detailHref}
                        data-work-item-key={item.key}
                        className="hover:underline"
                        title={item.title}
                      >
                        {item.title}
                      </a>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="work-item-list-cell-content">
                    {item.unavailableFields.includes("priority") ? (
                      <UnavailableField field="priority" t={t} />
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        {getPriorityIcon(item.priority ?? "no-priority")}
                        {getPriorityLabel(item.priority)}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {item.unavailableFields.includes("dueDate") ? (
                    <UnavailableField field="dueDate" t={t} />
                  ) : item.dueDate ? (
                    formatDateShort(item.dueDate)
                  ) : (
                    noDueDateLabel
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{item.stateName}</Badge>
                </TableCell>
                <TableCell>{assigneeLabel(item, assigneeLabels)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function sortAriaValue(
  field: WorkItemSortField,
  sort: WorkItemSortField,
  dir: WorkItemSortDirection,
): "ascending" | "descending" | "none" {
  if (field !== sort) return "none";
  return dir === "asc" ? "ascending" : "descending";
}

function SortIcon({
  field,
  sort,
  dir,
}: {
  field: WorkItemSortField;
  sort: WorkItemSortField;
  dir: WorkItemSortDirection;
}) {
  if (field !== sort) {
    return <ArrowUpDown className="h-3 w-3 opacity-50" aria-hidden="true" />;
  }
  return dir === "asc" ? (
    <ArrowUp className="h-3 w-3" aria-hidden="true" />
  ) : (
    <ArrowDown className="h-3 w-3" aria-hidden="true" />
  );
}

export default memo(WorkItemList);
