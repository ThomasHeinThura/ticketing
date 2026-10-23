import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
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
  ArrowUp,
  Calendar,
  ChevronDown,
  CircleAlert,
  History,
  Pencil,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { useAuth } from "@/components/providers/auth-provider/hooks/use-auth";
import listCannedResponses from "@/fetchers/canned-response/list-canned-responses";
import getCommentMentionCandidates from "@/fetchers/work-item/get-comment-mention-candidates";
import type { WorkItemActivityRow } from "@/fetchers/work-item/get-work-item-activity";
import preflightCommentMentions from "@/fetchers/work-item/preflight-comment-mentions";
import useCreateWorkItemComment from "@/hooks/mutations/work-item/use-create-work-item-comment";
import useUpdateWorkItemComment from "@/hooks/mutations/work-item/use-update-work-item-comment";
import useGetWorkItemActivity from "@/hooks/queries/work-item/use-get-work-item-activity";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { WorkItemCommentDelete } from "./work-item-comment-delete";

export type ActivityFilter = "everything" | "comments" | "public";
const EMPTY_COMMENT_DOCUMENT = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

function collectMentionPersonIds(document: unknown): string[] {
  const ids = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (
      node.type === "taskdeskMention" &&
      node.attrs &&
      typeof node.attrs === "object"
    ) {
      const id = (node.attrs as Record<string, unknown>).id;
      if (typeof id === "string" && id) ids.add(id);
    }
    visit(node.content);
  };
  visit(document);
  return [...ids].sort();
}

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

/** Relation activity carries type/direction only; never render arbitrary endpoint data. */
export function activityChangeDescription(
  row: Pick<WorkItemActivityRow, "field" | "verb" | "oldValue" | "newValue">,
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
    const label = row.field ?? (includeVerb ? row.verb : undefined);
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
  const { user } = useAuth();
  const {
    canCreatePublicComments,
    canCreateInternalComments,
    isCheckingPermissions,
  } = useWorkspacePermission(workspaceId);
  const { data: people } = useGetActiveWorkspaceUsers(workspaceId);
  const activity = useGetWorkItemActivity({
    key: workItemKey,
    comment: focusedComment,
  });
  const cannedResponses = useQuery({
    queryKey: ["canned-responses", workItemKey],
    queryFn: () => listCannedResponses(workItemKey),
    enabled: Boolean(workItemKey),
  });
  const queryClient = useQueryClient();
  const createComment = useCreateWorkItemComment();
  const updateComment = useUpdateWorkItemComment();
  const [draft, setDraft] = useState<CommentContentSnapshot>({
    text: "",
    document: EMPTY_COMMENT_DOCUMENT,
  });
  const draftText = draft.text;
  const draftDocument = draft.document;
  const [visibility, setVisibility] = useState<"public" | "internal">(
    defaultVisibility,
  );
  const allowedCommentVisibilities = [
    ...(canCreateInternalComments() ? (["internal"] as const) : []),
    ...(canCreatePublicComments() ? (["public"] as const) : []),
  ];
  const selectedCommentVisibility = allowedCommentVisibilities.includes(
    visibility,
  )
    ? visibility
    : (allowedCommentVisibilities[0] ?? defaultVisibility);
  const [editing, setEditing] = useState<string | null>(null);
  // Edit mode unmounts the row's Edit button. When it closes, focus returns to
  // that button instead of dropping to <body>.
  const [restoreFocusId, setRestoreFocusId] = useState<string | null>(null);
  const editTriggers = useRef(new Map<string, HTMLButtonElement | null>());
  const [submitInProgress, setSubmitInProgress] = useState(false);
  const submitInProgressRef = useRef(false);
  const [insertingSnippet, setInsertingSnippet] = useState(false);
  const [snippetInsertFailed, setSnippetInsertFailed] = useState(false);
  const snippetInsertPending = useRef(false);
  const currentItemKey = useRef(workItemKey);
  currentItemKey.current = workItemKey;
  const composerBusy = submitInProgress || insertingSnippet;
  const [editDraft, setEditDraft] = useState<CommentContentSnapshot>({
    text: "",
    document: undefined,
  });
  const editText = editDraft.text;
  const editDocument = editDraft.document;
  const mentionCandidates = useQuery({
    queryKey: [
      "work-items",
      "comment-mention-candidates",
      workItemKey,
      selectedCommentVisibility,
    ],
    queryFn: () =>
      getCommentMentionCandidates({
        key: workItemKey,
        visibility: selectedCommentVisibility,
      }),
    enabled:
      Boolean(workItemKey) &&
      !isCheckingPermissions &&
      allowedCommentVisibilities.length > 0,
  });
  const mentionPersonIds = useMemo(
    () => collectMentionPersonIds(draftDocument),
    [draftDocument],
  );
  const mentionPreflight = useQuery({
    queryKey: [
      "work-items",
      "comment-mention-preflight",
      workItemKey,
      selectedCommentVisibility,
      mentionPersonIds,
    ],
    queryFn: () =>
      preflightCommentMentions({
        key: workItemKey,
        personIds: mentionPersonIds,
        visibility: selectedCommentVisibility,
      }),
    enabled:
      Boolean(workItemKey) &&
      !isCheckingPermissions &&
      allowedCommentVisibilities.length > 0 &&
      mentionPersonIds.length > 0,
  });
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
  function displayName(id: string | null, actorType: string) {
    if (actorType !== "person")
      return actorType === "system" ? "Automation" : actorType;
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
  function actorProfile(id: string | null, actorType: string) {
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
      name: displayName(id, actorType),
      image: candidate?.image ?? member?.user?.image,
      email: member?.user?.email,
    };
  }
  const activityKey = ["work-items", "activity", workItemKey] as const;
  const draftStorageKey = `taskdesk:comment-draft:${user?.id ?? ""}:${workItemKey}`;
  const [loadedDraftKey, setLoadedDraftKey] = useState<string | null>(null);
  const persistedDraftRef = useRef(draft);
  const visibilityRef = useRef(visibility);
  visibilityRef.current = visibility;

  const persistDraft = (
    snapshot: CommentContentSnapshot,
    nextVisibility = visibilityRef.current,
  ) => {
    if (loadedDraftKey !== draftStorageKey) return;
    persistedDraftRef.current = snapshot;
    try {
      window.localStorage.setItem(
        draftStorageKey,
        JSON.stringify({ ...snapshot, visibility: nextVisibility }),
      );
    } catch {
      // A full or disabled localStorage must not block comment composition.
    }
  };

  const updateVisibility = (nextVisibility: "public" | "internal") => {
    visibilityRef.current = nextVisibility;
    setVisibility(nextVisibility);
    persistDraft(persistedDraftRef.current, nextVisibility);
  };

  useEffect(() => {
    const emptyDraft = { text: "", document: EMPTY_COMMENT_DOCUMENT };
    persistedDraftRef.current = emptyDraft;
    setDraft(emptyDraft);
    visibilityRef.current = defaultVisibility;
    setVisibility(defaultVisibility);
    try {
      const saved = window.localStorage.getItem(draftStorageKey);
      if (!saved) return;
      const parsed: unknown = JSON.parse(saved);
      if (!parsed || typeof parsed !== "object") return;
      const record = parsed as Record<string, unknown>;
      const savedDraft = {
        text: typeof record.text === "string" ? record.text : "",
        document:
          record.document && typeof record.document === "object"
            ? record.document
            : EMPTY_COMMENT_DOCUMENT,
      };
      persistedDraftRef.current = savedDraft;
      setDraft(savedDraft);
      if (record.visibility === "public" || record.visibility === "internal") {
        visibilityRef.current = record.visibility;
        setVisibility(record.visibility);
      }
    } catch {
      try {
        window.localStorage.removeItem(draftStorageKey);
      } catch {
        // Storage can be disabled; the in-memory draft still works.
      }
    } finally {
      setLoadedDraftKey(draftStorageKey);
    }
  }, [defaultVisibility, draftStorageKey]);

  useEffect(() => {
    if (editing !== null || restoreFocusId === null) return;
    editTriggers.current.get(restoreFocusId)?.focus();
    setRestoreFocusId(null);
  }, [editing, restoreFocusId]);

  const submit = async () => {
    if (
      submitInProgressRef.current ||
      snippetInsertPending.current ||
      !draftText.trim() ||
      !draftDocument
    )
      return;
    submitInProgressRef.current = true;
    setSubmitInProgress(true);
    try {
      if (mentionPersonIds.length > 0) {
        await mentionPreflight.refetch();
      }
      await createComment.mutateAsync({
        key: workItemKey,
        body: draftDocument,
        visibility: selectedCommentVisibility,
      });
      const emptyDraft = { text: "", document: EMPTY_COMMENT_DOCUMENT };
      persistedDraftRef.current = emptyDraft;
      setDraft(emptyDraft);
      await queryClient.invalidateQueries({
        queryKey: ["work-items", "comment-mention-candidates", workItemKey],
      });
      try {
        window.localStorage.removeItem(draftStorageKey);
      } catch {
        // A successful post is not undone when storage is disabled.
      }
      await queryClient.invalidateQueries({ queryKey: activityKey });
    } catch {
      // Server capability checks are authoritative; the composer remains intact on 403/422.
    } finally {
      submitInProgressRef.current = false;
      setSubmitInProgress(false);
    }
  };

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
      className="flex flex-col gap-4"
      aria-labelledby="work-item-activity-heading"
      data-testid="work-item-activity"
    >
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

      <div
        hidden={
          isCheckingPermissions || allowedCommentVisibilities.length === 0
        }
        className="w-full"
        data-testid="work-item-comment-composer"
      >
        <label
          className="mb-2 block text-sm font-medium"
          htmlFor="comment-visibility"
        >
          {t("activity:timeline.visibilityLabel")}
        </label>
        <Select
          items={allowedCommentVisibilities.map((value) => ({
            value,
            label: t(`activity:timeline.${value}`),
          }))}
          value={selectedCommentVisibility}
          disabled={composerBusy}
          onValueChange={(value) => {
            const next = value as "public" | "internal";
            updateVisibility(next);
          }}
        >
          <SelectTrigger
            id="comment-visibility"
            aria-label={t("activity:timeline.visibilityLabel")}
          >
            <SelectValue>
              {t(`activity:timeline.${selectedCommentVisibility}`)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {allowedCommentVisibilities.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`activity:timeline.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="my-2 text-xs text-muted-foreground">
          {selectedCommentVisibility === "internal"
            ? t("activity:timeline.internalNotice")
            : t("activity:timeline.publicNotice")}
        </p>
        {mentionPreflight.data?.unreachablePersonIds.length ? (
          <Alert variant="warning" role="status" className="mb-2">
            <AlertDescription>
              {t("activity:timeline.mentionWarning", {
                people: mentionPreflight.data.unreachablePersonIds
                  .map(
                    (personId) =>
                      mentionCandidates.data?.find(
                        (candidate) => candidate.personId === personId,
                      )?.name ?? t("activity:timeline.mentionUnavailable"),
                  )
                  .join(", "),
              })}
            </AlertDescription>
          </Alert>
        ) : mentionPreflight.isError ? (
          <p className="mb-2 text-sm text-warning-foreground" role="status">
            {t("activity:timeline.mentionCheckFailed")}
          </p>
        ) : null}
        {cannedResponses.data && cannedResponses.data.length > 0 && (
          <Select
            value=""
            disabled={composerBusy}
            onValueChange={(id) => {
              if (
                !id ||
                snippetInsertPending.current ||
                submitInProgressRef.current
              )
                return;
              const key = workItemKey;
              snippetInsertPending.current = true;
              setInsertingSnippet(true);
              setSnippetInsertFailed(false);
              // Cached rows populate the menu only. Resolve current context and
              // revalidate item reach at the moment the agent chooses a template.
              void listCannedResponses(key)
                .then((responses) => {
                  if (currentItemKey.current !== key) return;
                  const response = responses.find((entry) => entry.id === id);
                  if (!response || !isTiptapDocument(response.body)) {
                    setSnippetInsertFailed(true);
                    return;
                  }
                  setDraft((current) => ({
                    ...current,
                    document: response.body,
                  }));
                  if (
                    (response.visibilityDefault === "public" ||
                      response.visibilityDefault === "internal") &&
                    allowedCommentVisibilities.includes(
                      response.visibilityDefault,
                    )
                  )
                    updateVisibility(response.visibilityDefault);
                })
                .catch(() => {
                  if (currentItemKey.current === key)
                    setSnippetInsertFailed(true);
                })
                .finally(() => {
                  snippetInsertPending.current = false;
                  setInsertingSnippet(false);
                });
            }}
          >
            <SelectTrigger
              aria-label={t("activity:timeline.cannedResponses")}
              className="mb-2"
            >
              <SelectValue
                placeholder={t("activity:timeline.insertCannedResponse")}
              />
            </SelectTrigger>
            <SelectContent>
              {cannedResponses.data.map((response) => (
                <SelectItem key={response.id} value={response.id}>
                  {response.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {snippetInsertFailed ? (
          <Alert variant="error" role="alert">
            <AlertDescription>
              {t("activity:timeline.cannedResponseInsertFailed")}
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="rounded-xl border border-border/80 bg-card/70 transition-colors focus-within:border-ring/60 focus-within:shadow-[0_0_0_2px_color-mix(in_srgb,var(--ring)_20%,transparent)]">
          <CommentEditor
            value={draftText}
            documentValue={draftDocument}
            onContentChange={(snapshot) => {
              setDraft(snapshot);
              persistDraft(snapshot);
            }}
            uploadSurface="comment"
            showQuickAttachButton={false}
            enableMentions
            disabled={composerBusy}
            mentionMembers={(mentionCandidates.data ?? []).map((candidate) => ({
              id: candidate.personId,
              label: candidate.name,
              image: candidate.image,
            }))}
            placeholder={t("activity:comment.leavePlaceholder")}
            className="[&_.taskdesk-comment-editor-content_.ProseMirror]:min-h-[3rem] [&_.taskdesk-comment-editor-content_.ProseMirror]:max-h-none [&_.taskdesk-comment-editor-content_.ProseMirror]:overflow-visible [&_.taskdesk-comment-editor-content_.ProseMirror]:px-3 [&_.taskdesk-comment-editor-content_.ProseMirror]:pt-3 [&_.taskdesk-comment-editor-content_.ProseMirror]:pb-2"
            onSubmitShortcut={() => void submit()}
          />
          <div className="flex items-center justify-end gap-2 border-border/70 border-t px-2 py-2">
            <Button
              size="xs"
              aria-label={
                createComment.isPending
                  ? t("activity:timeline.sending")
                  : t("activity:timeline.send")
              }
              aria-busy={createComment.isPending}
              disabled={
                !draftText.trim() || createComment.isPending || composerBusy
              }
              onClick={() => void submit()}
            >
              <ArrowUp className="size-3.5" />
            </Button>
          </div>
        </div>
        {(createComment.isError || updateComment.isError) && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {t("activity:timeline.mutationFailed")}
          </p>
        )}
      </div>

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
              : actorProfile(row.actorId, row.actorType);
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
                  </CommentCardPresentation>
                </TimelineContent>
              </TimelineItem>
            );
          }
          const description = activityChangeDescription(row, t);
          const icon =
            row.field === "priority" ? (
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
              {row.field ? (
                <span className="text-sm text-muted-foreground">
                  {description}
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">
                  {row.verb === "attachment.added" ||
                  row.verb === "attachment.deleted"
                    ? activityChangeDescription(row, t)
                    : row.verb}
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
