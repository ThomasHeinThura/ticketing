import {
  Button,
  Progress,
  ProgressIndicator,
  ProgressTrack,
} from "@taskdesk/ui";
import { FileText, RotateCw, X } from "lucide-react";
import { useMemo, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import {
  dismissWorkItemUpload,
  getWorkItemUploads,
  retryWorkItemUpload,
  subscribeWorkItemUploads,
  type WorkItemUpload,
} from "@/fetchers/attachment/work-item-upload-queue";

/** The in-flight uploads of one work item; `commentId: null` selects the item's own files. */
export function useWorkItemUploads(
  itemKey: string,
  scope: { commentId: string | null } | "all" = { commentId: null },
) {
  const all = useSyncExternalStore(
    subscribeWorkItemUploads,
    getWorkItemUploads,
    getWorkItemUploads,
  );
  const everything = scope === "all";
  const commentId = scope === "all" ? null : scope.commentId;
  return useMemo(
    () =>
      all.filter(
        (upload) =>
          upload.itemKey === itemKey &&
          (everything || (upload.commentId ?? null) === commentId),
      ),
    [all, commentId, everything, itemKey],
  );
}

// The attachments panel is a collapsed disclosure, so it is often not mounted when a file
// arrives by drop or paste. The always-mounted activity section shows the progress list
// only while the panel is absent, so a file is never uploaded without feedback and never
// listed twice.
let panelMounts = 0;
const panelListeners = new Set<() => void>();
export function registerAttachmentsPanel() {
  panelMounts += 1;
  for (const listener of panelListeners) listener();
  return () => {
    panelMounts -= 1;
    for (const listener of panelListeners) listener();
  };
}
export function useAttachmentsPanelMounted() {
  return useSyncExternalStore(
    (listener) => {
      panelListeners.add(listener);
      return () => {
        panelListeners.delete(listener);
      };
    },
    () => panelMounts > 0,
    () => false,
  );
}

function UploadRow({ upload }: { upload: WorkItemUpload }) {
  const { t } = useTranslation();
  const percent = upload.file.size
    ? Math.min(100, Math.round((upload.loaded / upload.file.size) * 100))
    : 0;
  return (
    <li
      className="flex items-center gap-2"
      data-testid="work-item-upload"
      data-state={upload.state}
    >
      <div className="taskdesk-attachment-card min-w-0 max-w-none flex-1">
        <span className="taskdesk-attachment-card-icon">
          <FileText className="size-4" />
        </span>
        <span className="taskdesk-attachment-card-content flex-1">
          <span className="taskdesk-attachment-card-title">
            {upload.file.name}
          </span>
          {upload.state === "failed" ? (
            <span
              role="alert"
              className="mt-0.5 text-destructive-foreground text-xs"
            >
              {upload.reason ??
                t(
                  upload.empty
                    ? "workItems:create.attachments.empty"
                    : "workItems:detail.attachments.uploadFailed",
                )}
            </span>
          ) : (
            <Progress
              value={upload.state === "queued" ? 0 : percent}
              aria-label={upload.file.name}
              className="mt-1.5 gap-0"
            >
              <ProgressTrack>
                <ProgressIndicator />
              </ProgressTrack>
            </Progress>
          )}
        </span>
      </div>
      {upload.state === "failed" ? (
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("workItems:detail.attachments.retryUpload", {
              name: upload.file.name,
            })}
            onClick={() => retryWorkItemUpload(upload.id)}
          >
            <RotateCw className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("workItems:detail.attachments.dismissUpload", {
              name: upload.file.name,
            })}
            onClick={() => dismissWorkItemUpload(upload.id)}
          >
            <X className="size-4" />
          </Button>
        </>
      ) : null}
    </li>
  );
}

/** AT-12: one row per file, each with its own progress bar and its own failure state. */
export function WorkItemUploadList({
  uploads,
}: {
  uploads: readonly WorkItemUpload[];
}) {
  const { t } = useTranslation();
  if (uploads.length === 0) return null;
  return (
    <ul
      className="flex flex-col gap-2"
      aria-label={t("workItems:detail.attachments.uploadsLabel")}
    >
      {uploads.map((upload) => (
        <UploadRow key={upload.id} upload={upload} />
      ))}
    </ul>
  );
}
