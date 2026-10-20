import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@taskdesk/ui";
import { Info, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "@/lib/format";
import { routes } from "@/lib/routes";
import {
  extractDescription,
  type WorkItemDetailField,
  type WorkItemDetailRow,
} from "@/types/work-item";
import WorkItemActivity, { type ActivityFilter } from "./work-item-activity";
import WorkItemApprovals from "./work-item-approvals";
import WorkItemAttachments from "./work-item-attachments";
import WorkItemDescription from "./work-item-description";
import WorkItemDetailLoading from "./work-item-detail-loading";
import WorkItemProperties from "./work-item-properties";
import WorkItemSla from "./work-item-sla";
import WorkItemTitle from "./work-item-title";

export type WorkItemDetailProps = {
  item: WorkItemDetailRow | undefined;
  /** The `{key}` from the URL -- shown by the not-found state, where there is no row. */
  workItemKey: string;
  activityFilter: ActivityFilter;
  onActivityFilterChange: (filter: ActivityFilter) => void;
  /** Best-effort: resolved client-side from the workspace's project list. Absent until
   * that list loads; the details section simply omits the row rather than showing a raw
   * project id. */
  project: { name: string; slug: string } | undefined;
  isLoading: boolean;
  isNotFound: boolean;
  isError: boolean;
  onRetry: () => void;
  /** A mutation (edit, state change, assignment) answered 404: the item is gone or no
   * longer reachable. The owner of the data shows the not-found state. */
  onAccessLost: () => void;
  /** `page`: kaneo's task page (content + Properties column); `pane`: kaneo's task sheet. */
  variant?: "page" | "pane";
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
 * relations, attachments, SLA, time entries) are separate
 * `screen-inventory.md` rows and separate slices. Edit, state change and assignment
 * (`WorkItemJourney`) sit under the description, each gated on the server's strict
 * capability for the item's workspace.
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
  activityFilter,
  onActivityFilterChange,
  project,
  isLoading,
  isNotFound,
  isError,
  onRetry,
  onAccessLost,
  variant = "page",
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
      <div className="bg-background">
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
      </div>
    );
  }

  if (isLoading || !item) {
    return <WorkItemDetailLoading />;
  }

  const description = extractDescription(item.description);
  const hasPartialFailure = item.unavailableFields.length > 0;

  const metadata = (
    <dl
      className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-muted-foreground text-xs"
      data-testid="work-item-metadata"
    >
      {project && (
        <>
          <dt>{t("workItems:detail.projectLabel")}</dt>
          <dd>
            <Link
              to={routes.workItemList.path}
              params={{ projectKey: project.slug }}
              className="text-foreground underline-offset-2 hover:underline"
            >
              {project.name}
            </Link>
          </dd>
        </>
      )}
      <dt>{t("workItems:detail.createdLabel")}</dt>
      <dd className="text-foreground">
        {item.unavailableFields.includes("createdAt") ? (
          <UnavailableField field="createdAt" t={t} />
        ) : (
          formatDateTime(item.createdAt)
        )}
      </dd>
      <dt>{t("workItems:detail.updatedLabel")}</dt>
      <dd className="text-foreground">
        {item.unavailableFields.includes("updatedAt") ? (
          <UnavailableField field="updatedAt" t={t} />
        ) : (
          formatDateTime(item.updatedAt)
        )}
      </dd>
    </dl>
  );

  // Kaneo's task page main column (`task-details-content.tsx`): key, borderless title,
  // description editor, then supporting sections and the activity feed.
  const main = (
    <div
      className={
        variant === "page"
          ? "mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 pt-3 pb-16 sm:px-4 xl:pt-8"
          : "flex w-full flex-col gap-4 px-4 py-3"
      }
    >
      {hasPartialFailure && (
        <Alert variant="warning" data-testid="work-item-detail-partial-notice">
          <Info />
          <AlertTitle>{t("workItems:detail.partialNoticeTitle")}</AlertTitle>
          <AlertDescription>
            <p>{t("workItems:detail.partialNoticeDescription")}</p>
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col gap-2.5">
        <p className="font-semibold text-foreground text-xs">
          {item.unavailableFields.includes("key") ? (
            <UnavailableField field="key" t={t} />
          ) : (
            item.key
          )}
        </p>
        <h1 className="sr-only">{item.title}</h1>
        {item.unavailableFields.includes("title") ? (
          <UnavailableField field="title" t={t} />
        ) : (
          <WorkItemTitle item={item} onAccessLost={onAccessLost} />
        )}
        {description.kind === "unsupported" ? (
          <Badge variant="outline">{t("workItems:detail.unavailable")}</Badge>
        ) : (
          <WorkItemDescription item={item} onAccessLost={onAccessLost} />
        )}
      </div>
      <WorkItemAttachments workItemKey={workItemKey} />
      {variant === "pane" ? (
        <>
          <WorkItemSla workItemKey={workItemKey} compact />
          <WorkItemApprovals workItemKey={workItemKey} compact />
        </>
      ) : null}
      <span className="block h-px w-full shrink-0 bg-border" />
      <WorkItemActivity
        workItemKey={workItemKey}
        workspaceId={item.workspaceId}
        defaultVisibility={item.defaultCommentVisibility}
        filter={activityFilter}
        onFilterChange={onActivityFilterChange}
      />
    </div>
  );

  if (variant === "pane") {
    // Kaneo's task sheet (`task-details-sheet-body.tsx`): a compact properties strip over
    // the scrolling content.
    return (
      <div
        className="flex flex-col bg-background"
        data-testid="work-item-detail"
      >
        <div className="border-border border-b bg-sidebar">
          <WorkItemProperties item={item} compact onAccessLost={onAccessLost} />
        </div>
        {main}
      </div>
    );
  }

  // Kaneo's task page (`task-layout.tsx`): content on the left, the Properties panel on
  // the right (above the content below `lg`).
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background lg:flex-row"
      data-testid="work-item-detail"
    >
      <div className="order-2 min-h-0 flex-1 overflow-y-auto overscroll-contain lg:order-1">
        {main}
      </div>
      <aside className="order-1 border-border/80 border-b bg-card lg:order-2 lg:h-full lg:overflow-y-auto lg:border-b-0 lg:border-l">
        <WorkItemProperties item={item} onAccessLost={onAccessLost}>
          <WorkItemSla workItemKey={workItemKey} compact />
          <WorkItemApprovals workItemKey={workItemKey} compact />
          {metadata}
        </WorkItemProperties>
      </aside>
    </div>
  );
}

export default WorkItemDetail;
