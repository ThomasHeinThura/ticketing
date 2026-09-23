import { Link } from "@tanstack/react-router";
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
  Skeleton,
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

export type WorkItemListProps = {
  workItems: WorkItemRow[] | undefined;
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

function priorityLabel(t: ReturnType<typeof useTranslation>["t"]) {
  return (priority: string | null) => {
    if (!priority) return t("workItems:list.noPriority");
    return t(`workItems:list.priority.${priority}`, priority);
  };
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
 * Two columns render a raw foreign key rather than a resolved value, both flagged as API
 * gaps in this pull request rather than guessed at:
 * - **State** shows `work_item.state_id` -- the list API
 *   (`apps/api/src/work-item/response.ts`) returns the id, not the workflow state's name
 *   or color, and there is no state-lookup endpoint this screen can join against yet.
 * - **Assignee** shows `work_item.assignee_id`, or "Unassigned" when null -- same gap,
 *   no user-lookup this screen can resolve a display name from.
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
  isLoading,
  isError,
  sort,
  dir,
  onSortChange,
  onRetry,
}: WorkItemListProps) {
  const { t } = useTranslation();
  const getPriorityLabel = priorityLabel(t);

  function handleHeaderClick(field: WorkItemSortField) {
    if (field === sort) {
      onSortChange(field, toggleWorkItemSortDirection(dir));
    } else {
      onSortChange(field, "asc");
    }
  }

  if (isError) {
    return (
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
    );
  }

  if (isLoading) {
    return (
      <div
        className="flex flex-col gap-2"
        data-testid="work-item-list-loading"
        aria-busy="true"
        aria-live="polite"
      >
        <span className="sr-only">{t("workItems:list.loading")}</span>
        {Array.from({ length: 6 }).map((_, index) => (
          // Skeleton rows have no identity to key on; the list is static in length and
          // never reordered while loading.
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholder rows
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    );
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

  const hasPartialFailure = workItems.some(
    (item) => item.unavailableFields.length > 0,
  );

  return (
    <div className="flex flex-col gap-3">
      {hasPartialFailure && (
        <Alert variant="warning" data-testid="work-item-list-partial-notice">
          <Info />
          <AlertTitle>{t("workItems:list.partialNoticeTitle")}</AlertTitle>
          <AlertDescription>
            <p>{t("workItems:list.partialNoticeDescription")}</p>
          </AlertDescription>
        </Alert>
      )}
      <Table data-testid="work-item-list-populated">
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
          {workItems.map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                {item.unavailableFields.includes("key") ? (
                  <UnavailableField field="key" t={t} />
                ) : (
                  <Link
                    to={routes.workItemDetail.path}
                    params={{ key: item.key }}
                    className="font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {item.key}
                  </Link>
                )}
              </TableCell>
              <TableCell className="max-w-xs truncate whitespace-nowrap">
                {item.unavailableFields.includes("title") ? (
                  <UnavailableField field="title" t={t} />
                ) : item.unavailableFields.includes("key") ? (
                  // The key this row's link would navigate to is unavailable -- render
                  // the (valid) title as plain text rather than a link to nowhere
                  // trustworthy.
                  <span title={item.title}>{item.title}</span>
                ) : (
                  <Link
                    to={routes.workItemDetail.path}
                    params={{ key: item.key }}
                    className="hover:underline"
                    title={item.title}
                  >
                    {item.title}
                  </Link>
                )}
              </TableCell>
              <TableCell>
                {item.unavailableFields.includes("priority") ? (
                  <UnavailableField field="priority" t={t} />
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    {getPriorityIcon(item.priority ?? "no-priority")}
                    {getPriorityLabel(item.priority)}
                  </span>
                )}
              </TableCell>
              <TableCell>
                {item.unavailableFields.includes("dueDate") ? (
                  <UnavailableField field="dueDate" t={t} />
                ) : item.dueDate ? (
                  formatDateShort(item.dueDate)
                ) : (
                  t("workItems:list.noDueDate")
                )}
              </TableCell>
              <TableCell>
                <Badge variant="outline">{item.stateId}</Badge>
              </TableCell>
              <TableCell>
                {item.assigneeId ?? t("workItems:list.unassigned")}
              </TableCell>
            </TableRow>
          ))}
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

export default WorkItemList;
