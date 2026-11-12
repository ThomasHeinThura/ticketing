import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Label,
  Switch,
  Tabs,
  TabsList,
  TabsTab,
} from "@taskdesk/ui";
import { Globe, Lock, Paperclip } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
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
 * Work-item comment composer (CA-1, CA-2, CA-5, F-11):
 * - Separates customer replies ("Reply to customer") from staff-only notes ("Internal note")
 *   with a library segmented control, matching submit button text, audience line, and a
 *   warning-tinted surface in internal mode.
 * - Offers no public mode when the item is not visible to a customer or the caller lacks
 *   `comment:create`; falls back to internal with a status notice if customer visibility is
 *   lost while composing; never silently flips mode across refetches or project-default edits.
 */
export default function WorkItemCommentComposer({
  workItemKey,
  workspaceId,
  projectId,
  defaultVisibility,
  isCustomerVisible = true,
  isCustomerVisibilityPending = false,
}: {
  workItemKey: string;
  workspaceId: string;
  projectId?: string;
  defaultVisibility: "public" | "internal";
  isCustomerVisible?: boolean;
  isCustomerVisibilityPending?: boolean;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const permissions = useWorkspacePermission(workspaceId, projectId);
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
    isCustomerVisible ? defaultVisibility : "internal",
  );
  const [customerVisibilityFallback, setCustomerVisibilityFallback] =
    useState(false);

  const canPostPublic = isCustomerVisible && canCreatePublicComments();
  const canPostInternal = canCreateInternalComments();
  const allowedCommentVisibilities = [
    ...(canPostPublic ? (["public"] as const) : []),
    ...(canPostInternal ? (["internal"] as const) : []),
  ];
  const selectedCommentVisibility: "public" | "internal" =
    allowedCommentVisibilities.includes(visibility)
      ? visibility
      : (allowedCommentVisibilities[0] ?? "internal");

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
  // A-07 / AT-3: files on a public comment stay internal unless staff choose to share them.
  // The choice is per comment; it never applies to an internal comment (AT-4).
  const shareSwitchId = useId();
  const [shareFiles, setShareFiles] = useState(false);
  const sharesFiles = selectedCommentVisibility === "public" && shareFiles;

  const isReady = !isCheckingPermissions && !isCustomerVisibilityPending;
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
      Boolean(workItemKey) && isReady && allowedCommentVisibilities.length > 0,
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
      isReady &&
      allowedCommentVisibilities.length > 0 &&
      mentionPersonIds.length > 0,
  });
  const activityKey = ["work-items", "activity", workItemKey] as const;
  const draftStorageKey = `taskdesk:comment-draft:${user?.id ?? ""}:${workItemKey}`;
  const [loadedDraftKey, setLoadedDraftKey] = useState<string | null>(null);
  const initializedDraftKeyRef = useRef<string | null>(null);
  const defaultVisibilityRef = useRef(defaultVisibility);
  defaultVisibilityRef.current = defaultVisibility;
  const isCustomerVisibleRef = useRef(isCustomerVisible);
  isCustomerVisibleRef.current = isCustomerVisible;
  const wasCustomerVisibleRef = useRef(isCustomerVisible);
  const persistedDraftRef = useRef(draft);
  const visibilityRef = useRef(visibility);
  visibilityRef.current = visibility;
  const selectedVisibilityRef = useRef(selectedCommentVisibility);
  selectedVisibilityRef.current = selectedCommentVisibility;
  const allowedVisibilitiesRef = useRef(allowedCommentVisibilities);
  allowedVisibilitiesRef.current = allowedCommentVisibilities;
  const sharesFilesRef = useRef(sharesFiles);
  sharesFilesRef.current = sharesFiles;

  const persistDraft = (
    snapshot: CommentContentSnapshot,
    nextVisibility = selectedVisibilityRef.current,
  ) => {
    persistedDraftRef.current = snapshot;
    if (loadedDraftKey !== draftStorageKey) return;
    try {
      // CA-2: an empty composer always opens on the project's default visibility, so a
      // choice is remembered only alongside real draft text (CA-16).
      if (!snapshot.text.trim()) {
        window.localStorage.removeItem(draftStorageKey);
        return;
      }
      window.localStorage.setItem(
        draftStorageKey,
        JSON.stringify({ ...snapshot, visibility: nextVisibility }),
      );
    } catch {
      // A full or disabled localStorage must not block comment composition.
    }
  };

  const updateVisibility = (nextVisibility: "public" | "internal") => {
    if (!allowedVisibilitiesRef.current.includes(nextVisibility)) return;
    visibilityRef.current = nextVisibility;
    selectedVisibilityRef.current = nextVisibility;
    setVisibility(nextVisibility);
    if (nextVisibility === "internal") setShareFiles(false);
    persistDraft(persistedDraftRef.current, nextVisibility);
  };

  // Reset initialization guard immediately when switching work items or users.
  const lastDraftStorageKeyRef = useRef(draftStorageKey);
  if (lastDraftStorageKeyRef.current !== draftStorageKey) {
    lastDraftStorageKeyRef.current = draftStorageKey;
    initializedDraftKeyRef.current = null;
  }

  // Initialize once per (user, workItem) once permissions and customer visibility settle.
  // Deliberately excludes `defaultVisibility` so background refetches or project-default
  // edits never overwrite an open composer's mode or draft mid-typing (F-11 Rule 3).
  useEffect(() => {
    if (initializedDraftKeyRef.current !== draftStorageKey && !isReady) {
      setLoadedDraftKey(null);
      setCustomerVisibilityFallback(false);
      return;
    }
    if (initializedDraftKeyRef.current === draftStorageKey) return;

    initializedDraftKeyRef.current = draftStorageKey;
    wasCustomerVisibleRef.current = isCustomerVisibleRef.current;

    const emptyDraft = { text: "", document: EMPTY_COMMENT_DOCUMENT };
    let nextDraft: CommentContentSnapshot = emptyDraft;
    let nextVisibility: "public" | "internal" = isCustomerVisibleRef.current
      ? defaultVisibilityRef.current
      : "internal";
    let fallbackOnRestore = false;

    try {
      const saved = window.localStorage.getItem(draftStorageKey);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (parsed && typeof parsed === "object") {
          const record = parsed as Record<string, unknown>;
          const savedDraft: CommentContentSnapshot = {
            text: typeof record.text === "string" ? record.text : "",
            document:
              record.document && typeof record.document === "object"
                ? record.document
                : EMPTY_COMMENT_DOCUMENT,
          };
          nextDraft = savedDraft;
          // An empty saved draft keeps the project default (CA-2).
          if (
            savedDraft.text.trim() &&
            (record.visibility === "public" || record.visibility === "internal")
          ) {
            if (
              record.visibility === "public" &&
              !isCustomerVisibleRef.current
            ) {
              nextVisibility = "internal";
              fallbackOnRestore = true;
            } else {
              nextVisibility = record.visibility;
            }
          }
        }
      }
    } catch {
      try {
        window.localStorage.removeItem(draftStorageKey);
      } catch {
        // Storage can be disabled; the in-memory draft still works.
      }
    }

    persistedDraftRef.current = nextDraft;
    setDraft(nextDraft);
    visibilityRef.current = nextVisibility;
    setVisibility(nextVisibility);
    setShareFiles(false);
    setCustomerVisibilityFallback(fallbackOnRestore);
    setLoadedDraftKey(draftStorageKey);

    if (fallbackOnRestore && nextDraft.text.trim()) {
      try {
        window.localStorage.setItem(
          draftStorageKey,
          JSON.stringify({ ...nextDraft, visibility: "internal" }),
        );
      } catch {
        // Ignore storage errors on fallback rewrite.
      }
    }
  }, [draftStorageKey, isReady]);

  // F-11 Rule 3: if the item stops being customer-visible while the composer is open,
  // fall back to an internal note immediately and tell the user.
  useEffect(() => {
    if (!isReady || initializedDraftKeyRef.current !== draftStorageKey) return;
    const wasVisible = wasCustomerVisibleRef.current;
    wasCustomerVisibleRef.current = isCustomerVisible;

    if (wasVisible && !isCustomerVisible) {
      const hadPublicOrDraft =
        visibilityRef.current === "public" ||
        Boolean(persistedDraftRef.current.text.trim()) ||
        staged.rows.length > 0;
      visibilityRef.current = "internal";
      selectedVisibilityRef.current = "internal";
      setVisibility("internal");
      setShareFiles(false);
      if (persistedDraftRef.current.text.trim()) {
        try {
          window.localStorage.setItem(
            draftStorageKey,
            JSON.stringify({
              ...persistedDraftRef.current,
              visibility: "internal",
            }),
          );
        } catch {
          // Storage failure does not block fallback to internal mode.
        }
      }
      if (hadPublicOrDraft && canPostInternal) {
        setCustomerVisibilityFallback(true);
      }
    } else if (!wasVisible && isCustomerVisible) {
      setCustomerVisibilityFallback(false);
    }
  }, [
    canPostInternal,
    draftStorageKey,
    isCustomerVisible,
    isReady,
    staged.rows.length,
  ]);

  const hasContent = Boolean(draftText.trim()) || staged.rows.length > 0;

  const submit = async () => {
    const modeToSend = selectedVisibilityRef.current;
    if (
      submitInProgressRef.current ||
      snippetInsertPending.current ||
      !hasContent ||
      !draftDocument ||
      !allowedVisibilitiesRef.current.includes(modeToSend)
    )
      return;
    const shouldShareFiles = modeToSend === "public" && sharesFilesRef.current;
    submitInProgressRef.current = true;
    setSubmitInProgress(true);
    try {
      if (mentionPersonIds.length > 0) {
        await mentionPreflight.refetch();
      }
      const created = await createComment.mutateAsync({
        key: workItemKey,
        body: draftDocument,
        visibility: modeToSend,
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
          customerVisible: shouldShareFiles,
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
      setShareFiles(false);
      setCustomerVisibilityFallback(false);
      // The next comment starts from the project's default visibility when allowed (CA-2).
      const nextDefault: "public" | "internal" = isCustomerVisibleRef.current
        ? defaultVisibilityRef.current
        : "internal";
      visibilityRef.current = nextDefault;
      setVisibility(nextDefault);
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

  const isInternalMode = selectedCommentVisibility === "internal";

  return (
    <div
      hidden={!isReady || allowedCommentVisibilities.length === 0}
      className="w-full"
      data-testid="work-item-comment-composer"
    >
      {customerVisibilityFallback ? (
        <Alert
          variant="warning"
          role="status"
          className="mb-2"
          data-testid="comment-visibility-fallback-notice"
        >
          <AlertDescription>
            {t("activity:timeline.customerVisibilityLostFallback")}
          </AlertDescription>
        </Alert>
      ) : null}
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
        tinted={isInternalMode}
        header={
          <>
            {allowedCommentVisibilities.length > 1 ? (
              <Tabs
                value={selectedCommentVisibility}
                onValueChange={(next) => {
                  if (
                    !composerBusy &&
                    (next === "public" || next === "internal")
                  ) {
                    updateVisibility(next);
                  }
                }}
              >
                <TabsList aria-label={t("activity:timeline.visibilityLabel")}>
                  <TabsTab
                    value="public"
                    disabled={composerBusy}
                    className="h-7 px-2.5 text-xs sm:h-7 sm:text-xs"
                  >
                    <Globe className="size-3.5" aria-hidden="true" />
                    {t("activity:timeline.replyToCustomer")}
                  </TabsTab>
                  <TabsTab
                    value="internal"
                    disabled={composerBusy}
                    className="h-7 px-2.5 text-xs sm:h-7 sm:text-xs"
                  >
                    <Lock className="size-3.5" aria-hidden="true" />
                    {t("activity:timeline.internalNote")}
                  </TabsTab>
                </TabsList>
              </Tabs>
            ) : isInternalMode ? (
              <Badge variant="warning" size="default">
                <Lock className="size-3.5" aria-hidden="true" />
                {t("activity:timeline.internalNote")}
              </Badge>
            ) : (
              <Badge variant="outline" size="default">
                <Globe className="size-3.5" aria-hidden="true" />
                {t("activity:timeline.replyToCustomer")}
              </Badge>
            )}
            <span
              className="text-muted-foreground text-xs"
              data-testid="comment-audience-notice"
            >
              {isInternalMode
                ? t("activity:timeline.onlyTeamSeesThis")
                : t("activity:timeline.visibleToCustomer")}
            </span>
          </>
        }
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
            <div className="flex flex-col gap-2 px-3 pb-2">
              <CreateWorkItemStagedAttachments
                rows={staged.rows}
                onRemove={staged.remove}
                disabled={composerBusy}
              />
              {selectedCommentVisibility === "public" ? (
                <div className="flex items-center gap-2">
                  <Switch
                    id={shareSwitchId}
                    checked={shareFiles}
                    disabled={composerBusy}
                    onCheckedChange={(checked) => setShareFiles(checked)}
                  />
                  <Label
                    htmlFor={shareSwitchId}
                    className="font-normal text-muted-foreground text-xs"
                  >
                    {t("activity:timeline.shareFilesWithCustomer")}
                  </Label>
                </div>
              ) : null}
            </div>
          ) : null
        }
        footerStart={
          cannedResponses.data && cannedResponses.data.length > 0 ? (
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
                    const response = responses.find((entry) => entry.id === id);
                    if (!response || !isTiptapDocument(response.body)) {
                      setSnippetInsertFailed(true);
                      return;
                    }
                    const hadDraftText = Boolean(
                      persistedDraftRef.current.text.trim(),
                    );
                    setDraft((current) => ({
                      ...current,
                      document: response.body,
                    }));
                    // Never silently flip an in-progress internal draft to public (F-11 Rule 3).
                    if (
                      (response.visibilityDefault === "internal" ||
                        (response.visibilityDefault === "public" &&
                          !hadDraftText)) &&
                      allowedVisibilitiesRef.current.includes(
                        response.visibilityDefault,
                      )
                    ) {
                      updateVisibility(response.visibilityDefault);
                    }
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
          ) : undefined
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
              aria-busy={createComment.isPending}
              disabled={!hasContent || createComment.isPending || composerBusy}
              onClick={() => void submit()}
            >
              {createComment.isPending
                ? t("activity:timeline.sending")
                : isInternalMode
                  ? t("activity:timeline.addInternalNote")
                  : t("activity:timeline.sendToCustomer")}
            </Button>
          </>
        }
      />
      {createComment.isError && (
        <p role="alert" className="mt-2 text-destructive text-sm">
          {t("activity:timeline.mutationFailed")}
        </p>
      )}
    </div>
  );
}
