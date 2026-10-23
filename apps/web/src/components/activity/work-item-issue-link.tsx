import { useQuery } from "@tanstack/react-query";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@taskdesk/ui";
import { InputRule } from "@tiptap/core";
import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import {
  TaskDeskIssueLink,
  TaskDeskIssueLinkView,
} from "@/components/task/extensions/taskdesk-issue-link";
import getWorkItem from "@/fetchers/work-item/get-work-item";
import { getPriorityLabel } from "@/lib/i18n/domain";
import { routes } from "@/lib/routes";

const KEY = "[A-Za-z][A-Za-z0-9]{0,15}-\\d{1,9}";

/** `/agent/work-items/{KEY}`: a canonical work-item URL pasted into a comment. */
export function extractWorkItemKeyFromUrl(value: string): string | null {
  try {
    const match = new URL(value).pathname.match(
      new RegExp(`^/agent/work-items/(${KEY})(?:/|$)`),
    );
    return match?.[1] ? match[1].toUpperCase() : null;
  } catch {
    return null;
  }
}

/** A stored `url` that already points at a canonical work-item page (absolute or relative). */
function isCanonicalWorkItemUrl(value: string): boolean {
  return (
    extractWorkItemKeyFromUrl(value) !== null ||
    new RegExp(`^/agent/work-items/${KEY}(?:[/?#]|$)`).test(value)
  );
}

/**
 * CA-14: `#SUP-123` renders the work item's key, title and state and links to its canonical
 * `/agent/work-items/{key}` page. Whether the key resolves is decided by the API with the
 * viewer's own reach: an item the viewer cannot read shows only its key, never a title.
 */
function WorkItemIssueLinkView(props: NodeViewProps) {
  const { node } = props;
  const { t } = useTranslation();
  const issueKey = String(node.attrs.issueKey || "").toUpperCase();
  const legacyTaskId = String(node.attrs.taskId || "");
  const storedUrl = String(node.attrs.url || "");
  const item = useQuery({
    queryKey: ["work-items", "issue-link", issueKey],
    queryFn: () => getWorkItem(issueKey),
    enabled: Boolean(issueKey),
    staleTime: 60_000,
    retry: false,
  });
  const resolved = item.data;
  // Links stored by original Kaneo carry a task id and a `/dashboard/.../task/{id}` URL (often
  // with no key, or with a key of the legacy task store). Those never resolve as work items, so
  // they keep Kaneo's own view and its link to the stored URL instead of a dead chip.
  const isLegacyLink =
    !issueKey ||
    (item.isError &&
      !isCanonicalWorkItemUrl(storedUrl) &&
      Boolean(legacyTaskId || storedUrl));
  if (isLegacyLink) return <TaskDeskIssueLinkView {...props} />;
  const href = issueKey ? routes.workItemDetail.build({ key: issueKey }) : "";
  const title = resolved?.title || (item.isError ? "" : "…");
  const chip = (
    <>
      <span className="taskdesk-issue-link-key">{issueKey}</span>
      {title ? (
        <span className="taskdesk-issue-link-title">{title}</span>
      ) : null}
      {resolved?.stateName ? (
        <span className="taskdesk-issue-link-key">· {resolved.stateName}</span>
      ) : null}
    </>
  );

  return (
    <NodeViewWrapper as="span" className="taskdesk-issue-link-node">
      {resolved ? (
        <HoverCard openDelay={160} closeDelay={120}>
          <HoverCardTrigger asChild>
            <a href={href} className="taskdesk-issue-link-chip">
              {chip}
            </a>
          </HoverCardTrigger>
          <HoverCardContent
            side="top"
            align="start"
            sideOffset={8}
            className="taskdesk-issue-link-preview"
          >
            <div className="taskdesk-issue-link-preview-top">
              <span className="taskdesk-issue-link-preview-key">
                {issueKey}
              </span>
              <span className="taskdesk-issue-link-preview-assignee">
                {resolved.assigneeName ?? t("tasks:assignee.unassigned")}
              </span>
            </div>
            <p className="taskdesk-issue-link-preview-title">
              {resolved.title}
            </p>
            <div className="taskdesk-issue-link-preview-meta">
              <span>{resolved.stateName}</span>
              {resolved.priority ? (
                <>
                  <span>·</span>
                  <span>{getPriorityLabel(resolved.priority)}</span>
                </>
              ) : null}
            </div>
          </HoverCardContent>
        </HoverCard>
      ) : item.isError ? (
        // Missing or out of the viewer's reach: indistinguishable on purpose, and not a link.
        <span
          className="taskdesk-issue-link-chip"
          title={t("workItems:detail.unavailable")}
        >
          <span className="taskdesk-issue-link-key">{issueKey}</span>
        </span>
      ) : (
        <span className="taskdesk-issue-link-chip">{chip}</span>
      )}
    </NodeViewWrapper>
  );
}

/**
 * The editor's `taskdeskIssueLink` node (same name and attributes, so stored documents are
 * unchanged) with the canonical work-item view, plus the `#KEY` + space input rule.
 */
export const WorkItemIssueLink = TaskDeskIssueLink.extend({
  addNodeView() {
    return ReactNodeViewRenderer(WorkItemIssueLinkView);
  },
  addInputRules() {
    const type = this.type;
    return [
      new InputRule({
        find: new RegExp(`(^|\\s)#(${KEY})\\s$`),
        handler: ({ state, range, match }) => {
          const key = String(match[2]).toUpperCase();
          const start = range.from + String(match[1]).length;
          state.tr.replaceWith(start, range.to, [
            type.create({
              url: routes.workItemDetail.build({ key }),
              issueKey: key,
              taskId: "",
            }),
            state.schema.text(" "),
          ]);
        },
      }),
    ];
  },
});
