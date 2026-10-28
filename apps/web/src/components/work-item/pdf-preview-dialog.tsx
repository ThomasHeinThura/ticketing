import type { WorkItemAttachment } from "@/fetchers/attachment/work-item-attachments";
import SharedPdfPreviewDialog from "../attachments/pdf-preview-dialog";

/** Keeps existing work-item callers on the shared sandboxed Kaneo preview. */
export default function PdfPreviewDialog({
  attachment,
  onOpenChange,
}: {
  attachment: WorkItemAttachment | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <SharedPdfPreviewDialog
      attachment={
        attachment
          ? {
              id: attachment.id,
              filename: attachment.filename,
              previewPath: `/attachments/${encodeURIComponent(attachment.id)}/preview`,
              downloadPath: `/attachments/${encodeURIComponent(attachment.id)}`,
            }
          : undefined
      }
      onOpenChange={onOpenChange}
    />
  );
}
