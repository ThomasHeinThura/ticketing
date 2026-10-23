import { Textarea, type TextareaProps } from "@taskdesk/ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Original Kaneo task content composition, shared by legacy and canonical controllers. */
export function TaskDetailContentPresentation({
  heading,
  beforeSubtasks,
  subtasks,
  relations,
  supporting,
  activity,
  className,
  dataTestId,
}: {
  heading: ReactNode;
  beforeSubtasks?: ReactNode;
  subtasks: ReactNode;
  relations: ReactNode;
  supporting?: ReactNode;
  activity: ReactNode;
  className?: string;
  dataTestId?: string;
}) {
  return (
    <div className={cn(className, "gap-4")} data-testid={dataTestId}>
      <div className="flex flex-col gap-2.5">{heading}</div>
      {beforeSubtasks}
      <div className="mt-4">{subtasks}</div>
      <div className="mt-2">{relations}</div>
      {supporting}
      <span className="text-sm font-medium text-muted-foreground h-[1px] bg-border w-full block shrink-0" />
      {activity}
    </div>
  );
}

/** The original Properties body; data loading and mutations stay with each controller. */
export function TaskPropertiesPresentation({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">{children}</div>
  );
}

/** Original title typography with wrapping for long persisted titles. */
export function TaskTitlePresentation(props: TextareaProps) {
  return (
    <Textarea
      {...props}
      unstyled
      rows={1}
      className="block w-full [&_textarea]:min-h-0 [&_textarea]:resize-none [&_textarea]:border-0 [&_textarea]:bg-transparent [&_textarea]:p-0 [&_textarea]:font-heading [&_textarea]:font-semibold [&_textarea]:text-[2rem] [&_textarea]:text-foreground [&_textarea]:leading-[1.15] [&_textarea]:tracking-[-0.02em] [&_textarea]:outline-none"
    />
  );
}

/** Original task description shell; both controllers retain their own editor/save logic. */
export function TaskDescriptionPresentation({
  className,
  ...props
}: ComponentProps<"section">) {
  return (
    <section
      {...props}
      className={cn("taskdesk-tiptap-shell group", className)}
    />
  );
}

/** Original TaskDescription's content geometry and type, applied to the shared rich-text editor. */
export const TASK_DESCRIPTION_EDITOR_CLASS =
  "[&_.taskdesk-comment-editor-content_.ProseMirror]:min-h-[1.85rem] [&_.taskdesk-comment-editor-content_.ProseMirror]:max-h-none [&_.taskdesk-comment-editor-content_.ProseMirror]:overflow-visible [&_.taskdesk-comment-editor-content_.ProseMirror]:px-0 [&_.taskdesk-comment-editor-content_.ProseMirror]:pt-[0.2rem] [&_.taskdesk-comment-editor-content_.ProseMirror]:pb-[2.9rem] [&_.taskdesk-comment-editor-content_.ProseMirror]:text-[0.965rem] [&_.taskdesk-comment-editor-content_.ProseMirror]:leading-[1.72]";
