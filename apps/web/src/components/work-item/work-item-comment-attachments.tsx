import type { WorkItemAttachment } from "@/fetchers/attachment/work-item-attachments";
import WorkItemAttachmentTile from "./work-item-attachments-tile";
import {
  useWorkItemUploads,
  WorkItemUploadList,
} from "./work-item-attachments-uploads";

/**
 * AT-1/CA-15: the files attached to one comment, shown on its card with the same tiles the
 * attachments panel uses. Files still uploading show their own progress here.
 */
export default function WorkItemCommentAttachments({
  workItemKey,
  commentId,
  attachments,
  uploaderName,
  onPreview,
}: {
  workItemKey: string;
  commentId: string;
  attachments: readonly WorkItemAttachment[];
  uploaderName: (personId: string | null) => string | undefined;
  onPreview: (attachment: WorkItemAttachment) => void;
}) {
  const uploads = useWorkItemUploads(workItemKey, { commentId });
  if (attachments.length === 0 && uploads.length === 0) return null;
  return (
    <div
      className="flex flex-col gap-2 px-3 pb-3"
      data-testid="work-item-comment-attachments"
    >
      <WorkItemUploadList uploads={uploads} />
      {attachments.length > 0 ? (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {attachments.map((attachment) => (
            <WorkItemAttachmentTile
              key={attachment.id}
              attachment={attachment}
              uploaderName={uploaderName(attachment.uploadedBy)}
              onPreview={onPreview}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
