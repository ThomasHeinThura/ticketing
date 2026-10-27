import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Button,
  ToggleGroup,
  ToggleGroupItem,
} from "@taskdesk/ui";
import { ArrowUp, Globe, Lock, Paperclip } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  COMMENT_COMPOSER_EDITOR_CLASS,
  CommentComposerPresentation,
} from "@/components/activity/comment-composer-presentation";
import CommentEditor, {
  type CommentContentSnapshot,
} from "@/components/activity/comment-editor";
import { PickerPopover } from "@/components/common/picker-popover";
import { useAuth } from "@/components/providers/auth-provider/hooks/use-auth";
import { enqueueWorkItemUploads } from "@/fetchers/attachment/work-item-upload-queue";
import listCannedResponses from "@/fetchers/canned-response/list-canned-responses";
import getCommentMentionCandidates from "@/fetchers/work-item/get-comment-mention-candidates";
import preflightCommentMentions from "@/fetchers/work-item/preflight-comment-mentions";
import useCreateWorkItemComment from "@/hooks/mutations/work-item/use-create-work-item-comment";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import CreateWorkItemStagedAttachments from "./create-work-item-staged-attachments";
import type { StagedWorkItemAttachment } from "./use-create-work-item-attachments";

const EMPTY_COMMENT_DOCUMENT = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

export function collectMentionPersonIds(document: unknown): string[] {
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

function isTiptapDocument(value: unknown): value is Record<string, unknown> {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).type === "doc",
  );
}

/**
 * Files chosen for a comment stay in browser memory until the comment exists: the attachment
 * row needs the comment's id (AT-1), and no blob URL ever enters the stored document (CA-15).
 */
function useStagedCommentFiles(scope: string) {
  const [rows, setRows] = useState<StagedWorkItemAttachment[]>([]);
  const latest = useRef(rows);
  const nextId = useRef(0);
  const publish = (value: StagedWorkItemAttachment[]) => {
    latest.current = value;
    setRows(value);
  };
  const release = (row: StagedWorkItemAttachment) => {
    if (row.preview) URL.revokeObjectURL(row.preview);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: a different work item starts with no staged files.
  useEffect(() => {
    return () => {
      for (const row of latest.current) release(row);
      latest.current = [];
      setRows([]);
    };
  }, [scope]);
  return {
    rows,
    stage(files: File[]) {
      publish([
        ...latest.current,
        ...files.map((file) => ({
          id: nextId.current++,
          file,
          preview:
            /^image\/(png|jpe?g|gif|webp)$/.test(file.type) &&
            typeof URL.createObjectURL === "function"
              ? URL.createObjectURL(file)
              : undefined,
          state: "staged" as const,
        })),
      ]);
    },
    remove(id: number) {
      const row = latest.current.find((entry) => entry.id === id);
      if (row) release(row);
      publish(latest.current.filter((entry) => entry.id !== id));
    },
    /** Hands the files over and forgets them; the upload queue owns the File objects now. */
    take() {
      const files = latest.current.map((row) => row.file);
      for (const row of latest.current) release(row);
      publish([]);
      return files;
    },
  };
}

/**
 * The work-item comment composer: Kaneo's composer card, a neutral one in both audiences.
 * Who will read the comment is chosen with the toggle in its footer and always stated beside
 * it (CA-1); it is never a warning surface (CA-5, owner decision: neutral Kaneo composer).
 */
export default function WorkItemCommentComposer({
  workItemKey,
  workspaceId,
  defaultVisibility,
}: {
  workItemKey: string;
  workspaceId: string;
  defaultVisibility: "public" | "internal";
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const permissions = useWorkspacePermission(workspaceId);
  const {
    canCreatePublicComments,
    canCreateInternalComments,
    isCheckingPermissions,
  } = permissions;
  const createComment = useCreateWorkItemComment();
  const cannedResponses = useQuery({
    queryKey: ["canned-responses", workItemKey],
    queryFn: () => listCannedResponses(workItemKey),
    enabled: Boolean(workItemKey),
  });
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
  const [submitInProgress, setSubmitInProgress] = useState(false);
  const submitInProgressRef = useRef(false);
  const [insertingSnippet, setInsertingSnippet] = useState(false);
  const [snippetInsertFailed, setSnippetInsertFailed] = useState(false);
  const snippetInsertPending = useRef(false);
  const currentItemKey = useRef(workItemKey);
  currentItemKey.current = workItemKey;
  const composerBusy = submitInProgress || insertingSnippet;
  const [attachAction, setAttachAction] = useState<(() => void) | null>(null);
  const handleAttachActionChange = useCallback(
    (next: (() => void) | null) => setAttachAction(() => next),
    [],
  );
  const staged = useStagedCommentFiles(workItemKey);
  const canAttach =
    !isCheckingPermissions && permissions.canCreateAttachments();
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

  const hasContent = Boolean(draftText.trim()) || staged.rows.length > 0;

  const submit = async () => {
    if (
      submitInProgressRef.current ||
      snippetInsertPending.current ||
      !hasContent ||
      !draftDocument
    )
      return;
    submitInProgressRef.current = true;
    setSubmitInProgress(true);
    try {
      if (mentionPersonIds.length > 0) {
        await mentionPreflight.refetch();
      }
      const created = await createComment.mutateAsync({
        key: workItemKey,
        body: draftDocument,
        visibility: selectedCommentVisibility,
      });
      // AT-1: the comment now exists, so its files can attach to it. Each file reports its
      // own progress under the comment's card and fails on its own.
      const files = staged.take();
      const commentId =
        created && typeof created === "object" && "id" in created
          ? String((created as { id: unknown }).id)
          : "";
      if (files.length > 0 && commentId) {
        enqueueWorkItemUploads({
          itemKey: workItemKey,
          commentId,
          files,
          onDone: () => {
            void queryClient.invalidateQueries({
              queryKey: ["work-items", "attachments", workItemKey],
            });
          },
        });
      }
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

  return (
    <div
      hidden={isCheckingPermissions || allowedCommentVisibilities.length === 0}
      className="w-full"
      data-testid="work-item-comment-composer"
    >
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
      {snippetInsertFailed ? (
        <Alert variant="error" role="alert" className="mb-2">
          <AlertDescription>
            {t("activity:timeline.cannedResponseInsertFailed")}
          </AlertDescription>
        </Alert>
      ) : null}
      <CommentComposerPresentation
        data-visibility={selectedCommentVisibility}
        editor={
          <CommentEditor
            value={draftText}
            documentValue={draftDocument}
            onContentChange={(snapshot) => {
              setDraft(snapshot);
              persistDraft(snapshot);
            }}
            uploadSurface="comment"
            showQuickAttachButton={false}
            onAttachActionChange={handleAttachActionChange}
            onFilesSelected={canAttach ? staged.stage : undefined}
            enableMentions
            disabled={composerBusy}
            mentionMembers={(mentionCandidates.data ?? []).map((candidate) => ({
              id: candidate.personId,
              label: candidate.name,
              image: candidate.image,
            }))}
            placeholder={t("activity:comment.leavePlaceholder")}
            className={COMMENT_COMPOSER_EDITOR_CLASS}
            onSubmitShortcut={() => void submit()}
          />
        }
        attachments={
          staged.rows.length > 0 ? (
            <div className="px-3 pb-2">
              <CreateWorkItemStagedAttachments
                rows={staged.rows}
                onRemove={staged.remove}
                disabled={composerBusy}
              />
            </div>
          ) : null
        }
        footerStart={
          <>
            {allowedCommentVisibilities.length > 1 ? (
              <ToggleGroup
                variant="outline"
                size="sm"
                aria-label={t("activity:timeline.visibilityLabel")}
                value={[selectedCommentVisibility]}
                disabled={composerBusy}
                onValueChange={(next) => {
                  const value = next[0];
                  if (value === "public" || value === "internal")
                    updateVisibility(value);
                }}
              >
                {allowedCommentVisibilities.map((value) => (
                  <ToggleGroupItem
                    key={value}
                    value={value}
                    aria-label={t(`activity:timeline.${value}`)}
                  >
                    {value === "internal" ? (
                      <Lock className="size-3.5" />
                    ) : (
                      <Globe className="size-3.5" />
                    )}
                    {t(`activity:timeline.${value}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            ) : (
              <span className="inline-flex items-center gap-1 font-medium text-muted-foreground text-xs">
                {selectedCommentVisibility === "internal" ? (
                  <Lock className="size-3.5" />
                ) : (
                  <Globe className="size-3.5" />
                )}
                {t(`activity:timeline.${selectedCommentVisibility}`)}
              </span>
            )}
            {cannedResponses.data && cannedResponses.data.length > 0 && (
              <PickerPopover
                value={undefined}
                disabled={composerBusy}
                ariaLabel={t("activity:timeline.cannedResponses")}
                placeholder={t("activity:timeline.insertCannedResponse")}
                className="h-7 w-auto min-w-0 text-xs"
                options={cannedResponses.data.map((response) => ({
                  value: response.id,
                  label: response.name,
                }))}
                onChange={(id) => {
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
                      const response = responses.find(
                        (entry) => entry.id === id,
                      );
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
              />
            )}
          </>
        }
        footerEnd={
          <>
            {canAttach ? (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => attachAction?.()}
                disabled={!attachAction || composerBusy}
                className="text-muted-foreground"
                aria-label={t("activity:comment.attachFile")}
              >
                <Paperclip className="size-3.5" />
              </Button>
            ) : null}
            <Button
              size="xs"
              aria-label={
                createComment.isPending
                  ? t("activity:timeline.sending")
                  : t("activity:timeline.send")
              }
              aria-busy={createComment.isPending}
              disabled={!hasContent || createComment.isPending || composerBusy}
              onClick={() => void submit()}
            >
              <ArrowUp className="size-3.5" />
            </Button>
          </>
        }
      />
      <p
        className="mt-2 text-muted-foreground text-xs"
        data-testid="comment-audience-notice"
      >
        {selectedCommentVisibility === "internal"
          ? t("activity:timeline.internalNotice")
          : t("activity:timeline.publicNotice")}
      </p>
      {createComment.isError && (
        <p role="alert" className="mt-2 text-destructive text-sm">
          {t("activity:timeline.mutationFailed")}
        </p>
      )}
    </div>
  );
}
