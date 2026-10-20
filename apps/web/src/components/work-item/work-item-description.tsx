import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import CommentEditor from "@/components/activity/comment-editor";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import type { WorkItemDetailRow } from "@/types/work-item";
import { useUpdateWorkItemFields } from "./work-item-properties";

/** Kaneo's description editor classes (`task-description-editor.tsx`). */
const EDITOR_CLASS =
  "[&_.taskdesk-comment-editor-content_.ProseMirror]:min-h-[11rem] [&_.taskdesk-comment-editor-content_.ProseMirror]:max-h-none [&_.taskdesk-comment-editor-content_.ProseMirror]:overflow-visible [&_.taskdesk-comment-editor-content_.ProseMirror]:px-0 [&_.taskdesk-comment-editor-content_.ProseMirror]:pt-1 [&_.taskdesk-comment-editor-content_.ProseMirror]:pb-2";

/**
 * The work item's description in kaneo's editor. Work items store the editor's Tiptap
 * document (`work_item.description` jsonb), so the document is saved, after a pause, with
 * the item's version. A legacy plain-text description opens as text and is saved back as
 * a document on the first edit.
 */
export default function WorkItemDescription({
  item,
  onAccessLost,
}: {
  item: WorkItemDetailRow;
  onAccessLost: () => void;
}) {
  const { t } = useTranslation();
  const { canUpdateTasks } = useWorkspacePermission(item.workspaceId);
  const update = useUpdateWorkItemFields(item, onAccessLost);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const isDocument =
    typeof item.description === "object" && item.description !== null;
  return (
    <CommentEditor
      value={typeof item.description === "string" ? item.description : ""}
      documentValue={isDocument ? item.description : undefined}
      onDocumentChange={(document) => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          timer.current = null;
          if (JSON.stringify(document) !== JSON.stringify(item.description)) {
            update.mutate({ description: document });
          }
        }, 1000);
      }}
      readOnly={!canUpdateTasks()}
      placeholder={t("tasks:detail.addDescription")}
      className={EDITOR_CLASS}
    />
  );
}
