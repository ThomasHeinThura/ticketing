import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input } from "@taskdesk/ui";
import { Paperclip } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  listWorkItemAttachments,
  requestAttachmentDeletion,
  type WorkItemAttachment,
} from "@/fetchers/attachment/work-item-attachments";
import { enqueueWorkItemUploads } from "@/fetchers/attachment/work-item-upload-queue";
import getCommentMentionCandidates from "@/fetchers/work-item/get-comment-mention-candidates";
import useRestoreWorkItemAttachment from "@/hooks/mutations/attachment/use-restore-work-item-attachment";
import { useIntentLifecycle } from "@/hooks/use-intent-lifecycle";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { HttpError } from "@/lib/http-error";
import WorkItemAttachmentLightbox from "./work-item-attachments-lightbox";
import WorkItemAttachmentTile, {
  isInlineImage,
  isPdfPreview,
} from "./work-item-attachments-tile";
import {
  registerAttachmentsPanel,
  useWorkItemUploads,
  WorkItemUploadList,
} from "./work-item-attachments-uploads";

/** Query key shared with the activity section, which lists each comment's files from it. */
export function workItemAttachmentsKey(workItemKey: string) {
  return ["work-items", "attachments", workItemKey] as const;
}

/**
 * Work-item attachments (`attachments.md`): thumbnails with a lightbox for images, Kaneo
 * attachment cards for everything else, multi-file upload with per-file progress through the
 * shared upload queue, download through the API's short-lived redirect, and confirmed deletion
 * when authorized. Files attached to a comment are shown on that comment, not here.
 */
export default function WorkItemAttachments({
  workItemKey,
  workspaceId,
  readOnly = false,
}: {
  workItemKey: string;
  /** When given, the Add control follows the caller's `attachment:create` capability. */
  workspaceId?: string;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const openPendingAction = useOpenPendingAction();
  const permissions = useWorkspacePermission(workspaceId);
  const [showRecoverable, setShowRecoverable] = useState(false);
  const canAdd =
    !showRecoverable &&
    !readOnly &&
    (!workspaceId ||
      (!permissions.isCheckingPermissions &&
        permissions.canCreateAttachments()));
  const removalBusy = useRef(false);
  const lifecycle = useIntentLifecycle(workItemKey, () => setError(null));
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const queryKey = workItemAttachmentsKey(workItemKey);
  const list = useQuery({
    queryKey: showRecoverable ? [...queryKey, "recoverable"] : queryKey,
    queryFn: () =>
      listWorkItemAttachments(
        workItemKey,
        showRecoverable ? "recoverable" : "live",
      ),
  });
  // Person IDs to names: the same reach-filtered source the comment composer mentions from.
  const people = useQuery({
    queryKey: [
      "work-items",
      "comment-mention-candidates",
      workItemKey,
      "internal",
    ],
    queryFn: () =>
      getCommentMentionCandidates({ key: workItemKey, visibility: "internal" }),
    retry: false,
    staleTime: 60_000,
  });
  const uploads = useWorkItemUploads(workItemKey);
  const remove = useMutation({ mutationFn: requestAttachmentDeletion });
  const restore = useRestoreWorkItemAttachment(workItemKey);
  const currentDeletable = useRef(new Set<string>());
  const currentRestorable = useRef(new Set<string>());
  const rows = Array.isArray(list.data) ? list.data : [];
  currentDeletable.current = new Set(
    rows
      .filter((row) => row.canDelete === true && row.state === "ready")
      .map((row) => row.id),
  );
  currentRestorable.current = new Set(
    rows
      .filter((row) => row.canRestore === true && row.state === "deleted")
      .map((row) => row.id),
  );

  useEffect(() => registerAttachmentsPanel(), []);

  function addFiles(files: File[]) {
    if (files.length === 0) return;
    setError(null);
    enqueueWorkItemUploads({
      itemKey: workItemKey,
      files,
      onDone: () => {
        void queryClient.invalidateQueries({ queryKey });
        void queryClient.invalidateQueries({
          queryKey: ["work-items", "activity", workItemKey],
        });
      },
    });
  }

  async function requestRemoval(attachment: WorkItemAttachment) {
    const id = attachment.id;
    if (removalBusy.current || !currentDeletable.current.has(id)) return;
    removalBusy.current = true;
    const intent = lifecycle.capture();
    setError(null);
    try {
      const pending = await remove.mutateAsync(id);
      if (!lifecycle.isCurrent(intent) || !currentDeletable.current.has(id))
        return;
      await openPendingAction(pending);
    } catch (cause) {
      if (lifecycle.isCurrent(intent))
        setError(
          cause instanceof HttpError && cause.status < 500 && cause.message
            ? cause.message
            : t("workItems:detail.attachments.deleteFailed"),
        );
    } finally {
      removalBusy.current = false;
    }
  }

  async function requestRestore(attachment: WorkItemAttachment) {
    if (!currentRestorable.current.has(attachment.id)) return;
    const intent = lifecycle.capture();
    setError(null);
    try {
      await restore.mutateAsync(attachment.id);
      if (!lifecycle.isCurrent(intent)) return;
      setShowRecoverable(false);
    } catch (cause) {
      if (lifecycle.isCurrent(intent))
        setError(
          cause instanceof HttpError && cause.status < 500 && cause.message
            ? cause.message
            : t("workItems:detail.attachments.restoreFailed"),
        );
    }
  }

  // Comment files belong to their comment's card; the panel lists the item's own files.
  const ready = rows.filter(
    (attachment) =>
      attachment.state === "ready" && (attachment.commentId ?? null) === null,
  );
  const recoverable = rows.filter(
    (attachment) => attachment.state === "deleted",
  );
  const images = useMemo(
    () => ready.filter((attachment) => isInlineImage(attachment.mimeType)),
    [ready],
  );
  const uploaderName = (personId: string | null) =>
    personId
      ? people.data?.find((person) => person.personId === personId)?.name
      : undefined;

  return (
    <section
      className="flex flex-col gap-2"
      aria-labelledby="work-item-attachments-heading"
      data-testid="work-item-attachments"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="work-item-attachments-heading" className="font-medium text-sm">
          {t("workItems:detail.attachments.heading")}
        </h2>
        {canAdd ? (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => inputRef.current?.click()}
            >
              <Paperclip className="size-4" />
              {uploads.length > 0
                ? t("workItems:detail.attachments.uploading")
                : t("workItems:detail.attachments.add")}
            </Button>
            <Input
              ref={inputRef}
              type="file"
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-label={t("workItems:detail.attachments.add")}
              onChange={(event) => {
                addFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
          </>
        ) : null}
        {!readOnly ? (
          <Button
            variant="outline"
            size="sm"
            aria-pressed={showRecoverable}
            onClick={() => {
              setError(null);
              setShowRecoverable((current) => !current);
            }}
          >
            {t(
              showRecoverable
                ? "workItems:detail.attachments.backToFiles"
                : "workItems:detail.attachments.recoverDeleted",
            )}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p className="text-destructive-foreground text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <WorkItemUploadList uploads={uploads} />
      {list.isLoading ? (
        <p className="text-muted-foreground text-sm" role="status">
          {t("common:empty.loading")}
        </p>
      ) : list.isError ? (
        <p className="text-muted-foreground text-sm">
          {t("workItems:detail.attachments.loadFailed")}
        </p>
      ) : showRecoverable ? (
        recoverable.length === 0 ? (
          <p className="text-muted-foreground text-sm" role="status">
            {t("workItems:detail.attachments.recoverableEmpty")}
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-2">
            {recoverable.map((attachment) => (
              <WorkItemAttachmentTile
                key={attachment.id}
                attachment={attachment}
                uploaderName={uploaderName(attachment.uploadedBy)}
                onPreview={() => undefined}
                recoverable
                onRestore={
                  attachment.canRestore
                    ? (row) => void requestRestore(row)
                    : undefined
                }
                restoreDisabled={restore.isPending}
              />
            ))}
          </ul>
        )
      ) : ready.length === 0 && uploads.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t("workItems:detail.attachments.empty")}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          {ready.map((attachment) => (
            <WorkItemAttachmentTile
              key={attachment.id}
              attachment={attachment}
              uploaderName={uploaderName(attachment.uploadedBy)}
              onPreview={(row) => setPreviewId(row.id)}
              onDelete={
                readOnly ? undefined : (row) => void requestRemoval(row)
              }
              deleteDisabled={remove.isPending}
            />
          ))}
        </ul>
      )}
      <WorkItemAttachmentLightbox
        images={images}
        pdfs={ready.filter((attachment) => isPdfPreview(attachment.mimeType))}
        openId={previewId}
        onOpenChange={(open) => {
          if (!open) setPreviewId(null);
        }}
        onNavigate={setPreviewId}
      />
    </section>
  );
}
