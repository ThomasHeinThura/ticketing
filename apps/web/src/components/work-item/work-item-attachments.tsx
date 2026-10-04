import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Label,
  Progress,
  ProgressIndicator,
  ProgressLabel,
  ProgressTrack,
  ProgressValue,
} from "@taskdesk/ui";
import {
  File,
  FileImage,
  FileText,
  Paperclip,
  Trash2,
  Upload,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";
import {
  cancelAttachmentUpload,
  enqueueAttachmentUploads,
  getWorkItemAttachmentUploadsSnapshot,
  retryAttachmentUpload,
  subscribeAttachmentUploads,
} from "@/components/work-item/attachment-uploads";
import { getApiUrl } from "@/fetchers/get-api-url";
import {
  deleteWorkItemAttachment,
  listWorkItemAttachments,
  type WorkItemAttachment,
} from "@/fetchers/work-item/attachments";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { formatDateTime } from "@/lib/format";

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let size = bytes / 1024;
  let unit = units[0] ?? "KB";
  for (let index = 0; size >= 1024 && index < units.length - 1; index += 1) {
    size /= 1024;
    unit = units[index + 1] ?? unit;
  }
  return `${size < 10 ? size.toFixed(1) : Math.round(size)} ${unit}`;
}

function isFileDrag(event: DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      "input, textarea, select, [contenteditable='true'], [role='textbox']",
    ),
  );
}

function AttachmentIcon({ mimeType }: { mimeType: string }) {
  if (mimeType.startsWith("image/")) return <FileImage aria-hidden="true" />;
  if (mimeType === "application/pdf" || mimeType.startsWith("text/")) {
    return <FileText aria-hidden="true" />;
  }
  return <File aria-hidden="true" />;
}

function isPreviewable(attachment: WorkItemAttachment) {
  const mimeType = attachment.mimeType.toLowerCase().split(";")[0]?.trim();
  return (
    attachment.state === "ready" &&
    (mimeType === "image/png" ||
      mimeType === "image/jpeg" ||
      mimeType === "image/gif" ||
      mimeType === "image/webp" ||
      mimeType === "application/pdf")
  );
}

function previewUrl(attachmentId: string) {
  const url = new URL(
    getApiUrl(`attachments/${encodeURIComponent(attachmentId)}`),
    window.location.origin,
  );
  url.searchParams.set("representation", "preview");
  return url.toString();
}

function AttachmentRow({
  attachment,
  onDelete,
  onPreview,
  canDelete,
}: {
  attachment: WorkItemAttachment;
  canDelete: boolean;
  onDelete: (attachment: WorkItemAttachment) => void;
  onPreview: (attachment: WorkItemAttachment) => void;
}) {
  const { t } = useTranslation();
  const downloadUrl = getApiUrl(
    `attachments/${encodeURIComponent(attachment.id)}`,
  );
  const canPreview = isPreviewable(attachment);
  const isRasterImage =
    canPreview && attachment.mimeType.toLowerCase().startsWith("image/");
  return (
    <li className="flex min-w-0 items-center gap-3 rounded-md border p-3">
      <span className="shrink-0">
        {isRasterImage ? (
          <button
            type="button"
            className="overflow-hidden rounded border"
            aria-label={t("workItems:attachments.preview", {
              filename: attachment.filename,
            })}
            onClick={() => onPreview(attachment)}
          >
            <img
              src={previewUrl(attachment.id)}
              alt=""
              loading="lazy"
              className="h-14 w-20 object-cover"
            />
          </button>
        ) : (
          <AttachmentIcon mimeType={attachment.mimeType} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{attachment.filename}</p>
        <p className="text-muted-foreground text-sm">
          {formatFileSize(attachment.size)} ·{" "}
          {formatDateTime(attachment.createdAt)}
          {attachment.uploadedBy
            ? ` · ${t("workItems:attachments.uploader", { id: attachment.uploadedBy })}`
            : ""}
        </p>
        <p className="text-muted-foreground text-xs">
          {attachment.customerVisible
            ? t("workItems:attachments.customerVisible")
            : t("workItems:attachments.internalOnly")}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {canPreview && !isRasterImage && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={t("workItems:attachments.preview", {
              filename: attachment.filename,
            })}
            onClick={() => onPreview(attachment)}
          >
            {t("workItems:attachments.previewAction")}
          </Button>
        )}
        <a
          href={downloadUrl}
          className="inline-flex h-8 items-center rounded-md border px-3 text-sm hover:bg-accent"
          aria-label={t("workItems:attachments.download", {
            filename: attachment.filename,
          })}
        >
          {t("workItems:attachments.downloadAction")}
        </a>
        {canDelete && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("workItems:attachments.delete", {
              filename: attachment.filename,
            })}
            onClick={() => onDelete(attachment)}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
    </li>
  );
}

export default function WorkItemAttachments({
  workItemKey,
  workspaceId,
  previewAttachmentId,
  onPreviewAttachment,
}: {
  workItemKey: string;
  workspaceId: string;
  previewAttachmentId?: string;
  onPreviewAttachment?: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { canUpdateTasks, isCheckingPermissions } =
    useWorkspacePermission(workspaceId);
  const canUpload = !isCheckingPermissions && canUpdateTasks();
  const uploads = useSyncExternalStore(
    subscribeAttachmentUploads,
    () => getWorkItemAttachmentUploadsSnapshot(workItemKey),
    () => [],
  );
  const queryKey = useMemo(
    () => ["work-item-attachments", workItemKey],
    [workItemKey],
  );
  const attachments = useQuery({
    queryKey,
    queryFn: () => listWorkItemAttachments(workItemKey),
  });
  const previewAttachment = attachments.data?.find(
    (attachment) => attachment.id === previewAttachmentId,
  );

  useEffect(() => {
    if (
      previewAttachmentId &&
      attachments.data &&
      (!previewAttachment || !isPreviewable(previewAttachment))
    ) {
      onPreviewAttachment?.(null);
    }
  }, [
    attachments.data,
    onPreviewAttachment,
    previewAttachment,
    previewAttachmentId,
  ]);
  const [deleting, setDeleting] = useState<WorkItemAttachment | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const addFiles = useCallback(
    (fileList: FileList | File[]) => {
      if (!canUpload) return;
      const files = Array.from(fileList);
      if (!files.length) return;
      enqueueAttachmentUploads(workItemKey, files, () => {
        void queryClient.invalidateQueries({ queryKey });
      });
    },
    [canUpload, queryClient, queryKey, workItemKey],
  );

  useEffect(() => {
    const handleDragOver = (event: DragEvent) => {
      if (!isFileDrag(event) || !canUpload) return;
      event.preventDefault();
      setIsDragging(true);
    };
    const handleDragLeave = (event: DragEvent) => {
      if (event.relatedTarget === null) setIsDragging(false);
    };
    const handleDrop = (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      setIsDragging(false);
      if (event.dataTransfer?.files.length) addFiles(event.dataTransfer.files);
    };
    const handlePaste = (event: ClipboardEvent) => {
      if (!canUpload || isEditableTarget(event.target)) return;
      const files = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);
      if (files.length) {
        event.preventDefault();
        addFiles(files);
      }
    };
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);
    window.addEventListener("paste", handlePaste);
    return () => {
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);
      window.removeEventListener("paste", handlePaste);
    };
  }, [addFiles, canUpload]);

  const confirmDelete = async () => {
    if (!deleting) return;
    setIsDeleting(true);
    setDeleteError("");
    try {
      await deleteWorkItemAttachment(deleting.id);
      await queryClient.invalidateQueries({ queryKey });
      setDeleting(null);
    } catch (error) {
      setDeleteError(
        error instanceof Error
          ? error.message
          : t("workItems:attachments.deleteError"),
      );
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <section
      aria-labelledby="work-item-attachments-heading"
      className="relative flex flex-col gap-3"
      data-testid="work-item-attachments"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="work-item-attachments-heading" className="font-medium text-lg">
          <Paperclip className="mr-2 inline size-4" aria-hidden="true" />
          {t("workItems:attachments.heading")}
        </h2>
        {canUpload && (
          <Label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent">
            <Upload className="size-4" aria-hidden="true" />
            {t("workItems:attachments.addFiles")}
            <input
              type="file"
              multiple
              className="sr-only"
              aria-label={t("workItems:attachments.addFiles")}
              onChange={(event) => {
                if (event.currentTarget.files)
                  addFiles(event.currentTarget.files);
                event.currentTarget.value = "";
              }}
            />
          </Label>
        )}
      </div>

      {canUpload && (
        <p className="text-muted-foreground text-sm">
          {t("workItems:attachments.dropHint")}
        </p>
      )}
      {isDragging && canUpload && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-md border-2 border-dashed bg-background/95">
          <p className="font-medium">{t("workItems:attachments.dropNow")}</p>
        </div>
      )}

      {attachments.isLoading ? (
        <p role="status">{t("workItems:attachments.loading")}</p>
      ) : attachments.isError ? (
        <div>
          <p role="alert">{t("workItems:attachments.loadError")}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void attachments.refetch()}
          >
            {t("workItems:attachments.retry")}
          </Button>
        </div>
      ) : attachments.data?.length ? (
        <ul className="flex flex-col gap-2">
          {attachments.data.map((attachment) => (
            <AttachmentRow
              key={attachment.id}
              attachment={attachment}
              canDelete={canUpload}
              onPreview={(attachment) => onPreviewAttachment?.(attachment.id)}
              onDelete={(row) => {
                setDeleteError("");
                setDeleting(row);
              }}
            />
          ))}
        </ul>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("workItems:attachments.emptyTitle")}</EmptyTitle>
            <EmptyDescription>
              {t("workItems:attachments.emptyDescription")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      <Dialog
        open={Boolean(
          previewAttachmentId &&
            previewAttachment &&
            isPreviewable(previewAttachment),
        )}
        onOpenChange={(open) => {
          if (!open) onPreviewAttachment?.(null);
        }}
      >
        {previewAttachment && isPreviewable(previewAttachment) && (
          <DialogPopup
            closeLabel={t("common:actions.close")}
            className="max-w-5xl"
          >
            <DialogHeader>
              <DialogTitle>
                {t("workItems:attachments.previewTitle")}
              </DialogTitle>
              <DialogDescription>
                {previewAttachment.filename}
              </DialogDescription>
            </DialogHeader>
            <div className="flex min-h-0 justify-center overflow-auto p-4">
              {previewAttachment.mimeType === "application/pdf" ? (
                <iframe
                  title={previewAttachment.filename}
                  src={previewUrl(previewAttachment.id)}
                  sandbox=""
                  className="h-[75vh] w-full rounded-md border"
                />
              ) : (
                <img
                  src={previewUrl(previewAttachment.id)}
                  alt={previewAttachment.filename}
                  className="max-h-[75vh] max-w-full object-contain"
                />
              )}
            </div>
          </DialogPopup>
        )}
      </Dialog>

      {uploads.length > 0 && (
        <ul
          aria-label={t("workItems:attachments.uploadsLabel")}
          className="flex flex-col gap-2"
        >
          {uploads.map((upload) => (
            <li key={upload.id} className="rounded-md border p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate font-medium">
                  {upload.filename}
                </span>
                <span className="shrink-0 text-muted-foreground text-sm">
                  {formatFileSize(upload.size)}
                </span>
              </div>
              {upload.status === "failed" ? (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p role="alert" className="text-destructive text-sm">
                    {upload.cancellation === "leaving-app"
                      ? t("workItems:attachments.cancelledLeavingApp")
                      : upload.cancellation === "user"
                        ? t("workItems:attachments.cancelled")
                        : upload.error}
                  </p>
                  {upload.cancellation !== "leaving-app" && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => retryAttachmentUpload(upload.id)}
                    >
                      {t("workItems:attachments.retry")}
                    </Button>
                  )}
                </div>
              ) : upload.status === "complete" ? (
                <p role="status" className="mt-2 text-sm">
                  {t("workItems:attachments.uploadComplete")}
                </p>
              ) : (
                <div className="mt-2 flex items-center gap-3">
                  <Progress
                    value={upload.progress}
                    aria-label={t("workItems:attachments.uploadProgress", {
                      filename: upload.filename,
                    })}
                  >
                    <ProgressLabel>
                      {t(`workItems:attachments.status.${upload.status}`)}
                    </ProgressLabel>
                    <ProgressValue />
                    <ProgressTrack>
                      <ProgressIndicator />
                    </ProgressTrack>
                  </Progress>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => cancelAttachmentUpload(upload.id)}
                  >
                    {t("workItems:attachments.cancel")}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("workItems:attachments.deleteTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("workItems:attachments.deleteDescription", {
                filename: deleting?.filename ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <p role="alert" className="text-destructive text-sm">
              {deleteError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogClose
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isDeleting}
                />
              }
            >
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={isDeleting}
              onClick={() => void confirmDelete()}
            >
              {isDeleting
                ? t("workItems:attachments.deleting")
                : t("workItems:attachments.deleteAction")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
