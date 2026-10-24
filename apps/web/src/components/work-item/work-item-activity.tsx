import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Timeline,
  TimelineContent,
  TimelineItem,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@taskdesk/ui";
import {
  Calendar,
  ChevronDown,
  CircleAlert,
  History,
  Pencil,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityActorPresentation,
  ActivityAvatarPresentation,
  ActivityEventPresentation,
  CommentCardPresentation,
} from "@/components/activity/comment-card-presentation";
import CommentEditor, {
  type CommentContentSnapshot,
} from "@/components/activity/comment-editor";
import CommentVersionHistory from "@/components/activity/comment-version-history";
import { listWorkItemAttachments } from "@/fetchers/attachment/work-item-attachments";
import { enqueueWorkItemUploads } from "@/fetchers/attachment/work-item-upload-queue";
import getCommentMentionCandidates from "@/fetchers/work-item/get-comment-mention-candidates";
import type { WorkItemActivityRow } from "@/fetchers/work-item/get-work-item-activity";
import useUpdateWorkItemComment from "@/hooks/mutations/work-item/use-update-work-item-comment";
import useGetWorkItemActivity from "@/hooks/queries/work-item/use-get-work-item-activity";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import {
  useWorkItemFileIntake,
  WorkItemFileDropOverlay,
} from "./work-item-attachments-intake";
import WorkItemAttachmentLightbox from "./work-item-attachments-lightbox";
import { isInlineImage } from "./work-item-attachments-tile";
import {
  useAttachmentsPanelMounted,
  useWorkItemUploads,
  WorkItemUploadList,
} from "./work-item-attachments-uploads";
import WorkItemCommentAttachments from "./work-item-comment-attachments";
import WorkItemCommentComposer from "./work-item-comment-composer";
import { WorkItemCommentDelete } from "./work-item-comment-delete";

export type ActivityFilter = "everything" | "comments" | "public";
function effectiveVisibility(row: WorkItemActivityRow): "public" | "internal" {
  return row.visibility === "public" ? "public" : "internal";
}

export function filterActivityRows(
  rows: WorkItemActivityRow[],
  filter: ActivityFilter,
): WorkItemActivityRow[] {
  return rows.filter((row) => {
    if (filter === "comments") return isComment(row);
    if (filter === "public") return effectiveVisibility(row) === "public";
    return true;
  });
}

export function groupConsecutiveActivity(
  rows: WorkItemActivityRow[],
): WorkItemActivityRow[][] {
  const chronological = [...rows].reverse();
  const groups: WorkItemActivityRow[][] = [];
  for (const row of chronological) {
    const previous = groups.at(-1);
    const previousRow = previous?.at(-1);
    const sameActor =
      previousRow?.actorId !== null &&
      previousRow?.actorId !== undefined &&
      row.actorId !== null &&
      previousRow.actorId === row.actorId &&
      previousRow.actorType === row.actorType;
    const withinWindow =
      previousRow !== undefined &&
      new Date(row.createdAt).getTime() -
        new Date(previousRow.createdAt).getTime() <=
        5 * 60 * 1000;
    if (
      previous &&
      sameActor &&
      withinWindow &&
      row.kind !== "comment" &&
      previousRow?.kind !== "comment"
    ) {
      previous.push(row);
    } else {
      groups.push([row]);
    }
  }
  return groups;
}

function jsonText(value: unknown) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "—";
  try {
    return JSON.stringify(value);
  } catch {
    return "Unavailable";
  }
}

/** `WF-21`: a customer reply or upload on a resolved request the workflow could not reopen. */
export const REOPEN_REQUESTED_VERB = "reopen_requested";

/** A bare activity verb as a sentence; keys with no catalogue label read as plain words. */
export function activityVerbLabel(
  verb: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const words = verb.replace(/[._]+/g, " ").trim();
  return t(`activity:timeline.verbs.${verb.replace(/\./g, "_")}`, {
    defaultValue: words.charAt(0).toUpperCase() + words.slice(1),
  });
}

/** A custom-field edit is one `custom_field` row whose payload names the field. */
function customFieldLabel(row: { field?: string | null; payload?: unknown }) {
  if (row.field !== "custom_field") return undefined;
  const name = (row.payload as { name?: unknown } | null | undefined)?.name;
  return typeof name === "string" && name.trim() ? name.trim() : undefined;
}

/** Relation activity carries type/direction only; never render arbitrary endpoint data. */
export function activityChangeDescription(
  row: Pick<WorkItemActivityRow, "field" | "verb" | "oldValue" | "newValue"> & {
    payload?: unknown;
  },
  t: (key: string) => string,
  includeVerb = false,
): string {
  if (row.field === "description")
    return t("activity:timeline.descriptionUpdated");
  if (row.field === "label") return t("activity:timeline.labelsUpdated");
  if (
    !row.field &&
    (row.verb === "attachment.added" || row.verb === "attachment.deleted")
  )
    return t(
      row.verb === "attachment.added"
        ? "activity:timeline.attachmentAdded"
        : "activity:timeline.attachmentDeleted",
    );
  if (row.field !== "relation") {
    const label =
      customFieldLabel(row) ??
      row.field ??
      (includeVerb ? activityVerbLabel(row.verb, t) : undefined);
    return `${label ? `${label}: ` : ""}${jsonText(row.oldValue)} → ${jsonText(row.newValue)}`;
  }
  const relationLabel = (value: unknown): string => {
    if (value === null || value === undefined) return "—";
    if (!value || typeof value !== "object" || Array.isArray(value))
      return t("workItems:detail.unavailable");
    const record = value as Record<string, unknown>;
    if (record.direction !== "outgoing" && record.direction !== "incoming")
      return t("workItems:detail.unavailable");
    const inverse = {
      relates: "relates",
      blocks: "blocked_by",
      duplicates: "duplicated_by",
      precedes: "follows",
      requires: "required_by",
    } as const;
    if (typeof record.type !== "string" || !Object.hasOwn(inverse, record.type))
      return t("workItems:detail.unavailable");
    const type = record.type as keyof typeof inverse;
    return t(
      `workItems:relations.types.${record.direction === "incoming" ? inverse[type] : type}`,
    );
  };
  return `${t("tasks:relations.title")}: ${relationLabel(row.oldValue)} → ${relationLabel(row.newValue)}`;
}

/**
 * CA-9: system actions are attributed to what made them, never to a person. The activity row
 * carries the actor's kind; a job or automation that names itself in the row payload is
 * shown by that name.
 */
export function nonPersonActorLabel(
  actorType: string,
  t: (key: string) => string,
  payload?: unknown,
): string {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    for (const key of ["automationName", "jobName"] as const) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  if (actorType === "automation")
    return t("activity:timeline.actors.automation");
  if (actorType === "api_key") return t("activity:timeline.actors.apiKey");
  return t("activity:timeline.actors.system");
}

function isComment(row: WorkItemActivityRow) {
  return row.kind === "comment";
}

function isTiptapDocument(value: unknown): value is Record<string, unknown> {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).type === "doc",
  );
}

function WorkItemActivity({
  workItemKey,
  workspaceId,
  defaultVisibility,
  filter,
  focusedComment,
  onFilterChange,
}: {
  workItemKey: string;
  workspaceId: string;
  defaultVisibility: "public" | "internal";
  filter: ActivityFilter;
  focusedComment?: string;
  onFilterChange: (filter: ActivityFilter) => void;
}) {
  const { t } = useTranslation();
  const permissions = useWorkspacePermission(workspaceId);
  const {
    canCreatePublicComments,
    canCreateInternalComments,
    isCheckingPermissions,
  } = permissions;
  const { data: people } = useGetActiveWorkspaceUsers(workspaceId);
  const activity = useGetWorkItemActivity({
    key: workItemKey,
    comment: focusedComment,
  });
  const queryClient = useQueryClient();
  const updateComment = useUpdateWorkItemComment();
  const canReadPeople =
    canCreateInternalComments() || canCreatePublicComments();
  const [editing, setEditing] = useState<string | null>(null);
  // Edit mode unmounts the row's Edit button. When it closes, focus returns to
  // that button instead of dropping to <body>.
  const [restoreFocusId, setRestoreFocusId] = useState<string | null>(null);
  const editTriggers = useRef(new Map<string, HTMLButtonElement | null>());
  const [editDraft, setEditDraft] = useState<CommentContentSnapshot>({
    text: "",
    document: undefined,
  });
  const editText = editDraft.text;
  const editDocument = editDraft.document;
  // Names for actors and uploaders: the reach-filtered people the composer mentions from.
  const mentionCandidates = useQuery({
    queryKey: [
      "work-items",
      "comment-mention-candidates",
      workItemKey,
      canCreateInternalComments() ? "internal" : "public",
    ],
    queryFn: () =>
      getCommentMentionCandidates({
        key: workItemKey,
        visibility: canCreateInternalComments() ? "internal" : "public",
      }),
    enabled: Boolean(workItemKey) && !isCheckingPermissions && canReadPeople,
  });
  // AT-1: files attached to comments render on their comment's card.
  const attachmentList = useQuery({
    queryKey: ["work-items", "attachments", workItemKey],
    queryFn: () => listWorkItemAttachments(workItemKey),
    enabled: Boolean(workItemKey),
  });
  const readyAttachments = (
    Array.isArray(attachmentList.data) ? attachmentList.data : []
  ).filter((attachment) => attachment.state === "ready");
  const commentAttachments = (commentId: string) =>
    readyAttachments.filter((attachment) => attachment.commentId === commentId);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewImages = readyAttachments.filter((attachment) =>
    isInlineImage(attachment.mimeType),
  );
  const uploaderName = (personId: string | null) =>
    personId
      ? mentionCandidates.data?.find((entry) => entry.personId === personId)
          ?.name
      : undefined;
  // AT-10/AT-11: files dropped or pasted anywhere on the detail attach to the work item.
  const canAttachToItem =
    !isCheckingPermissions && permissions.canCreateAttachments();
  const sectionRef = useRef<HTMLElement>(null);
  const { dragging, bounds: dropBounds } = useWorkItemFileIntake({
    anchorRef: sectionRef,
    enabled: canAttachToItem,
    onFiles: (files) =>
      enqueueWorkItemUploads({
        itemKey: workItemKey,
        files,
        onDone: () => {
          void queryClient.invalidateQueries({
            queryKey: ["work-items", "attachments", workItemKey],
          });
          void queryClient.invalidateQueries({
            queryKey: ["work-items", "activity", workItemKey],
          });
        },
      }),
  });
  const panelMounted = useAttachmentsPanelMounted();
  const itemUploads = useWorkItemUploads(workItemKey);
  const focusedCommentRef = useRef<HTMLDivElement>(null);
  const rows = activity.data?.pages.flatMap((page) => page.data) ?? [];
  // The API returns newest first; grouping reverses once so the rendered list
  // reads chronologically with the newest entry at the bottom.
  const visibleRows = filterActivityRows(rows, filter);
  const hasFocusedComment = Boolean(
    focusedComment &&
      visibleRows.some((row) => isComment(row) && row.id === focusedComment),
  );
  useEffect(() => {
    if (!hasFocusedComment || !focusedComment) return;
    const target = focusedCommentRef.current;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ block: "center" });
  }, [focusedComment, hasFocusedComment]);
  const users = people?.members ?? [];
  function displayName(
    id: string | null,
    actorType: string,
    payload?: unknown,
  ) {
    if (actorType !== "person")
      return nonPersonActorLabel(actorType, t, payload);
    return displayPersonName(id);
  }
  function displayPersonName(personId: string | null) {
    if (!personId) return t("common:people.unknown");
    // Mention candidates carry person IDs and are already filtered by current
    // work-item reach. The workspace-members DTO only carries user IDs, so use
    // that legacy mapping only when no reachable person candidate is available.
    const candidate = mentionCandidates.data?.find(
      (entry) => entry.personId === personId && entry.reachable,
    );
    if (candidate) return candidate.name;
    const member = users.find((entry) => entry.userId === personId);
    return (
      member?.user?.name ?? member?.user?.email ?? t("common:people.unknown")
    );
  }
  function actorProfile(
    id: string | null,
    actorType: string,
    payload?: unknown,
  ) {
    const candidate =
      actorType === "person"
        ? mentionCandidates.data?.find(
            (entry) => entry.personId === id && entry.reachable,
          )
        : undefined;
    const member =
      actorType === "person"
        ? users.find((entry) => entry.userId === id)
        : undefined;
    return {
      name: displayName(id, actorType, payload),
      image: candidate?.image ?? member?.user?.image,
      email: member?.user?.email,
    };
  }
  const activityKey = ["work-items", "activity", workItemKey] as const;

  useEffect(() => {
    if (editing !== null || restoreFocusId === null) return;
    editTriggers.current.get(restoreFocusId)?.focus();
    setRestoreFocusId(null);
  }, [editing, restoreFocusId]);

  const saveEdit = async () => {
    if (!editing || !editText.trim() || !editDocument) return;
    try {
      await updateComment.mutateAsync({ id: editing, body: editDocument });
      setRestoreFocusId(editing);
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: activityKey });
      await queryClient.invalidateQueries({
        queryKey: ["work-items", "comment-versions", workItemKey, editing],
      });
    } catch {
      // Keep the editor open so a failed edit can be retried or cancelled.
    }
  };

  return (
    <section
      ref={sectionRef}
      className="flex flex-col gap-4"
      aria-labelledby="work-item-activity-heading"
      data-testid="work-item-activity"
    >
      <WorkItemFileDropOverlay active={dragging} bounds={dropBounds} />
      <WorkItemAttachmentLightbox
        images={previewImages}
        openId={previewId}
        onOpenChange={(open) => {
          if (!open) setPreviewId(null);
        }}
        onNavigate={setPreviewId}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="work-item-activity-heading" className="font-medium text-lg">
          {t("activity:timeline.heading")}
        </h2>
        <Select
          items={[
            { value: "everything", label: t("activity:timeline.everything") },
            { value: "comments", label: t("activity:timeline.comments") },
            { value: "public", label: t("activity:timeline.publicOnly") },
          ]}
          value={filter}
          onValueChange={(value) => onFilterChange(value as ActivityFilter)}
        >
          <SelectTrigger
            aria-label={t("activity:timeline.filterLabel")}
            className="w-44"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="everything">
              {t("activity:timeline.everything")}
            </SelectItem>
            <SelectItem value="comments">
              {t("activity:timeline.comments")}
            </SelectItem>
            <SelectItem value="public">
              {t("activity:timeline.publicOnly")}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <WorkItemCommentComposer
        workItemKey={workItemKey}
        workspaceId={workspaceId}
        defaultVisibility={defaultVisibility}
      />
      {!panelMounted ? <WorkItemUploadList uploads={itemUploads} /> : null}

      {activity.isError && (
        <Alert variant="error" role="alert">
          <AlertDescription>
            {t("activity:timeline.loadFailed")}{" "}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void activity.refetch()}
            >
              {t("activity:timeline.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {activity.isLoading && (
        // Timeline placeholders remain below the composer; status stays accessible.
        <div
          role="status"
          aria-busy="true"
          className="flex flex-col gap-3"
          data-testid="work-item-activity-loading"
        >
          <span className="sr-only">{t("activity:timeline.loading")}</span>
          {[0, 1, 2, 3].map((index) => (
            <div
              key={index}
              aria-hidden="true"
              className="flex flex-col gap-2 rounded-lg border p-3"
            >
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ))}
        </div>
      )}
      {!activity.isLoading && !activity.isError && visibleRows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t("activity:timeline.empty")}
        </p>
      )}
      <Timeline role="list" aria-label={t("activity:timeline.heading")}>
        {groupConsecutiveActivity(visibleRows).map((group, index, groups) => {
          const row = group[0];
          const profile =
            isComment(row) && Object.hasOwn(row, "actorPersonId")
              ? {
                  name:
                    row.actorPersonId && row.actorDisplayName
                      ? row.actorDisplayName
                      : t("common:people.unknown"),
                  image: undefined,
                  email: undefined,
                }
              : actorProfile(row.actorId, row.actorType, row.payload);
          const timestamp = (
            <time
              className="whitespace-nowrap text-xs text-muted-foreground"
              dateTime={row.createdAt}
              title={formatDateTime(row.createdAt)}
            >
              {formatRelativeTime(row.createdAt)}
            </time>
          );
          if (isComment(row)) {
            const isDeleted = Boolean(row.deletedAt);
            const body = row.body;
            const isEditing = editing === row.id;
            return (
              <TimelineItem
                key={row.id}
                step={index + 1}
                role="listitem"
                className="m-0! flex-row items-start py-2!"
              >
                <TimelineContent className="min-w-0 flex-1">
                  <CommentCardPresentation
                    id={`comment-${row.id}`}
                    ref={
                      row.id === focusedComment ? focusedCommentRef : undefined
                    }
                    tabIndex={-1}
                    data-focused-comment={
                      row.id === focusedComment ? "true" : undefined
                    }
                    className={
                      row.id === focusedComment ? "ring-2 ring-ring" : undefined
                    }
                    data-visibility={effectiveVisibility(row)}
                    header={
                      <>
                        <ActivityActorPresentation {...profile} />
                        {timestamp}
                        <span className="text-xs text-muted-foreground">
                          {effectiveVisibility(row) === "public"
                            ? t("activity:timeline.public")
                            : t("activity:timeline.internal")}
                        </span>
                        {row.editedAt && !isDeleted ? (
                          <CommentVersionHistory
                            workItemKey={workItemKey}
                            commentId={row.id}
                            label={t("activity:timeline.edited")}
                            editorName={displayPersonName}
                          />
                        ) : null}
                      </>
                    }
                    actions={
                      !isDeleted &&
                      !isEditing &&
                      (row.canEdit === true || row.canDelete === true) ? (
                        <>
                          {row.canEdit === true && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 w-6 rounded-md p-0 text-muted-foreground hover:text-foreground"
                                    aria-label={t("activity:timeline.edit")}
                                    ref={(node: HTMLButtonElement | null) => {
                                      editTriggers.current.set(row.id, node);
                                    }}
                                    onClick={() => {
                                      setEditing(row.id);
                                      setEditDraft({
                                        text:
                                          typeof body === "string" ? body : "",
                                        document: isTiptapDocument(body)
                                          ? body
                                          : undefined,
                                      });
                                    }}
                                  >
                                    <Pencil className="size-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {t("activity:timeline.edit")}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                          <WorkItemCommentDelete
                            workItemKey={workItemKey}
                            commentId={row.id}
                            canDelete={row.canDelete === true}
                          />
                        </>
                      ) : undefined
                    }
                    footer={
                      !isDeleted && isEditing ? (
                        <div className="flex items-center justify-end gap-2 border-border/70 border-t bg-card/60 px-3 py-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            className="h-7 px-2.5 text-xs"
                            onClick={() => {
                              setRestoreFocusId(row.id);
                              setEditing(null);
                            }}
                          >
                            {t("activity:timeline.cancel")}
                          </Button>
                          <Button
                            size="sm"
                            className="h-7 px-2.5 text-xs"
                            disabled={
                              !editText.trim() || updateComment.isPending
                            }
                            onClick={() => void saveEdit()}
                          >
                            {t("activity:timeline.save")}
                          </Button>
                          {updateComment.isError ? (
                            <p
                              role="alert"
                              className="text-sm text-destructive"
                            >
                              {t("activity:timeline.mutationFailed")}
                            </p>
                          ) : null}
                        </div>
                      ) : undefined
                    }
                  >
                    {isDeleted ? (
                      <p className="px-3 py-3 text-sm text-muted-foreground">
                        {t("activity:timeline.deleted", {
                          actor: row.deletedBy
                            ? displayName(row.deletedBy, "person")
                            : t("common:people.unknown"),
                          date: formatDateTime(row.deletedAt ?? row.createdAt),
                        })}
                      </p>
                    ) : isEditing ? (
                      <CommentEditor
                        value={editText}
                        documentValue={editDocument}
                        onContentChange={setEditDraft}
                        uploadSurface="comment"
                        showQuickAttachButton={false}
                        enableMentions={false}
                        autoFocus="end"
                        className="[&_.taskdesk-comment-editor-content_.ProseMirror]:min-h-[3rem] [&_.taskdesk-comment-editor-content_.ProseMirror]:max-h-none [&_.taskdesk-comment-editor-content_.ProseMirror]:overflow-visible [&_.taskdesk-comment-editor-content_.ProseMirror]:px-3 [&_.taskdesk-comment-editor-content_.ProseMirror]:pt-2.5 [&_.taskdesk-comment-editor-content_.ProseMirror]:pb-2"
                      />
                    ) : isTiptapDocument(body) || typeof body === "string" ? (
                      <CommentEditor
                        value={typeof body === "string" ? body : ""}
                        documentValue={
                          isTiptapDocument(body) ? body : undefined
                        }
                        readOnly
                        showBubbleMenu={false}
                        showQuickAttachButton={false}
                        className="taskdesk-comment-viewer [&_.taskdesk-comment-editor-content_.ProseMirror]:px-3 [&_.taskdesk-comment-editor-content_.ProseMirror]:pt-2 [&_.taskdesk-comment-editor-content_.ProseMirror]:pb-3"
                      />
                    ) : (
                      <p className="whitespace-pre-wrap px-3 py-3 text-sm">
                        {jsonText(body)}
                      </p>
                    )}
                    {isDeleted ? null : (
                      <WorkItemCommentAttachments
                        workItemKey={workItemKey}
                        commentId={row.id}
                        attachments={commentAttachments(row.id)}
                        uploaderName={uploaderName}
                        onPreview={(file) => setPreviewId(file.id)}
                      />
                    )}
                  </CommentCardPresentation>
                </TimelineContent>
              </TimelineItem>
            );
          }
          const description = activityChangeDescription(row, t);
          const icon =
            row.verb === REOPEN_REQUESTED_VERB ? (
              <TriangleAlert className="size-4" />
            ) : row.field === "priority" ? (
              <CircleAlert className="size-4" />
            ) : row.field === "assignee" ? (
              <UserRound className="size-4" />
            ) : row.field === "dueDate" ? (
              <Calendar className="size-4" />
            ) : (
              <History className="size-4" />
            );
          return (
            <ActivityEventPresentation
              key={row.id}
              step={index + 1}
              icon={icon}
              avatar={
                <ActivityAvatarPresentation
                  name={profile.name}
                  image={profile.image}
                />
              }
              actor={
                <ActivityActorPresentation {...profile} showAvatar={false} />
              }
              timestamp={timestamp}
              showConnector={Boolean(
                groups[index + 1] && !isComment(groups[index + 1][0]),
              )}
            >
              {row.verb === REOPEN_REQUESTED_VERB ? (
                <span
                  className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
                  data-testid="work-item-reopen-requested"
                >
                  <Badge variant="warning">
                    <TriangleAlert className="size-3" aria-hidden="true" />
                    {t("activity:timeline.reopenRequested.badge")}
                  </Badge>
                  {t("activity:timeline.reopenRequested.description")}
                </span>
              ) : row.field ? (
                <span className="text-sm text-muted-foreground">
                  {description}
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">
                  {row.verb === "attachment.added" ||
                  row.verb === "attachment.deleted"
                    ? activityChangeDescription(row, t)
                    : activityVerbLabel(row.verb, t)}
                </span>
              )}
              {group.length > 1 ? (
                <Collapsible className="mt-2">
                  <CollapsibleTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-auto justify-start gap-1 px-0 py-0 text-xs text-muted-foreground"
                      />
                    }
                  >
                    <ChevronDown className="size-3" />
                    {t("activity:timeline.groupedChanges", {
                      count: group.length,
                    })}
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <ul className="mt-2 list-inside list-disc text-xs">
                      {group.map((entry) => (
                        <li key={entry.id}>
                          {activityChangeDescription(entry, t, true)}
                        </li>
                      ))}
                    </ul>
                  </CollapsibleContent>
                </Collapsible>
              ) : null}
            </ActivityEventPresentation>
          );
        })}
      </Timeline>

      {activity.hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          disabled={activity.isFetchingNextPage}
          onClick={() => void activity.fetchNextPage()}
        >
          {activity.isFetchingNextPage
            ? t("activity:timeline.loading")
            : t("activity:timeline.loadMore")}
        </Button>
      )}
    </section>
  );
}

export default WorkItemActivity;
