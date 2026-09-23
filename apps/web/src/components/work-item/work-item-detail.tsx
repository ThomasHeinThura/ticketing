import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Separator,
  Skeleton,
} from "@taskdesk/ui";
import { ChevronDown, Info, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDateMedium, formatDateTime } from "@/lib/format";
import { getPriorityIcon } from "@/lib/priority";
import { routes } from "@/lib/routes";
import {
  extractDescription,
  type WorkItemDetailField,
  type WorkItemDetailRow,
} from "@/types/work-item";

export type WorkItemDetailProps = {
  item: WorkItemDetailRow | undefined;
  /** The `{key}` from the URL -- shown by the not-found state, where there is no row. */
  workItemKey: string;
  /** Best-effort: resolved client-side from the workspace's project list. Absent until
   * that list loads; the details section simply omits the row rather than showing a raw
   * project id. */
  project: { name: string; slug: string } | undefined;
  isLoading: boolean;
  isNotFound: boolean;
  isError: boolean;
  onRetry: () => void;
};

const FIELD_LABEL_KEYS: Record<WorkItemDetailField, string> = {
  key: "workItems:detail.keyLabel",
  title: "workItems:detail.titleLabel",
  priority: "workItems:detail.priorityLabel",
  dueDate: "workItems:detail.dueDateLabel",
  startDate: "workItems:detail.startDateLabel",
  stateName: "workItems:detail.stateLabel",
  createdAt: "workItems:detail.createdLabel",
  updatedAt: "workItems:detail.updatedLabel",
};

/** Renders a field marked unavailable by `parseWorkItemDetailRow` -- a visible
 * "Unavailable" badge plus a field-specific accessible label, e.g. "State unavailable". */
function UnavailableField({
  field,
  t,
}: {
  field: WorkItemDetailField;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  return (
    <Badge
      variant="outline"
      aria-label={t("workItems:detail.unavailableFieldLabel", {
        field: t(FIELD_LABEL_KEYS[field]),
      })}
    >
      {t("workItems:detail.unavailable")}
    </Badge>
  );
}

/**
 * The work-item detail page (`docs/02-design/screen-inventory.md` "Work item — full
 * page", `/agent/work-items/{key}`). Read-only first slice, per the spec's own
 * progressive-disclosure rule (`docs/03-features/work-items.md` § Screens): state,
 * assignee, priority and due date in the header; the description in the body; everything
 * else in a collapsible section. The spec's remaining sections (activity and comments,
 * relations, attachments, approvals, SLA, time entries) are separate
 * `screen-inventory.md` rows and separate slices; editing is likewise later work.
 *
 * Four states, matching G6 with a record view's own shape of them: loading (skeleton),
 * error (retryable alert), not-found (the 404 the route deliberately distinguishes --
 * `require-work-item-reach.ts` makes "not yours" and "not there" indistinguishable, so
 * this is the one state for both), and ready. "Empty" is not a page-level state for an
 * existing record: missing optional values render as "Unassigned"/"No priority"/"No due
 * date"/"No description", and a field that fails validation at the fetcher boundary
 * renders as the partial state below rather than an empty one.
 *
 * Partial state (G6 / design-principles.md principle 7): a field that fails
 * `parseWorkItemDetailRow`'s validation renders as an "Unavailable" badge, and a
 * non-blocking notice above the header says some details are missing. This never falls
 * back to the error state -- the request succeeded.
 */
function WorkItemDetail({
  item,
  workItemKey,
  project,
  isLoading,
  isNotFound,
  isError,
  onRetry,
}: WorkItemDetailProps) {
  const { t } = useTranslation();

  if (isNotFound) {
    return (
      <Empty data-testid="work-item-detail-not-found">
        <EmptyHeader>
          <EmptyTitle>{workItemKey}</EmptyTitle>
          <EmptyDescription>
            {t("workItems:detail.notFoundDescription")}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (isError) {
    return (
      <Alert variant="error" data-testid="work-item-detail-error">
        <TriangleAlert />
        <AlertTitle>{t("workItems:detail.errorTitle")}</AlertTitle>
        <AlertDescription>
          <p>{t("workItems:detail.errorDescription")}</p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            {t("workItems:detail.retry")}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (isLoading || !item) {
    return (
      <div
        className="flex flex-col gap-3"
        data-testid="work-item-detail-loading"
        aria-busy="true"
        aria-live="polite"
      >
        <span className="sr-only">{t("workItems:detail.loading")}</span>
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-9 w-2/3" />
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-6 w-28" />
        </div>
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const description = extractDescription(item.description);
  const hasPartialFailure = item.unavailableFields.length > 0;

  // `assigneeId` set with no resolved name means one of: a placeholder person with no
  // linked login, or a user outside this workspace (whose name the API deliberately
  // never resolves -- `get-work-item.ts`'s own note). `work-items.md`'s edge cases
  // render an unresolvable assignee as "(inactive)"; both cases share that rendering,
  // and neither leaks a name that shouldn't be shown.
  const assigneeLabel =
    item.assigneeId === null
      ? t("workItems:detail.unassigned")
      : (item.assigneeName ?? t("workItems:detail.inactiveAssignee"));

  return (
    <div className="flex flex-col gap-6" data-testid="work-item-detail">
      {hasPartialFailure && (
        <Alert variant="warning" data-testid="work-item-detail-partial-notice">
          <Info />
          <AlertTitle>{t("workItems:detail.partialNoticeTitle")}</AlertTitle>
          <AlertDescription>
            <p>{t("workItems:detail.partialNoticeDescription")}</p>
          </AlertDescription>
        </Alert>
      )}

      <header className="flex flex-col gap-2">
        <p className="font-mono text-muted-foreground text-sm">
          {item.unavailableFields.includes("key") ? (
            <UnavailableField field="key" t={t} />
          ) : (
            item.key
          )}
        </p>
        <h1 className="font-semibold text-2xl">
          {item.unavailableFields.includes("title") ? (
            <UnavailableField field="title" t={t} />
          ) : (
            item.title
          )}
        </h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="inline-flex items-center gap-1.5">
            <span className="text-muted-foreground">
              {t("workItems:detail.stateLabel")}
            </span>
            {item.unavailableFields.includes("stateName") ? (
              <UnavailableField field="stateName" t={t} />
            ) : (
              <Badge variant="outline">{item.stateName}</Badge>
            )}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="text-muted-foreground">
              {t("workItems:detail.priorityLabel")}
            </span>
            {item.unavailableFields.includes("priority") ? (
              <UnavailableField field="priority" t={t} />
            ) : (
              <span className="inline-flex items-center gap-1.5">
                {getPriorityIcon(item.priority ?? "no-priority")}
                {item.priority
                  ? t(`workItems:list.priority.${item.priority}`, item.priority)
                  : t("workItems:detail.noPriority")}
              </span>
            )}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="text-muted-foreground">
              {t("workItems:detail.dueDateLabel")}
            </span>
            {item.unavailableFields.includes("dueDate") ? (
              <UnavailableField field="dueDate" t={t} />
            ) : item.dueDate ? (
              formatDateMedium(item.dueDate)
            ) : (
              t("workItems:detail.noDueDate")
            )}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="text-muted-foreground">
              {t("workItems:detail.assigneeLabel")}
            </span>
            {assigneeLabel}
          </span>
        </div>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium text-lg">
          {t("workItems:detail.descriptionHeading")}
        </h2>
        {description.kind === "text" ? (
          <p className="whitespace-pre-wrap text-sm">{description.text}</p>
        ) : description.kind === "unsupported" ? (
          <Badge variant="outline">{t("workItems:detail.unavailable")}</Badge>
        ) : (
          <p className="text-muted-foreground text-sm">
            {t("workItems:detail.noDescription")}
          </p>
        )}
      </section>

      <Separator />

      <Collapsible>
        <CollapsibleTrigger
          asChild
          className="-ml-2 h-auto gap-1 px-2 py-1 font-medium text-sm"
        >
          <Button variant="ghost" size="sm">
            {t("workItems:detail.detailsHeading")}
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </Button>
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 pt-3 text-sm">
            {project && (
              <>
                <dt className="text-muted-foreground">
                  {t("workItems:detail.projectLabel")}
                </dt>
                <dd>
                  <Link
                    to={routes.workItemList.path}
                    params={{ projectKey: project.slug }}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {project.name}
                  </Link>
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">
              {t("workItems:detail.startDateLabel")}
            </dt>
            <dd>
              {item.unavailableFields.includes("startDate") ? (
                <UnavailableField field="startDate" t={t} />
              ) : item.startDate ? (
                formatDateMedium(item.startDate)
              ) : (
                t("workItems:detail.noStartDate")
              )}
            </dd>
            <dt className="text-muted-foreground">
              {t("workItems:detail.createdLabel")}
            </dt>
            <dd>
              {item.unavailableFields.includes("createdAt") ? (
                <UnavailableField field="createdAt" t={t} />
              ) : (
                formatDateTime(item.createdAt)
              )}
            </dd>
            <dt className="text-muted-foreground">
              {t("workItems:detail.updatedLabel")}
            </dt>
            <dd>
              {item.unavailableFields.includes("updatedAt") ? (
                <UnavailableField field="updatedAt" t={t} />
              ) : (
                formatDateTime(item.updatedAt)
              )}
            </dd>
          </dl>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  );
}

export default WorkItemDetail;
