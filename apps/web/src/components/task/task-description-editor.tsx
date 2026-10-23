import { useTranslation } from "react-i18next";
import CommentEditor from "@/components/activity/comment-editor";
import { TASK_DESCRIPTION_EDITOR_CLASS } from "@/components/task/task-detail-presentation";

type TaskDescriptionEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  taskId?: string;
  ensureTaskId?: () => Promise<string | null>;
  /** Create flows stage files in memory instead of uploading to a task that does not exist yet. */
  onFilesSelected?: (files: File[]) => void;
  /** The form that owns the editor is locked (for example while a create is running). */
  disabled?: boolean;
};

export default function TaskDescriptionEditor({
  value,
  onChange,
  placeholder,
  taskId,
  ensureTaskId,
  onFilesSelected,
  disabled,
}: TaskDescriptionEditorProps) {
  const { t } = useTranslation();

  return (
    <CommentEditor
      value={value}
      onChange={onChange}
      placeholder={placeholder ?? t("tasks:detail.addDescription")}
      taskId={taskId}
      ensureTaskId={ensureTaskId}
      onFilesSelected={onFilesSelected}
      uploadSurface="description"
      disabled={disabled}
      className={TASK_DESCRIPTION_EDITOR_CLASS}
    />
  );
}
