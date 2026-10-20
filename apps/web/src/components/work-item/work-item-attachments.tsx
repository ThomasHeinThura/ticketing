import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@taskdesk/ui";
import { Paperclip, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  deleteAttachment,
  listWorkItemAttachments,
  uploadWorkItemAttachment,
} from "@/fetchers/attachment/work-item-attachments";
import { getApiUrl } from "@/fetchers/get-api-url";
import { formatDateMedium } from "@/lib/format";

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Work-item attachments (`attachments.md`): list, upload through presign → PUT → complete,
 * download through the API's short-lived redirect, and delete by the uploader.
 */
export default function WorkItemAttachments({
  workItemKey,
}: {
  workItemKey: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const queryKey = ["work-items", "attachments", workItemKey];
  const list = useQuery({
    queryKey,
    queryFn: () => listWorkItemAttachments(workItemKey),
  });
  const upload = useMutation({
    mutationFn: (file: File) => uploadWorkItemAttachment(workItemKey, file),
    onMutate: () => setError(null),
    onError: (cause) =>
      setError(
        cause instanceof Error
          ? cause.message
          : t("workItems:detail.attachments.uploadFailed"),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
  const remove = useMutation({
    mutationFn: deleteAttachment,
    onError: (cause) =>
      setError(
        cause instanceof Error
          ? cause.message
          : t("workItems:detail.attachments.deleteFailed"),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  const ready = (list.data ?? []).filter(
    (attachment) => attachment.state === "ready",
  );

  return (
    <section
      className="flex flex-col gap-2"
      aria-labelledby="work-item-attachments-heading"
      data-testid="work-item-attachments"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="work-item-attachments-heading" className="font-medium text-lg">
          {t("workItems:detail.attachments.heading")}
        </h2>
        <Button
          variant="outline"
          size="sm"
          disabled={upload.isPending}
          onClick={() => inputRef.current?.click()}
        >
          <Paperclip className="size-4" />
          {upload.isPending
            ? t("workItems:detail.attachments.uploading")
            : t("workItems:detail.attachments.add")}
        </Button>
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          aria-label={t("workItems:detail.attachments.add")}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) upload.mutate(file);
            event.target.value = "";
          }}
        />
      </div>
      {error ? (
        <p className="text-destructive-foreground text-sm" role="alert">
          {error}
        </p>
      ) : null}
      {list.isLoading ? (
        <p className="text-muted-foreground text-sm" role="status">
          {t("common:empty.loading")}
        </p>
      ) : list.isError ? (
        <p className="text-muted-foreground text-sm">
          {t("workItems:detail.attachments.loadFailed")}
        </p>
      ) : ready.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t("workItems:detail.attachments.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {ready.map((attachment) => (
            <li
              key={attachment.id}
              className="flex items-center gap-3 px-3 py-2 text-sm"
            >
              <Paperclip className="size-4 shrink-0 text-muted-foreground" />
              <a
                href={getApiUrl(`/attachments/${attachment.id}`)}
                className="min-w-0 flex-1 truncate hover:underline"
              >
                {attachment.filename}
              </a>
              <span className="shrink-0 text-muted-foreground text-xs">
                {formatBytes(attachment.size)} ·{" "}
                {formatDateMedium(attachment.createdAt)}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("workItems:detail.attachments.delete", {
                  name: attachment.filename,
                })}
                disabled={remove.isPending}
                onClick={() => remove.mutate(attachment.id)}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
