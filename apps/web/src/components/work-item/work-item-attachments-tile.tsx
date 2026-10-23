import { Button } from "@taskdesk/ui";
import {
  FileArchive,
  File as FileIcon,
  FileImage,
  FileSpreadsheet,
  FileText,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { WorkItemAttachment } from "@/fetchers/attachment/work-item-attachments";
import { getApiUrl } from "@/fetchers/get-api-url";
import { formatDateMedium } from "@/lib/format";

export function formatAttachmentSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** The raster formats every browser renders; SVG is a script vector and never inlined (AT-8). */
export function isInlineImage(mimeType: string) {
  return /^image\/(png|jpe?g|gif|webp)$/i.test(mimeType);
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
 * AT-8: an image renders as an inline thumbnail that opens the lightbox; everything else
 * is a Kaneo attachment card with icon, filename, size and uploader that downloads.
 */
export default function WorkItemAttachmentTile({
  attachment,
  uploaderName,
  onPreview,
  onDelete,
  deleteDisabled,
}: {
  attachment: WorkItemAttachment;
  uploaderName?: string;
  onPreview: (attachment: WorkItemAttachment) => void;
  onDelete?: (attachment: WorkItemAttachment) => void;
  deleteDisabled?: boolean;
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
      <a
        href={attachmentUrl(attachment.id)}
        className="taskdesk-attachment-card min-w-0 max-w-none flex-1"
        aria-label={attachment.filename}
        title={attachment.filename}
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
      {remove}
    </li>
  );
}
