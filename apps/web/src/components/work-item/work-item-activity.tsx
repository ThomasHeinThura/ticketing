import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@taskdesk/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { formatDateTime, formatRelativeTime } from "@/lib/format";

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
  onFilterChange,
}: {
  workItemKey: string;
  workspaceId: string;
  defaultVisibility: "public" | "internal";
  filter: ActivityFilter;
  onFilterChange: (filter: ActivityFilter) => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data: people } = useGetActiveWorkspaceUsers(workspaceId);
  const activity = useGetWorkItemActivity({ key: workItemKey });
  const cannedResponses = useQuery({
    queryKey: ["canned-responses", workspaceId],
    queryFn: () => listCannedResponses(workspaceId),
    enabled: Boolean(workspaceId),
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
  const [editing, setEditing] = useState<string | null>(null);
  const [submitInProgress, setSubmitInProgress] = useState(false);
  const submitInProgressRef = useRef(false);
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
      visibility,
    ],
    queryFn: () =>
      getCommentMentionCandidates({ key: workItemKey, visibility }),
    enabled: Boolean(workItemKey),
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
      visibility,
      mentionPersonIds,
    ],
    queryFn: () =>
      preflightCommentMentions({
        key: workItemKey,
        personIds: mentionPersonIds,
        visibility,
      }),
    enabled: Boolean(workItemKey) && mentionPersonIds.length > 0,
  });
  const rows = activity.data?.pages.flatMap((page) => page.data) ?? [];
  // The API returns newest first; grouping reverses once so the rendered list
  // reads chronologically with the newest entry at the bottom.
  const visibleRows = filterActivityRows(rows, filter);
  const users = people?.members ?? [];
  const displayName = (id: string | null, actorType: string) => {
    if (actorType !== "person")
      return actorType === "system" ? "Automation" : actorType;
    const person = users.find((entry) => entry.userId === id);
    return person?.user?.name ?? person?.user?.email ?? "Former member";
  };
  const displayPersonName = (personId: string | null) => {
    if (!personId) return t("common:unknown");
    // New versions store person.id. Pre-correction rows stored user.id; keep
    // resolving that exact historical value without rewriting it on read.
    const person = users.find(
      (entry) => entry.personId === personId || entry.userId === personId,
    );
    return person?.user?.name ?? person?.user?.email ?? t("common:unknown");
  };
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

  const submit = async () => {
    if (submitInProgressRef.current || !draftText.trim() || !draftDocument)
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
        visibility,
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
        <p role="status" className="text-sm text-muted-foreground">
          {t("activity:timeline.loading")}
        </p>
      )}
      {!activity.isLoading && visibleRows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t("activity:timeline.empty")}
        </p>
      )}
      <ol
        className="flex flex-col gap-3"
        aria-label={t("activity:timeline.heading")}
      >
        {groupConsecutiveActivity(visibleRows).map((group) => {
          const row = group[0];
          const actor = displayName(row.actorId, row.actorType);
          if (isComment(row)) {
            const isDeleted = Boolean(row.deletedAt);
            const body = row.body;
            return (
              <li
                key={row.id}
                className="rounded-lg border bg-card p-3"
                data-visibility={effectiveVisibility(row)}
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <strong>{actor}</strong>
                  <time
                    dateTime={row.createdAt}
                    title={formatDateTime(row.createdAt)}
                  >
                    {formatRelativeTime(row.createdAt)}
                  </time>
                  <span className="text-muted-foreground">
                    {effectiveVisibility(row) === "public"
                      ? t("activity:timeline.public")
                      : t("activity:timeline.internal")}
                  </span>
                  {row.editedAt && !row.deletedAt ? (
                    <CommentVersionHistory
                      workItemKey={workItemKey}
                      commentId={row.id}
                      label={t("activity:timeline.edited")}
                      editorName={displayPersonName}
                    />
                  ) : null}
                  {!isDeleted && editing !== row.id && (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        setEditing(row.id);
                        setEditDraft({
                          text: typeof body === "string" ? body : "",
                          document: isTiptapDocument(body) ? body : undefined,
                        });
                      }}
                    >
                      {t("activity:timeline.edit")}
                    </Button>
                  )}
                </div>
                {isDeleted ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t("activity:timeline.deleted", {
                      actor: row.deletedBy
                        ? displayName(row.deletedBy, "person")
                        : t("common:unknown"),
                      date: formatDateTime(row.deletedAt ?? row.createdAt),
                    })}
                  </p>
                ) : editing === row.id ? (
                  <div className="mt-3 flex flex-col gap-2">
                    {/* Native comments do not yet have mention notification or attachment-linkage endpoints. */}
                    <CommentEditor
                      value={editText}
                      documentValue={editDocument}
                      onContentChange={setEditDraft}
                      uploadSurface="comment"
                      showQuickAttachButton={false}
                      enableMentions={false}
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditing(null)}
                      >
                        {t("activity:timeline.cancel")}
                      </Button>
                      <Button
                        size="sm"
                        disabled={!editText.trim() || updateComment.isPending}
                        onClick={() => void saveEdit()}
                      >
                        {t("activity:timeline.save")}
                      </Button>
                    </div>
                    {updateComment.isError && (
                      <p role="alert" className="text-sm text-destructive">
                        {t("activity:timeline.mutationFailed")}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="mt-2">
                    {isTiptapDocument(body) ? (
                      <CommentEditor
                        value=""
                        documentValue={body}
                        readOnly
                        showBubbleMenu={false}
                      />
                    ) : typeof body === "string" ? (
                      <CommentEditor
                        value={body}
                        readOnly
                        showBubbleMenu={false}
                      />
                    ) : (
                      <p className="whitespace-pre-wrap text-sm">
                        {jsonText(body)}
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          }
          const description = `${row.field ? `${row.field}: ` : ""}${jsonText(row.oldValue)} → ${jsonText(row.newValue)}`;
          return (
            <li
              key={row.id}
              className="rounded-lg border px-3 py-2 text-sm"
              data-visibility={effectiveVisibility(row)}
            >
              <div className="flex flex-wrap items-center gap-2">
                <strong>{actor}</strong>
                <span>{row.verb}</span>
                <time
                  className="text-muted-foreground"
                  dateTime={row.createdAt}
                  title={formatDateTime(row.createdAt)}
                >
                  {formatRelativeTime(row.createdAt)}
                </time>
              </div>
              {row.field && (
                <p className="mt-1 text-muted-foreground">{description}</p>
              )}
              {group.length > 1 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-muted-foreground">
                    {t("activity:timeline.groupedChanges", {
                      count: group.length,
                    })}
                  </summary>
                  <ul className="mt-2 list-inside list-disc">
                    {group.map((entry) => (
                      <li key={entry.id}>
                        {entry.field ?? entry.verb}: {jsonText(entry.oldValue)}{" "}
                        → {jsonText(entry.newValue)}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          );
        })}
      </ol>
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

      <div
        className={
          visibility === "internal"
            ? "rounded-xl border border-warning/50 bg-warning/5 p-3"
            : "rounded-xl border bg-card p-3"
        }
      >
        <label
          className="mb-2 block text-sm font-medium"
          htmlFor="comment-visibility"
        >
          {t("activity:timeline.visibilityLabel")}
        </label>
        <Select
          value={visibility}
          disabled={submitInProgress}
          onValueChange={(value) => {
            const next = value as "public" | "internal";
            updateVisibility(next);
          }}
        >
          <SelectTrigger
            id="comment-visibility"
            aria-label={t("activity:timeline.visibilityLabel")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="internal">
              {t("activity:timeline.internal")}
            </SelectItem>
            <SelectItem value="public">
              {t("activity:timeline.public")}
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="my-2 text-xs text-muted-foreground">
          {visibility === "internal"
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
            disabled={submitInProgress}
            onValueChange={(id) => {
              const response = cannedResponses.data?.find(
                (entry) => entry.id === id,
              );
              if (!response || !isTiptapDocument(response.body)) return;
              setDraft((current) => ({
                ...current,
                document: response.body,
              }));
              if (
                response.visibilityDefault === "public" ||
                response.visibilityDefault === "internal"
              ) {
                updateVisibility(response.visibilityDefault);
              }
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
          disabled={submitInProgress}
          mentionMembers={(mentionCandidates.data ?? []).map((candidate) => ({
            id: candidate.personId,
            label: candidate.name,
            image: candidate.image,
          }))}
          placeholder={t("activity:comment.leavePlaceholder")}
        />
        <div className="mt-2 flex justify-end">
          <Button
            disabled={
              !draftText.trim() || createComment.isPending || submitInProgress
            }
            onClick={() => void submit()}
          >
            {createComment.isPending
              ? t("activity:timeline.sending")
              : t("activity:timeline.send")}
          </Button>
        </div>
        {(createComment.isError || updateComment.isError) && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {t("activity:timeline.mutationFailed")}
          </p>
        )}
      </div>
    </section>
  );
}

export default WorkItemActivity;
