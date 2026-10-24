import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  useIsMobile,
} from "@taskdesk/ui";
import { ChevronDown, ChevronRight, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { TaskPageFrame } from "@/components/common/task-layout";
import WorkItemChangeSection, {
  useChangeSectionVisible,
} from "@/components/service-management/change-section";
import { TaskDetailContentPresentation } from "@/components/task/task-detail-presentation";
import WorkItemTime from "@/components/time-tracking/work-item-time";
import { useTimeTrackingFeatures } from "@/hooks/queries/time-tracking/use-time-tracking";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { formatDateTime } from "@/lib/format";
import { routes } from "@/lib/routes";
import { parseWorkItemApprovalRequestSearch } from "@/lib/work-item-approval-request-search";
import {
  parseWorkItemDetailSectionsSearch,
  type WorkItemDetailSection,
} from "@/lib/work-item-detail-sections-search";
import { extractDescription, type WorkItemDetailRow } from "@/types/work-item";
import WorkItemActivity, { type ActivityFilter } from "./work-item-activity";
import WorkItemApprovals from "./work-item-approvals";
import WorkItemAttachments from "./work-item-attachments";
import WorkItemAuditHistory from "./work-item-audit-history";
import { WorkItemBlockedBadge } from "./work-item-blocked-badge";
import WorkItemCustomFields from "./work-item-custom-fields";
import WorkItemDescription from "./work-item-description";
import WorkItemDetailLoading from "./work-item-detail-loading";
import { WorkItemFeedbackProvider } from "./work-item-feedback";
import WorkItemHierarchy from "./work-item-hierarchy";
import WorkItemProperties from "./work-item-properties";
import WorkItemRelations from "./work-item-relations";
import WorkItemSla from "./work-item-sla";
import WorkItemTitle from "./work-item-title";
import UnavailableField from "./work-item-unavailable-field";

export type WorkItemDetailProps = {
  item: WorkItemDetailRow | undefined;
  /** The `{key}` from the URL -- shown by the not-found state, where there is no row. */
  workItemKey: string;
  activityFilter: ActivityFilter;
  focusedComment?: string;
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
  pageHeader?: ReactNode;
  pageNotice?: ReactNode;
};

/** Original Kaneo task composition with canonical persisted controls and scoped access-loss states. */
function WorkItemDetail({
  item,
  workItemKey,
  activityFilter,
  focusedComment,
  onActivityFilterChange,
  project,
  isLoading,
  isNotFound,
  isError,
  onRetry,
  onAccessLost,
  variant = "page",
  pageHeader,
  pageNotice,
}: WorkItemDetailProps) {
  const { t } = useTranslation();
  const isCompactPage = useIsMobile(1024);
  // TC-6: the Time section exists only where feature.time_tracking is on for the item's project.
  const timeTracking = useTimeTrackingFeatures(item?.projectId);
  // The time APIs need time_entry:create, which the built-in Viewer role lacks: no Time section
  // (and no error alert) for a caller who cannot log time.
  const { canLogTime } = useWorkspacePermission();
  // P5: the service and change section exists only while the service catalogue is on.
  const changeVisible = useChangeSectionVisible();

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
          <UnavailableField field="createdAt" />
        ) : (
          formatDateTime(item.createdAt)
        )}
      </dd>
      <dt>{t("workItems:detail.updatedLabel")}</dt>
      <dd className="text-foreground">
        {item.unavailableFields.includes("updatedAt") ? (
          <UnavailableField field="updatedAt" />
        ) : (
          formatDateTime(item.updatedAt)
        )}
      </dd>
    </dl>
  );

  // Everything editable sits under a provider keyed by the item: switching items (the side
  // pane's ?item=, or the page's {key}) remounts the title, description and properties, so
  // a pending edit flushes against the item it was typed on and no draft, debounce or
  // conflict notice carries over to the next one.

  const extensions = (
    <WorkItemDetailSections
      workItemKey={workItemKey}
      hidden={[
        ...(timeTracking.time && canLogTime() ? [] : (["time"] as const)),
        ...(changeVisible ? [] : (["change"] as const)),
      ]}
    >
      {{
        attachments: <WorkItemAttachments workItemKey={workItemKey} />,
        sla: <WorkItemSla workItemKey={workItemKey} compact />,
        approvals: <WorkItemApprovals workItemKey={workItemKey} compact />,
        time: <WorkItemTime item={item} />,
        change: <WorkItemChangeSection workItemKey={workItemKey} />,
      }}
    </WorkItemDetailSections>
  );
  // CF-3: the custom fields that apply to this item's type; none renders nothing.
  const customFields = (
    <WorkItemCustomFields item={item} onAccessLost={onAccessLost} />
  );
  const properties = (
    <WorkItemProperties
      item={item}
      compact={variant === "pane"}
      onAccessLost={onAccessLost}
    >
      {variant === "page" && !isCompactPage ? (
        <>
          {customFields}
          {extensions}
          {metadata}
        </>
      ) : null}
    </WorkItemProperties>
  );
  const main = (
    <TaskDetailContentPresentation
      className={
        variant === "page"
          ? "mx-auto flex min-h-0 w-full max-w-3xl flex-col px-3 pb-16 pt-3 sm:px-4 xl:pb-20 xl:pt-8"
          : "flex flex-col px-4 py-4"
      }
      heading={
        <>
          {hasPartialFailure && (
            <Alert
              variant="warning"
              data-testid="work-item-detail-partial-notice"
            >
              <Info />
              <AlertTitle>
                {t("workItems:detail.partialNoticeTitle")}
              </AlertTitle>
              <AlertDescription>
                <p>{t("workItems:detail.partialNoticeDescription")}</p>
              </AlertDescription>
            </Alert>
          )}
          <p className="text-xs font-semibold text-foreground">
            {item.unavailableFields.includes("key") ? (
              <UnavailableField field="key" />
            ) : (
              item.key
            )}
          </p>
          <WorkItemBlockedBadge
            blockedByOpenCount={item.blockedByOpenCount}
            className="self-start"
          />
          <h1 className="sr-only">{item.title}</h1>
          {item.unavailableFields.includes("title") ? (
            <UnavailableField field="title" />
          ) : (
            <WorkItemTitle item={item} onAccessLost={onAccessLost} />
          )}
          {description.kind === "unsupported" ? (
            <Badge variant="outline">{t("workItems:detail.unavailable")}</Badge>
          ) : (
            <WorkItemDescription item={item} onAccessLost={onAccessLost} />
          )}
        </>
      }
      subtasks={
        <WorkItemHierarchy
          workItemKey={workItemKey}
          onAccessLost={onAccessLost}
        />
      }
      relations={
        <WorkItemRelations
          itemKey={workItemKey}
          workspaceId={item.workspaceId}
          projectId={item.projectId}
        />
      }
      supporting={
        variant === "pane" || isCompactPage ? (
          <>
            {customFields}
            {extensions}
          </>
        ) : null
      }
      activity={
        <>
          <WorkItemActivity
            workItemKey={workItemKey}
            workspaceId={item.workspaceId}
            defaultVisibility={item.defaultCommentVisibility}
            focusedComment={focusedComment}
            filter={activityFilter}
            onFilterChange={onActivityFilterChange}
          />
          <WorkItemAuditHistory
            workItemKey={workItemKey}
            workspaceId={item.workspaceId}
            projectId={item.projectId}
          />
        </>
      }
    />
  );

  if (variant === "pane") {
    // Kaneo's task sheet (`task-details-sheet-body.tsx`): a compact properties strip that
    // stays put over the content, which scrolls on its own.
    return (
      <WorkItemFeedbackProvider key={item.key}>
        <div
          className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
          data-testid="work-item-detail"
          data-work-item-intake-scope=""
        >
          <div
            className="flex w-full shrink-0 flex-col gap-0 overflow-y-auto border-border border-b bg-sidebar"
            data-testid="work-item-properties-strip"
          >
            {properties}
          </div>
          <div
            className="min-h-0 flex-1 overflow-y-auto"
            data-testid="work-item-pane-content"
          >
            {main}
          </div>
        </div>
      </WorkItemFeedbackProvider>
    );
  }

  return (
    <WorkItemFeedbackProvider key={item.key}>
      {pageHeader ? (
        <TaskPageFrame
          header={pageHeader}
          notice={pageNotice}
          rightSidebar={properties}
        >
          <div data-testid="work-item-detail" data-work-item-intake-scope="">
            {main}
          </div>
        </TaskPageFrame>
      ) : (
        <div
          className="flex h-full min-h-0 flex-col bg-background lg:flex-row"
          data-testid="work-item-detail"
          data-work-item-intake-scope=""
        >
          <div className="order-2 min-h-0 flex-1 overflow-y-auto overscroll-contain lg:order-1">
            {main}
          </div>
          <aside className="order-1 border-border/80 border-b bg-card lg:order-2 lg:h-full lg:overflow-y-auto lg:border-b-0 lg:border-l">
            {properties}
          </aside>
        </div>
      )}
    </WorkItemFeedbackProvider>
  );
}

/** Kaneo disclosures add capabilities without permanent empty cards in the task content. */
function WorkItemDetailSections({
  workItemKey,
  children,
  hidden = [],
}: {
  workItemKey: string;
  children: Record<WorkItemDetailSection, ReactNode>;
  /** Sections whose feature is off: neither the heading nor the content is offered. */
  hidden?: readonly WorkItemDetailSection[];
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const parsed = parseWorkItemDetailSectionsSearch(location.search).sections;
  const open = parsed?.itemKey === workItemKey ? parsed.open : [];
  const hasApprovalRequest =
    parseWorkItemApprovalRequestSearch(location.search).approvalRequest
      ?.itemKey === workItemKey;
  const setOpen = (section: WorkItemDetailSection, next: boolean) => {
    const sections = next
      ? [...new Set([...open, section])]
      : open.filter((value) => value !== section);
    const params = new URLSearchParams(location.searchStr);
    if (sections.length)
      params.set(
        "sections",
        JSON.stringify({ itemKey: workItemKey, open: sections }),
      );
    else params.delete("sections");
    void navigate({
      href: `${location.pathname}${params.size ? `?${params}` : ""}${location.hash ? `#${location.hash}` : ""}`,
      replace: true,
    });
  };
  return (
    <div
      className="flex flex-col gap-1"
      data-testid="work-item-detail-sections"
    >
      {(["attachments", "sla", "approvals", "time", "change"] as const)
        .filter((section) => !hidden.includes(section))
        .map((section) => {
          const expanded =
            open.includes(section) ||
            (section === "approvals" && hasApprovalRequest);
          return (
            <Collapsible
              key={section}
              open={expanded}
              onOpenChange={(next) => setOpen(section, next)}
            >
              <CollapsibleTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-full justify-start gap-1.5 px-1 text-xs font-medium text-muted-foreground"
                  />
                }
              >
                {expanded ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
                {t(`workItems:detail.${section}.heading`)}
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="py-2">{children[section]}</div>
              </CollapsibleContent>
            </Collapsible>
          );
        })}
    </div>
  );
}

export default WorkItemDetail;
