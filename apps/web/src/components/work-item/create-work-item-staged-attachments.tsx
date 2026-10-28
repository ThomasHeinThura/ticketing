import { Button } from "@taskdesk/ui";
import { Check, FileText, LoaderCircle, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { HttpError } from "@/lib/http-error";
import type { StagedWorkItemAttachment } from "./use-create-work-item-attachments";

/** Kaneo attachment-card styling; local previews never enter persisted editor JSON. */
export default function CreateWorkItemStagedAttachments({
  rows,
  onRemove,
  disabled,
}: {
  rows: StagedWorkItemAttachment[];
  onRemove: (id: number) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  if (!rows.length) return null;
  return (
    <section
      className="flex flex-col gap-2"
      aria-label={t("workItems:create.attachments.heading")}
    >
      {rows.map((row) => (
        <div
          key={row.id}
          className="flex items-center gap-2"
          data-testid="create-staged-attachment"
        >
          <div className="taskdesk-attachment-card flex-1 min-w-0">
            <span className="taskdesk-attachment-card-icon">
              {row.preview ? (
                <img
                  src={row.preview}
                  alt=""
                  className="size-8 rounded object-cover"
                />
              ) : (
                <FileText className="size-4" />
              )}
            </span>
            <span className="taskdesk-attachment-card-content">
              <span className="taskdesk-attachment-card-title">
                {row.file.name}
              </span>
              <span className="taskdesk-attachment-card-meta">
                {t(
                  `workItems:create.attachments.${row.state === "ready" ? "uploaded" : row.state === "uploading" ? "uploading" : row.state === "failed" ? "failed" : "staged"}`,
                )}
              </span>
              {row.state === "failed" ? (
                <span
                  role="alert"
                  className="text-xs text-destructive-foreground"
                >
                  {row.error instanceof HttpError &&
                  row.error.status < 500 &&
                  row.error.message
                    ? row.error.message
                    : t(
                        `workItems:create.attachments.${row.file.size === 0 ? "empty" : "unknown"}`,
                      )}
                </span>
              ) : null}
            </span>
            {row.state === "ready" ? <Check className="size-4" /> : null}
            {row.state === "uploading" ? (
              <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
            ) : null}
          </div>
          {row.state === "staged" || row.state === "failed" ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled}
              aria-label={t("workItems:create.attachments.remove", {
                name: row.file.name,
              })}
              onClick={() => onRemove(row.id)}
            >
              <X className="size-3.5" />
            </Button>
          ) : null}
        </div>
      ))}
    </section>
  );
}
