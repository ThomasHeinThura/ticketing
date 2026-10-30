import { Button } from "@taskdesk/ui";
import {
  Eye,
  FileArchive,
  File as FileIcon,
  FileImage,
  FileSpreadsheet,
  FileText,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ActionTooltip } from "@/components/common/action-tooltip";
import type { WorkItemAttachment } from "@/fetchers/attachment/work-item-attachments";
import { getApiUrl } from "@/fetchers/get-api-url";
import { formatDateMedium, formatDateTime } from "@/lib/format";

export function formatAttachmentSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** The raster formats every browser renders; SVG is a script vector and never inlined (AT-8). */
export function isInlineImage(mimeType: string) {
  return /^image\/(png|jpe?g|gif|webp)$/i.test(mimeType);
}

export function isPdfPreview(mimeType: string) {
  return mimeType.trim().toLowerCase() === "application/pdf";
}

/** The API's short-lived redirect: the only way bytes are read, always behind a policy check. */
export function attachmentUrl(id: string) {
  return getApiUrl(`/attachments/${encodeURIComponent(id)}`);
}

function KindIcon({ mimeType }: { mimeType: string }) {
  if (/^image\//i.test(mimeType)) return <FileImage className="size-4" />;
  if (/zip|tar|gzip|7z|rar/i.test(mimeType))
    return <FileArchive className="size-4" />;
  if (/sheet|excel|csv/i.test(mimeType))
    return <FileSpreadsheet className="size-4" />;
  if (/pdf|word|document|text|presentation|powerpoint/i.test(mimeType))
    return <FileText className="size-4" />;
  return <FileIcon className="size-4" />;
}

/**
 * AT-8: an image opens the lightbox; PDFs keep the download card and add a sandboxed
 * preview action; every other file remains a downloadable Kaneo attachment card.
 */
export default function WorkItemAttachmentTile({
  attachment,
  uploaderName,
  onPreview,
  onDelete,
  deleteDisabled,
  onRestore,
  restoreDisabled,
  recoverable = false,
}: {
  attachment: WorkItemAttachment;
  uploaderName?: string;
  onPreview: (attachment: WorkItemAttachment) => void;
  onDelete?: (attachment: WorkItemAttachment) => void;
  deleteDisabled?: boolean;
  onRestore?: (attachment: WorkItemAttachment) => void;
  restoreDisabled?: boolean;
  recoverable?: boolean;
}) {
  const { t } = useTranslation();
  const meta = [
    formatAttachmentSize(attachment.size),
    uploaderName
      ? t("workItems:detail.attachments.uploadedBy", { name: uploaderName })
      : null,
    formatDateMedium(attachment.createdAt),
  ]
    .filter(Boolean)
    .join(" · ");
  const remove =
    attachment.canDelete === true && onDelete ? (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("workItems:detail.attachments.delete", {
          name: attachment.filename,
        })}
        disabled={deleteDisabled}
        onClick={() => onDelete(attachment)}
      >
        <Trash2 className="size-4" />
      </Button>
    ) : null;
  const restore =
    attachment.canRestore === true && onRestore ? (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("workItems:detail.attachments.restore", {
          name: attachment.filename,
        })}
        disabled={restoreDisabled}
        onClick={() => onRestore(attachment)}
      >
        <RotateCcw className="size-4" />
      </Button>
    ) : null;

  if (recoverable) {
    const recoveryUntil = attachment.deletedAt
      ? formatDateTime(
          new Date(
            new Date(attachment.deletedAt).getTime() + 24 * 60 * 60 * 1000,
          ),
        )
      : null;
    const recoveryMeta = [
      meta,
      attachment.commentId
        ? t("workItems:detail.attachments.commentParent")
        : null,
      recoveryUntil
        ? t("workItems:detail.attachments.recoverableUntil", {
            date: recoveryUntil,
          })
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <li
        className="col-span-full flex min-w-0 items-center gap-1"
        data-testid="work-item-attachment"
        data-kind="recoverable"
      >
        <div className="taskdesk-attachment-card min-w-0 max-w-none flex-1">
          <span className="taskdesk-attachment-card-icon">
            <KindIcon mimeType={attachment.mimeType} />
          </span>
          <span className="taskdesk-attachment-card-content">
            <span className="taskdesk-attachment-card-title">
              {attachment.filename}
            </span>
            <span className="taskdesk-attachment-card-meta">
              {recoveryMeta}
            </span>
          </span>
        </div>
        {restore}
      </li>
    );
  }

  if (isInlineImage(attachment.mimeType)) {
    return (
      <li
        className="flex min-w-0 flex-col gap-1"
        data-testid="work-item-attachment"
        data-kind="image"
      >
        <Button
          variant="ghost"
          className="h-28 w-full overflow-hidden rounded-lg border border-border p-0"
          aria-label={t("workItems:detail.attachments.preview", {
            name: attachment.filename,
          })}
          onClick={() => onPreview(attachment)}
        >
          <img
            src={attachmentUrl(attachment.id)}
            alt={attachment.filename}
            loading="lazy"
            className="size-full object-cover"
          />
        </Button>
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-xs">
              {attachment.filename}
            </p>
            <p className="truncate text-muted-foreground text-xs">{meta}</p>
          </div>
          {remove}
        </div>
      </li>
    );
  }
  return (
    <li
      className="col-span-full flex min-w-0 items-center gap-1"
      data-testid="work-item-attachment"
      data-kind="file"
    >
      <ActionTooltip label={attachment.filename}>
        <a
          href={attachmentUrl(attachment.id)}
          className="taskdesk-attachment-card min-w-0 max-w-none flex-1"
          aria-label={attachment.filename}
        >
          <span className="taskdesk-attachment-card-icon">
            <KindIcon mimeType={attachment.mimeType} />
          </span>
          <span className="taskdesk-attachment-card-content">
            <span className="taskdesk-attachment-card-title">
              {attachment.filename}
            </span>
            <span className="taskdesk-attachment-card-meta">{meta}</span>
          </span>
        </a>
      </ActionTooltip>
      {isPdfPreview(attachment.mimeType) ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("workItems:detail.attachments.pdfPreviewOpen", {
            name: attachment.filename,
          })}
          onClick={() => onPreview(attachment)}
        >
          <Eye className="size-4" />
        </Button>
      ) : null}
      {remove}
    </li>
  );
}
